import { ExternalLink, LifeBuoy } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { roleLabels } from "@/lib/auth/roles"
import { adminBusinessDetail } from "@/lib/pilots/admin"
import type { ProblemKind } from "@/lib/support/detail"
import { formatZoned } from "@/lib/time"
import { cn } from "@/lib/utils"

import { extendTrialAction, setPilotAction, startSupportAction } from "../../actions"
import { statusLabels, statusVariant } from "../../labels"

export const metadata: Metadata = { title: "Ficha del negocio" }
export const dynamic = "force-dynamic"

const TZ = "America/Montevideo"

const connectionLabels = { active: "Conectado", disconnected: "Desconectado", token_expired: "Venció el permiso" } as const
const catalogLabels = { pending: "En cola", running: "Importando", ok: "Al día", error: "Con error" } as const
const problemLabels: Record<ProblemKind, string> = {
  bot: "Bot",
  whatsapp: "WhatsApp",
  scheduled: "Programado",
  notification: "Aviso",
  catalog: "Catálogo",
}

function when(date: Date | null | undefined, pattern = "d MMM yyyy, HH:mm") {
  return date ? formatZoned(date, TZ, pattern) : "—"
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid content-start gap-3 rounded-[10px] border p-5", className)}>
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  )
}

export default async function BusinessSupportPage({ params, searchParams }: PageProps<"/admin/soporte/[businessId]">) {
  const { businessId } = await params
  const { listo } = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) notFound()
  const detail = await adminBusinessDetail(businessId)
  if (!detail) notFound()

  const { business: b, billing, usage, members, connections, counts, metrics } = detail
  const owner = members.find((m) => m.role === "owner")
  const now = new Date()

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/admin/soporte" className="text-sm text-muted-foreground hover:text-foreground">
            ← Soporte
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{b.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {owner?.email ?? "Sin dueño"} · alta el {when(b.createdAt, "d MMM yyyy")} · {b.slug}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {b.isDemo ? <Badge>Demo</Badge> : null}
            <Badge variant={statusVariant(billing.status)}>{statusLabels[billing.status]}</Badge>
            <Badge variant="outline">Plan {billing.plan.name}</Badge>
          </div>
        </div>
        <form action={startSupportAction}>
          <input type="hidden" name="businessId" value={b.id} />
          <Button type="submit">
            <LifeBuoy />
            Entrar a su panel
          </Button>
        </form>
      </div>

      {listo === "prueba" ? (
        <p role="status" className="mb-6 rounded-[10px] border border-emerald-600/40 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          Listo: la prueba ahora termina el {when(b.trialEndsAt, "d 'de' MMMM")}.
        </p>
      ) : null}

      <p className="mb-6 text-sm text-muted-foreground">
        “Entrar a su panel” te muestra su panel con el rol Admin (sin Facturación). Lo que hagas queda a tu nombre y en la
        auditoría de abajo. Dura dos horas o hasta que toques “Salir del modo soporte”.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Cuenta">
          <dl className="grid gap-1.5">
            <Row label="Estado">{statusLabels[billing.status]}</Row>
            <Row label="Fin de la prueba">{when(b.trialEndsAt)}</Row>
            <Row label="Piloto hasta">{b.pilotEndsAt && b.pilotEndsAt > now ? when(b.pilotEndsAt) : "No es piloto"}</Row>
            <Row label="Suscripción">
              {b.subscriptionStatus ?? "Sin suscripción"}
              {b.cancelAtPeriodEnd ? " (se cancela al fin del período)" : ""}
            </Row>
            <Row label="Período actual hasta">{when(b.currentPeriodEnd)}</Row>
            {b.paymentFailedAt ? <Row label="Cobro fallido desde">{when(b.paymentFailedAt)}</Row> : null}
            <Row label="Cliente de Stripe">
              {b.stripeCustomerId ? (
                <a
                  href={`https://dashboard.stripe.com/customers/${b.stripeCustomerId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs underline"
                >
                  {b.stripeCustomerId}
                  <ExternalLink className="size-3" />
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label={`Uso de ${usage.period}`}>
              {usage.conversations.used}/{usage.conversations.limit} conversaciones · {usage.templates.used}/
              {usage.templates.limit} plantillas
            </Row>
            <Row label="Zona horaria y moneda">
              {b.timezone} · {b.currency}
            </Row>
          </dl>

          {b.isDemo ? null : (
            <div className="grid gap-3 border-t pt-4">
              <form action={extendTrialAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="businessId" value={b.id} />
                <label className="grid min-w-48 flex-1 gap-1 text-sm">
                  <span className="text-muted-foreground">Extender la prueba</span>
                  <NativeSelect name="days" defaultValue="14" aria-label="Días de prueba extra">
                    <option value="7">7 días más</option>
                    <option value="14">14 días más</option>
                    <option value="30">30 días más</option>
                  </NativeSelect>
                </label>
                <Button type="submit" variant="outline">
                  Extender
                </Button>
              </form>
              <form action={setPilotAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="businessId" value={b.id} />
                <label className="grid min-w-48 flex-1 gap-1 text-sm">
                  <span className="text-muted-foreground">Piloto</span>
                  <NativeSelect name="days" defaultValue="60" aria-label="Duración del piloto">
                    <option value="30">Piloto por 30 días desde hoy</option>
                    <option value="60">Piloto por 60 días desde hoy</option>
                    <option value="90">Piloto por 90 días desde hoy</option>
                    <option value="0">Quitar el piloto</option>
                  </NativeSelect>
                </label>
                <Button type="submit" variant="outline">
                  Guardar
                </Button>
              </form>
            </div>
          )}
        </Section>

        <Section title="Conexiones">
          <dl className="grid gap-1.5">
            <Row label="WhatsApp">
              {connections.whatsapp
                ? `${connectionLabels[connections.whatsapp.status]} · ${connections.whatsapp.displayPhone}${connections.whatsapp.verifiedName ? ` (${connections.whatsapp.verifiedName})` : ""}`
                : "Sin conectar"}
            </Row>
            <Row label="Mercado Pago">
              {connections.mercadopago
                ? `${connectionLabels[connections.mercadopago.status]}${connections.mercadopago.displayName ? ` · ${connections.mercadopago.displayName}` : ""}${connections.mercadopago.liveMode ? "" : " · credenciales de prueba"} · permiso hasta ${when(connections.mercadopago.expiresAt, "d MMM")}`
                : "Sin conectar"}
            </Row>
            {connections.catalog.length === 0 ? (
              <Row label="Catálogo web">Sin fuentes</Row>
            ) : (
              connections.catalog.map((c) => (
                <Row key={c.url} label="Catálogo web">
                  <span className="block truncate">{c.url}</span>
                  <span className={cn("block text-xs", c.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                    {catalogLabels[c.status]} · {c.itemCount} fichas · {when(c.lastImportedAt)}
                    {c.lastError ? ` · ${c.lastError}` : ""}
                  </span>
                </Row>
              ))
            )}
          </dl>
        </Section>

        <Section title="Configuración">
          <dl className="grid gap-1.5">
            <Row label="Servicios activos">{counts.services}</Row>
            <Row label="Profesionales o recursos">{counts.staff}</Row>
            <Row label="Clientes">{counts.customers}</Row>
            <Row label="Turnos por venir">{counts.upcomingBookings}</Row>
            <Row label="Bot">{detail.botConfigured ? `Configurado · ${counts.faq} preguntas frecuentes` : "Sin configurar"}</Row>
            <Row label="Alta">
              {detail.pendingSteps.length === 0
                ? "Completa"
                : `Le falta: ${detail.pendingSteps.map((s) => s.title.toLowerCase()).join(", ")}`}
            </Row>
          </dl>
        </Section>

        <Section title="Equipo">
          <ul className="grid gap-2 text-sm">
            {members.map((m) => (
              <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">{m.name ?? m.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.email}
                    {m.phoneE164 ? ` · ${m.phoneE164}` : ""}
                    {m.emailBouncedAt ? " · el correo rebota" : ""}
                  </span>
                </span>
                <span className="flex gap-1.5">
                  <Badge variant="outline">{roleLabels[m.role]}</Badge>
                  {m.active ? null : <Badge variant="secondary">Inactivo</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Últimos 30 días" className="mt-4">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {(
            [
              ["Clientes", metrics.conversations],
              ["Turnos del bot", metrics.botBookings],
              ["Derivaciones", metrics.handoffs],
              ["Errores", metrics.botErrors],
              ["Bien", metrics.goodReplies],
              ["Mal", metrics.badReplies],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="grid gap-0.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="font-mono text-sm">{value}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Problemas de los últimos 14 días" className="mt-4">
        {detail.problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No falló nada en estos días.</p>
        ) : (
          <ul className="divide-y text-sm">
            {detail.problems.map((p, i) => (
              <li key={i} className="grid gap-1 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{problemLabels[p.kind]}</Badge>
                  <span className="font-medium">{p.title}</span>
                  <span className="text-xs text-muted-foreground">{when(p.at)}</span>
                </div>
                {p.detail ? <p className="font-mono text-xs break-words text-muted-foreground">{p.detail}</p> : null}
                {p.conversationId ? (
                  <Link
                    href={`/admin/soporte/${b.id}/conversaciones/${p.conversationId}`}
                    className="text-xs underline"
                  >
                    Ver la conversación
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Conversaciones" className="mt-4">
        {detail.conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no tiene conversaciones.</p>
        ) : (
          <ul className="divide-y text-sm">
            {detail.conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/soporte/${b.id}/conversaciones/${c.id}`}
                  className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {c.customerName ?? c.customerPhone}
                      {c.isTest ? " (chat de prueba)" : ""}
                    </span>
                    <span className="block truncate text-muted-foreground">{c.preview ?? "Sin mensajes"}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.mode === "human" ? <Badge variant="secondary">Atiende una persona</Badge> : null}
                    {when(c.lastMessageAt, "d MMM, HH:mm")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Auditoría" className="mt-4">
        {detail.audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
        ) : (
          <ul className="divide-y text-sm">
            {detail.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.actorEmail ?? "Sistema"}</span>
                </span>
                <span className="text-xs text-muted-foreground">{when(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
