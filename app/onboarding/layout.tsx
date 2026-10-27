import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"

/** Asistente de alta (docs/SPEC.md, "Asistente de alta del negocio"). */
export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-8 pb-16 sm:pt-12">{children}</main>
    </div>
  )
}
