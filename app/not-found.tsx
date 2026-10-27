import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">No encontramos esta página</h1>
      <Button asChild variant="outline" className="mt-8">
        <Link href="/">Ir al inicio</Link>
      </Button>
    </main>
  )
}
