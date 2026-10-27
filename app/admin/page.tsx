import { MessageCircle } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import type { BillingStatus } from "@/lib/billing/state"
import { adminOverview } from "@/lib/pilots/admin"
import type { PilotRow } from "@/lib/pilots/overview"
import { formatZoned } from "@/lib/time"
import { cn } from "@/lib/utils"

import { createDemoAction, setPilotAction } from "./actions"

export const metadata: Metadata = { title: "Pilotos" }
export const dynamic = "force-dynamic"

const TZ = "America/Montevideo"

const statusLabels: Record<BillingStatus, string> = {
  trialing: "En prueba",
  trial_expired: "Prueba terminada",
  active: "Pago",
  past_due: "Pago pendiente",
  suspended: "Suspendido",
  canceled: "Sin plan",
  pilot: "Piloto",
}

const periods = [7, 30] as const

function Metric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-sm", warn && value > 0 && "text-destructive")}>{value}</span>
    </div>
  )
}

function BusinessCard({ row, days }: { row: PilotRow; days: number }) {
  const m = row.metrics
  return (
    <li className="grid gap-4 rounded-[10px] border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-sm text-muted-foreground">{row.ownerEmail ?? "Sin dueño"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.isDemo ? <Badge>Demo</Badge> : null}
          <Badge variant={row.status === "trial_expired" || row.status === "suspended" ? "destructive" : "secondary"}>
            {statusLabels[row.status]}
          </Badge>
          <Badge variant="outline">
            <MessageCircle />
            {row.whatsappConnected ? "WhatsApp conectado" : "Sin WhatsApp"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        <Metric label="Clientes" value={m.conversations} />
        <Metric label="Turnos del bot" value={m.botBookings} />
        <Metric label="Derivaciones" value={m.handoffs} />
        <Metric label="Errores" value={m.botErrors} warn />
        <Metric label="Bien" value={m.goodReplies} />
        <Metric label="Mal" value={m.badReplies} warn />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Últimos {days} días. Alta el {formatZoned(row.createdAt, TZ, "d MMM yyyy")}.</p>

      {row.isDemo ? null : (
        <form action={setPilotAction} className="flex flex-wrap items-end gap-2 border-t pt-4">
          <input type="hidden" name="businessId" value={row.id} />
          <label className="grid min-w-48 flex-1 gap-1 text-sm">
            <span className="text-muted-foreground">
              {row.pilotEndsAt && row.pilotEndsAt > new Date()
                ? `Piloto hasta el ${formatZoned(row.pilotEndsAt, TZ, "d 'de' MMMM")}`
                : "No es piloto"}
            </span>
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
      )}
    </li>
  )
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const { dias, demo } = await searchParams
  const days = periods.find((p) => String(p) === dias) ?? 7
  const rows = await adminOverview(days)
  const demoRow = rows.find((r) => r.isDemo)
  const others = rows.filter((r) => !r.isDemo).reverse()
  const pilots = others.filter((r) => r.status === "pilot").length

  return (
    <>
      <PageHeader
        title="Pilotos"
        description={`${others.length} ${others.length === 1 ? "negocio" : "negocios"}, ${pilots} ${pilots === 1 ? "piloto" : "pilotos"}.`}
        actions={periods.map((p) => (
          <Button key={p} asChild size="sm" variant={p === days ? "secondary" : "ghost"}>
            <Link href={`/admin?dias=${p}`}>{p} días</Link>
          </Button>
        ))}
      />

      <section className="mb-10 grid gap-3 rounded-[10px] border p-5">
        <h2 className="font-medium">Demo pública</h2>
        {demoRow ? (
          <>
            <p className="text-sm text-muted-foreground">
              {demo === "lista" ? "Listo: la demo está creada y sos su dueño. " : null}
              <span className="font-medium text-foreground">{demoRow.name}</span>
              {demoRow.whatsappConnected
                ? " tiene WhatsApp conectado. Sus clientes, turnos y conversaciones se borran todas las noches."
                : " todavía no tiene WhatsApp. Elegila en el selector de negocios del panel y conectá el número de la demo desde Configuración."}
            </p>
            <ul>
              <BusinessCard row={demoRow} days={days} />
            </ul>
          </>
        ) : (
          <form action={createDemoAction} className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Crea “Barbería Demo” con servicios y dos profesionales, con vos como dueño. Después conectás el número de la
              demo desde su Configuración.
            </p>
            <Button type="submit" className="w-full sm:w-auto">
              Crear la demo
            </Button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-medium">Negocios</h2>
        {others.length === 0 ? (
          <p className="rounded-[10px] border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Todavía no se dio de alta ningún negocio. Pasales el enlace de la landing a los pilotos.
          </p>
        ) : (
          <ul className="grid gap-4">
            {others.map((row) => (
              <BusinessCard key={row.id} row={row} days={days} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
