"use client"

import {
  AlertTriangle,
  ArrowUp,
  Bot,
  Check,
  CheckCheck,
  Clock,
  ImageIcon,
  Mic,
  ThumbsDown,
  ThumbsUp,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"

import {
  rateBotReplyAction,
  releaseConversationAction,
  sendReplyAction,
  takeConversationAction,
} from "@/app/app/conversaciones/actions"
import { FormError } from "@/components/forms/field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatZoned } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { Thread, ThreadMessage } from "@/lib/whatsapp/inbox"

/*
 * Hilo de una conversación de WhatsApp: mensajes del cliente a la izquierda y
 * del negocio (bot o equipo) a la derecha, como en el celular. Tomar la
 * conversación frena al bot; devolverla lo vuelve a activar. Dueño y admins
 * califican las respuestas del bot para ajustarlo (Fase 7).
 */

export function ThreadView({
  thread,
  timezone,
  connected,
  canRate = false,
}: {
  thread: Thread
  timezone: string
  connected: boolean
  canRate?: boolean
}) {
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [thread.messages.length])

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.ok) onOk?.()
      else setError(result.error ?? "No se pudo completar.")
    })
  }

  function send() {
    const text = draft.trim()
    if (!text || pending) return
    run(() => sendReplyAction({ conversationId: thread.id, text }), () => setDraft(""))
  }

  const human = thread.mode === "human"
  const blocked = !connected
    ? "WhatsApp no está conectado, así que no se pueden mandar mensajes."
    : !thread.windowOpen
      ? "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo deja escribirle con una plantilla aprobada; cuando el cliente vuelva a escribir, podés responderle."
      : null

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[28rem] flex-col overflow-hidden rounded-[10px] border lg:h-[calc(100dvh-10rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <Link href={`/app/clientes/${thread.customerId}`} className="block truncate font-medium hover:underline">
            {thread.customerName}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">{thread.phone}</p>
        </div>
        <div className="flex items-center gap-2">
          {human ? (
            <Badge variant="secondary">
              <UserRound />
              {thread.assignedToMe ? "La atendés vos" : thread.assignedName ? `La atiende ${thread.assignedName}` : "Necesita una persona"}
            </Badge>
          ) : (
            <Badge variant="outline">
              <Bot />
              Responde el bot
            </Badge>
          )}
          {human ? (
            <>
              {!thread.assignedToMe ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => takeConversationAction(thread.id))}>
                  Tomar
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => releaseConversationAction(thread.id))}>
                <Bot />
                Devolver al bot
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => takeConversationAction(thread.id))}>
              <UserRound />
              Tomar conversación
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/40 px-4 py-4">
        {thread.messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay mensajes.</p>
        ) : (
          thread.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              timezone={timezone}
              rating={canRate && m.author === "bot" ? <ReplyRating conversationId={thread.id} message={m} /> : null}
            />
          ))
        )}
      </div>

      <div className="grid gap-2 border-t p-3">
        {blocked ? (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {blocked}
          </p>
        ) : !human ? (
          <p className="text-xs text-muted-foreground">Si escribís, la conversación pasa a estar a tu cargo y el bot deja de responder.</p>
        ) : null}
        <FormError message={error} />
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Escribí una respuesta"
            aria-label="Respuesta"
            rows={1}
            maxLength={4000}
            disabled={Boolean(blocked)}
            className="max-h-32 min-h-11 resize-none sm:min-h-9"
          />
          <Button
            type="submit"
            size="icon"
            disabled={Boolean(blocked) || pending || !draft.trim()}
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

const statusIcons = {
  queued: Clock,
  sent: Check,
  delivered: CheckCheck,
  read: CheckCheck,
} as const

const statusLabels = { queued: "Enviando", sent: "Enviado", delivered: "Entregado", read: "Leído" } as const

