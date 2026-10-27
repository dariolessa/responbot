import { LifeBuoy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { endSupportAction } from "@/lib/support/actions"

/** Franja fija del modo soporte: deja claro de quién es el panel y cómo salir. */
export function SupportBanner({ businessName }: { businessName: string }) {
  return (
    <div
      role="status"
      className="z-40 flex md:sticky md:top-0 flex-wrap items-center justify-between gap-2 bg-amber-400 px-4 py-2 text-sm text-amber-950 sm:px-6"
    >
      <p className="flex min-w-0 items-center gap-2">
        <LifeBuoy className="size-4 shrink-0" />
        <span className="min-w-0">
          Modo soporte en <span className="font-semibold">{businessName}</span>. Lo que hagas queda a tu nombre y en la
          auditoría del negocio.
        </span>
      </p>
      <form action={endSupportAction}>
        <Button type="submit" size="sm" variant="outline" className="border-amber-950/30 bg-amber-50 text-amber-950 hover:bg-amber-100">
          Salir del modo soporte
        </Button>
      </form>
    </div>
  )
}
