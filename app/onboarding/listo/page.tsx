import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { StepList } from "@/components/onboarding/pending-steps"
import { Button } from "@/components/ui/button"
import { getTenant } from "@/lib/auth/tenant"
import { pendingSteps } from "@/lib/onboarding/steps"

export const metadata: Metadata = { title: "Tu agenda está lista" }

export default async function ListoPage() {
  const { db } = await getTenant()
  const business = await db.business()
  const completed = business?.onboardingCompleted ?? []
  const pending = pendingSteps(completed)

  return (
    <div className="w-full max-w-lg">
      <h1 className="text-2xl font-semibold tracking-tight">
        {pending.length === 0 ? "¡Tu agenda está lista!" : "Ya casi está"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {pending.length === 0
          ? "Ya podés cargar turnos desde el panel. Conectar WhatsApp y probar el bot llegan muy pronto."
          : "Te faltan algunos pasos. Podés seguir ahora o desde el panel cuando quieras."}
      </p>
      <div className="mt-8 rounded-lg border p-2">
        <StepList completed={completed} />
      </div>
      <Button asChild size="lg" className="mt-8 w-full sm:w-auto">
        <Link href="/app/agenda">
          Ir a mi agenda
          <ArrowRight />
        </Link>
      </Button>
    </div>
  )
}
