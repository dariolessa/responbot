import { Logo } from "@/components/layout/logo"
import { SupportBanner } from "@/components/layout/support-banner"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { requireUser } from "@/lib/auth/tenant"
import { supportBusiness } from "@/lib/support/mode"

/** Asistente de alta (docs/SPEC.md, "Asistente de alta del negocio"). */
export default async function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  const user = await requireUser()
  const support = await supportBusiness(user.email)
  return (
    <div className="flex min-h-dvh flex-col">
      {support ? <SupportBanner businessName={support.name} /> : null}
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-8 pb-16 sm:pt-12">{children}</main>
    </div>
  )
}
