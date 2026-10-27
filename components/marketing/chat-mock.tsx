import { CheckCheck } from "lucide-react"

import { LogoMark } from "@/components/layout/logo"
import { cn } from "@/lib/utils"

/*
 * Conversación de ejemplo de WhatsApp reservando un turno, dibujada con HTML
 * (la "captura del chat" de la landing): se ve nítida en cualquier pantalla y
 * en modo oscuro.
 */

type Bubble = { from: "client" | "bot"; text: string; time: string; buttons?: string[] }

const conversation: Bubble[] = [
  { from: "client", text: "Hola! Tienen lugar para un corte el sábado de mañana?", time: "22:41" },
  {
    from: "bot",
    text: "¡Hola Lucía! El corte sale $ 650 y dura 45 minutos. El sábado 7 tengo con Ana a las 9:30 o a las 11:00. ¿Cuál te queda mejor?",
    time: "22:41",
    buttons: ["9:30", "11:00", "Otro día"],
  },
  { from: "client", text: "11:00", time: "22:42" },
  {
    from: "bot",
    text: "¡Listo! Te reservé el corte con Ana el sábado 7 a las 11:00. Te mando un recordatorio el día antes. 💇‍♀️",
    time: "22:42",
  },
]

export function ChatMock({ className }: { className?: string }) {
  return (
    <div
      className={cn("mx-auto w-full max-w-sm overflow-hidden rounded-[22px] border bg-card", className)}
      aria-label="Ejemplo de conversación de WhatsApp en la que el asistente reserva un turno"
      role="img"
    >
      <div className="flex items-center gap-3 border-b bg-emerald-700 px-4 py-3 text-white dark:bg-emerald-900">
        <span className="flex size-9 items-center justify-center rounded-full bg-white">
          <LogoMark className="size-6" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">Peluquería Sol</span>
          <span className="block text-xs text-white/75">en línea</span>
        </span>
      </div>
      <div className="grid gap-2 bg-[#efeae2] px-3 py-4 dark:bg-zinc-900" aria-hidden="true">
        {conversation.map((bubble, index) => (
          <div key={index} className={cn("grid max-w-[85%] gap-1", bubble.from === "client" ? "justify-self-end" : "justify-self-start")}>
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-[13px] leading-snug text-zinc-900 dark:text-zinc-100",
                bubble.from === "client" ? "rounded-tr-none bg-[#d9fdd3] dark:bg-emerald-900/70" : "rounded-tl-none bg-white dark:bg-zinc-800",
              )}
            >
              {bubble.text}
              <span className="ml-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                {bubble.time}
                {bubble.from === "client" ? <CheckCheck className="size-3 text-sky-500" /> : null}
              </span>
            </div>
            {bubble.buttons ? (
              <div className="grid grid-cols-3 gap-1">
                {bubble.buttons.map((b) => (
                  <span
                    key={b}
                    className="rounded-lg bg-white py-1.5 text-center text-[12px] font-medium text-sky-600 dark:bg-zinc-800 dark:text-sky-400"
                  >
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
