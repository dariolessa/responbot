"use client"

import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/** Elegir varios servicios (o profesionales) con chips; botones de 44 px en el celular. */
export function ServicePicker({
  services,
  value,
  onChange,
  emptyText = "Todavía no hay servicios.",
}: {
  services: { id: string; name: string }[]
  value: string[]
  onChange: (value: string[]) => void
  emptyText?: string
}) {
  if (services.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  const selected = new Set(value)
  const all = services.every((s) => selected.has(s.id))

  return (
    <div className="flex flex-wrap gap-2">
      {services.map((s) => {
        const on = selected.has(s.id)
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((id) => id !== s.id) : [...value, s.id])}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-150 hover:bg-accent sm:h-8",
              on && "border-primary bg-primary/5 text-primary hover:bg-primary/10",
            )}
          >
            {on ? <Check className="size-3.5" /> : null}
            {s.name}
          </button>
        )
      })}
      {services.length > 2 ? (
        <button
          type="button"
          onClick={() => onChange(all ? [] : services.map((s) => s.id))}
          className="inline-flex h-11 items-center px-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:h-8"
        >
          {all ? "Ninguno" : "Todos"}
        </button>
      ) : null}
    </div>
  )
}
