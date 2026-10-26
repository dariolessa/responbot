import { MailCheck } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Revisá tu correo" }

export default function CheckEmailPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Revisá tu correo</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Te mandamos un enlace para entrar. Vale por 15 minutos y se usa una sola vez. Si no
          lo ves, fijate en la carpeta de spam.
        </p>
        <Button asChild variant="ghost" className="mt-8">
          <Link href="/login">Volver</Link>
        </Button>
      </div>
    </main>
  )
}
