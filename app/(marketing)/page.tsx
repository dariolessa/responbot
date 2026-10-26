import { ArrowRight } from "lucide-react"
import Link from "next/link"

import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"

// Landing provisoria: la versión completa llega en la Fase 6.
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <Link href="/login">Entrar</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-20 sm:px-6">
        <p className="text-sm font-medium text-primary">Para peluquerías, barberías, uñas y estética</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Tu WhatsApp responde, cotiza y reserva turnos mientras vos trabajás.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Un asistente que usa tu agenda real, con recordatorios automáticos y un panel para tu
          equipo.
        </p>
        <div className="mt-10">
          <Button asChild size="lg">
            <Link href="/login">
              Empezar gratis
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
