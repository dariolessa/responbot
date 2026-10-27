"use client"

import { Check, Loader2 } from "lucide-react"
import Link from "next/link"
import { useState, useTransition } from "react"

import { Field, FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"

import { saveAutomations } from "./actions"

export type AutomationsValues = {
  reactivationEnabled: boolean
  reviewRequestEnabled: boolean
  reviewUrl: string
  reviewDelayHours: number
}

/** Mensajes que el bot manda solo: reactivación de clientes y pedido de reseña después del servicio. */
export function AutomationsForm({
  initial,
  reactivationPlan,
}: {
  initial: AutomationsValues
  /** Nombre del plan que la incluye, si el actual no tiene reactivación. */
  reactivationPlan: string | null
}) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function set<K extends keyof AutomationsValues>(key: K, value: AutomationsValues[K]) {
    setSaved(false)
    setValues((v) => ({ ...v, [key]: value }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await saveAutomations(values)
      if (result.ok) setSaved(true)
      else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={values.reactivationEnabled && !reactivationPlan}
          disabled={Boolean(reactivationPlan)}
          onChange={(e) => set("reactivationEnabled", e.target.checked)}
        />
        <span>
          Invitar a volver a los clientes que pasaron su tiempo habitual
          <span className="block text-muted-foreground">
            {reactivationPlan ? (
              <>
                Viene con el plan {reactivationPlan}.{" "}
                <Link href="/app/facturacion" className="underline underline-offset-4">
                  Ver planes
                </Link>
              </>
            ) : (
              "Les ofrece un turno con su profesional de siempre. Como mucho un mensaje cada 30 días; el tiempo de cada servicio se ajusta en Servicios."
            )}
          </span>
        </span>
      </label>

      <div className="grid gap-4">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={values.reviewRequestEnabled}
            onChange={(e) => set("reviewRequestEnabled", e.target.checked)}
          />
          <span>
            Pedir una reseña en Google después del servicio
            <span className="block text-muted-foreground">
              Se manda al marcar el turno como atendido, como mucho una vez cada 90 días por cliente.
            </span>
          </span>
        </label>
        {values.reviewRequestEnabled ? (
          <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
            <Field
              label="Enlace para dejar la reseña"
              htmlFor="review-url"
              hint="En tu Perfil de Empresa de Google: Pedir reseñas → copiar el enlace."
              error={fieldErrors.reviewUrl}
            >
              <Input
                id="review-url"
                type="url"
                inputMode="url"
                value={values.reviewUrl}
                placeholder="https://g.page/r/…/review"
                onChange={(e) => set("reviewUrl", e.target.value)}
              />
            </Field>
            <Field label="Cuándo" htmlFor="review-delay" error={fieldErrors.reviewDelayHours}>
              <NativeSelect
                id="review-delay"
                value={String(values.reviewDelayHours)}
                onChange={(e) => set("reviewDelayHours", Number(e.target.value))}
              >
                <option value="1">1 hora después</option>
                <option value="2">2 horas después</option>
                <option value="4">4 horas después</option>
                <option value="24">Al día siguiente</option>
              </NativeSelect>
            </Field>
          </div>
        ) : null}
      </div>

      <FormError message={error} />
      <div className="flex items-center justify-end gap-3">
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
            <Check className="size-4 text-primary" />
            Guardado
          </span>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Guardar
        </Button>
      </div>
    </form>
  )
}
