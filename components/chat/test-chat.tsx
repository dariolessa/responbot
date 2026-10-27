"use client"

import { AlertTriangle, ArrowUp, RotateCcw, UserRound, Wrench } from "lucide-react"
import { useEffect, useRef, useState, useTransition } from "react"

import { resetTestChat, sendTestMessage } from "@/app/app/bot/actions"
import { FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { ChatMessage, ChatState } from "@/lib/bot/test-chat"
import { cn } from "@/lib/utils"

/** Qué hizo el bot, en palabras del dueño. */
const toolLabels: Record<string, string> = {
  list_services: "Miró los servicios",
  list_staff: "Miró el equipo",
  check_availability: "Buscó horarios libres",
  create_booking: "Reservó un turno",
  get_customer_bookings: "Miró los turnos del cliente",
  reschedule_booking: "Movió un turno",
  cancel_booking: "Canceló un turno",
  join_waitlist: "Anotó en lista de espera",
  get_business_info: "Miró los datos del negocio",
  save_customer_name: "Guardó el nombre",
  handoff_to_human: "Derivó a una persona",
  show_choices: "Mostró opciones",
}

const suggestions = ["Hola, ¿qué servicios tienen?", "Quiero un turno para mañana", "¿Dónde quedan?"]

export function TestChat({
  initial,
  configured,
  assistantName,
}: {
  initial: ChatState
  configured: boolean
  assistantName: string
}) {
  const [state, setState] = useState(initial)
  const [draft, setDraft] = useState("")
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [state.messages.length, pendingText])

  function send(text: string) {
    const value = text.trim()
    if (!value || pending) return
    setError(null)
    setDraft("")
    setPendingText(value)
    startTransition(async () => {
      const result = await sendTestMessage({ text: value })
      setPendingText(null)
      if (result.ok) setState(result.data)
      else {
        setError(result.error)
        setDraft(value)
      }
    })
  }

  function reset() {
    setError(null)
    startTransition(async () => {
      const result = await resetTestChat()
      if (result.ok) setState(result.data)
      else setError(result.error)
    })
  }

  const empty = state.messages.length === 0 && !pendingText

  return (
    <div className="flex h-[70dvh] min-h-[28rem] flex-col overflow-hidden rounded-[10px] border lg:h-[36rem]">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{assistantName}</p>
          <p className="text-xs text-muted-foreground">Chat de prueba · los turnos que reserve quedan en la agenda</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={pending || state.messages.length === 0}
          aria-label="Empezar de nuevo"
        >
          <RotateCcw />
          <span className="hidden sm:inline">Empezar de nuevo</span>
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/40 px-4 py-4">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              Escribile como si fueras un cliente. Responde con el mismo motor que va a usar en WhatsApp.
            </p>
            {configured ? (
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          state.messages.map((m, i) => (
            <Bubble
              key={m.id}
              message={m}
              // Las opciones solo se pueden tocar en la última respuesta, como en WhatsApp.
              onChoose={i === state.messages.length - 1 && !pending && !state.humanMode ? send : undefined}
            />
          ))
        )}
        {pendingText ? (
          <>
            <Bubble
              message={{ id: "pending", direction: "inbound", body: pendingText, at: "", tools: [], failed: false, choices: [] }}
            />
            <div className="flex" aria-live="polite">
              <span className="inline-flex items-center gap-1 rounded-2xl rounded-bl-sm border bg-background px-3.5 py-3">
                <span className="sr-only">{assistantName} está escribiendo</span>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </div>
          </>
        ) : null}
      </div>

      <div className="grid gap-2 border-t p-3">
        {state.humanMode ? (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            El bot le pasó esta conversación a una persona y ya no responde. En WhatsApp le llegaría el aviso al
            equipo. Tocá &quot;Empezar de nuevo&quot; para seguir probando.
          </p>
        ) : null}
        {!configured ? (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            Falta conectar la inteligencia artificial del bot. Cuando esté configurada, vas a poder probarlo acá.
          </p>
        ) : null}
        <FormError message={error} />
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder="Escribí un mensaje"
            aria-label="Mensaje"
            rows={1}
            maxLength={2000}
            disabled={!configured || state.humanMode}
            className="max-h-32 min-h-11 resize-none sm:min-h-9"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!configured || state.humanMode || pending || !draft.trim()}
            aria-label="Enviar"
            className="size-11 shrink-0 sm:size-9"
          >
            <ArrowUp />
          </Button>
        </form>
      </div>
    </div>
  )
}

function Bubble({ message, onChoose }: { message: ChatMessage; onChoose?: (text: string) => void }) {
  const fromCustomer = message.direction === "inbound"
  return (
    <div className={cn("flex flex-col gap-1", fromCustomer ? "items-end" : "items-start")}>
      {!fromCustomer && message.tools.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Lo que consultó el bot">
          {message.tools.map((t, i) => (
            <li
              key={`${t.name}-${i}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground",
                !t.ok && "border-destructive/30 text-destructive",
              )}
            >
              <Wrench className="size-3" />
              {toolLabels[t.name] ?? t.name}
            </li>
          ))}
        </ul>
      ) : null}
      <p
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
          fromCustomer
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm border bg-background",
          message.failed && "border-destructive/30",
        )}
      >
        {message.body}
      </p>
      {!fromCustomer && message.choices.length > 0 ? (
        <ul className="flex max-w-[85%] flex-wrap gap-1.5" aria-label="Opciones">
          {message.choices.map((c) => (
            <li key={c.title}>
              <Button
                variant="outline"
                size="sm"
                disabled={!onChoose}
                onClick={() => onChoose?.(c.description ? `${c.title} (${c.description})` : c.title)}
                className="h-auto min-h-9 flex-col items-start gap-0 py-1.5 text-left"
              >
                <span>{c.title}</span>
                {c.description ? <span className="text-xs font-normal text-muted-foreground">{c.description}</span> : null}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
