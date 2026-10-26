"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { can } from "@/lib/auth/roles"
import type { Role } from "@/lib/db/schema"
import { cn } from "@/lib/utils"

import { navItems, type NavItem } from "./nav-items"

function useVisibleItems(role: Role) {
  return navItems.filter((item) => !item.permission || can(role, item.permission))
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Lista vertical de la barra lateral (escritorio) y de la hoja "Más" (celular). */
export function SidebarNav({
  role,
  items,
  onNavigate,
}: {
  role: Role
  items?: NavItem[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const visible = useVisibleItems(role)
  const list = items ?? visible

  return (
    <nav className="grid gap-0.5">
      {list.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground md:h-9",
              active && "bg-sidebar-accent text-foreground",
            )}
          >
            <Icon className={cn("size-4", active && "text-primary")} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Barra inferior del celular: Agenda, Conversaciones, Clientes y Más. */
export function BottomNav({ role, footer }: { role: Role; footer?: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const visible = useVisibleItems(role)
  const primary = visible.filter((item) => item.mobile)
  const more = visible.filter((item) => !item.mobile)
  const moreActive = more.some((item) => isActive(pathname, item.href))

  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium"

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="flex">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(tab, active ? "text-primary" : "text-muted-foreground")}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          )
        })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger className={cn(tab, moreActive ? "text-primary" : "text-muted-foreground")}>
            <MoreHorizontal className="size-5" />
            Más
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-xl pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <SheetHeader>
              <SheetTitle>Más</SheetTitle>
            </SheetHeader>
            <div className="grid gap-4 px-4">
              <SidebarNav role={role} items={more} onNavigate={() => setOpen(false)} />
              {footer}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  )
}
