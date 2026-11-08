"use client"

import { KeyRound, Loader2 } from "lucide-react"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { seedMetaReviewerAction, type ReviewerState } from "../actions"

export function ReviewerForm() {
  const [state, action, pending] = useActionState<ReviewerState, FormData>(seedMetaReviewerAction, {})

  return (
    <form action={action} className="grid max-w-sm gap-4">
      <div className="grid gap-2">
        <Label htmlFor="password">Contraseña para reviewer@responbot.com</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Repetila</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p role="status" className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          Listo: usuario {state.done.createdUser ? "creado" : "actualizado"} y Peluquería Demo{" "}
          {state.done.createdBusiness ? "creada" : "actualizada"}. Ya pueden entrar con esa contraseña.
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Crear o actualizar la cuenta
      </Button>
    </form>
  )
}
