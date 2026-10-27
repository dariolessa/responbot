/** Marca del producto (docs/SPEC.md: el nombre se reemplaza con una variable de marca). */
export const brand = {
  name: "Responbot",
  /** Verde del logo, solo para la marca; el acento de la interfaz es esmeralda. */
  green: "#02A82F",
  /** Contacto que muestran la landing, los términos y la privacidad (lo pide la revisión de Meta y Google). */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || null,
  /** Razón social que presta el servicio (la LLC que cobra con Stripe). */
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || null,
  /** Número de la demo pública (solo dígitos); la landing ofrece probarla por WhatsApp. */
  demoWhatsApp: process.env.NEXT_PUBLIC_DEMO_WHATSAPP?.replace(/\D/g, "") || null,
} as const

/** Enlace para escribirle a la demo con un primer mensaje ya cargado. */
export function demoWhatsAppUrl(): string | null {
  if (!brand.demoWhatsApp) return null
  return `https://wa.me/${brand.demoWhatsApp}?text=${encodeURIComponent("Hola, quiero sacar un turno")}`
}
