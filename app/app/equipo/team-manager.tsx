"use client"

import { Clock, Loader2, Mail, Plus, UserPlus, Users, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Field, FormError } from "@/components/forms/field"
import { ServicePicker } from "@/components/forms/service-picker"
import { WeeklyHoursEditor } from "@/components/forms/weekly-hours-editor"
import { EmptyState } from "@/components/layout/empty-state"
import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { roleLabels } from "@/lib/auth/roles"
import { colorOptions, resourceColor } from "@/lib/colors"
import type { MemberWithUser } from "@/lib/db/scoped"
import type { WeeklyRangeValue } from "@/lib/forms"
import { defaultWeeklyHours, summarizeHours } from "@/lib/hours"
import { cn } from "@/lib/utils"

import { cancelInvitation, invite, saveStaff, updateMember } from "./actions"

type Staff = {
  id: string
  name: string
  color: string | null
  active: boolean
  userId: string | null
  serviceIds: string[]
  hours: WeeklyRangeValue[]
}

type StaffDraft = Omit<Staff, "id"> & { id?: string }

type Invitation = {
  id: string
  email: string
  role: "owner" | "admin" | "staff"
  resourceId: string | null
  expiresAt: string
}

type InviteDraft = { email: string; role: "admin" | "staff"; resourceId: string | null }

