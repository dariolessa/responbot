"use client"

import { useEffect } from "react"

/** Registra el service worker para que el panel se pueda instalar como app. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sin service worker el panel funciona igual; solo no se puede instalar.
    })
  }, [])
  return null
}
