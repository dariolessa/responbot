/** Marca del producto (docs/SPEC.md: el nombre se reemplaza con una variable de marca). */
export const brand = {
  name: "Responbot",
  /** Violeta del logo, solo para la marca (no usa el verde de WhatsApp; Meta rechaza íconos que imiten sus marcas). */
  color: "#6D28D9",
  /** Contacto que muestran la landing, los términos y la privacidad (lo pide la revisión de Meta y Google). */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "soporte@responbot.com",
  /** Razón social que presta el servicio (la LLC que cobra con Stripe); Responbot es su nombre comercial. */
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || "AppsGuru, LLC",
  /** Dónde está constituida la sociedad. */
  legalJurisdiction: "Delaware, Estados Unidos",
  /** Número de la demo pública (solo dígitos); la landing ofrece probarla por WhatsApp. */
  demoWhatsApp: process.env.NEXT_PUBLIC_DEMO_WHATSAPP?.replace(/\D/g, "") || null,
} as const

/** Enlace para escribirle a la demo con un primer mensaje ya cargado. */
export function demoWhatsAppUrl(): string | null {
  if (!brand.demoWhatsApp) return null
  return `https://wa.me/${brand.demoWhatsApp}?text=${encodeURIComponent("Hola, quiero sacar un turno")}`
}
