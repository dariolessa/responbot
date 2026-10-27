/** Solo rutas internas: evita redirecciones abiertas a otros dominios. */
export function safeCallbackUrl(value: unknown, fallback = "/app/agenda"): string {
  if (typeof value !== "string") return fallback
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
  return value
}
