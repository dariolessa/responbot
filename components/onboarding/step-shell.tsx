import Link from "next/link"

import { TOTAL_STEPS, type Step } from "@/lib/onboarding/steps"
import { cn } from "@/lib/utils"

/** Encabezado común de cada paso: número, progreso, título y bajada. */
export function StepShell({
  step,
  title,
  description,
  wide,
  children,
}: {
  step: Step
  title: string
  description?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("w-full", wide ? "max-w-2xl" : "max-w-lg")}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-primary">
          Paso {step.number} de {TOTAL_STEPS}
        </p>
        {step.number > 1 ? (
          <Link
            href="/app/agenda"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Terminar después
          </Link>
        ) : null}
      </div>
      <div
        className="mt-3 flex gap-1"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={step.number}
        aria-label="Progreso del alta"
      >
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={cn("h-1 flex-1 rounded-full", i < step.number ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-8">{children}</div>
    </div>
  )
}
