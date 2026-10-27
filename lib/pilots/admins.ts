/*
 * Quién entra al panel de la plataforma (/admin): los emails de
 * PLATFORM_ADMIN_EMAILS, separados por coma. Sin la variable no entra nadie.
 */

export function parseAdminEmails(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformAdmin(email: string | null | undefined, raw: string | undefined | null): boolean {
  if (!email) return false
  return parseAdminEmails(raw).includes(email.trim().toLowerCase())
}
