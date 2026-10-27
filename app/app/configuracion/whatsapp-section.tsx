import { CheckCircle2, MessageCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ConnectWhatsAppButton } from "@/components/whatsapp/connect-button"
import type { ScopedDb } from "@/lib/db/scoped"
import { env } from "@/lib/env"
import {
  listTemplates,
  TEMPLATE_LANGUAGE,
  templateDefinitions,
  type RemoteTemplate,
} from "@/lib/integrations/whatsapp/templates"
import { accountToken, graphOptions, isWhatsAppConfigured } from "@/lib/whatsapp/deps"

import { DisconnectWhatsAppButton, SubmitTemplatesButton } from "./whatsapp-controls"

/*
 * Conexión de WhatsApp en Configuración: el botón del alta embebida, el
 * número conectado y el estado de las plantillas en Meta.
 */

const statusLabels = {
  active: "Conectado",
  token_expired: "Hay que reconectar",
  disconnected: "Desconectado",
} as const

const templateStatusLabels: Record<string, string> = {
  APPROVED: "Aprobada",
  PENDING: "En revisión",
  REJECTED: "Rechazada",
  PAUSED: "Pausada",
  DISABLED: "Desactivada",
}

async function remoteTemplates(wabaId: string, token: string): Promise<RemoteTemplate[] | null> {
  try {
    return await listTemplates(wabaId, graphOptions(token))
  } catch (error) {
    console.warn("[whatsapp] no se pudieron leer las plantillas", error)
    return null
  }
}

export async function WhatsAppSection({ db }: { db: ScopedDb }) {
  const configured = isWhatsAppConfigured()
  const account = await db.whatsappAccounts.findFirst()

  if (!account) {
    return (
      <div id="whatsapp" className="grid gap-3 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <MessageCircle className="size-5 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">WhatsApp</span>
            <span className="block text-sm text-muted-foreground">
              {configured
                ? "Conectá el número de tu negocio para que el bot responda. Se abre una ventana de Meta para elegir o crear tu cuenta de WhatsApp Business."
                : "La conexión con WhatsApp todavía no está habilitada en Responbot."}
            </span>
          </span>
          {configured ? null : <Badge variant="secondary">Muy pronto</Badge>}
        </div>
        {configured ? (
          <ConnectWhatsAppButton
            appId={env.META_APP_ID!}
            configId={env.META_CONFIG_ID!}
            version={env.WHATSAPP_API_VERSION}
          />
        ) : null}
      </div>
    )
  }

  const active = account.status === "active"
  const templates = active && configured ? await remoteTemplates(account.wabaId, accountToken(account)) : null
  const byName = new Map(
    (templates ?? []).filter((t) => t.language === TEMPLATE_LANGUAGE).map((t) => [t.name, t.status]),
  )
  const missing = templates !== null && templateDefinitions.some((t) => !byName.has(t.name))

  return (
    <div id="whatsapp" className="grid gap-4 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <MessageCircle className="size-5 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">WhatsApp</span>
          <span className="block truncate font-mono text-sm text-muted-foreground">
            {account.displayPhone}
            {account.verifiedName ? ` · ${account.verifiedName}` : ""}
          </span>
        </span>
        <Badge variant={active ? "default" : "destructive"}>
          {active ? <CheckCircle2 /> : null}
          {statusLabels[account.status]}
        </Badge>
      </div>

      {!active ? (
        <p className="text-sm text-muted-foreground">
          Meta dejó de aceptar la conexión y el bot no puede responder. Volvé a conectar el número para seguir.
        </p>
      ) : null}

      {active ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Plantillas de mensajes</p>
          <p className="text-sm text-muted-foreground">
            Fuera de las 24 horas desde el último mensaje del cliente, WhatsApp solo deja escribir con plantillas
            aprobadas por Meta. Se usan para recordatorios y avisos.
          </p>
          {templates === null ? (
            <p className="text-sm text-muted-foreground">No pudimos consultar el estado en Meta ahora.</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {templateDefinitions.map((t) => {
                const status = byName.get(t.name)
                return (
                  <li key={t.name} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{t.label}</span>
                    <Badge variant={status === "APPROVED" ? "default" : status === "REJECTED" ? "destructive" : "secondary"}>
                      {status ? (templateStatusLabels[status] ?? status) : "Sin enviar"}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          )}
          {missing ? <SubmitTemplatesButton /> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!active && configured ? (
          <ConnectWhatsAppButton
            appId={env.META_APP_ID!}
            configId={env.META_CONFIG_ID!}
            version={env.WHATSAPP_API_VERSION}
            label="Volver a conectar"
          />
        ) : null}
        <DisconnectWhatsAppButton />
      </div>
    </div>
  )
}
