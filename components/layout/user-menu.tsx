"use client"

import { FlaskConical, LogOut } from "lucide-react"
import Link from "next/link"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOutAction } from "@/lib/auth/actions"

function initials(name: string | null, email: string) {
  const source = name?.trim() || email
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function UserMenu({
  name,
  email,
  image,
  platformAdmin = false,
}: {
  name: string | null
  email: string
  image: string | null
  /** Muestra el acceso al panel de la plataforma (pilotos y demo). */
  platformAdmin?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:size-9"
        aria-label="Tu cuenta"
      >
        <Avatar className="size-8">
          {image ? <AvatarImage src={image} alt="" /> : null}
          <AvatarFallback className="text-xs">{initials(name, email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          {name ? <p className="truncate text-sm font-medium">{name}</p> : null}
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {platformAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <FlaskConical />
              Pilotos
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void signOutAction()}>
          <LogOut />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
