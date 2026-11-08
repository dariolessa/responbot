"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { AuthError } from "next-auth"
import { z } from "zod"

import { signIn } from "@/lib/auth"
import { safeCallbackUrl } from "@/lib/auth/callback-url"
import { createPasswordSession } from "@/lib/auth/password-login"
import { db } from "@/lib/db"

export async function signInWithGoogle(formData: FormData) {
  await signIn("google", { redirectTo: safeCallbackUrl(formData.get("callbackUrl")) })
}

export type MagicLinkState = { error?: string; email?: string }

const magicLinkSchema = z.object({
  email: z.email({ error: "Escribí un email válido." }).trim().toLowerCase(),
  callbackUrl: z.string().optional(),
})

export async function sendMagicLink(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, email: String(formData.get("email") ?? "") }
  }

  try {
    // Si sale bien, signIn redirige a /login/revisa-tu-correo.
    await signIn("resend", {
      email: parsed.data.email,
      redirectTo: safeCallbackUrl(parsed.data.callbackUrl),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "No pudimos mandarte el enlace. Probá de nuevo en un rato.",
        email: parsed.data.email,
      }
    }
    throw error
  }
  return {}
}

export type PasswordState = { error?: string; email?: string }

const passwordSchema = z.object({
  email: z.email({ error: "Escribí un email válido." }).trim().toLowerCase(),
  password: z.string().min(1, { error: "Escribí la contraseña." }).max(200),
  callbackUrl: z.string().optional(),
})

/**
 * Ingreso con contraseña: solo para cuentas de prueba creadas por script (la
 * de los revisores de Meta, scripts/seed-meta-reviewer.ts). Crea la misma
 * sesión en base que Auth.js y pone su cookie.
 */
export async function signInWithPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const parsed = passwordSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, email: String(formData.get("email") ?? "") }
  }

  const session = await createPasswordSession(db, parsed.data.email, parsed.data.password)
  if (!session) {
    console.warn("[auth] contraseña incorrecta", { email: parsed.data.email })
    return { error: "El email o la contraseña no coinciden.", email: parsed.data.email }
  }

  // Mismo nombre de cookie que usa Auth.js: con HTTPS lleva el prefijo __Secure-.
  const proto = (await headers()).get("x-forwarded-proto")
  const secure = proto ? proto.split(",")[0]?.trim() === "https" : process.env.NODE_ENV === "production"
  ;(await cookies()).set(secure ? "__Secure-authjs.session-token" : "authjs.session-token", session.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: session.expires,
  })
  redirect(safeCallbackUrl(parsed.data.callbackUrl))
}
