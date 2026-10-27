"use client"

import { Loader2, UserPlus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Field, FormError } from "@/components/forms/field"
import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { createCustomer, updateCustomer } from "./actions"

type Values = { name: string; phone: string; notes: string }

/** Formulario de cliente: alta (sin id) o edición. */
export function CustomerForm({
  id,
  initial,
  onSaved,
}: {
  id?: string
  initial: Values
  onSaved: (id: string) => void
}) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = id ? await updateCustomer({ id, ...values }) : await createCustomer(values)
      if (result.ok) onSaved(result.data?.id ?? id!)
      else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field label="Nombre" htmlFor="customer-name" error={fieldErrors.name}>
        <Input
          id="customer-name"
          value={values.name}
          autoComplete="off"
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
      </Field>
      <Field label="Teléfono (WhatsApp)" htmlFor="customer-phone" hint="Por ejemplo 099 123 456." error={fieldErrors.phone}>
        <Input
          id="customer-phone"
          type="tel"
          inputMode="tel"
          className="font-mono"
          value={values.phone}
          autoComplete="off"
          onChange={(e) => setValues({ ...values, phone: e.target.value })}
        />
      </Field>
      <Field label="Notas" htmlFor="customer-notes" hint="Preferencias, alergias, lo que sirva recordar." error={fieldErrors.notes}>
        <Textarea
          id="customer-notes"
          value={values.notes}
          onChange={(e) => setValues({ ...values, notes: e.target.value })}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Guardar
      </Button>
    </form>
  )
}

export function NewCustomerButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus />
        Agregar cliente
      </Button>
      <ResponsiveSheet open={open} onOpenChange={setOpen} title="Nuevo cliente">
        {open ? (
          <CustomerForm
            initial={{ name: "", phone: "", notes: "" }}
            onSaved={(id) => {
              setOpen(false)
              router.push(`/app/clientes/${id}`)
            }}
          />
        ) : null}
      </ResponsiveSheet>
    </>
  )
}
