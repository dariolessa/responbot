"use server"

import { AuthError } from "next-auth"
import { z } from "zod"

import { signIn } from "@/lib/auth"
import { safeCallbackUrl } from "@/lib/auth/callback-url"

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
