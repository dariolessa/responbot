import {
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  CalendarCheck,
  Clock,
  CreditCard,
  ListChecks,
  MessageCircle,
  Settings2,
  Smartphone,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { AgendaMock } from "@/components/marketing/agenda-mock"
import { ChatMock } from "@/components/marketing/chat-mock"
import { faq, Pricing } from "@/components/marketing/pricing"
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome"
import { Button } from "@/components/ui/button"
import { TRIAL_DAYS } from "@/lib/billing/plans"
import { brand } from "@/lib/brand"

export const metadata: Metadata = {
  title: { absolute: `${brand.name} · Tu WhatsApp reserva turnos por vos` },
  description:
    "Un asistente de WhatsApp que responde consultas, cotiza y reserva turnos con tu agenda real. Para peluquerías, barberías, uñas y estética.",
}

const steps: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Settings2,
    title: "Cargás tu negocio",
    text: "Servicios con precio y duración, tu equipo y sus horarios. Con plantillas por rubro, en unos minutos.",
  },
  {
    icon: Smartphone,
    title: "Conectás tu WhatsApp",
    text: "Con el alta oficial de Meta, sin programas raros ni riesgo de bloqueo.",
  },
  {
    icon: CalendarCheck,
    title: "El bot atiende y reserva",
    text: "Responde al instante, ofrece horarios libres de verdad y anota el turno en tu agenda.",
  },
]

const features: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Clock, title: "Responde las 24 horas", text: "Las consultas de la noche ya no se pierden: el bot las contesta y reserva." },
  { icon: MessageCircle, title: "Cotiza sin errores", text: "Precios y duraciones salen de tu lista de servicios, nunca inventados." },
  { icon: BellRing, title: "Recordatorios con botones", text: "Confirmar, reprogramar o cancelar con un toque. Menos faltazos." },
  { icon: CreditCard, title: "Señas con Mercado Pago", text: "El turno se confirma cuando pagan, y la plata va directo a tu cuenta." },
  { icon: ListChecks, title: "Lista de espera", text: "Si alguien cancela, el lugar se ofrece solo al primero que lo quiera." },
  { icon: UsersRound, title: "Clientes que vuelven", text: "Invitaciones a volver cuando pasa su tiempo habitual y pedido de reseñas en Google." },
  { icon: Bot, title: "Una persona cuando hace falta", text: "El bot deriva lo que no sabe y te avisa al celular para que respondas." },
  { icon: BarChart3, title: "Números claros", text: "Turnos, ingresos, inasistencias y los horarios que más te piden." },
]

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Titular */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-sm font-medium text-primary">Para peluquerías, barberías, uñas y estética</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Tu WhatsApp responde, cotiza y reserva turnos mientras vos trabajás.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Un asistente que usa tu agenda real, manda recordatorios y cobra señas, con un panel simple para vos y tu
              equipo.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg">
                <Link href="/login">
                  Probar {TRIAL_DAYS} días gratis
                  <ArrowRight />
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">Sin tarjeta. Configurás todo en minutos.</span>
            </div>
          </div>
          <ChatMock />
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" className="scroll-mt-20 border-t bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Cómo funciona</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className="grid content-start gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <step.icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="font-medium">
                    <span className="font-mono text-muted-foreground">{index + 1}.</span> {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Agenda */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Tu agenda, siempre al día</h2>
            <p className="mt-4 text-muted-foreground">
              Cada turno que toma el bot aparece al instante en la columna del profesional. Movés turnos, cargás
              bloqueos y marcás quién vino desde el celular, y cada profesional ve solo lo suyo.
            </p>
            <ul className="mt-6 grid gap-2 text-sm">
              <li>• Vista del día, de la semana y en lista.</li>
              <li>• Aviso al celular con cada reserva, cancelación o cliente que pide una persona.</li>
              <li>• Resumen del día por WhatsApp a las 8 de la mañana.</li>
            </ul>
          </div>
          <AgendaMock />
        </section>

        {/* Funciones */}
        <section className="border-t bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Todo lo que hace por vos</h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <div key={feature.title} className="grid content-start gap-2">
                  <feature.icon className="size-5 text-primary" strokeWidth={1.75} />
                  <h3 className="font-medium">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Precios */}
        <section id="precios" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 md:py-24">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Precios simples</h2>
          <p className="mx-auto mt-3 mb-10 max-w-xl text-center text-muted-foreground">
            Empezá con la prueba gratis y elegí el plan cuando veas que funciona.
          </p>
          <Pricing />
        </section>

        {/* Preguntas */}
        <section id="preguntas" className="scroll-mt-20 border-t bg-muted/30">
          <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 md:py-20">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Preguntas frecuentes</h2>
            <div className="mt-8 divide-y rounded-[10px] border bg-background">
              {faq.map((item) => (
                <details key={item.q} className="group px-4 sm:px-5">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-medium [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="pb-4 text-sm text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6 md:py-24">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Que tu WhatsApp trabaje mientras vos atendés.
          </h2>
          <Button asChild size="lg" className="mt-8">
            <Link href="/login">
              Empezar gratis
              <ArrowRight />
            </Link>
          </Button>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
