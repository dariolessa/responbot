"use client"

import { Loader2, Search, UserPlus, X } from "lucide-react"
import { useEffect, useState, useTransition } from "react"

import {
  createBookingAction,
  getSlots,
  searchCustomers,
  type CustomerOption,
  type SlotOption,
} from "@/app/app/agenda/actions"
import { Field, FormError } from "@/components/forms/field"
import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { formatDate } from "@/lib/time"
import { formatDuration } from "@/lib/onboarding/templates"
import { cn } from "@/lib/utils"

import type { AgendaResource, AgendaService } from "./types"

export type NewBookingPrefill = { date: string; time?: string; resourceId?: string | null }

type CustomerChoice =
  | { kind: "existing"; option: CustomerOption }
  | { kind: "new"; name: string; phone: string }
  | null

/*
 * Reserva manual (docs/SPEC.md, "Detalles de la agenda"): servicio,
 * profesional, día y horario libre, y cliente buscado por nombre o teléfono
 * (o uno nuevo).
 */
export function NewBookingSheet({
  prefill,
  onClose,
  onCreated,
  services,
  resources,
}: {
  prefill: NewBookingPrefill | null
  onClose: () => void
  onCreated: (message: string) => void
  services: AgendaService[]
  resources: AgendaResource[]
}) {
  return (
    <ResponsiveSheet
      open={prefill !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title="Nuevo turno"
    >
      {prefill ? (
        <NewBookingForm
          // Cada apertura arranca de cero.
          key={JSON.stringify(prefill)}
          prefill={prefill}
          services={services}
          resources={resources}
          onCreated={onCreated}
        />
      ) : null}
    </ResponsiveSheet>
  )
}

function NewBookingForm({
  prefill,
  services,
  resources,
  onCreated,
}: {
  prefill: NewBookingPrefill
  services: AgendaService[]
  resources: AgendaResource[]
  onCreated: (message: string) => void
}) {
  const prefillResource = resources.find((r) => r.id === prefill.resourceId)
  const firstService =
    services.find((s) => !prefillResource || prefillResource.serviceIds.includes(s.id)) ?? services[0]

  const [serviceId, setServiceId] = useState(firstService?.id ?? "")
  const [resourceId, setResourceId] = useState<string>(
    prefill.resourceId ?? (resources.length === 1 ? resources[0]!.id : ""),
  )
  const [date, setDate] = useState(prefill.date)
  const [time, setTime] = useState(prefill.time ?? "")
  const [customTime, setCustomTime] = useState(Boolean(prefill.time))
  const [slots, setSlots] = useState<SlotOption[] | null>(null)
  const [loadingSlots, startSlots] = useTransition()

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CustomerOption[]>([])
  const [customer, setCustomer] = useState<CustomerChoice>(null)
  const [requestDeposit, setRequestDeposit] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, startSaving] = useTransition()

  const doers = resources.filter((r) => r.serviceIds.includes(serviceId))
  const deposit = services.find((s) => s.id === serviceId)?.deposit ?? null
  const effectiveResource = doers.some((r) => r.id === resourceId) ? resourceId : ""

  // Horarios libres para la combinación elegida.
  useEffect(() => {
    if (!serviceId || !date) return
    let cancelled = false
    startSlots(async () => {
      const result = await getSlots({ serviceId, resourceId: effectiveResource || null, date })
      if (!cancelled) setSlots(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [serviceId, effectiveResource, date])

  // Búsqueda de clientes con una pausa corta entre teclas.
  useEffect(() => {
    if (query.trim().length < 2) return
    const timer = setTimeout(async () => {
      const result = await searchCustomers({ q: query })
      if (result.ok) setResults(result.data)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    if (!customer) {
      setError("Elegí un cliente o cargá uno nuevo.")
      return
    }
    if (!time) {
      setError("Elegí un horario.")
      return
    }
    startSaving(async () => {
      const result = await createBookingAction({
        serviceId,
        resourceId: effectiveResource || null,
        date,
        time,
        customer:
          customer.kind === "existing"
            ? { kind: "existing", id: customer.option.id }
            : { kind: "new", name: customer.name, phone: customer.phone },
        requestDeposit: Boolean(deposit) && requestDeposit,
      })
      if (result.ok) {
        const who = customer.kind === "existing" ? customer.option.name ?? customer.option.phone : customer.name
        onCreated(
          deposit && requestDeposit
            ? `Turno de ${who} guardado para el ${formatDate(date, "EEEE d")} a las ${time}, esperando la seña.`
            : `Turno de ${who} reservado para el ${formatDate(date, "EEEE d")} a las ${time}.`,
        )
      } else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  if (services.length === 0 || resources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Para dar turnos necesitás al menos un servicio y un profesional con horario.
      </p>
    )
  }

  const visibleSlots = slots ?? []

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field label="Servicio" htmlFor="nb-service" error={fieldErrors.serviceId}>
        <NativeSelect id="nb-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {formatDuration(s.durationMinutes)} · {s.price}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {resources.length > 1 ? (
        <Field label="Profesional" htmlFor="nb-resource">
          <NativeSelect
            id="nb-resource"
            value={effectiveResource}
            onChange={(e) => setResourceId(e.target.value)}
          >
            <option value="">Cualquiera disponible</option>
            {doers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <Field label="Día" htmlFor="nb-date" error={fieldErrors.date}>
        <Input
          id="nb-date"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value)
            if (!customTime) setTime("")
          }}
          required
        />
      </Field>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Horario</span>
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setCustomTime((v) => !v)
              setTime("")
            }}
          >
            {customTime ? "Ver horarios libres" : "Otra hora"}
          </button>
        </div>
        {customTime ? (
          <>
            <Input
              type="time"
              step={300}
              aria-label="Hora"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-32 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Desde el panel podés dar un turno fuera del horario; no puede pisar otro turno ni un bloqueo.
            </p>
          </>
        ) : loadingSlots && slots === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Buscando horarios…
          </p>
        ) : visibleSlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay horarios libres ese día. Probá otro día u otra hora.</p>
        ) : (
          <div className={cn("flex flex-wrap gap-2", loadingSlots && "opacity-60")}>
            {visibleSlots.map((slot) => (
              <button
                key={`${slot.resourceId}-${slot.startsAt}`}
                type="button"
                aria-pressed={time === slot.time}
                onClick={() => setTime(slot.time)}
                className={cn(
                  "h-11 rounded-md border px-3 font-mono text-sm transition-colors duration-150 hover:bg-accent sm:h-9",
                  time === slot.time && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {slot.time}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Cliente</span>
        {customer?.kind === "existing" ? (
          <div className="flex items-center gap-3 rounded-md border px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{customer.option.name ?? "Sin nombre"}</span>
              <span className="block font-mono text-xs text-muted-foreground">{customer.option.phone}</span>
              {customer.option.noShowCount > 0 ? (
                <span className="block text-xs text-red-600 dark:text-red-400">
                  {customer.option.noShowCount === 1 ? "Faltó 1 vez" : `Faltó ${customer.option.noShowCount} veces`}
                </span>
              ) : null}
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label="Cambiar cliente" onClick={() => setCustomer(null)}>
              <X />
            </Button>
          </div>
        ) : customer?.kind === "new" ? (
          <div className="grid gap-3 rounded-md border p-3">
            <Field label="Nombre" htmlFor="nb-name" error={fieldErrors["customer.name"]}>
              <Input
                id="nb-name"
                value={customer.name}
                autoComplete="off"
                onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
              />
            </Field>
            <Field
              label="Teléfono (WhatsApp)"
              htmlFor="nb-phone"
              hint="Por ejemplo 099 123 456."
              error={fieldErrors["customer.phone"]}
            >
              <Input
                id="nb-phone"
                type="tel"
                inputMode="tel"
                className="font-mono"
                value={customer.phone}
                autoComplete="off"
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
              />
            </Field>
            <button
              type="button"
              className="justify-self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setCustomer(null)}
            >
              Buscar un cliente existente
            </button>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar cliente por nombre o teléfono"
                placeholder="Nombre o teléfono"
                value={query}
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (e.target.value.trim().length < 2) setResults([])
                }}
                className="pl-9"
              />
            </div>
            {results.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setCustomer({ kind: "existing", option: r })}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate font-medium">{r.name ?? "Sin nombre"}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim().length >= 2 ? (
              <p className="text-sm text-muted-foreground">No encontramos a nadie con eso.</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setCustomer({
                  kind: "new",
                  name: /\d/.test(query) ? "" : query.trim(),
                  phone: /\d/.test(query) ? query.trim() : "",
                })
              }
            >
              <UserPlus />
              Cliente nuevo
            </Button>
          </div>
        )}
      </div>

      {deposit ? (
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={requestDeposit}
            onChange={(e) => setRequestDeposit(e.target.checked)}
          />
          <span>
            Pedir seña de <span className="font-mono">{deposit}</span> por Mercado Pago
            <span className="block text-muted-foreground">
              El cliente recibe el link por WhatsApp y el turno se confirma cuando paga.
            </span>
          </span>
        </label>
      ) : null}

      <FormError message={error} />

      <Button type="submit" size="lg" disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : null}
        Reservar turno
      </Button>
    </form>
  )
}
