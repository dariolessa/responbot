import Link from "next/link"

import { BottomNav, SidebarNav } from "@/components/layout/app-nav"
import { BusinessSwitcher, type SwitcherBusiness } from "@/components/layout/business-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { UserMenu } from "@/components/layout/user-menu"
import { BillingBanner } from "@/components/billing/billing-banner"
import { getTenant } from "@/lib/auth/tenant"
import { monthUsage } from "@/lib/billing/access"
import { billingState } from "@/lib/billing/state"
import { env } from "@/lib/env"
import { isPlatformAdmin } from "@/lib/pilots/admins"
import { unreadCount } from "@/lib/notifications/inbox"

/*
 * Layout del panel: barra lateral en escritorio, barra inferior en el celular
 * (docs/SPEC.md, "Panel y agenda"). getTenant() valida la sesión y la
 * membresía; sin negocio redirige a /onboarding.
 */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const { user, role, business, memberships, db } = await getTenant()
  const badges = { "/app/notificaciones": await unreadCount(db, user.id) }
  const now = new Date()
  const billing = billingState((await db.business())!, now)
  const usage = await monthUsage(db, billing, business.timezone, now)
  const platformAdmin = isPlatformAdmin(user.email, env.PLATFORM_ADMIN_EMAILS)

  const toSwitcher = (m: typeof business): SwitcherBusiness => ({
    businessId: m.businessId,
    businessName: m.businessName,
    role: m.role,
  })
  const switcher = (
    <BusinessSwitcher current={toSwitcher(business)} businesses={memberships.map(toSwitcher)} />
  )

  return (
    <div className="min-h-dvh md:pl-64">
      {/* Escritorio */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/app/agenda" aria-label="Ir a la agenda">
            <Logo />
          </Link>
        </div>
        <div className="px-3 pb-4">{switcher}</div>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav role={role} badges={badges} />
        </div>
        <div className="flex items-center justify-between border-t px-3 py-3">
          <UserMenu name={user.name} email={user.email} image={user.image} platformAdmin={platformAdmin} />
          <ThemeToggle />
        </div>
      </aside>

      {/* Celular */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <Link href="/app/agenda" className="min-w-0" aria-label="Ir a la agenda">
          <span className="block truncate font-semibold">{business.businessName}</span>
        </Link>
        <div className="flex items-center">
          <ThemeToggle />
          <UserMenu name={user.name} email={user.email} image={user.image} platformAdmin={platformAdmin} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:px-10 md:pt-10 md:pb-12">
        <BillingBanner
          state={billing}
          overLimit={usage.conversations.used >= usage.conversations.limit}
          isOwner={role === "owner"}
        />
        {children}
      </main>

      <BottomNav role={role} badges={badges} footer={memberships.length > 1 ? switcher : undefined} />
    </div>
  )
}
