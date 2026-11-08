import { redirect } from "next/navigation"

/** Dirección anterior: lleva a /eliminacion-datos conservando el código. */
export default async function EliminacionDeDatosAnterior({ searchParams }: PageProps<"/eliminacion-de-datos">) {
  const { codigo, code } = await searchParams
  const value = typeof code === "string" ? code : typeof codigo === "string" ? codigo : null
  redirect(value ? `/eliminacion-datos?code=${encodeURIComponent(value)}` : "/eliminacion-datos")
}
