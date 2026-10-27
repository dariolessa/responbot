import { and, asc, eq, lte } from "drizzle-orm"

import { changeBookingStatus } from "@/lib/booking/create"
import { bookingPayload, onBookingChange } from "@/lib/booking/customer-messages"
import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"
import {
  MercadoPagoError,
  type MercadoPagoApi,
  type MpPayment,
  type MpTokens,
} from "@/lib/integrations/mercadopago/api"
import { formatMoney } from "@/lib/money"
import { notify } from "@/lib/notifications/dispatch"
import { withCompleted } from "@/lib/onboarding/steps"

/*
 * Señas con Mercado Pago (docs/SPEC.md, "Mercado Pago" y "Señas"): la cuenta
 * de cada negocio, el link de pago de cada turno retenido, los pagos que
 * avisa el webhook, las devoluciones y el vencimiento de las retenciones.
 *
 * Lo que habla con Mercado Pago recibe sus dependencias (`PaymentDeps`) para
 * que los tests lo simulen. Las devoluciones se piden en la base (dentro de la
 * transacción del cambio) y se procesan después, como los avisos.
 */

export type PaymentDeps = {
  api: MercadoPagoApi
  encrypt(value: string): string
  decrypt(value: string): string
  /** URL pública del webhook (notification_url de cada preferencia). */
  notificationUrl: string
  /** Adónde vuelve el cliente después de pagar. */
  backUrl: string | null
}

/** Se renueva el token si vence antes de esto (Mercado Pago da 180 días). */
const REFRESH_BEFORE_MS = 7 * 86_400_000
/** El cron diario renueva los que vencen dentro de este plazo. */
export const HEALTH_REFRESH_BEFORE_MS = 30 * 86_400_000

const systemActor = { type: "system" as const, id: null, channel: "system" as const }

export class PaymentError extends Error {}

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; cause?: unknown }
    if (e.code === "23505") return true
    current = e.cause
  }
  return false
}

export async function saveMpConnection(
  scoped: ScopedDb,
  actorId: string,
  input: { tokens: MpTokens; displayName: string | null },
  encrypt: (value: string) => string,
  now: Date = new Date(),
): Promise<schema.MpAccount> {
  const values = {
    mpUserId: String(input.tokens.user_id),
    displayName: input.displayName,
    liveMode: input.tokens.live_mode ?? true,
    accessTokenEnc: encrypt(input.tokens.access_token),
    refreshTokenEnc: encrypt(input.tokens.refresh_token),
    expiresAt: new Date(now.getTime() + input.tokens.expires_in * 1000),
    status: "active" as const,
  }
  let account: schema.MpAccount | undefined
  try {
    const existing = await scoped.mpAccounts.findFirst()
    ;[account] = existing
      ? await scoped.mpAccounts.update(eq(schema.mpAccounts.id, existing.id), values)
      : await scoped.mpAccounts.insert(values)
  } catch (error) {
    if (isUniqueViolation(error)) throw new PaymentError("Esa cuenta de Mercado Pago ya está conectada a otro negocio.")
    throw error
  }
  if (!account) throw new Error("mercadopago: no se pudo guardar la conexión")
  await scoped.auditLogs.insert({
    actorId,
    action: "mercadopago.connected",
    targetType: "mp_account",
    targetId: account.id,
    metadata: { mpUserId: values.mpUserId, displayName: values.displayName, liveMode: values.liveMode },
  })
  const business = await scoped.business()
  if (business && !business.onboardingCompleted.includes("mercadopago")) {
    await scoped.updateBusiness({ onboardingCompleted: withCompleted(business.onboardingCompleted, "mercadopago") })
  }
  return account
}

/** Borra la conexión (los tokens dejan de guardarse). Los turnos retenidos siguen hasta pagarse o vencer. */
export async function removeMpConnection(scoped: ScopedDb, actorId: string) {
  const [account] = await scoped.mpAccounts.delete()
  if (!account) return null
  await scoped.auditLogs.insert({
    actorId,
    action: "mercadopago.disconnected",
    targetType: "mp_account",
    targetId: account.id,
    metadata: { mpUserId: account.mpUserId, displayName: account.displayName },
  })
  const business = await scoped.business()
  if (business?.onboardingCompleted.includes("mercadopago")) {
    await scoped.updateBusiness({
      onboardingCompleted: business.onboardingCompleted.filter((s) => s !== "mercadopago"),
    })
  }
  return account
}

/** El token dejó de servir: avisa a dueño y admins (panel y correo) una sola vez. */
export async function markMercadoPagoBroken(scoped: ScopedDb, now: Date = new Date()): Promise<boolean> {
  const [changed] = await scoped.mpAccounts.update(eq(schema.mpAccounts.status, "active"), { status: "token_expired" })
  if (!changed) return false
  await notify(scoped, { type: "mercadopago.disconnected", payload: {}, now })
  return true
}

