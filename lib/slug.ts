import { randomBytes } from "node:crypto"

/** "Barbería Don José" → "barberia-don-jose-x7k2" (el sufijo evita choques). */
export function businessSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  const suffix = randomBytes(3).toString("hex").slice(0, 4)
  return `${base || "negocio"}-${suffix}`
}
