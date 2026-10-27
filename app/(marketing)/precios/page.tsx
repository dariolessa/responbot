import type { Metadata } from "next"

import { faq, Pricing } from "@/components/marketing/pricing"
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome"

export const metadata: Metadata = {
  title: "Precios",
  description: "Planes mensuales en dólares con 14 días de prueba gratis y sin tarjeta.",
}

export default function PreciosPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 sm:px-6 md:py-20">
        <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Precios</h1>
        <p className="mx-auto mt-3 mb-10 max-w-xl text-center text-muted-foreground">
          Un plan para cada tamaño de local. Todos incluyen el bot de WhatsApp, la agenda y los recordatorios.
        </p>
        <Pricing />
        <div className="mx-auto mt-16 grid max-w-3xl gap-6">
          {faq.slice(4).map((item) => (
            <div key={item.q}>
              <h2 className="font-medium">{item.q}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{item.a}</p>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
