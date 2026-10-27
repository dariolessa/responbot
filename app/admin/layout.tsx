import Link from "next/link"

import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { requirePlatformAdmin } from "@/lib/pilots/admin"

/*
 * Panel de la plataforma (Fase 7): pilotos, demo pública, soporte y revisión del bot.
 * Solo para los emails de PLATFORM_ADMIN_EMAILS; al resto le da 404.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePlatformAdmin()
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/admin" aria-label="Pilotos" className="shrink-0">
            <Logo />
          </Link>
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm whitespace-nowrap">
            <Link href="/admin" className="inline-flex min-h-11 items-center rounded-md px-2 hover:bg-muted sm:min-h-8">
              Pilotos
            </Link>
            <Link href="/admin/soporte" className="inline-flex min-h-11 items-center rounded-md px-2 hover:bg-muted sm:min-h-8">
              Soporte
            </Link>
            <Link href="/admin/revision" className="inline-flex min-h-11 items-center rounded-md px-2 hover:bg-muted sm:min-h-8">
              Revisión del bot
            </Link>
            <Link href="/admin/ayuda" className="inline-flex min-h-11 items-center rounded-md px-2 hover:bg-muted sm:min-h-8">
              Cómo se usa
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/app" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">
            Ir al panel
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-6 md:pt-10">{children}</main>
    </div>
  )
}
