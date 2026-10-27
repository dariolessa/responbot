"use client"

import { BellOff, BellRing, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

/*
 * Activar los avisos push en este dispositivo (docs/SPEC.md, "Push web"). Los
 * navegadores piden que el permiso salga de un toque, así que es un botón; en
 * iPhone funciona con el panel instalado en la pantalla de inicio.
 */

type State = "loading" | "unsupported" | "denied" | "off" | "on"

function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" })
}

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return "unsupported" as const
      }
      if (Notification.permission === "denied") return "denied" as const
      const reg = await navigator.serviceWorker.getRegistration("/")
      const sub = await reg?.pushManager.getSubscription()
      return sub ? ("on" as const) : ("off" as const)
    }
    check()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState("off"))
    return () => {
      cancelled = true
    }
  }, [])

  async function enable() {
    setBusy(true)
    setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off")
        return
      }
      const reg = await registration()
      await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }))
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!response.ok) throw new Error("No se pudo guardar")
      setState("on")
    } catch {
      setError("No pudimos activar los avisos en este dispositivo. Probá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration("/")
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setState("off")
    } catch {
      setError("No pudimos apagar los avisos. Probá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {state === "on" ? <BellRing className="size-4 text-primary" /> : <BellOff className="size-4" />}
        </div>
        <div className="text-sm">
          <p className="font-medium">
            {state === "on" ? "Push activado en este dispositivo" : "Push en este dispositivo"}
          </p>
          <p className="text-muted-foreground">
            {state === "unsupported"
              ? "Este navegador no recibe avisos push. En iPhone, instalá el panel en la pantalla de inicio."
              : state === "denied"
                ? "Bloqueaste los avisos para este sitio. Habilitalos desde los ajustes del navegador."
                : "Reservas nuevas, cancelaciones y derivaciones al instante, aunque el panel esté cerrado."}
          </p>
          {error ? <p className="mt-1 text-destructive">{error}</p> : null}
        </div>
      </div>
      {state === "off" || state === "on" || state === "loading" ? (
        <Button
          variant={state === "on" ? "outline" : "default"}
          disabled={busy || state === "loading"}
          onClick={state === "on" ? disable : enable}
          className="shrink-0"
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {state === "on" ? "Desactivar" : "Activar"}
        </Button>
      ) : null}
    </div>
  )
}
