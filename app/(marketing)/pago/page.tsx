import type { Metadata } from "next"
import Link from "next/link"

import { Logo } from "@/components/layout/logo"

export const metadata: Metadata = { title: "Pago de la seña" }

/** Adónde vuelve el cliente después de pagar la seña en Mercado Pago. */
export default function PagoPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-6 sm:px-6">
      <Link href="/" className="w-fit">
        <Logo />
      </Link>
      <main className="mt-16 grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">¡Gracias!</h1>
        <p className="text-sm text-muted-foreground">
          Si el pago se aprobó, en unos minutos te llega la confirmación del turno por WhatsApp. Ya podés cerrar esta
          página.
        </p>
      </main>
    </div>
  )
}
