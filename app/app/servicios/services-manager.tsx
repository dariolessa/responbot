"use client"

import { ChevronDown, ChevronUp, LayoutTemplate, Loader2, Plus, Scissors, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Field, FormError } from "@/components/forms/field"
import { ServicePicker } from "@/components/forms/service-picker"
import { EmptyState } from "@/components/layout/empty-state"
import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { centsToInput, formatMoney } from "@/lib/money"
import { durationOptions, formatDuration } from "@/lib/onboarding/templates"

import { deleteService, moveService, saveService } from "./actions"

export type ServiceItem = {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  price: number
  depositOverride: number | null
  active: boolean
  resourceIds: string[]
}

type Draft = {
  id?: string
  name: string
  description: string
  durationMinutes: number
  price: string
  depositOverride: string
  active: boolean
  resourceIds: string[]
}

export function ServicesManager({
  services,
  resources,
  currency,
}: {
  services: ServiceItem[]
  resources: { id: string; name: string }[]
  currency: string
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  function open(service?: ServiceItem) {
    setError(null)
    setFieldErrors({})
    setDraft(
      service
        ? {
            id: service.id,
            name: service.name,
            description: service.description ?? "",
            durationMinutes: service.durationMinutes,
            price: centsToInput(service.price),
            depositOverride:
              service.depositOverride === null ? "" : centsToInput(service.depositOverride),
            active: service.active,
            resourceIds: service.resourceIds,
          }
        : {
            name: "",
            description: "",
            durationMinutes: 30,
            price: "",
            depositOverride: "",
            active: true,
            resourceIds: resources.map((r) => r.id),
          },
    )
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    startTransition(async () => {
      const result = await saveService(draft)
      if (result.ok) {
        setDraft(null)
        router.refresh()
      } else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  function remove() {
    if (!draft?.id) return
    if (!window.confirm(`¿Borrar "${draft.name}"?`)) return
    startTransition(async () => {
      const result = await deleteService({ id: draft.id! })
      if (!result.ok) return setError(result.error)
      if (result.data === "paused") {
        window.alert("Ese servicio tiene turnos, así que lo pausamos en lugar de borrarlo.")
      }
      setDraft(null)
      router.refresh()
    })
  }

  function move(id: string, direction: "up" | "down") {
    startTransition(async () => {
      await moveService({ id, direction })
      router.refresh()
    })
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  return (
    <>
      {services.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="Todavía no cargaste servicios"
          description="Cargá lo que ofrecés para poder dar turnos."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => open()}>
                <Plus />
                Crear servicio
              </Button>
              <Button variant="outline" asChild>
                <Link href="/onboarding/servicios">
                  <LayoutTemplate />
                  Usar una plantilla
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/onboarding/servicios">
                <LayoutTemplate />
                Agregar desde plantilla
              </Link>
            </Button>
            <Button onClick={() => open()}>
              <Plus />
              Nuevo servicio
            </Button>
          </div>
          <ul className="divide-y rounded-lg border">
            {services.map((s, index) => (
              <li key={s.id} className="flex items-center gap-2 pr-2">
                <button
                  type="button"
                  onClick={() => open(s)}
                  className="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-accent/50"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    {s.active ? null : <Badge variant="secondary">Pausado</Badge>}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <span className="font-mono">{formatDuration(s.durationMinutes)}</span>
                    {" · "}
                    <span className="font-mono">{formatMoney(s.price, currency)}</span>
                    {" · "}
                    {s.resourceIds.length === 0
                      ? "Nadie lo hace todavía"
                      : s.resourceIds.length === 1
                        ? "1 profesional"
                        : `${s.resourceIds.length} profesionales`}
                  </span>
                </button>
                <div className="flex shrink-0 flex-col sm:flex-row">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Subir ${s.name}`}
                    disabled={index === 0 || pending}
                    onClick={() => move(s.id, "up")}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Bajar ${s.name}`}
                    disabled={index === services.length - 1 || pending}
                    onClick={() => move(s.id, "down")}
                  >
                    <ChevronDown />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ResponsiveSheet
        open={draft !== null}
        onOpenChange={(o) => (o ? null : setDraft(null))}
        title={draft?.id ? "Editar servicio" : "Nuevo servicio"}
        footer={
          <div className="flex items-center justify-between gap-2">
            {draft?.id ? (
              <Button variant="ghost" onClick={remove} disabled={pending} className="text-destructive">
                <Trash2 />
                Borrar
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" form="service-form" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Guardar
            </Button>
          </div>
        }
      >
        {draft ? (
          <form id="service-form" onSubmit={save} className="grid gap-5">
            <Field label="Nombre" htmlFor="service-name" error={fieldErrors.name}>
              <Input
                id="service-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={fieldErrors.name ? true : undefined}
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Duración" htmlFor="service-duration" error={fieldErrors.durationMinutes}>
                <NativeSelect
                  id="service-duration"
                  value={draft.durationMinutes}
                  onChange={(e) => set("durationMinutes", Number(e.target.value))}
                >
                  {[...new Set([...durationOptions, draft.durationMinutes])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <option key={m} value={m}>
                        {formatDuration(m)}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label={`Precio (${currency})`} htmlFor="service-price" error={fieldErrors.price}>
                <Input
                  id="service-price"
                  inputMode="decimal"
                  className="font-mono"
                  value={draft.price}
                  onChange={(e) => set("price", e.target.value)}
                  aria-invalid={fieldErrors.price ? true : undefined}
                />
              </Field>
            </div>
            <Field
              label="Descripción (opcional)"
              htmlFor="service-description"
              hint="El bot la usa para explicar el servicio."
              error={fieldErrors.description}
            >
              <Textarea
                id="service-description"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <Field
              label={`Seña propia (${currency}, opcional)`}
              htmlFor="service-deposit"
              hint="Si la dejás vacía, se usa la seña general del negocio."
              error={fieldErrors.depositOverride}
            >
              <Input
                id="service-deposit"
                inputMode="decimal"
                className="font-mono"
                value={draft.depositOverride}
                onChange={(e) => set("depositOverride", e.target.value)}
              />
            </Field>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Quién lo hace</p>
              <ServicePicker
                services={resources}
                value={draft.resourceIds}
                onChange={(ids) => set("resourceIds", ids)}
                emptyText="Todavía no hay profesionales. Sumalos en Equipo."
              />
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={draft.active} onChange={(e) => set("active", e.target.checked)} />
              Activo: se puede reservar
            </label>
            <FormError message={error} />
          </form>
        ) : null}
      </ResponsiveSheet>
    </>
  )
}
