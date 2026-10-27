/** Marca del producto (docs/SPEC.md: el nombre se reemplaza con una variable de marca). */
export const brand = {
  name: "Responbot",
  /** Verde del logo, solo para la marca; el acento de la interfaz es esmeralda. */
  green: "#02A82F",
  /** Contacto que muestran la landing, los términos y la privacidad (lo pide la revisión de Meta y Google). */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || null,
  /** Razón social que presta el servicio (la LLC que cobra con Stripe). */
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || null,
} as const
