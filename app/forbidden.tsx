import { ShieldX } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldX className="size-6" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">No tenés acceso a esta sección</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Pedile al dueño del negocio que te cambie el rol si la necesitás.
      </p>
      <Button asChild variant="outline" className="mt-8">
        <Link href="/app/agenda">Volver a la agenda</Link>
      </Button>
    </main>
  )
}
