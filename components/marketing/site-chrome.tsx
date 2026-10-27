import Link from "next/link"

import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { brand } from "@/lib/brand"

/** Encabezado de las páginas públicas (landing, precios, términos, privacidad). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label={`${brand.name}, inicio`}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Secciones">
          <Link href="/#como-funciona" className="hover:text-foreground">
            Cómo funciona
          </Link>
          <Link href="/precios" className="hover:text-foreground">
            Precios
          </Link>
          <Link href="/#preguntas" className="hover:text-foreground">
            Preguntas
          </Link>
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild>
            <Link href="/login">Probar gratis</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="grid gap-2">
          <Logo />
          <p>
            © {new Date().getFullYear()} {brand.legalName ?? brand.name}. Hecho en Uruguay.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Legales">
          <Link href="/precios" className="hover:text-foreground">
            Precios
          </Link>
          <Link href="/terminos" className="hover:text-foreground">
            Términos
          </Link>
          <Link href="/privacidad" className="hover:text-foreground">
            Privacidad
          </Link>
          <Link href="/eliminacion-de-datos" className="hover:text-foreground">
            Eliminación de datos
          </Link>
          {brand.contactEmail ? (
            <a href={`mailto:${brand.contactEmail}`} className="hover:text-foreground">
              {brand.contactEmail}
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  )
}
