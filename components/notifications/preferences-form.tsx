"use client"

import { Check, Loader2 } from "lucide-react"
import { useState, useTransition } from "react"

import { savePreferencesAction } from "@/app/app/notificaciones/actions"
import { Field, FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { channelLabels, channels, notificationTypes, type Channel, type NotificationType } from "@/lib/notifications/types"

type Flags = Record<Channel, boolean>

const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`)

export function PreferencesForm({
  initial,
  whatsappAvailable,
}: {
  initial: { types: Record<string, Flags>; quietStart: string; quietEnd: string; phone: string }
  /** El negocio tiene WhatsApp conectado (los avisos salen desde ese número). */
  whatsappAvailable: boolean
}) {
  const [types, setTypes] = useState(initial.types)
  const [quietStart, setQuietStart] = useState(initial.quietStart)
  const [quietEnd, setQuietEnd] = useState(initial.quietEnd)
  const [phone, setPhone] = useState(initial.phone)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const toggle = (type: string, channel: Channel, value: boolean) => {
    setSaved(false)
    setTypes((t) => ({ ...t, [type]: { ...t[type]!, [channel]: value } }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await savePreferencesAction({ types, quietStart, quietEnd, phone })
      if (result.ok) setSaved(true)
      else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  // Las horas van en punto; si lo guardado no lo es, se suma a la lista.
  const options = (value: string) => (hours.includes(value) ? hours : [...hours, value].sort())

  return (
    <form onSubmit={submit} className="grid gap-8">
      {/* Celular: una tarjeta por aviso con sus canales. */}
      <ul className="divide-y rounded-lg border sm:hidden">
        {Object.keys(types).map((type) => {
          const def = notificationTypes[type as NotificationType]
          return (
            <li key={type} className="grid gap-1 px-4 py-3">
              <span className="text-sm font-medium">{def.label}</span>
              <div className="flex flex-wrap gap-x-5">
                {def.channels.map((channel) => (
                  <label key={channel} className="flex h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={types[type]![channel]}
                      onChange={(e) => toggle(type, channel, e.target.checked)}
                    />
                    {channelLabels[channel]}
                  </label>
                ))}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Aviso</th>
              {channels.map((channel) => (
                <th key={channel} className="w-24 px-2 py-3 text-center font-medium">
                  {channelLabels[channel]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(types).map((type) => {
              const def = notificationTypes[type as NotificationType]
              return (
                <tr key={type} className="border-b last:border-b-0">
                  <td className="px-4 py-3">{def.label}</td>
                  {channels.map((channel) => (
                    <td key={channel} className="px-2 py-1 text-center">
                      {def.channels.includes(channel) ? (
                        <label className="flex h-11 cursor-pointer items-center justify-center sm:h-9">
                          <Checkbox
                            aria-label={`${def.label}: ${channelLabels[channel]}`}
                            checked={types[type]![channel]}
                            onChange={(e) => toggle(type, channel, e.target.checked)}
                          />
                        </label>
                      ) : (
                        <span className="text-muted-foreground" aria-hidden>
                          —
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Tu WhatsApp"
          htmlFor="phone"
          hint={
            !phone.trim()
              ? "Sin tu número no te llegan los avisos por WhatsApp."
              : whatsappAvailable
                ? "Los avisos te llegan desde el número de WhatsApp del negocio."
                : "Los avisos por WhatsApp empiezan a llegar cuando el negocio conecte su número."
          }
          error={fieldErrors.phone}
          className="sm:col-span-2"
        >
          <Input
            id="phone"
            inputMode="tel"
            autoComplete="tel"
            placeholder="099 123 456"
            value={phone}
            onChange={(e) => {
              setSaved(false)
              setPhone(e.target.value)
            }}
            aria-invalid={fieldErrors.phone ? true : undefined}
            className="max-w-64"
          />
        </Field>
        <Field label="Silencio desde" htmlFor="quietStart">
          <NativeSelect id="quietStart" value={quietStart} onChange={(e) => setQuietStart(e.target.value)}>
            {options(quietStart).map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Hasta" htmlFor="quietEnd">
          <NativeSelect id="quietEnd" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)}>
            {options(quietEnd).map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="-mt-4 text-xs text-muted-foreground sm:col-span-2">
          En ese horario no te mandamos push ni WhatsApp, salvo cuando un cliente necesita una persona.
        </p>
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
          Guardar preferencias
        </Button>
      </div>
    </form>
  )
}
