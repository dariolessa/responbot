"use client"

import { ArrowRight, Check, Loader2, Plus, Trash2 } from "lucide-react"
import { useRef, useState, useTransition } from "react"

import { FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { centsToInput, formatMoney } from "@/lib/money"
import {
  categories,
  categoryByKey,
  durationOptions,
  formatDuration,
  type CategoryKey,
} from "@/lib/onboarding/templates"
import { cn } from "@/lib/utils"

import { continueStep, saveServicesStep } from "../step-actions"

type Row = {
  key: number
  include: boolean
  name: string
  durationMinutes: number
  price: string
}

function rowsFor(category: CategoryKey | null, currency: string, firstKey: number): Row[] {
  const templates = categoryByKey(category)?.services ?? []
  return templates.map((t, i) => ({
    key: firstKey + i,
    include: true,
    name: t.name,
    durationMinutes: t.durationMinutes,
    // Los precios de referencia están en pesos uruguayos.
    price: currency === "UYU" ? centsToInput(t.priceUyu) : "",
  }))
}

export function ServicesStep({
  currency,
  initialCategory,
  existing,
}: {
  currency: string
  initialCategory: string | null
  existing: { id: string; name: string; durationMinutes: number; price: number }[]
}) {
  const startCategory = (categoryByKey(initialCategory)?.key ?? null) as CategoryKey | null
  const [category, setCategory] = useState<CategoryKey | null>(startCategory)
  const [rows, setRows] = useState<Row[]>(() =>
    existing.length > 0 ? [] : rowsFor(startCategory, currency, 0),
  )
  // Claves de filas: las iniciales empiezan en 0 (igual en servidor y cliente).
  const nextKey = useRef(1000)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  const included = rows.filter((r) => r.include)

  function pickCategory(key: CategoryKey) {
    setCategory(key)
    // Se reemplazan las filas de plantilla; las que escribió la persona se conservan.
    const fresh = rowsFor(key, currency, nextKey.current)
    nextKey.current += fresh.length
    setRows((current) => [
      ...fresh,
      ...current.filter((r) => !categoryByKey(category)?.services.some((t) => t.name === r.name)),
    ])
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((current) => [
      ...current,
      { key: nextKey.current++, include: true, name: "", durationMinutes: 30, price: "" },
    ])
  }

  function submit() {
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result =
        included.length === 0 && existing.length > 0
          ? await continueStep("services")
          : await saveServicesStep({
              category,
              services: included.map((r) => ({
                name: r.name,
                durationMinutes: r.durationMinutes,
                price: r.price,
              })),
            })
      // Si todo salió bien, la acción redirige al paso siguiente.
      if (result && !result.ok) {
        setError(result.error)
        // Los errores vienen por índice de los incluidos; se pasan a la clave de la fila.
        const mapped: Record<string, string> = {}
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          const [, index, field] = path.split(".")
          const row = included[Number(index)]
          if (row && field) mapped[`${row.key}.${field}`] = message
        }
        setFieldErrors(mapped)
      }
    })
  }

  return (
    <div className="grid gap-8">
      {existing.length > 0 ? (
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Ya cargaste</h2>
          <ul className="mt-3 grid gap-2">
            {existing.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-primary" />
                <span className="flex-1">{s.name}</span>
                <span className="font-mono text-muted-foreground">
                  {formatDuration(s.durationMinutes)} · {formatMoney(s.price, currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">
          {existing.length > 0 ? "¿Querés sumar más desde una plantilla?" : "Tu tipo de negocio"}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => pickCategory(c.key)}
              aria-pressed={category === c.key}
              className={cn(
                "flex h-11 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors duration-150 hover:bg-accent",
                category === c.key && "border-primary bg-primary/5 text-primary hover:bg-primary/10",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {rows.length > 0 ? (
        <section className="grid gap-2">
          <div className="hidden grid-cols-[1.5rem_1fr_8rem_7rem_2.25rem] gap-3 px-1 text-xs font-medium text-muted-foreground sm:grid">
            <span />
            <span>Servicio</span>
            <span>Duración</span>
            <span>Precio ({currency})</span>
            <span />
          </div>
          {rows.map((row) => {
            const err = (field: string) => fieldErrors[`${row.key}.${field}`]
            return (
              <div
                key={row.key}
                className={cn(
                  "grid grid-cols-[1.5rem_1fr_2.75rem] items-start gap-x-3 gap-y-2 rounded-lg border p-3 sm:grid-cols-[1.5rem_1fr_8rem_7rem_2.25rem] sm:border-0 sm:p-1",
                  !row.include && "opacity-60",
                )}
              >
                <div className="flex h-11 items-center sm:h-9">
                  <Checkbox
                    checked={row.include}
                    onChange={(e) => update(row.key, { include: e.target.checked })}
                    aria-label={`Incluir ${row.name || "servicio"}`}
                  />
                </div>
                <div className="grid gap-1">
                  <Input
                    value={row.name}
                    placeholder="Nombre del servicio"
                    aria-label="Nombre del servicio"
                    aria-invalid={err("name") ? true : undefined}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                  />
                  {err("name") ? <p className="text-xs text-destructive">{err("name")}</p> : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Quitar"
                  className="sm:order-last"
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                >
                  <Trash2 />
                </Button>
                <div className="col-start-2 grid gap-1 sm:col-start-auto">
                  <NativeSelect
                    value={row.durationMinutes}
                    aria-label="Duración"
                    onChange={(e) => update(row.key, { durationMinutes: Number(e.target.value) })}
                  >
                    {[...new Set([...durationOptions, row.durationMinutes])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {formatDuration(m)}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
                <div className="col-start-2 grid gap-1 sm:col-start-auto">
                  <Input
                    value={row.price}
                    inputMode="decimal"
                    placeholder="Precio"
                    aria-label={`Precio en ${currency}`}
                    aria-invalid={err("price") ? true : undefined}
                    className="font-mono"
                    onChange={(e) => update(row.key, { price: e.target.value })}
                  />
                  {err("price") ? <p className="text-xs text-destructive">{err("price")}</p> : null}
                </div>
              </div>
            )
          })}
        </section>
      ) : null}

      <div>
        <Button type="button" variant="outline" onClick={addRow}>
          <Plus />
          Agregar otro servicio
        </Button>
      </div>

      <FormError message={error} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {included.length > 0
            ? `Vas a guardar ${included.length} ${included.length === 1 ? "servicio" : "servicios"}.`
            : existing.length > 0
              ? "No vas a agregar servicios nuevos."
              : "Elegí un tipo de negocio o agregá un servicio."}
        </p>
        <Button type="button" size="lg" onClick={submit} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {included.length > 0 ? "Guardar y seguir" : "Seguir"}
          {pending ? null : <ArrowRight />}
        </Button>
      </div>
    </div>
  )
}