function MessageBubble({
  message,
  timezone,
  rating,
}: {
  message: ThreadMessage
  timezone: string
  rating: ReactNode
}) {
  const fromCustomer = message.direction === "inbound"
  const StatusIcon = message.status in statusIcons ? statusIcons[message.status as keyof typeof statusIcons] : null
  const MediaIcon = message.type === "audio" ? Mic : message.type === "image" ? ImageIcon : null

  return (
    <div className={cn("flex flex-col gap-1", fromCustomer ? "items-start" : "items-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
          fromCustomer ? "rounded-bl-sm border bg-background" : "rounded-br-sm bg-primary/10 dark:bg-primary/20",
          message.status === "failed" && "border border-destructive/40",
        )}
      >
        {MediaIcon ? (
          <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MediaIcon className="size-3.5" />
            {message.type === "audio" ? "Audio" : "Imagen"}
            {message.type === "audio" && !message.transcript ? " (sin transcribir)" : null}
          </p>
        ) : null}
        {message.type === "image" && message.transcript ? (
          <p className="mb-1 text-xs whitespace-pre-wrap text-muted-foreground italic">{message.transcript.split("\n")[0]}</p>
        ) : null}
        {message.body ? <p className="whitespace-pre-wrap">{message.body}</p> : null}
        {message.choices.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Opciones que se mostraron">
            {message.choices.map((c) => (
              <li key={c} className="rounded-full border bg-background px-2 py-0.5 text-xs">
                {c}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
        {message.author ? (
          <span>{message.author === "bot" ? "Bot" : message.author} ·</span>
        ) : null}
        <span className="font-mono">{formatZoned(new Date(message.at), timezone, "d MMM HH:mm")}</span>
        {!fromCustomer && StatusIcon ? (
          <StatusIcon
            className={cn("size-3.5", message.status === "read" && "text-sky-600 dark:text-sky-400")}
            aria-label={statusLabels[message.status as keyof typeof statusLabels]}
          />
        ) : null}
      </p>
      {message.error ? (
        <p className="flex items-center gap-1 px-1 text-xs text-destructive">
          <AlertTriangle className="size-3.5" />
          {message.status === "failed" ? `No se entregó. ${message.error}` : message.error}
        </p>
      ) : null}
      {rating}
    </div>
  )
}

/** Bien / Mal sobre una respuesta del bot; con "Mal" se anota qué tendría que haber dicho. */
function ReplyRating({ conversationId, message }: { conversationId: string; message: ThreadMessage }) {
  const current = message.rating
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(current?.note ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(rating: "good" | "bad" | null, withNote: string | null) {
    setError(null)
    startTransition(async () => {
      const result = await rateBotReplyAction({ conversationId, messageId: message.id, rating, note: withNote })
      if (result.ok) setEditing(false)
      else setError(result.error ?? "No se pudo guardar.")
    })
  }

  const button = "inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs sm:min-h-7"
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1">
      <div className="flex items-center gap-1 text-muted-foreground">
        <button
          type="button"
          disabled={pending}
          aria-pressed={current?.value === "good"}
          onClick={() => save(current?.value === "good" ? null : "good", null)}
          className={cn(button, "hover:bg-muted", current?.value === "good" && "text-primary")}
        >
          <ThumbsUp className="size-3.5" />
          Bien
        </button>
        <button
          type="button"
          disabled={pending}
          aria-pressed={current?.value === "bad"}
          onClick={() => (current?.value === "bad" && !editing ? save(null, null) : setEditing(true))}
          className={cn(button, "hover:bg-muted", current?.value === "bad" && "text-destructive")}
        >
          <ThumbsDown className="size-3.5" />
          Mal
        </button>
      </div>
      {current?.value === "bad" && current.note && !editing ? (
        <button type="button" onClick={() => setEditing(true)} className="text-right text-xs text-muted-foreground italic">
          “{current.note}”
        </button>
      ) : null}
      {editing ? (
        <form
          className="grid w-72 max-w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save("bad", note)
          }}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="¿Qué tendría que haber contestado? (opcional)"
            aria-label="Qué tendría que haber contestado"
            rows={2}
            maxLength={1000}
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Guardar
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
    </div>
  )
}
