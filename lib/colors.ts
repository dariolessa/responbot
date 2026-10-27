/** Colores para distinguir a cada profesional en la agenda. */
export const colorOptions = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#06b6d4",
  "#ef4444",
  "#84cc16",
] as const

export type ResourceColor = (typeof colorOptions)[number]

/** Color del profesional, o uno estable según su posición si no eligió. */
export function resourceColor(color: string | null | undefined, index: number): string {
  return color ?? colorOptions[index % colorOptions.length]!
}
