/*
 * Plantillas de servicios por tipo de negocio, para cargar el catálogo en un
 * minuto (docs/SPEC.md, "Asistente de alta", paso 2). Son un punto de
 * partida: la persona edita nombre, duración y precio antes de guardar.
 *
 * Los precios son de referencia en pesos uruguayos; con otra moneda se dejan
 * vacíos para que los complete el negocio.
 */

export type ServiceTemplate = {
  name: string
  durationMinutes: number
  /** Precio de referencia en centésimos de UYU. */
  priceUyu: number
  description?: string
}

export type CategoryKey = "peluqueria" | "barberia" | "unas" | "estetica"

export type Category = {
  key: CategoryKey
  label: string
  services: ServiceTemplate[]
}

const uyu = (pesos: number) => pesos * 100

export const categories: Category[] = [
  {
    key: "peluqueria",
    label: "Peluquería",
    services: [
      { name: "Corte de dama", durationMinutes: 45, priceUyu: uyu(900) },
      { name: "Corte de caballero", durationMinutes: 30, priceUyu: uyu(600) },
      { name: "Corte infantil", durationMinutes: 30, priceUyu: uyu(500) },
      { name: "Brushing", durationMinutes: 45, priceUyu: uyu(700) },
      { name: "Color raíz", durationMinutes: 90, priceUyu: uyu(1800) },
      { name: "Mechas", durationMinutes: 150, priceUyu: uyu(3500) },
      {
        name: "Alisado",
        durationMinutes: 180,
        priceUyu: uyu(4500),
        description: "El precio puede variar según el largo del pelo.",
      },
      { name: "Peinado para evento", durationMinutes: 60, priceUyu: uyu(1500) },
    ],
  },
  {
    key: "barberia",
    label: "Barbería",
    services: [
      { name: "Corte", durationMinutes: 30, priceUyu: uyu(550) },
      { name: "Corte y barba", durationMinutes: 45, priceUyu: uyu(800) },
      { name: "Barba", durationMinutes: 20, priceUyu: uyu(350) },
      { name: "Afeitado con navaja", durationMinutes: 30, priceUyu: uyu(450) },
      { name: "Corte infantil", durationMinutes: 30, priceUyu: uyu(450) },
      { name: "Perfilado de cejas", durationMinutes: 10, priceUyu: uyu(150) },
    ],
  },
  {
    key: "unas",
    label: "Uñas",
    services: [
      { name: "Manicura tradicional", durationMinutes: 45, priceUyu: uyu(600) },
      { name: "Esmaltado semipermanente", durationMinutes: 60, priceUyu: uyu(900) },
      { name: "Kapping", durationMinutes: 75, priceUyu: uyu(1100) },
      { name: "Uñas esculpidas", durationMinutes: 120, priceUyu: uyu(1600) },
      { name: "Service de esculpidas", durationMinutes: 90, priceUyu: uyu(1200) },
      { name: "Pedicura", durationMinutes: 60, priceUyu: uyu(900) },
      { name: "Retiro", durationMinutes: 30, priceUyu: uyu(350) },
    ],
  },
  {
    key: "estetica",
    label: "Estética",
    services: [
      { name: "Limpieza facial", durationMinutes: 60, priceUyu: uyu(1500) },
      { name: "Perfilado de cejas", durationMinutes: 20, priceUyu: uyu(400) },
      { name: "Lifting de pestañas", durationMinutes: 60, priceUyu: uyu(1300) },
      { name: "Depilación con cera, piernas", durationMinutes: 45, priceUyu: uyu(900) },
      { name: "Depilación con cera, axilas", durationMinutes: 15, priceUyu: uyu(350) },
      { name: "Masaje descontracturante", durationMinutes: 60, priceUyu: uyu(1400) },
      { name: "Drenaje linfático", durationMinutes: 60, priceUyu: uyu(1400) },
    ],
  },
]

export const categoryKeys = categories.map((c) => c.key) as [CategoryKey, ...CategoryKey[]]

export function categoryByKey(key: string | null | undefined): Category | undefined {
  return categories.find((c) => c.key === key)
}

export function categoryLabel(key: string | null | undefined): string | null {
  return categoryByKey(key)?.label ?? null
}

/** Duraciones para elegir en los formularios. */
export const durationOptions = [10, 15, 20, 30, 40, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240]

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
