/** Opciones del alta de negocio. Uruguay primero (docs/SPEC.md). */

export const archetypeOptions = [
  { value: "services", label: "Peluquería, barbería, uñas o estética", available: true },
  { value: "health", label: "Salud", available: false },
  { value: "real_estate", label: "Inmobiliaria", available: false },
  { value: "spaces", label: "Canchas y espacios", available: false },
] as const

export const timezoneOptions = [
  { value: "America/Montevideo", label: "Montevideo (UTC−3)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (UTC−3)" },
  { value: "America/Sao_Paulo", label: "San Pablo (UTC−3)" },
  { value: "America/Asuncion", label: "Asunción" },
  { value: "America/Santiago", label: "Santiago" },
  { value: "America/Lima", label: "Lima (UTC−5)" },
  { value: "America/Bogota", label: "Bogotá (UTC−5)" },
  { value: "America/Mexico_City", label: "Ciudad de México (UTC−6)" },
  { value: "Europe/Madrid", label: "Madrid" },
] as const

export const currencyOptions = [
  { value: "UYU", label: "Peso uruguayo (UYU)" },
  { value: "USD", label: "Dólar (USD)" },
  { value: "ARS", label: "Peso argentino (ARS)" },
  { value: "BRL", label: "Real (BRL)" },
  { value: "PYG", label: "Guaraní (PYG)" },
  { value: "CLP", label: "Peso chileno (CLP)" },
  { value: "PEN", label: "Sol (PEN)" },
  { value: "COP", label: "Peso colombiano (COP)" },
  { value: "MXN", label: "Peso mexicano (MXN)" },
  { value: "EUR", label: "Euro (EUR)" },
] as const

export const TRIAL_DAYS = 14
