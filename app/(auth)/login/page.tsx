import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Logo } from "@/components/layout/logo"
import { GoogleIcon } from "@/components/layout/google-icon"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { auth } from "@/lib/auth"
import { safeCallbackUrl } from "@/lib/auth/callback-url"

import { signInWithGoogle } from "./actions"
import { MagicLinkForm } from "./magic-link-form"
import { PasswordForm } from "./password-form"

export const metadata: Metadata = { title: "Entrar" }

const errorMessages: Record<string, string> = {
  Verification: "El enlace venció o ya se usó. Pedí uno nuevo.",
  OAuthAccountNotLinked: "Ese email ya está asociado a otra forma de entrar.",
  AccessDenied: "No tenés acceso con esa cuenta.",
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams
  const callbackUrl = safeCallbackUrl(params.callbackUrl)

  const session = await auth()
  if (session?.user) redirect(callbackUrl)

  const errorCode = typeof params.error === "string" ? params.error : undefined
  const error = errorCode
    ? (errorMessages[errorCode] ?? "No pudimos iniciar sesión. Probá de nuevo.")
    : undefined

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          <Logo className="text-lg" />
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Entrá a tu panel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu agenda y tu asistente de WhatsApp, en un solo lugar.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <form action={signInWithGoogle}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <Button type="submit" className="w-full">
            <GoogleIcon />
            Continuar con Google
          </Button>
        </form>

        <div className="my-8 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">¿No podés entrar con Google?</span>
          <Separator className="flex-1" />
        </div>

        <MagicLinkForm callbackUrl={callbackUrl} />

        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          Te mandamos un enlace que vale por 15 minutos y se usa una sola vez.
        </p>

        <details className="group mt-8 rounded-lg border px-4 py-3" open={params.password !== undefined || undefined}>
          <summary className="cursor-pointer text-sm font-medium">Entrar con email y contraseña</summary>
          <p className="mt-2 mb-4 text-xs leading-relaxed text-muted-foreground">
            Para cuentas de prueba que te dimos con contraseña (por ejemplo, el equipo de revisión de Meta).
          </p>
          <PasswordForm callbackUrl={callbackUrl} />
        </details>
      </div>
    </main>
  )
}
