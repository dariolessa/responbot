"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

/** Actualización en vivo (docs/SPEC.md): refresca la página cada 20 s y al volver a la pestaña. */
export function LiveRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    const timer = setInterval(refresh, intervalMs)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [router, intervalMs])
  return null
}
