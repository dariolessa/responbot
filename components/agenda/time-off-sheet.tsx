"use client"

import { Loader2, Trash2 } from "lucide-react"
import { useState, useTransition } from "react"

import { createTimeOff, deleteTimeOff } from "@/app/app/agenda/actions"
import { Field, FormError } from "@/components/forms/field"
import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"

import type { AgendaData } from "./types"

/** Bloqueos: vacaciones, almuerzo, trámites o feriados de todo el negocio. */
export function TimeOffSheet({
  open,
  onClose,
  onChanged,
  data,
}: {
  open: boolean
  onClose: () => void
  onChanged: (message: string) => void
  data: AgendaData
}) {
  const [values, setValues] = useState(() => initialValues(data))
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  const nameOf = new Map(data.resources.map((r) => [r.id, r.name]))
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await createTimeOff({
        resourceId: values.resourceId || null,
        allDay: values.allDay,
        startDate: values.startDate,
        startTime: values.allDay ? undefined : values.startTime,
        endDate: values.endDate,
        endTime: values.allDay ? undefined : values.endTime,
        reason: values.reason,
      })
      if (result.ok) {
        setValues(initialValues(data))
        onChanged("Listo, el horario quedó bloqueado.")
      } else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteTimeOff({ id })
      if (result.ok) onChanged("Bloqueo quitado.")
      else setError(result.error)
    })
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => (o ? null : onClose())}
      title="Bloquear horario"
      description="Nadie puede reservar en un horario bloqueado."
    >
      <form onSubmit={submit} className="grid gap-5">
        <Field label="Para" htmlFor="to-resource">
          <NativeSelect
            id="to-resource"
            value={values.resourceId}
            onChange={(e) => set("resourceId", e.target.value)}
          >
            {data.canManageAll ? <option value="">Todo el negocio (feriado, cierre)</option> : null}
            {data.resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox checked={values.allDay} onChange={(e) => set("allDay", e.target.checked)} />
          Todo el día
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde" htmlFor="to-start-date">
            <Input
              id="to-start-date"
              type="date"
              value={values.startDate}
              onChange={(e) => {
                set("startDate", e.target.value)
                if (e.target.value > values.endDate) set("endDate", e.target.value)
              }}
              required
            />
          </Field>
          {values.allDay ? (
            <div />
          ) : (
            <Field label="Hora" htmlFor="to-start-time">
              <Input
                id="to-start-time"
                type="time"
                step={900}
                className="font-mono"
                value={values.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                required
              />
            </Field>
          )}
          <Field label="Hasta" htmlFor="to-end-date" error={fieldErrors.endDate}>
            <Input
              id="to-end-date"
              type="date"
              value={values.endDate}
              min={values.startDate}
              onChange={(e) => set("endDate", e.target.value)}
              required
            />
          </Field>
          {values.allDay ? (
            <div />
          ) : (
            <Field label="Hora" htmlFor="to-end-time" error={fieldErrors.endTime}>
              <Input
                id="to-end-time"
                type="time"
                step={900}
                className="font-mono"
                value={values.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                required
              />
            </Field>
          )}
        </div>
        <Field label="Motivo (opcional)" htmlFor="to-reason" error={fieldErrors.reason}>
          <Input
            id="to-reason"
            value={values.reason}
            placeholder="Vacaciones, almuerzo, feriado…"
            onChange={(e) => set("reason", e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Bloquear
        </Button>
      </form>

      {data.upcomingTimeOff.length > 0 ? (
        <section className="mt-8">
          <h3 className="mb-2 text-sm font-medium">Próximos bloqueos</h3>
          <ul className="divide-y rounded-lg border">
            {data.upcomingTimeOff.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1 pr-1 pl-3">
                <span className="min-w-0 flex-1 py-1.5">
                  <span className="block truncate text-sm">
                    {t.resourceId ? (nameOf.get(t.resourceId) ?? "Profesional") : "Todo el negocio"}
                    {t.reason ? <span className="text-muted-foreground"> · {t.reason}</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground first-letter:uppercase">{t.label}</span>
                </span>
                {t.resourceId !== null || data.canManageAll ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Quitar bloqueo"
                    disabled={pending}
                    onClick={() => remove(t.id)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ResponsiveSheet>
  )
}

function initialValues(data: AgendaData) {
  return {
    resourceId: data.canManageAll ? "" : (data.resources[0]?.id ?? ""),
    allDay: false,
    startDate: data.date,
    startTime: "13:00",
    endDate: data.date,
    endTime: "14:00",
    reason: "",
  }
}
