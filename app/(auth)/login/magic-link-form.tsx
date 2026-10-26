"use client"

import { Loader2, Mail } from "lucide-react"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { sendMagicLink, type MagicLinkState } from "./actions"

export function MagicLinkForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, {})

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="vos@tunegocio.com"
          defaultValue={state.email}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "email-error" : undefined}
          required
        />
        {state.error ? (
          <p id="email-error" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Mail />}
        Recibir un enlace de acceso
      </Button>
    </form>
  )
}
