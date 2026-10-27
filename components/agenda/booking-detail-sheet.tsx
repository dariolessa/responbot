"use client"

import { CalendarClock, Copy, Loader2, MessageCircle, Phone, Send } from "lucide-react"
import Link from "next/link"
import { useEffect, useState, useTransition } from "react"

import {
  changeStatusAction,
  getBookingHistory,
  getDepositInfo,
  moveBookingAction,
  refundDepositAction,
  resendPaymentLink,
  type BookingHistoryItem,
  type DepositInfo,
} from "@/app/app/agenda/actions"
import { Field, FormError } from "@/components/forms/field"
import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { isOpen, statusLabels, transitions, type BookingStatus } from "@/lib/booking/policies"
import { formatPhone } from "@/lib/phone"
import { formatDate, minutesToTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { statusDotClass } from "./status"
import type { AgendaBooking, AgendaResource } from "./types"

const sourceLabels = { panel: "Panel", whatsapp: "WhatsApp", test_chat: "Chat de prueba" } as const
const depositLabels = { none: "Sin seña", pending: "Seña pendiente", paid: "Seña pagada", refunded: "Seña devuelta" }

/** Estados a los que el panel puede llevar un turno (vencer lo hace el sistema). */
type PanelTarget = Exclude<BookingStatus, "pending_payment" | "expired">

/** Acciones de estado que se ofrecen, en este orden. */
const statusButtons: { to: PanelTarget; label: string; variant: "default" | "outline" }[] = [
  { to: "confirmed", label: "Confirmar", variant: "default" },
  { to: "completed", label: "Atendido", variant: "default" },
  { to: "client_confirmed", label: "Confirmó el cliente", variant: "outline" },
  { to: "no_show", label: "No vino", variant: "outline" },
]

/** Detalle del turno en panel lateral (docs/SPEC.md, "Detalle de turno"). */
export function BookingDetailSheet({
  booking,
  resources,
  onClose,
  onChanged,
}: {
  booking: AgendaBooking | null
  resources: AgendaResource[]
  onClose: () => void
  onChanged: (message: string) => void
}) {
  return (
    <ResponsiveSheet
      open={booking !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={booking ? booking.customerName : "Turno"}
      description={booking ? `${booking.serviceName} · ${formatDate(booking.date, "EEEE d 'de' MMMM")}` : undefined}
    >
      {booking ? (
        <BookingDetail key={booking.id} booking={booking} resources={resources} onChanged={onChanged} />
      ) : null}
    </ResponsiveSheet>
  )
}

function BookingDetail({
  booking,
  resources,
  onChanged,
}: {
  booking: AgendaBooking
  resources: AgendaResource[]
  onChanged: (message: string) => void
}) {
  const [history, setHistory] = useState<BookingHistoryItem[] | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"view" | "cancel" | "move">("view")
  const [reason, setReason] = useState("")
  const [refundOnCancel, setRefundOnCancel] = useState(true)
  const [move, setMove] = useState({
    date: booking.date,
    time: minutesToTime(booking.startMin),
    resourceId: booking.resourceId,
  })

  useEffect(() => {
    let cancelled = false
    getBookingHistory({ bookingId: booking.id }).then((result) => {
      if (!cancelled && result.ok) setHistory(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [booking.id, booking.status, booking.startMin])

  const resource = resources.find((r) => r.id === booking.resourceId)
  const allowed = transitions[booking.status]
  const open = isOpen(booking.status)
  const phoneDigits = booking.customerPhone.replace(/\D/g, "")

  function setStatus(to: PanelTarget) {
    setError(null)
    startTransition(async () => {
      const result = await changeStatusAction({
        bookingId: booking.id,
        to,
        reason: reason || undefined,
        refundDeposit: to === "cancelled" && booking.depositStatus === "paid" ? refundOnCancel : undefined,
      })
      if (result.ok) {
        setMode("view")
        onChanged(`Turno marcado como "${statusLabels[to].toLowerCase()}".`)
      } else setError(result.error)
    })
  }

  function submitMove(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await moveBookingAction({ bookingId: booking.id, ...move })
      if (result.ok) {
        setMode("view")
        onChanged(`Turno movido al ${formatDate(move.date, "EEEE d")} a las ${move.time}.`)
      } else setError(result.error)
    })
  }

  return (
    <div className="grid gap-6">
      <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">Estado</dt>
        <dd className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", statusDotClass[booking.status])} />
          {statusLabels[booking.status]}
        </dd>
        <dt className="text-muted-foreground">Horario</dt>
        <dd className="font-mono">
          {minutesToTime(booking.startMin)}–{minutesToTime(booking.endMin)}
        </dd>
        <dt className="text-muted-foreground">Profesional</dt>
        <dd>{resource?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">Precio</dt>
        <dd className="font-mono">{booking.price}</dd>
        <dt className="text-muted-foreground">Seña</dt>
        <dd>
          {depositLabels[booking.depositStatus]}
          {booking.deposit ? <span className="font-mono"> · {booking.deposit}</span> : null}
        </dd>
        <dt className="text-muted-foreground">Reservado por</dt>
        <dd>{sourceLabels[booking.source]}</dd>
        {booking.cancelReason ? (
          <>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd>{booking.cancelReason}</dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/app/clientes/${booking.customerId}`}>Ver ficha</Link>
        </Button>
        {phoneDigits ? (
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={`tel:+${phoneDigits}`} aria-label={`Llamar al ${formatPhone(booking.customerPhone)}`}>
                <Phone />
                Llamar
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">
                <MessageCircle />
                WhatsApp
              </a>
            </Button>
          </>
        ) : null}
      </div>

      {booking.deposit ? (
        <DepositPanel
          key={`${booking.status}-${booking.depositStatus}`}
          bookingId={booking.id}
          onChanged={onChanged}
        />
      ) : null}

      {mode === "view" && (open || allowed.length > 0) ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            {statusButtons
              .filter((b) => allowed.includes(b.to))
              .map((b) => (
                <Button key={b.to} variant={b.variant} disabled={pending} onClick={() => setStatus(b.to)}>
                  {b.label}
                </Button>
              ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {open ? (
              <Button variant="outline" disabled={pending} onClick={() => setMode("move")}>
                <CalendarClock />
                Reprogramar
              </Button>
            ) : null}
            {allowed.includes("cancelled") ? (
              <Button
                variant="outline"
                className="text-destructive"
                disabled={pending}
                onClick={() => setMode("cancel")}
              >
                Cancelar turno
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "cancel" ? (
        <div className="grid gap-3 rounded-lg border p-4">
          <Field label="Motivo (opcional)" htmlFor="cancel-reason">
            <Input
              id="cancel-reason"
              value={reason}
              placeholder="Por ejemplo: avisó que no llega"
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </Field>
          {booking.depositStatus === "paid" ? (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={refundOnCancel} onChange={(e) => setRefundOnCancel(e.target.checked)} />
              Devolver la seña ({booking.deposit}) por Mercado Pago
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMode("view")} disabled={pending}>
              Volver
            </Button>
            <Button variant="destructive" onClick={() => setStatus("cancelled")} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Cancelar turno
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "move" ? (
        <form onSubmit={submitMove} className="grid gap-3 rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Día" htmlFor="move-date">
              <Input
                id="move-date"
                type="date"
                value={move.date}
                onChange={(e) => setMove({ ...move, date: e.target.value })}
                required
              />
            </Field>
            <Field label="Hora" htmlFor="move-time">
              <Input
                id="move-time"
                type="time"
                step={300}
                className="font-mono"
                value={move.time}
                onChange={(e) => setMove({ ...move, time: e.target.value })}
                required
              />
            </Field>
          </div>
          {resources.length > 1 ? (
            <Field label="Profesional" htmlFor="move-resource">
              <NativeSelect
                id="move-resource"
                value={move.resourceId}
                onChange={(e) => setMove({ ...move, resourceId: e.target.value })}
              >
                {resources
                  .filter((r) => r.serviceIds.includes(booking.serviceId) || r.id === booking.resourceId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode("view")} disabled={pending}>
              Volver
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Mover turno
            </Button>
          </div>
        </form>
      ) : null}

      <FormError message={error} />

      <section>
        <h3 className="mb-2 text-sm font-medium">Historial</h3>
        {history === null ? (
          <div className="grid gap-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <ol className="grid gap-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex gap-2">
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", statusDotClass[h.toStatus])} />
                <span className="min-w-0 flex-1">
                  {h.fromStatus === null
                    ? "Reservado"
                    : h.fromStatus === h.toStatus
                      ? "Reprogramado"
                      : statusLabels[h.toStatus]}
                  <span className="text-muted-foreground">
                    {" · "}
                    {h.actor} · {h.at}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/** Seña del turno: link de pago mientras se espera, lo que resta cobrar y la devolución. */
function DepositPanel({ bookingId, onChanged }: { bookingId: string; onChanged: (message: string) => void }) {
  const [info, setInfo] = useState<DepositInfo | null | undefined>(undefined)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    getDepositInfo({ bookingId }).then((result) => {
      if (!cancelled) setInfo(result.ok ? result.data : null)
    })
    return () => {
      cancelled = true
    }
  }, [bookingId])

  if (info === undefined) return <div className="h-16 animate-pulse rounded-lg bg-muted" />
  if (info === null) return null

  function resend() {
    setError(null)
    startTransition(async () => {
      const result = await resendPaymentLink({ bookingId })
      if (result.ok) {
        if (result.data.url) setInfo((i) => (i ? { ...i, paymentUrl: result.data.url } : i))
        onChanged("Le mandamos el link de la seña por WhatsApp.")
      } else setError(result.error)
    })
  }

  function refund() {
    if (!info) return
    const warning = info.refundByPolicy
      ? `¿Devolver la seña de ${info.amount}?`
      : `Según tu política de cancelación no corresponde devolverla. ¿Devolver igual ${info.amount}?`
    if (!window.confirm(warning)) return
    setError(null)
    startTransition(async () => {
      const result = await refundDepositAction({ bookingId })
      if (result.ok) {
        setInfo((i) => (i ? { ...i, refund: "pending", refundError: null } : i))
        onChanged("Estamos devolviendo la seña por Mercado Pago.")
      } else setError(result.error)
    })
  }

  async function copy() {
    if (!info?.paymentUrl) return
    try {
      await navigator.clipboard.writeText(info.paymentUrl)
      setCopied(true)
    } catch {
      setError("No se pudo copiar. Abrí el link y copialo desde ahí.")
    }
  }

  const refundText = {
    pending: "Devolución en curso.",
    refunded: "Seña devuelta.",
    failed: `No se pudo devolver${info.refundError ? `: ${info.refundError}` : "."}`,
    none: null,
  }[info.refund]

  return (
    <div className="grid gap-3 rounded-lg border p-4 text-sm">
      {info.holdUntil ? (
        <>
          <p>
            Esperando la seña de <span className="font-mono">{info.amount}</span>. El turno se guarda hasta las{" "}
            <span className="font-mono">{info.holdUntil}</span>; si no llega, se libera solo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={resend}>
              <Send />
              Reenviar link
            </Button>
            {info.paymentUrl ? (
              <Button variant="outline" size="sm" onClick={copy}>
                <Copy />
                {copied ? "Copiado" : "Copiar link"}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {info.remaining && !info.cancelled ? (
        <p>
          Seña pagada. Al cobrar en el local, restan <span className="font-mono">{info.remaining}</span>.
        </p>
      ) : null}
      {info.remaining && info.cancelled && info.refund === "none" ? (
        <p className="text-muted-foreground">
          {info.refundByPolicy
            ? "El turno se canceló a tiempo: según tu política, la seña se devuelve."
            : "El turno se canceló fuera de plazo: según tu política, la seña no se devuelve."}
        </p>
      ) : null}
      {refundText ? <p className={info.refund === "failed" ? "text-destructive" : "text-muted-foreground"}>{refundText}</p> : null}
      {info.canRefund && info.cancelled && info.remaining !== null && (info.refund === "none" || info.refund === "failed") ? (
        <Button variant="outline" size="sm" className="justify-self-start" disabled={pending} onClick={refund}>
          {info.refund === "failed" ? "Reintentar devolución" : "Devolver seña"}
        </Button>
      ) : null}
      <FormError message={error} />
    </div>
  )
}

