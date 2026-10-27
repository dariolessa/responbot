"use client"

import { Send, Unplug } from "lucide-react"
import { useState, useTransition } from "react"

import { FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"

import { disconnectWhatsApp, submitTemplates } from "./whatsapp-actions"

export function DisconnectWhatsAppButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("¿Desconectar WhatsApp? El bot deja de responder en ese número hasta que lo vuelvas a conectar.")) return
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