export function TeamManager({
  currentUserId,
  services,
  staff,
  members,
  invitations,
}: {
  currentUserId: string
  services: { id: string; name: string }[]
  staff: Staff[]
  members: MemberWithUser[]
  invitations: Invitation[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<StaffDraft | null>(null)
  const [inviteDraft, setInviteDraft] = useState<InviteDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)

  const memberName = (userId: string | null) => {
    const m = members.find((x) => x.userId === userId)
    return m ? (m.userId === currentUserId ? "Vos" : (m.name ?? m.email)) : null
  }
  const invitationFor = (resourceId: string) => invitations.find((i) => i.resourceId === resourceId)

  function resetErrors() {
    setError(null)
    setFieldErrors({})
  }

  function openStaff(s?: Staff) {
    resetErrors()
    setDraft(
      s
        ? { ...s }
        : {
            name: "",
            color: colorOptions[staff.length % colorOptions.length]!,
            active: true,
            userId: null,
            serviceIds: services.map((x) => x.id),
            hours: staff[0]?.hours.map((h) => ({ ...h })) ?? defaultWeeklyHours(),
          },
    )
  }

  function submitStaff(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    startTransition(async () => {
      const result = await saveStaff(draft)
      if (result.ok) {
        setDraft(null)
        router.refresh()
      } else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  function submitInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteDraft) return
    startTransition(async () => {
      const result = await invite(inviteDraft)
      if (result.ok) {
        setNotice(
          result.data.sent
            ? `Le mandamos la invitación a ${inviteDraft.email}.`
            : `La invitación quedó lista, pero no pudimos mandar el correo. Avisale a ${inviteDraft.email} que entre con ese email.`,
        )
        setInviteDraft(null)
        router.refresh()
      } else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  function memberAction(input: Parameters<typeof updateMember>[0], confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    startTransition(async () => {
      const result = await updateMember(input)
      if (!result.ok) setNotice(result.error)
      router.refresh()
    })
  }

  const linkable = members.filter(
    (m) => m.active && (!staff.some((s) => s.userId === m.userId) || draft?.userId === m.userId),
  )

  return (
    <div className="grid gap-10">
      {notice ? (
        <p role="status" className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          {notice}
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <X className="size-4" />
          </button>
        </p>
      ) : null}

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-medium">Profesionales</h2>
            <p className="text-sm text-muted-foreground">Cada uno es una columna de la agenda.</p>
          </div>
          <Button onClick={() => openStaff()}>
            <Plus />
            Agregar profesional
          </Button>
        </div>

        {staff.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Todavía no sumaste a tu equipo"
            description="Agregá a los profesionales y sus horarios para empezar a dar turnos."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {staff.map((s, index) => {
              const linked = memberName(s.userId)
              const pendingInvite = invitationFor(s.id)
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openStaff(s)}
                    className="flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-accent/50"
                  >
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: resourceColor(s.color, index) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {s.active ? null : <Badge variant="secondary">Inactivo</Badge>}
                        {linked ? <Badge variant="outline">{linked}</Badge> : null}
                        {!linked && pendingInvite ? (
                          <Badge variant="outline">Invitación enviada</Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="size-3.5 shrink-0" />
                        {summarizeHours(s.hours)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {s.serviceIds.length === services.length && services.length > 0
                          ? "Hace todos los servicios"
                          : `${s.serviceIds.length} de ${services.length} servicios`}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-medium">Acceso al panel</h2>
            <p className="text-sm text-muted-foreground">
              Quiénes entran y qué pueden hacer. Un profesional ve solo su agenda y sus clientes.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              resetErrors()
              setInviteDraft({ email: "", role: "staff", resourceId: null })
            }}
          >
            <UserPlus />
            Invitar a alguien
          </Button>
        </div>

        <ul className="divide-y rounded-lg border">
          {members.map((m) => {
            const isMe = m.userId === currentUserId
            const editable = m.role !== "owner" && !isMe
            return (
              <li key={m.membershipId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={cn("min-w-0 flex-1", !m.active && "opacity-60")}>
                  <span className="block truncate text-sm font-medium">
                    {m.name ?? m.email}
                    {isMe ? <span className="font-normal text-muted-foreground"> (vos)</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                </span>
                {editable && m.active ? (
                  <NativeSelect
                    aria-label={`Rol de ${m.name ?? m.email}`}
                    value={m.role}
                    disabled={pending}
                    onChange={(e) =>
                      memberAction({
                        membershipId: m.membershipId,
                        role: e.target.value as "admin" | "staff",
                      })
                    }
                    className="w-36"
                  >
                    <option value="admin">{roleLabels.admin}</option>
                    <option value="staff">{roleLabels.staff}</option>
                  </NativeSelect>
                ) : (
                  <Badge variant="secondary">{m.active ? roleLabels[m.role] : "Sin acceso"}</Badge>
                )}
                {editable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      memberAction(
                        { membershipId: m.membershipId, active: !m.active },
                        m.active
                          ? `${m.name ?? m.email} va a perder el acceso al panel ahora mismo. ¿Seguimos?`
                          : undefined,
                      )
                    }
                  >
                    {m.active ? "Quitar acceso" : "Devolver acceso"}
                  </Button>
                ) : null}
              </li>
            )
          })}
          {invitations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Mail className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{i.email}</span>
                <span className="block text-xs text-muted-foreground">
                  Invitación pendiente · {roleLabels[i.role]}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await cancelInvitation({ id: i.id })
                    router.refresh()
                  })
                }
              >
                Cancelar invitación
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <ResponsiveSheet
        open={draft !== null}
        onOpenChange={(o) => (o ? null : setDraft(null))}
        title={draft?.id ? draft.name || "Profesional" : "Nuevo profesional"}
        footer={
          <div className="flex justify-end">
            <Button type="submit" form="staff-form" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Guardar
            </Button>
          </div>
        }
      >
        {draft ? (
          <form id="staff-form" onSubmit={submitStaff} className="grid gap-6">
            <Field label="Nombre" htmlFor="staff-name" error={fieldErrors.name}>
              <Input
                id="staff-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                aria-invalid={fieldErrors.name ? true : undefined}
              />
            </Field>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Color en la agenda</p>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    aria-pressed={draft.color === c}
                    onClick={() => setDraft({ ...draft, color: c })}
                    className={cn(
                      "size-9 rounded-full border-2 border-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      draft.color === c && "border-foreground",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <Field
              label="Entra al panel como"
              htmlFor="staff-user"
              hint="Así ve su propia agenda. Para sumar a alguien nuevo, invitalo por email."
            >
              <NativeSelect
                id="staff-user"
                value={draft.userId ?? ""}
                onChange={(e) => setDraft({ ...draft, userId: e.target.value || null })}
              >
                <option value="">Nadie (solo figura en la agenda)</option>
                {linkable.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === currentUserId ? "Vos" : (m.name ?? m.email)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {draft.id && !draft.userId && !invitationFor(draft.id) ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetErrors()
                  setInviteDraft({ email: "", role: "staff", resourceId: draft.id! })
                  setDraft(null)
                }}
              >
                <Mail />
                Invitar a {draft.name || "este profesional"} por email
              </Button>
            ) : null}
            <div className="grid gap-2">
              <p className="text-sm font-medium">Servicios que hace</p>
              <ServicePicker
                services={services}
                value={draft.serviceIds}
                onChange={(serviceIds) => setDraft({ ...draft, serviceIds })}
              />
            </div>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Horario de la semana</p>
              <WeeklyHoursEditor
                value={draft.hours}
                onChange={(hours) => setDraft({ ...draft, hours })}
                error={Object.entries(fieldErrors).find(([k]) => k.startsWith("hours"))?.[1]}
              />
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              Activo: aparece en la agenda y se le pueden dar turnos
            </label>
            <FormError message={error} />
          </form>
        ) : null}
      </ResponsiveSheet>

      <ResponsiveSheet
        open={inviteDraft !== null}
        onOpenChange={(o) => (o ? null : setInviteDraft(null))}
        title="Invitar a alguien"
        description="Le llega un correo para entrar con su cuenta de Google. La invitación vence en 7 días."
        footer={
          <div className="flex justify-end">
            <Button type="submit" form="invite-form" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Mandar invitación
            </Button>
          </div>
        }
      >
        {inviteDraft ? (
          <form id="invite-form" onSubmit={submitInvite} className="grid gap-5">
            <Field label="Email" htmlFor="invite-email" error={fieldErrors.email}>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                value={inviteDraft.email}
                onChange={(e) => setInviteDraft({ ...inviteDraft, email: e.target.value })}
                aria-invalid={fieldErrors.email ? true : undefined}
                autoFocus
              />
            </Field>
            <Field
              label="Rol"
              htmlFor="invite-role"
              hint={
                inviteDraft.role === "admin"
                  ? "Puede todo menos facturación, borrar el negocio y transferirlo."
                  : "Ve y gestiona solo su agenda y sus clientes."
              }
            >
              <NativeSelect
                id="invite-role"
                value={inviteDraft.role}
                onChange={(e) =>
                  setInviteDraft({ ...inviteDraft, role: e.target.value as "admin" | "staff" })
                }
              >
                <option value="staff">{roleLabels.staff}</option>
                <option value="admin">{roleLabels.admin}</option>
              </NativeSelect>
            </Field>
            <Field
              label="Su agenda"
              htmlFor="invite-resource"
              hint="Si atiende, elegí su columna de la agenda."
            >
              <NativeSelect
                id="invite-resource"
                value={inviteDraft.resourceId ?? ""}
                onChange={(e) => setInviteDraft({ ...inviteDraft, resourceId: e.target.value || null })}
              >
                <option value="">No atiende</option>
                {staff
                  .filter((s) => !s.userId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <FormError message={error} />
          </form>
        ) : null}
      </ResponsiveSheet>
    </div>
  )
}
