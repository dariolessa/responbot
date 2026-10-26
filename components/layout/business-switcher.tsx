"use client"

import { Check, ChevronsUpDown, Loader2, Store } from "lucide-react"
import { useTransition } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { switchBusiness } from "@/lib/auth/actions"
import { roleLabels } from "@/lib/auth/roles"
import type { Role } from "@/lib/db/schema"

export type SwitcherBusiness = { businessId: string; businessName: string; role: Role }

export function BusinessSwitcher({
  current,
  businesses,
}: {
  current: SwitcherBusiness
  businesses: SwitcherBusiness[]
}) {
  const [pending, startTransition] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-12 w-full items-center gap-3 rounded-md border px-3 text-left text-sm transition-colors duration-150 outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="Cambiar de negocio"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{current.businessName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {roleLabels[current.role]}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel>Tus negocios</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {businesses.map((b) => (
          <DropdownMenuItem
            key={b.businessId}
            disabled={pending}
            onSelect={() => {
              if (b.businessId === current.businessId) return
              startTransition(() => switchBusiness({ businessId: b.businessId }))
            }}
          >
            <span className="min-w-0 flex-1 truncate">{b.businessName}</span>
            {b.businessId === current.businessId ? <Check className="text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
