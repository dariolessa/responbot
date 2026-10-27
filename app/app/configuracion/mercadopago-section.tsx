import { CheckCircle2, CreditCard } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ScopedDb } from "@/lib/db/scoped"
import { isMercadoPagoConfigured } from "@/lib/payments/deps"

import { DisconnectMercadoPagoButton } from "./mercadopago-controls"

/*
 * Conexión de Mercado Pago en Configuración: cada negocio conecta su propia
 * cuenta y el dinero de las señas va directo a ella.
 */

const statusLabels = {
  active: "Conectado",
  token_expired: "Hay que reconectar",
  disconnected: "Desconectado",
} as const

const notices: Record<string, { text: string; error?: boolean }> = {
  conectado: { text: "Listo, Mercado Pago quedó conectado." },
  cancelado: { text: "No se conectó: se canceló la autorización en Mercado Pago.", error: true },
  ocupado: { text: "Esa cuenta de Mercado Pago ya está conectada a otro negocio.", error: true },
  error: { text: "No pudimos conectar Mercado Pago. Probá de nuevo en unos minutos.", error: true },
}

const CONNECT_URL = "/api/integrations/mercadopago/connect"

export async function MercadoPagoSection({ db, notice }: { db: ScopedDb; notice?: string }) {
  const configured = isMercadoPagoConfigured()
  const account = await db.mpAccounts.findFirst()
  const message = notice ? notices[notice] : undefined
  const messageLine = message ? (
    <p role="status" className={message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
      {message.text}
    </p>
  ) : null

  if (!account) {
    return (
      <div id="mercadopago" className="grid gap-3 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <CreditCard className="size-5 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Mercado Pago</span>
            <span className="block text-sm text-muted-foreground">
              {configured
                ? "Conectá tu cuenta para cobrar señas al reservar. El dinero va directo a tu cuenta."
                : "El cobro de señas todavía no está habilitado en Responbot."}
            </span>
          </span>
          {configured ? null : <Badge variant="secondary">Muy pronto</Badge>}
        </div>
        {messageLine}
        {configured ? (
          <Button asChild className="w-full sm:w-auto sm:justify-self-start">
            <a href={CONNECT_URL}>Conectar Mercado Pago</a>
          </Button>
        ) : null}
      </div>
    )
  }

  const active = account.status === "active"
  return (
    <div id="mercadopago" className="grid gap-4 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <CreditCard className="size-5 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Mercado Pago</span>
          <span className="block truncate text-sm text-muted-foreground">
            {account.displayName ?? `Cuenta ${account.mpUserId}`}
            {account.liveMode ? "" : " · de prueba"}
          </span>
        </span>
        <Badge variant={active ? "default" : "destructive"}>
          {active ? <CheckCircle2 /> : null}
          {statusLabels[account.status]}
        </Badge>
      </div>
      {messageLine}
      {!active ? (
        <p className="text-sm text-muted-foreground">
          Mercado Pago dejó de aceptar la conexión: los turnos nuevos se confirman sin seña hasta que la vuelvas a
          conectar.
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {!active && configured ? (
          <Button asChild>
            <a href={CONNECT_URL}>Volver a conectar</a>
          </Button>
        ) : null}
        <DisconnectMercadoPagoButton />
      </div>
    </div>
  )
}