/** Token vigente de la cuenta; lo renueva si está por vencer. */
export async function accessToken(
  scoped: ScopedDb,
  account: schema.MpAccount,
  deps: PaymentDeps,
  now: Date,
  refreshBeforeMs = REFRESH_BEFORE_MS,
): Promise<string> {
  if (account.expiresAt.getTime() - now.getTime() > refreshBeforeMs) return deps.decrypt(account.accessTokenEnc)
  try {
    const tokens = await deps.api.refreshTokens(deps.decrypt(account.refreshTokenEnc))
    await scoped.mpAccounts.update(eq(schema.mpAccounts.id, account.id), {
      accessTokenEnc: deps.encrypt(tokens.access_token),
      refreshTokenEnc: deps.encrypt(tokens.refresh_token),
      expiresAt: new Date(now.getTime() + tokens.expires_in * 1000),
    })
    return tokens.access_token
  } catch (error) {
    if (error instanceof MercadoPagoError && (error.tokenInvalid || error.status === 400)) {
      await markMercadoPagoBroken(scoped, now)
      throw new PaymentError("Mercado Pago se desconectó. Hay que volver a conectarlo.")
    }
    // Error pasajero: si el token todavía no venció, se usa igual.
    if (account.expiresAt > now) return deps.decrypt(account.accessTokenEnc)
    throw error
  }
}

async function activeAccount(scoped: ScopedDb) {
  return scoped.mpAccounts.findFirst(eq(schema.mpAccounts.status, "active"))
}

// ---------------------------------------------------------------------------
// Link de pago
// ---------------------------------------------------------------------------

