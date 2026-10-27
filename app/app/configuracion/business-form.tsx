"use client"

import { Check, Loader2 } from "lucide-react"
import { useState, useTransition } from "react"

import { Field, FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { currencyOptions, timezoneOptions } from "@/lib/business-options"
import { categories } from "@/lib/onboarding/templates"

import { saveBusiness } from "./actions"

type Values = {
  name: string
  address: string
  category: string
  timezone: string
  currency: string
}

export function BusinessForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = (key: keyof Values, value: string) => {
    setSaved(false)
    setValues((v) => ({ ...v, [key]: value }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await saveBusiness(values as Parameters<typeof saveBusiness>[0])
      if (result.ok) setSaved(true)
      else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="business-name" error={fieldErrors.name}>
          <Input id="business-name" value={values.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Tipo de negocio" htmlFor="business-category" error={fieldErrors.category}>
          <NativeSelect
            id="business-category"
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
          >
            <option value="">Sin elegir</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Dirección" htmlFor="business-address" error={fieldErrors.address} className="sm:col-span-2">
          <Input
            id="business-address"
            value={values.address}
            autoComplete="street-address"
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <Field label="Zona horaria" htmlFor="business-timezone" error={fieldErrors.timezone}>
          <NativeSelect
            id="business-timezone"
            value={values.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          >
            {timezoneOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Moneda"
          htmlFor="business-currency"
          hint="Cambiarla no convierte los precios cargados."
          error={fieldErrors.currency}
        >
          <NativeSelect
            id="business-currency"
            value={values.currency}
            onChange={(e) => set("currency", e.target.value)}
          >
            {currencyOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
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
          Guardar datos
        </Button>
      </div>
    </form>
  )
}
