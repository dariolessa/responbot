"use client"

import { Unplug } from "lucide-react"
import { useState, useTransition } from "react"

import { FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"

import { disconnectMercadoPago } from "./mercadopago-actions"

export function DisconnectMercadoPagoButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              "¿Desconectar Mercado Pago? Los turnos nuevos se confirman sin seña. Los que esperan una seña siguen hasta que se paguen o venzan.",
            )
          )
            return
          startTransition(async () => {
            const result = await disconnectMercadoPago()
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
