import { Search } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { adminSearchBusinesses } from "@/lib/pilots/admin"
import { formatZoned } from "@/lib/time"

import { statusLabels, statusVariant } from "../labels"

export const metadata: Metadata = { title: "Soporte" }
export const dynamic = "force-dynamic"

const TZ = "America/Montevideo"

export default async function SoportePage({ searchParams }: PageProps<"/admin/soporte">) {
  const { q } = await searchParams
  const term = typeof q === "string" ? q.slice(0, 100) : ""
  const rows = await adminSearchBusinesses(term)

  return (
    <>
      <PageHeader
        title="Soporte"
        description="Buscá un negocio por nombre, email de alguien del equipo o número de WhatsApp para ver su ficha, sus problemas y sus conversaciones."
      />

      <form className="mb-6 flex gap-2" role="search">
        <Input
          name="q"
          defaultValue={term}
          placeholder="Nombre, email o número"
          aria-label="Buscar negocio"
          className="min-h-11 flex-1 sm:min-h-9"
          autoFocus
        />
        <Button type="submit">
          <Search />
          Buscar
        </Button>
      </form>

      <p className="mb-3 text-sm text-muted-foreground">
        {term
          ? `${rows.length} ${rows.length === 1 ? "resultado" : "resultados"} para “${term}”.`
          : "Los últimos negocios dados de alta."}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-[10px] border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {term ? "No encontramos ningún negocio con eso. Probá con otra parte del nombre o del email." : "Todavía no hay negocios."}
        </p>
      ) : (
        <ul className="divide-y rounded-[10px] border">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/admin/soporte/${row.id}`}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {row.ownerEmail ?? "Sin dueño"} · alta el {formatZoned(row.createdAt, TZ, "d MMM yyyy")}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {row.isDemo ? <Badge>Demo</Badge> : null}
                  <Badge variant={statusVariant(row.status)}>{statusLabels[row.status]}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