/** Link de Checkout Pro del turno retenido; lo crea la primera vez. */
export async function ensurePaymentLink(
  scoped: ScopedDb,
  booking: schema.Booking,
  deps: PaymentDeps,
  now: Date = new Date(),
): Promise<string> {
  if (booking.paymentUrl) return booking.paymentUrl
  if (booking.status !== "pending_payment" || !booking.holdExpiresAt || booking.depositAmount <= 0) {
    throw new PaymentError("Ese turno no espera una seña.")
  }
  const account = await activeAccount(scoped)
  if (!account) throw new PaymentError("Mercado Pago no está conectado.")
  const token = await accessToken(scoped, account, deps, now)
  const [business, service] = await Promise.all([scoped.business(), scoped.services.findById(booking.serviceId)])
  const preference = await deps.api.createPreference(token, {
    bookingId: booking.id,
    title: `Seña: ${service?.name ?? "turno"} en ${business?.name ?? "el local"}`,
    amount: booking.depositAmount,
    currency: booking.currency,
    notificationUrl: deps.notificationUrl,
    expiresAt: booking.holdExpiresAt,
    backUrl: deps.backUrl ?? undefined,
  })
  const url = account.liveMode ? preference.init_point : (preference.sandbox_init_point ?? preference.init_point)
  await scoped.bookings.update(eq(schema.bookings.id, booking.id), {
    paymentUrl: url,
    paymentPreferenceId: preference.id,
  })
  return url
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Montos de Mercado Pago (con decimales) a centésimos. */
const toCents = (value: number | undefined) => Math.round((value ?? 0) * 100)

export type SyncResult =
  | "confirmed"
  | "paid"
  | "refund_requested"
  | "refunded"
  | "recorded"
  | "ignored"

/**
 * Aplica un pago consultado a Mercado Pago (del webhook o del cron). Guarda
 * el pago y, si está aprobado, confirma el turno retenido. Si el turno ya no
 * se puede confirmar (se canceló, o venció y el horario se ocupó), pide la
 * devolución automática.
 */
export async function applyPayment(scoped: ScopedDb, payment: MpPayment, now: Date = new Date()): Promise<SyncResult> {
  const bookingId = payment.external_reference ?? ""
  if (!UUID.test(bookingId)) return "ignored"
  const providerPaymentId = String(payment.id)

  return scoped.transaction(async (tx) => {
    const booking = await tx.bookings.findById(bookingId)
    if (!booking) return "ignored"

    const amount = toCents(payment.transaction_amount)
    const existing = await tx.payments.findFirst(eq(schema.payments.providerPaymentId, providerPaymentId))
    const values = {
      bookingId: booking.id,
      provider: "mercadopago" as const,
      providerPaymentId,
      amount,
      currency: payment.currency_id,
      status: payment.status,
      raw: payment as unknown as Record<string, unknown>,
    }
    const [row] = existing
      ? await tx.payments.update(eq(schema.payments.id, existing.id), values)
      : await tx.payments.insert(values)
    if (!row) return "ignored"

    if (payment.status === "refunded" || payment.status === "charged_back") {
      await tx.payments.update(eq(schema.payments.id, row.id), {
        refundStatus: "refunded",
        refundedAmount: toCents(payment.transaction_amount_refunded) || amount,
      })
      if (booking.depositStatus === "paid" || booking.depositStatus === "pending") {
        await tx.bookings.update(eq(schema.bookings.id, booking.id), { depositStatus: "refunded" })
      }
      return "refunded"
    }
    if (payment.status !== "approved") return "recorded"
    if (existing?.status === "approved" && booking.depositStatus !== "pending") return "recorded"

    const enough = payment.currency_id === booking.currency && amount >= booking.depositAmount
    if (!enough) {
      console.warn("[mercadopago] pago aprobado por otro monto o moneda", booking.id, providerPaymentId)
      return "recorded"
    }

    if (booking.status === "pending_payment") {
      await tx.bookings.update(eq(schema.bookings.id, booking.id), { depositStatus: "paid" })
      await changeBookingStatus(tx, { bookingId: booking.id, to: "confirmed" }, systemActor, { now })
      await notifyDepositPaid(tx, booking, now)
      return "confirmed"
    }

    if (booking.status === "expired" && booking.startsAt > now) {
      // Pagó justo después del vencimiento: si el horario sigue libre, el turno vuelve.
      let revived = false
      try {
        await tx.transaction(async (inner) => {
          await inner.bookings.update(eq(schema.bookings.id, booking.id), { status: "confirmed", depositStatus: "paid" })
        })
        revived = true
      } catch {
        // El horario ya se ocupó (exclusión de la base): se devuelve la seña.
      }
      if (revived) {
        await tx.bookingEvents.insert({
          bookingId: booking.id,
          fromStatus: "expired",
          toStatus: "confirmed",
          actorType: "system",
          actorId: null,
          channel: "system",
        })
        const current = (await tx.bookings.findById(booking.id))!
        await onBookingChange(tx, current, { kind: "status", from: "pending_payment" }, systemActor, now)
        await notifyDepositPaid(tx, current, now)
        return "confirmed"
      }
    }

    if (booking.status === "expired" || booking.status === "cancelled") {
      await tx.payments.update(eq(schema.payments.id, row.id), { refundStatus: "pending" })
      await tx.bookings.update(eq(schema.bookings.id, booking.id), { depositStatus: "paid" })
      return "refund_requested"
    }

    if (booking.depositStatus !== "paid") {
      await tx.bookings.update(eq(schema.bookings.id, booking.id), { depositStatus: "paid" })
    }
    return "paid"
  })
}

async function notifyDepositPaid(scoped: ScopedDb, booking: schema.Booking, now: Date) {
  const business = await scoped.business()
  await notify(scoped, {
    type: "deposit.paid",
    payload: {
      ...(await bookingPayload(scoped, booking, business?.timezone ?? "UTC")),
      amount: formatMoney(booking.depositAmount, booking.currency),
    },
    resourceId: booking.resourceId,
    now,
  })
}

/** Webhook: consulta el pago con el token del negocio y lo aplica. */
export async function syncPayment(
  scoped: ScopedDb,
  paymentId: string,
  deps: PaymentDeps,
  now: Date = new Date(),
): Promise<SyncResult> {
  const account = await scoped.mpAccounts.findFirst()
  if (!account) return "ignored"
  const token = await accessToken(scoped, account, deps, now)
  const payment = await deps.api.getPayment(token, paymentId)
  return applyPayment(scoped, payment, now)
}

// ---------------------------------------------------------------------------
// Devoluciones
// ---------------------------------------------------------------------------

/** Pago aprobado de la seña de un turno, si lo hay. */
export async function depositPayment(scoped: ScopedDb, bookingId: string) {
  return scoped.payments.findFirst(
    and(eq(schema.payments.bookingId, bookingId), eq(schema.payments.status, "approved")),
    asc(schema.payments.createdAt),
  )
}

/** Marca la seña para devolver (se procesa enseguida, fuera de la transacción). */
export async function requestDepositRefund(scoped: ScopedDb, bookingId: string): Promise<boolean> {
  const booking = await scoped.bookings.findById(bookingId)
  if (!booking || booking.depositStatus !== "paid") return false
  const payment = await depositPayment(scoped, bookingId)
  if (!payment || payment.refundStatus === "pending" || payment.refundStatus === "refunded") return false
  await scoped.payments.update(eq(schema.payments.id, payment.id), { refundStatus: "pending", refundError: null })
  return true
}

/**
 * ¿La política permite devolver la seña? Si canceló el negocio, siempre; si
 * canceló el cliente, solo con al menos `cancel_hours` de anticipación.
 */
export function refundAllowedByPolicy(input: {
  booking: Pick<schema.Booking, "status" | "startsAt">
  cancelledBy: schema.BookingEvent["actorType"] | null
  cancelledAt: Date | null
  cancelHours: number
}): boolean {
  if (input.booking.status !== "cancelled") return false
  if (input.cancelledBy === "user" || input.cancelledBy === "system") return true
  if (!input.cancelledAt) return false
  return input.booking.startsAt.getTime() - input.cancelledAt.getTime() >= input.cancelHours * 3_600_000
}

/** Manda a Mercado Pago las devoluciones pedidas. */
export async function processPendingRefunds(
  scoped: ScopedDb,
  deps: PaymentDeps | null,
  now: Date = new Date(),
): Promise<{ refunded: number; failed: number }> {
  const pending = await scoped.payments.findMany({
    where: eq(schema.payments.refundStatus, "pending"),
    orderBy: asc(schema.payments.updatedAt),
    limit: 20,
  })
  const totals = { refunded: 0, failed: 0 }
  if (pending.length === 0 || !deps) return totals
  const account = await scoped.mpAccounts.findFirst()

  for (const payment of pending) {
    // Se toma la fila; si otro proceso ya la tomó, no coincide y se saltea.
    const [claimed] = await scoped.payments.update(
      and(eq(schema.payments.id, payment.id), eq(schema.payments.refundStatus, "pending")),
      { refundStatus: "failed", refundError: "Procesando…" },
    )
    if (!claimed) continue
    try {
      if (!account) throw new PaymentError("Mercado Pago no está conectado.")
      const token = await accessToken(scoped, account, deps, now)
      await deps.api.refundPayment(token, payment.providerPaymentId, null)
      await scoped.transaction(async (tx) => {
        await tx.payments.update(eq(schema.payments.id, payment.id), {
          refundStatus: "refunded",
          refundedAmount: payment.amount,
          refundError: null,
        })
        const [booking] = await tx.bookings.update(eq(schema.bookings.id, payment.bookingId), {
          depositStatus: "refunded",
        })
        if (booking) {
          await tx.scheduledMessages.insert({
            bookingId: booking.id,
            customerId: booking.customerId,
            kind: "deposit_refunded",
            sendAt: now,
          })
        }
      })
      totals.refunded++
    } catch (error) {
      console.error("[mercadopago] no se pudo devolver la seña", payment.id, error instanceof Error ? error.message : error)
      const message =
        error instanceof PaymentError
          ? error.message
          : error instanceof MercadoPagoError
            ? `Mercado Pago no aceptó la devolución (${error.message}).`
            : "No pudimos hablar con Mercado Pago."
      await scoped.payments.update(eq(schema.payments.id, payment.id), { refundStatus: "failed", refundError: message })
      totals.failed++
    }
  }
  return totals
}

// ---------------------------------------------------------------------------
// Vencimiento de retenciones (cron expire-holds)
// ---------------------------------------------------------------------------

/**
 * Turnos retenidos cuya seña no llegó a tiempo: antes de vencerlos se
 * pregunta a Mercado Pago (por si el webhook se perdió); si no hay pago
 * aprobado, pasan a vencidos y el horario se libera (aviso al cliente y a la
 * lista de espera).
 */
export async function expireHolds(
  scoped: ScopedDb,
  deps: PaymentDeps | null,
  now: Date = new Date(),
): Promise<{ expired: number; paid: number }> {
  const due = await scoped.bookings.findMany({
    where: and(eq(schema.bookings.status, "pending_payment"), lte(schema.bookings.holdExpiresAt, now)),
    orderBy: asc(schema.bookings.holdExpiresAt),
    limit: 50,
  })
  const totals = { expired: 0, paid: 0 }
  const account = due.length ? await activeAccount(scoped) : undefined
  for (const booking of due) {
    if (deps && account) {
      try {
        const token = await accessToken(scoped, account, deps, now)
        const approved = (await deps.api.searchPayments(token, booking.id)).find((p) => p.status === "approved")
        if (approved && (await applyPayment(scoped, approved, now)) === "confirmed") {
          totals.paid++
          continue
        }
      } catch (error) {
        console.error("[mercadopago] no se pudo revisar el pago antes de vencer", booking.id, error)
      }
    }
    try {
      await changeBookingStatus(scoped, { bookingId: booking.id, to: "expired" }, systemActor, { now })
      totals.expired++
    } catch (error) {
      // Cambió mientras tanto (se pagó o se canceló).
      console.warn("[mercadopago] no se pudo vencer la retención", booking.id, error instanceof Error ? error.message : error)
    }
  }

  return totals
}
