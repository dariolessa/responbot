import { ArrowRight, Check, Circle, Clock } from "lucide-react"
import Link from "next/link"

import { pendingSteps, steps } from "@/lib/onboarding/steps"
import { cn } from "@/lib/utils"

/**
 * Lista de pasos del alta (docs/SPEC.md: "el panel muestra una lista de pasos
 * pendientes hasta completar el alta").
 */
export function StepList({ completed, compact }: { completed: readonly string[]; compact?: boolean }) {
  const done = new Set(completed)
  const next = pendingSteps(completed)[0]
  return (
    <ol className={cn("grid", compact ? "gap-1" : "gap-2")}>
      {steps.map((step) => {
        const isDone = done.has(step.key)
        const isNext = next?.key === step.key
        const Icon = isDone ? Check : step.available ? Circle : Clock
        const content = (
          <>
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border",
                isDone && "border-primary bg-primary text-primary-foreground",
                isNext && "border-primary text-primary",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", isDone ? "text-muted-foreground" : "font-medium")}>
                {step.title}
                {step.optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
              </span>
              {!compact || isNext ? (
                <span className="block text-xs text-muted-foreground">
                  {step.available ? step.description : "Llega muy pronto."}
                </span>
              ) : null}
            </span>
            {isNext ? <ArrowRight className="size-4 shrink-0 text-primary" /> : null}
          </>
        )
        return (
          <li key={step.key}>
            {step.available && !isDone ? (
              <Link
                href={step.href}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-accent"
              >
                {content}
              </Link>
            ) : (
              <div className={cn("flex min-h-11 items-center gap-3 px-2 py-1.5", !step.available && "opacity-60")}>
                {content}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Tarjeta del panel con los pasos que faltan; no se muestra si no falta nada. */
export function PendingStepsCard({ completed }: { completed: readonly string[] }) {
  const pending = pendingSteps(completed)
  if (pending.length === 0) return null
  return (
    <section className="mb-8 rounded-lg border p-4 sm:p-6">
      <h2 className="font-medium">Terminá de configurar tu negocio</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {pending.length === 1 ? "Te falta un paso" : `Te faltan ${pending.length} pasos`} para empezar a dar
        turnos.
      </p>
      <div className="mt-4">
        <StepList completed={completed} compact />
      </div>
    </section>
  )
}
