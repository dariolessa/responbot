import type { Metadata } from "next"
import Link from "next/link"

import { Logo } from "@/components/layout/logo"
import { brand } from "@/lib/brand"

export const metadata: Metadata = { title: "Eliminación de datos" }

/** Página de estado del pedido de eliminación de datos de Meta. */
export default async function EliminacionDeDatosPage({ searchParams }: PageProps<"/eliminacion-de-datos">) {
  const { codigo } = await searchParams
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-6 sm:px-6">
      <Link href="/" className="w-fit">
        <Logo />
      </Link>
      <main className="mt-16 grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Eliminación de datos</h1>
        {typeof codigo === "string" ? (
          <p className="text-sm">
            Recibimos tu pedido. Código de confirmación: <span className="font-mono">{codigo}</span>
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {brand.name} no guarda datos de tu cuenta de Facebook. Cuando conectás WhatsApp, guardamos solo lo necesario
          para responder en el número de tu negocio, y lo borramos cuando lo desconectás desde Configuración.
        </p>
        <p className="text-sm text-muted-foreground">
          Si sos cliente de un negocio que usa {brand.name} y querés que borren tus datos, escribile a ese negocio por
          WhatsApp. Para dejar de recibir recordatorios, escribí BAJA.
        </p>
      </main>
    </div>
  )
}
