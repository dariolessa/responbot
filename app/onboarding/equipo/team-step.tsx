"use client"

import { ArrowRight, Check, Loader2, Trash2, UserPlus } from "lucide-react"
import { useRef, useState, useTransition } from "react"

import { FieldError, FormError } from "@/components/forms/field"
import { ServicePicker } from "@/components/forms/service-picker"
import { WeeklyHoursEditor } from "@/components/forms/weekly-hours-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { WeeklyRangeValue } from "@/lib/forms"
import { defaultWeeklyHours } from "@/lib/hours"

import { continueStep, saveTeamStep } from "../step-actions"

type Member = {
  key: number
  name: string
  isMe: boolean
  email: string
  serviceIds: string[]
  hours: WeeklyRangeValue[]
}

export function TeamStep({
  me,
  services,
  existing,
}: {
  me: { name: string; email: string }
  services: { id: string; name: string }[]
  existing: { id: string; name: string; isMe: boolean; hours: string }[]
}) {
  const allServiceIds = services.map((s) => s.id)
  const meTaken = existing.some((r) => r.isMe)
  const [members, setMembers] = useState<Member[]>(() =>
    existing.length > 0
      ? []
      : [
          {
            key: 0,
            name: me.name,
            isMe: true,
            email: "",
            serviceIds: allServiceIds,
            hours: defaultWeeklyHours(),
          },
        ],
  )
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  // Claves estables para las filas nuevas (las iniciales usan 0, igual en servidor y cliente).
  const nextKey = useRef(1)

  function update(key: number, patch: Partial<Member>) {
    setMembers((current) =>
      current.map((m) => {
        if (m.key === key) return { ...m, ...patch }
        // Solo una persona puede ser "yo".
        if (patch.isMe) return { ...m, isMe: false }
        return m
      }),
    )
  }

  function addMember() {
    setMembers((current) => [
      ...current,
      {
        key: nextKey.current++,
        name: "",
        isMe: false,
        email: "",
        serviceIds: allServiceIds,
        // Arranca con el horario del primero, que suele ser el del local.
        hours: current[0]?.hours.map((h) => ({ ...h })) ?? defaultWeeklyHours(),
      },
    ])
  }

  function submit() {
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result =
        members.length === 0 && existing.length > 0
          ? await continueStep("team")
          : await saveTeamStep({
              members: members.map((m) => ({
                name: m.name,
                isMe: m.isMe,
                email: m.isMe ? "" : m.email,
                serviceIds: m.serviceIds,
                hours: m.hours,
              })),
            })
      if (result && !result.ok) {
        setError(result.error)
        const mapped: Record<string, string> = {}
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          const [, index, field] = path.split(".")
          const member = members[Number(index)]
          if (member && field) mapped[`${member.key}.${field}`] ??= message
        }
        setFieldErrors(mapped)
      }
    })
  }

  return (
    <div className="grid gap-8">
      {existing.length > 0 ? (
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Ya están en tu equipo</h2>
          <ul className="mt-3 grid gap-2">
            {existing.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  {r.name}
                  {r.isMe ? <span className="text-muted-foreground"> (vos)</span> : null}
                  <span className="block text-xs text-muted-foreground">{r.hours}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {members.map((member, index) => {
        const err = (field: string) => fieldErrors[`${member.key}.${field}`]
        const id = (field: string) => `member-${member.key}-${field}`
        return (
          <section key={member.key} className="grid gap-6 rounded-lg border p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-medium">
                {member.isMe ? "Vos" : member.name.trim() || `Profesional ${index + 1}`}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Quitar profesional"
                onClick={() => setMembers((current) => current.filter((m) => m.key !== member.key))}
              >
                <Trash2 />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={id("name")}>Nombre</Label>
                <Input
                  id={id("name")}
                  value={member.name}
                  placeholder="Ana Pérez"
                  aria-invalid={err("name") ? true : undefined}
                  onChange={(e) => update(member.key, { name: e.target.value })}
                />
                <FieldError message={err("name")} />
              </div>
              {member.isMe ? null : (
                <div className="grid gap-2">
                  <Label htmlFor={id("email")}>Email para invitarlo (opcional)</Label>
                  <Input
                    id={id("email")}
                    type="email"
                    value={member.email}
                    placeholder="ana@gmail.com"
                    aria-invalid={err("email") ? true : undefined}
                    onChange={(e) => update(member.key, { email: e.target.value })}
                  />
                  <FieldError message={err("email")} />
                </div>
              )}
            </div>

            {meTaken ? null : (
              <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-0">
                <Checkbox
                  checked={member.isMe}
                  onChange={(e) => update(member.key, { isMe: e.target.checked })}
                />
                Soy yo: también atiendo y quiero ver mi agenda
              </label>
            )}

            <div className="grid gap-2">
              <p className="text-sm font-medium">Servicios que hace</p>
              <ServicePicker
                services={services}
                value={member.serviceIds}
                onChange={(serviceIds) => update(member.key, { serviceIds })}
              />
              <FieldError message={err("serviceIds")} />
            </div>

            <div className="grid gap-2">
              <p className="text-sm font-medium">Horario de la semana</p>
              <WeeklyHoursEditor
                idPrefix={id("hours")}
                value={member.hours}
                onChange={(hours) => update(member.key, { hours })}
                error={err("hours")}
              />
            </div>
          </section>
        )
      })}

      <div>
        <Button type="button" variant="outline" onClick={addMember}>
          <UserPlus />
          Agregar profesional
        </Button>
      </div>

      <FormError message={error} />

      <div className="flex justify-end">
        <Button type="button" size="lg" onClick={submit} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {members.length > 0 ? "Guardar y seguir" : "Seguir"}
          {pending ? null : <ArrowRight />}
        </Button>
      </div>
    </div>
  )
}
