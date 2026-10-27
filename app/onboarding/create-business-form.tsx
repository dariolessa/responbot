"use client"

import { ArrowRight, Loader2 } from "lucide-react"
import { useActionState } from "react"

import { FieldError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { archetypeOptions, currencyOptions, timezoneOptions } from "@/lib/business-options"

import { createBusiness, type CreateBusinessState } from "./actions"

export function CreateBusinessForm() {
  const [state, action, pending] = useActionState<CreateBusinessState, FormData>(
    createBusiness,
    {},
  )
  const v = state.values ?? {}
  const e = state.errors ?? {}

  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-2">
        <Label htmlFor="name">Nombre del negocio</Label>
        <Input
          id="name"
          name="name"
          placeholder="Barbería Don José"
          defaultValue={v.name}
          aria-invalid={e.name ? true : undefined}
          aria-describedby="name-error"
          autoFocus
          required
        />
        <FieldError id="name-error" message={e.name} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="archetype">Rubro</Label>
        <NativeSelect id="archetype" name="archetype" defaultValue={v.archetype ?? "services"}>
          {archetypeOptions.map((o) => (
            <option key={o.value} value={o.value} disabled={!o.available}>
              {o.available ? o.label : `${o.label} (próximamente)`}
            </option>
          ))}
        </NativeSelect>
        <FieldError id="archetype-error" message={e.archetype} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="address">Dirección (opcional)</Label>
        <Input
          id="address"
          name="address"
          placeholder="Av. 18 de Julio 1234, Montevideo"
          defaultValue={v.address}
          autoComplete="street-address"
          aria-invalid={e.address ? true : undefined}
          aria-describedby="address-error"
        />
        <FieldError id="address-error" message={e.address} />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="timezone">Zona horaria</Label>
          <NativeSelect
            id="timezone"
            name="timezone"
            defaultValue={v.timezone ?? "America/Montevideo"}
          >
            {timezoneOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError id="timezone-error" message={e.timezone} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="currency">Moneda</Label>
          <NativeSelect id="currency" name="currency" defaultValue={v.currency ?? "UYU"}>
            {currencyOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError id="currency-error" message={e.currency} />
        </div>
      </div>

      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending ? <Loader2 className="animate-spin" /> : null}
        Crear mi negocio y seguir
        {pending ? null : <ArrowRight />}
      </Button>
    </form>
  )
}
