import { Bot, CreditCard } from "lucide-react"

import { cn } from "@/lib/utils"

/*
 * Vista del día de la agenda, de ejemplo (la "captura de la agenda" de la
 * landing): una columna por profesional, bloques por estado como en el panel.
 */

type Block = { start: number; length: number; client: string; service: string; tone: "confirmed" | "pending" | "done"; bot?: boolean; deposit?: boolean }

const columns: { name: string; blocks: Block[] }[] = [
  {
    name: "Ana",
    blocks: [
      { start: 0, length: 2, client: "Lucía P.", service: "Corte", tone: "done" },
      { start: 2, length: 3, client: "Martina R.", service: "Color", tone: "confirmed", bot: true, deposit: true },
      { start: 6, length: 2, client: "Sofía G.", service: "Corte", tone: "confirmed", bot: true },
    ],
  },
  {
    name: "Bruno",
    blocks: [
      { start: 1, length: 2, client: "Diego M.", service: "Barba y corte", tone: "done" },
      { start: 4, length: 1, client: "Pablo S.", service: "Barba", tone: "pending", deposit: true },
      { start: 5, length: 2, client: "Nicolás F.", service: "Corte", tone: "confirmed", bot: true },
    ],
  },
  {
    name: "Carla",
    blocks: [
      { start: 0, length: 3, client: "Valentina C.", service: "Uñas esculpidas", tone: "confirmed" },
      { start: 4, length: 2, client: "Camila T.", service: "Semipermanente", tone: "confirmed", bot: true },
    ],
  },
]

const hours = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]
const ROW = 2.25 // rem por media hora

const toneClass: Record<Block["tone"], string> = {
  confirmed: "border-emerald-600/30 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/50 dark:text-emerald-100",
  pending: "border-amber-500/40 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100",
  done: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400",
}

export function AgendaMock({ className }: { className?: string }) {
  return (
    <div
      className={cn("overflow-hidden rounded-[10px] border bg-card", className)}
      role="img"
      aria-label="Ejemplo de la agenda del día con turnos de tres profesionales, varios reservados por el bot"
    >
      <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
        <span className="font-medium">Sábado 7 de noviembre</span>
        <span className="text-xs text-muted-foreground">8 turnos · 4 por WhatsApp</span>
      </div>
      <div className="grid grid-cols-[3.25rem_repeat(3,minmax(0,1fr))]" aria-hidden="true">
        <div />
        {columns.map((c) => (
          <div key={c.name} className="border-b border-l px-2 py-2 text-xs font-medium">
            {c.name}
          </div>
        ))}
        <div className="relative">
          {hours.map((h) => (
            <div key={h} className="pr-2 text-right font-mono text-[10px] text-muted-foreground" style={{ height: `${ROW}rem` }}>
              {h.endsWith(":00") ? h : ""}
            </div>
          ))}
        </div>
        {columns.map((c) => (
          <div key={c.name} className="relative border-l" style={{ height: `${ROW * hours.length}rem` }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ top: `${i * ROW}rem` }} />
            ))}
            {c.blocks.map((b) => (
              <div
                key={`${b.start}-${b.client}`}
                className={cn("absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight", toneClass[b.tone])}
                style={{ top: `${b.start * ROW + 0.125}rem`, height: `${b.length * ROW - 0.25}rem` }}
              >
                <span className="flex items-center gap-1 font-medium">
                  <span className="truncate">{b.client}</span>
                  {b.bot ? <Bot className="size-3 shrink-0 opacity-70" /> : null}
                  {b.deposit ? <CreditCard className="size-3 shrink-0 opacity-70" /> : null}
                </span>
                <span className="block truncate opacity-80">{b.service}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
