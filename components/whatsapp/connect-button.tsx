"use client"

import { MessageCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"

/*
 * Botón "Conectar WhatsApp": abre el alta embebida de Meta (Embedded Signup)
 * con el SDK oficial de Facebook. Meta devuelve un código por el callback de
 * FB.login y el waba_id y phone_number_id por un postMessage; con los tres se
 * llama a /api/integrations/whatsapp/signup.
 */

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string }

type FacebookSdk = {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void
  login(callback: (response: FbLoginResponse) => void, options: Record<string, unknown>): void
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js"

function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB)
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version })
      resolve(window.FB!)
    }
    const script = document.createElement("script")
    script.src = SDK_URL
    script.async = true
    script.defer = true
    script.crossOrigin = "anonymous"
    script.onerror = () => reject(new Error("sdk"))
    document.body.appendChild(script)
  })
}

type SessionInfo = { wabaId: string; phoneNumberId: string }

export function ConnectWhatsAppButton({
  appId,
  configId,
  version,
  label = "Conectar WhatsApp",
}: {
  appId: string
  configId: string
  version: string
  label?: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const session = useRef<SessionInfo | null>(null)
  const code = useRef<string | null>(null)

  async function finish() {
    if (!session.current || !code.current) return
    const body = { code: code.current, ...session.current }
    session.current = null
    code.current = null
    try {
      const response = await fetch("/api/integrations/whatsapp/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const result = (await response.json()) as { ok: boolean; error?: string }
      if (!result.ok) setError(result.error ?? "No se pudo conectar WhatsApp.")
      else router.refresh()
    } catch {
      setError("No se pudo conectar WhatsApp. Revisá tu conexión y probá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  // Meta manda el waba_id y el phone_number_id por postMessage al terminar el flujo.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return
      let data: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } }
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return
      if (data.event === "FINISH" && data.data?.waba_id && data.data.phone_number_id) {
        session.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id }
        void finish()
      } else if (data.event === "CANCEL" || data.event === "ERROR") {
        setBusy(false)
        setError("El alta en Meta no se terminó. Podés volver a intentarlo cuando quieras.")
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
    // finish solo lee refs y el router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function start() {
    setError(null)
    setBusy(true)
    try {
      const fb = await loadSdk(appId, version)
      fb.login(
        (response) => {
          const received = response.authResponse?.code
          if (!received) {
            setBusy(false)
            if (!session.current) setError("El alta en Meta no se terminó. Podés volver a intentarlo cuando quieras.")
            return
          }
          code.current = received
          void finish()
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, sessionInfoVersion: "3" },
        },
      )
    } catch {
      setBusy(false)
      setError("No se pudo abrir la ventana de Meta. Revisá que el navegador no bloquee ventanas emergentes.")
    }
  }

  return (
    <div className="grid gap-2">
      <Button onClick={start} disabled={busy} className="w-full sm:w-auto">
        <MessageCircle />
        {busy ? "Conectando…" : label}
      </Button>
      <FormError message={error} />
    </div>
  )
}
