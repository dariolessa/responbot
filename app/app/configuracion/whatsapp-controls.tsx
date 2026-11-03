"use client"

import { RefreshCw, Send, Unplug } from "lucide-react"
import { useState, useTransition } from "react"

import { FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"

import { disconnectWhatsApp, retryAppSync, submitTemplates } from "./whatsapp-actions"

export function RetrySyncButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        className="w-full sm:w-auto"
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await retryAppSync()
            if (!result.ok) setError(result.error)
          })
        }
      >
        <RefreshCw />
        {pending ? "Pidiendo…" : "Volver a pedir"}
      </Button>
      <FormError message={error} />
    </div>
  )
}

export function DisconnectWhatsAppButton({ coexistence = false }: { coexistence?: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          const question = coexistence
            ? "¿Desconectar WhatsApp? El bot deja de responder, y vos seguís usando la app WhatsApp Business del celular como siempre."
            : "¿Desconectar WhatsApp? El bot deja de responder en ese número hasta que lo vuelvas a conectar."
          if (!window.confirm(question)) return
          startTransition(async () => {
            const result = await disconnectWhatsApp()
            if (!result.ok) setError(result.error)
          })
        }}
      >
        <Unplug />
        {pending ? "Desconectando…" : "Desconectar"}
      </Button>
      <FormError message={error} />
    </div>
  )
}

export function SubmitTemplatesButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || done}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await submitTemplates()
            if (result.ok) setDone(true)
            else setError(result.error)
          })
        }
        className="w-full sm:w-auto"
      >
        <Send />
        {pending ? "Enviando…" : done ? "Enviadas a revisión" : "Enviar a revisión de Meta"}
      </Button>
      <FormError message={error} />
    </div>
  )
}
