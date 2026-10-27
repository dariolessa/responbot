"use client"

import { Ban, CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

import { moveBookingAction } from "@/app/app/agenda/actions"
import { EmptyState } from "@/components/layout/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { addDaysToDate, formatDate, minutesToTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { BookingDetailSheet } from "./booking-detail-sheet"
import { DayView } from "./day-view"
import { gridRange, withOverrides } from "./layout"
import { ListView } from "./list-view"
import { NewBookingSheet, type NewBookingPrefill } from "./new-booking-sheet"
import { TimeOffSheet } from "./time-off-sheet"
import type { AgendaBooking, AgendaData, AgendaView as View } from "./types"
import { WeekView } from "./week-view"

/** Refresco de la agenda (docs/SPEC.md: polling cada 20 segundos y al volver a la pestaña). */
const POLL_MS = 20_000

const viewLabels: Record<View, string> = { dia: "Día", semana: "Semana", lista: "Lista" }
const stepDays: Record<View, number> = { dia: 1, semana: 7, lista: 14 }

type Override = Pick<AgendaBooking, "resourceId" | "date" | "startMin" | "endMin">

export function AgendaView({ data }: { data: AgendaData }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [newBooking, setNewBooking] = useState<NewBookingPrefill | null>(null)
  const [blocksOpen, setBlocksOpen] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const busy = useRef(false)

  // Actualización en vivo: cada 20 s y al volver a la pestaña, salvo con algo abierto.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || busy.current) return
      router.refresh()
    }
    const timer = setInterval(refresh, POLL_MS)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [router])
  useEffect(() => {
    busy.current = newBooking !== null || blocksOpen
  }, [newBooking, blocksOpen])

  // El aviso se va solo.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), notice.error ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const href = (patch: { vista?: View; fecha?: string; profesional?: string | null }) => {
    const params = new URLSearchParams()
    params.set("vista", patch.vista ?? data.view)
    params.set("fecha", patch.fecha ?? data.date)
    const profesional = patch.profesional === undefined ? data.resourceFilter : patch.profesional
    if (profesional) params.set("profesional", profesional)
    return `/app/agenda?${params.toString()}`
  }

  const resources = data.resourceFilter
    ? data.resources.filter((r) => r.id === data.resourceFilter)
    : data.resources
  const bookings = withOverrides(data.bookings, overrides).filter((b) =>
    resources.some((r) => r.id === b.resourceId),
  )
  const detail = data.bookings.find((b) => b.id === detailId) ?? null

  function changed(message: string) {
    setNotice({ text: message })
    setDetailId(null)
    setNewBooking(null)
    setBlocksOpen(false)
    router.refresh()
  }

  function onMove(id: string, resourceId: string, startMin: number) {
    const booking = data.bookings.find((b) => b.id === id)
    if (!booking) return
    const duration = booking.endMin - booking.startMin
    // Actualización optimista: se mueve ya y se deshace si la base lo rechaza.
    setOverrides((o) => ({ ...o, [id]: { resourceId, date: booking.date, startMin, endMin: startMin + duration } }))
    startTransition(async () => {
      const result = await moveBookingAction({
        bookingId: id,
        date: booking.date,
        time: minutesToTime(startMin),
        resourceId: resourceId === booking.resourceId ? undefined : resourceId,
      })
      if (result.ok) {
        setNotice({ text: `Turno de ${booking.customerName} movido a las ${minutesToTime(startMin)}.` })
        router.refresh()
      } else {
        setNotice({ text: result.error, error: true })
      }
      setOverrides((o) => {
        const rest = { ...o }
        delete rest[id]
        return rest
      })
    })
  }

  const title =
    data.view === "dia"
      ? `${data.date === data.today ? "Hoy, " : ""}${formatDate(data.date)}`
      : data.view === "semana"
        ? `Semana del ${formatDate(data.dates[0]!, "d 'de' MMMM")}`
        : `Desde el ${formatDate(data.date, "d 'de' MMMM")}`

  const range = gridRange(resources, bookings, data.dates)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase">{title}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBlocksOpen(true)} disabled={!data.hasOwnColumn}>
            <Ban />
            <span className="hidden sm:inline">Bloquear</span>
          </Button>
          <Button
            onClick={() => setNewBooking({ date: data.date, resourceId: data.resourceFilter })}
            disabled={!data.hasOwnColumn}
          >
            <Plus />
            Nuevo turno
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <nav className="inline-flex rounded-md border p-0.5" aria-label="Vista">
          {(Object.keys(viewLabels) as View[]).map((v) => (
            <Link
              key={v}
              href={href({ vista: v })}
              aria-current={data.view === v ? "page" : undefined}
              className={cn(
                "flex h-10 items-center rounded-[6px] px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground sm:h-8",
                data.view === v && "bg-accent text-foreground",
              )}
            >
              {viewLabels[v]}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <Link href={href({ fecha: addDaysToDate(data.date, -stepDays[data.view]) })} aria-label="Anterior">
              <ChevronLeft />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={href({ fecha: data.today })}>Hoy</Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link href={href({ fecha: addDaysToDate(data.date, stepDays[data.view]) })} aria-label="Siguiente">
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <Input
          type="date"
          aria-label="Ir a una fecha"
          value={data.date}
          onChange={(e) => e.target.value && router.push(href({ fecha: e.target.value }))}
          className="w-auto"
        />
        {data.view !== "dia" && data.resources.length > 1 ? (
          <NativeSelect
            aria-label="Profesional"
            value={data.resourceFilter ?? ""}
            onChange={(e) => router.push(href({ profesional: e.target.value || null }))}
            className="w-auto min-w-40"
          >
            <option value="">Todo el equipo</option>
            {data.resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </div>

      {notice ? (
        <div
          role="status"
          className={cn(
            "flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm",
            notice.error && "border-destructive/30 bg-destructive/5 text-destructive",
          )}
        >
          {notice.text}
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {!data.hasOwnColumn ? (
        <EmptyState
          icon={CalendarDays}
          title="Todavía no tenés una agenda asignada"
          description="Pedile al dueño del negocio que te asigne tu columna en Equipo."
        />
      ) : data.resources.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Todavía no hay profesionales"
          description="Sumá a quienes atienden y sus horarios para empezar a dar turnos."
          action={
            <Button asChild>
              <Link href="/app/equipo">Ir a Equipo</Link>
            </Button>
          }
        />
      ) : data.view === "dia" ? (
        <DayView
          date={data.date}
          isToday={data.date === data.today}
          nowMin={data.nowMin}
          range={range}
          slotStep={data.slotStep}
          resources={resources}
          bookings={bookings}
          timeOff={data.timeOff}
          onSlotClick={(resourceId, startMin) =>
            setNewBooking({ date: data.date, time: minutesToTime(startMin), resourceId })
          }
          onBookingClick={setDetailId}
          onMove={onMove}
        />
      ) : data.view === "semana" ? (
        <WeekView
          dates={data.dates}
          today={data.today}
          nowMin={data.nowMin}
          range={range}
          slotStep={data.slotStep}
          resources={resources}
          bookings={bookings}
          timeOff={data.timeOff}
          dayHref={(fecha) => href({ vista: "dia", fecha })}
          onSlotClick={(date, startMin) =>
            setNewBooking({ date, time: minutesToTime(startMin), resourceId: data.resourceFilter })
          }
          onBookingClick={setDetailId}
        />
      ) : (
        <ListView
          dates={data.dates}
          today={data.today}
          bookings={bookings}
          resources={data.resources}
          onBookingClick={setDetailId}
          onCreate={() => setNewBooking({ date: data.date, resourceId: data.resourceFilter })}
        />
      )}

      <NewBookingSheet
        prefill={newBooking}
        onClose={() => setNewBooking(null)}
        onCreated={changed}
        services={data.services}
        resources={data.resources}
      />
      <BookingDetailSheet
        booking={detail}
        resources={data.resources}
        onClose={() => setDetailId(null)}
        onChanged={changed}
      />
      <TimeOffSheet open={blocksOpen} onClose={() => setBlocksOpen(false)} onChanged={changed} data={data} />
    </div>
  )
}
