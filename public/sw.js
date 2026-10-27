/*
 * Service worker de Responbot (PWA instalable).
 *
 * Fase 1: guarda la página "sin conexión" y la muestra si una navegación
 * falla sin red. No cachea datos del panel: la agenda siempre viene fresca.
 * Fase 4: muestra los avisos push del despachador y, al tocarlos, abre el
 * panel en el lugar del aviso.
 */
const CACHE = "responbot-v2"
const OFFLINE_URL = "/offline.html"

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((res) => res ?? Response.error())),
  )
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }
  const title = data.title || "Responbot"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url || "/app/notificaciones" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || "/app/notificaciones", self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin))
      if (open) return open.navigate(url).then((w) => (w ?? open).focus())
      return self.clients.openWindow(url)
    }),
  )
})
