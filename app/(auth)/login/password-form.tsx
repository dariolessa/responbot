"use client"

import { KeyRound, Loader2 } from "lucide-react"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { signInWithPassword, type PasswordState } from "./actions"

/** Ingreso con email y contraseña, para las cuentas de prueba (por ejemplo, la de los revisores de Meta). */
export function PasswordForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(signInWithPassword, {})

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="grid gap-2">
        <Label htmlFor="password-email">Email</Label>
        <Input
          id="password-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          defaultValue={state.email}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "password-error" : undefined}
          required
        />
        {state.error ? (
          <p id="password-error" role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Entrar con contraseña
      </Button>
    </form>
  )
}
