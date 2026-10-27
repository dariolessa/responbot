import "server-only"

import { Resend } from "resend"

import { env } from "@/lib/env"

let client: Resend | undefined

/** Cliente de Resend (se crea al primer uso). */
export function resend(): Resend {
  client ??= new Resend(env.RESEND_API_KEY)
  return client
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const { error } = await resend().emails.send({ from: env.EMAIL_FROM, ...input })
  if (error) throw new Error(`Resend no pudo enviar el correo: ${error.message}`)
}
