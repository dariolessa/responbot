"use client"

import { ArrowRight, Check, Info, Loader2 } from "lucide-react"
import { useState, useTransition } from "react"

import { saveRules } from "@/app/app/configuracion/actions"
import { Field, FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import {
  bufferOptions,
  cancelHoursOptions,
  maxDaysAheadOptions,
  minNoticeOptions,
  slotStepOptions,
  type RulesFormValues,
} from "@/lib/rules"
import { cn } from "@/lib/utils"

const depositModes = [
  { value: "none", label: "Sin seña" },
  { value: "fixed", label: "Monto fijo" },
  { value: "percent", label: "Porcentaje" },
] as const

export function RulesForm({
  initial,
  currency,
  mode,
}: {
  initial: RulesFormValues
  currency: string
  mode: "onboarding" | "settings"
}) {
  const [values, setValues] = useState<RulesFormValues>(initial)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof RulesFormValues>(key: K, value: RulesFormValues[K]) => {
    setSaved(false)
    setValues((v) => ({ ...v, [key]: value }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await saveRules(values, mode)
      if (!result) return
      if (result.ok) setSaved(true)
      else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  const select = (
    key: "minNoticeMinutes" | "maxDaysAhead" | "bufferMinutes" | "slotStepMinutes" | "cancelHours",
    options: { value: number; label: string }[],
  ) => (
    <NativeSelect
      id={key}
      value={String(values[key])}
      onChange={(e) => set(key, Number(e.target.value))}
      aria-invalid={fieldErrors[key] ? true : undefined}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  )

  return (
    <form onSubmit={submit} className="grid gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Anticipación mínima"
          htmlFor="minNoticeMinutes"
          hint="Lo mínimo que falta para el turno cuando reservan."
          error={fieldErrors.minNoticeMinutes}
        >
          {select("minNoticeMinutes", minNoticeOptions)}
        </Field>
        <Field
          label="Se puede reservar hasta"
          htmlFor="maxDaysAhead"
          hint="Cuánto hacia adelante se ofrecen turnos."
          error={fieldErrors.maxDaysAhead}
        >
          {select("maxDaysAhead", maxDaysAheadOptions)}
        </Field>
        <Field
          label="Descanso entre turnos"
          htmlFor="bufferMinutes"
          hint="Tiempo libre después de cada turno para limpiar o preparar."
          error={fieldErrors.bufferMinutes}
        >
          {select("bufferMinutes", bufferOptions)}
        </Field>
        <Field
          label="Horarios que se ofrecen"
          htmlFor="slotStepMinutes"
          hint="Cada cuánto empieza un turno posible."
          error={fieldErrors.slotStepMinutes}
        >
          {select("slotStepMinutes", slotStepOptions)}
        </Field>
        <Field
          label="Cancelación con devolución de seña"
          htmlFor="cancelHours"
          error={fieldErrors.cancelHours}
          className="sm:col-span-2"
        >
          {select("cancelHours", cancelHoursOptions)}
        </Field>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">Seña para reservar</legend>
        <div className="grid grid-cols-3 gap-2">
          {depositModes.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={values.depositMode === m.value}
              onClick={() => set("depositMode", m.value)}
              className={cn(
                "flex h-11 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors duration-150 hover:bg-accent sm:h-9",
                values.depositMode === m.value &&
                  "border-primary bg-primary/5 text-primary hover:bg-primary/10",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        {values.depositMode !== "none" ? (
          <Field
            label={values.depositMode === "fixed" ? `Monto (${currency})` : "Porcentaje del precio"}
            htmlFor="depositValue"
            error={fieldErrors.depositValue}
          >
            <div className="relative max-w-48">
              <Input
                id="depositValue"
                inputMode="decimal"
                value={values.depositValue ?? ""}
                onChange={(e) => set("depositValue", e.target.value)}
                aria-invalid={fieldErrors.depositValue ? true : undefined}
                className="pr-8 font-mono"
              />
              {values.depositMode === "percent" ? (
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              ) : null}
            </div>
          </Field>
        ) : null}
        {values.depositMode !== "none" ? (
          <p className="flex gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            Para cobrar señas vas a conectar Mercado Pago, que llega muy pronto. Mientras tanto, los
            turnos que cargás desde el panel se confirman sin seña.
          </p>
        ) : null}
      </fieldset>

      <FormError message={error} />

      <div className="flex items-center justify-end gap-3">
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
            <Check className="size-4 text-primary" />
            Guardado
          </span>
        ) : null}
        <Button type="submit" size={mode === "onboarding" ? "lg" : "default"} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {mode === "onboarding" ? "Guardar y seguir" : "Guardar reglas"}
          {mode === "onboarding" && !pending ? <ArrowRight /> : null}
        </Button>
      </div>
    </form>
  )
}
