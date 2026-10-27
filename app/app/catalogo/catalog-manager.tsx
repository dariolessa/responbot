"use client"

import {
  AlertTriangle,
  Camera,
  ExternalLink,
  Globe,
  ImageOff,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCw,
  Store,
  Trash2,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Field, FormError } from "@/components/forms/field"
import { EmptyState } from "@/components/layout/empty-state"
import { LiveRefresh } from "@/components/layout/live-refresh"
import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatZoned } from "@/lib/time"

import { addSource, deleteItem, deleteSource, reimportSource, saveItem, setItemAvailable } from "./actions"

export type SourceRow = {
  id: string
  url: string
  kind: "web" | "mercadolibre" | "instagram"
  status: "pending" | "running" | "ok" | "error"
  lastError: string | null
  itemCount: number
  accountName: string | null
  connected: boolean
  lastImportedAt: string | null
}

const kindIcons = { web: Globe, mercadolibre: Store, instagram: Camera } as const

export type ItemRow = {
  id: string
  fromWeb: boolean
  title: string
  description: string
  price: string
  priceLabel: string
  currency: string
  operation: string
  location: string
  attributes: string
  imageUrls: string[]
  url: string
  available: boolean
  editedManually: boolean
}

type Draft = Omit<ItemRow, "id" | "fromWeb" | "priceLabel" | "editedManually" | "imageUrls"> & {
  id?: string
  fromWeb: boolean
  imageUrls: string
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
}

export function CatalogManager({
  sources,
  items,
  currency,
  timezone,
  notice: initialNotice,
  connectable,
}: {
  sources: SourceRow[]
  items: ItemRow[]
  currency: string
  timezone: string
  notice: string | null
  connectable: { mercadolibre: boolean; instagram: boolean }
}) {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(initialNotice)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  const importing = sources.some((s) => s.status === "pending" || s.status === "running")
  const available = items.filter((i) => i.available).length

  function add(e: React.FormEvent) {
    e.preventDefault()
    setSourceError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await addSource({ url })
      if (!result.ok) return setSourceError(result.fieldErrors?.url ?? result.error)
      setUrl("")
      setNotice(
        result.data === "instagram"
          ? "Quedó guardada. Para leer tus publicaciones tocá \"Conectar Instagram\"."
          : "Estamos leyendo las publicaciones. Tarda uno o dos minutos; aparecen abajo.",
      )
      router.refresh()
    })
  }

  function runSource(action: "reimport" | "delete", source: SourceRow) {
    const name = source.accountName ?? shortUrl(source.url)
    if (action === "delete" && !window.confirm(`¿Sacar ${name} y sus publicaciones del catálogo?`)) return
    startTransition(async () => {
      const result = action === "reimport" ? await reimportSource({ id: source.id }) : await deleteSource({ id: source.id })
      if (!result.ok) setSourceError(result.error)
      router.refresh()
    })
  }

  function open(item?: ItemRow) {
    setError(null)
    setFieldErrors({})
    setDraft(
      item
        ? { ...item, imageUrls: item.imageUrls.join("\n") }
        : {
            fromWeb: false,
            title: "",
            description: "",
            price: "",
            currency,
            operation: "",
            location: "",
            attributes: "",
            imageUrls: "",
            url: "",
            available: true,
          },
    )
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    startTransition(async () => {
      // fromWeb solo se usa en pantalla; el esquema de la acción lo descarta.
      const result = await saveItem(draft)
      if (result.ok) {
        setDraft(null)
        router.refresh()
      } else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  function remove() {
    if (!draft?.id) return
    const question = draft.fromWeb
      ? `"${draft.title}" viene de tu web: la vamos a ocultar para que el bot no la ofrezca. ¿Seguimos?`
      : `¿Borrar "${draft.title}"?`
    if (!window.confirm(question)) return
    startTransition(async () => {
      const result = await deleteItem({ id: draft.id! })
      if (!result.ok) return setError(result.error)
      setDraft(null)
      router.refresh()
    })
  }

  function toggle(item: ItemRow) {
    startTransition(async () => {
      await setItemAvailable({ id: item.id, available: !item.available })
      router.refresh()
    })
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d))

  return (
    <>
      {importing ? <LiveRefresh intervalMs={5_000} /> : null}

      <section className="mb-8 rounded-lg border p-4">
        <h2 className="font-medium">De dónde aprende</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          La página de tu web donde están las propiedades o productos, o el link de tu tienda de MercadoLibre. Se vuelve a leer todos los días.
        </p>
        <form onSubmit={add} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://tuinmobiliaria.com/propiedades o tu tienda de MercadoLibre"
            inputMode="url"
            aria-label="Dirección de la página"
            aria-invalid={sourceError ? true : undefined}
          />
          <Button type="submit" disabled={pending || !url.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            Agregar
          </Button>
        </form>
        <FormError message={sourceError} />
        {notice ? <p className="mt-2 text-sm text-muted-foreground">{notice}</p> : null}
        {connectable.mercadolibre || connectable.instagram ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">O conectá tu cuenta:</span>
            {connectable.mercadolibre ? (
              <Button variant="outline" size="sm" asChild>
                <a href="/api/integrations/mercadolibre/connect">
                  <Store />
                  Conectar MercadoLibre
                </a>
              </Button>
            ) : null}
            {connectable.instagram ? (
              <Button variant="outline" size="sm" asChild>
                <a href="/api/integrations/instagram/connect">
                  <Camera />
                  Conectar Instagram
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {sources.length > 0 ? (
          <ul className="mt-4 divide-y rounded-md border">
            {sources.map((s) => {
              const KindIcon = kindIcons[s.kind]
              return (
                <li key={s.id} className="flex items-center gap-2 py-2 pr-2 pl-3">
                  <KindIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {s.accountName ?? shortUrl(s.url)}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {s.status === "pending" || s.status === "running" ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" />
                          Leyendo la página…
                        </span>
                      ) : s.status === "error" ? (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertTriangle className="size-3" />
                          {s.lastError}
                        </span>
                      ) : (
                        <>
                          {s.itemCount === 1 ? "1 publicación" : `${s.itemCount} publicaciones`}
                          {s.lastImportedAt
                            ? ` · leída el ${formatZoned(new Date(s.lastImportedAt), timezone, "d MMM HH:mm")}`
                            : null}
                        </>
                      )}
                    </p>
                  </div>
                  {s.kind !== "instagram" || s.connected ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Volver a leer"
                      disabled={pending || s.status === "pending" || s.status === "running"}
                      onClick={() => runSource("reimport", s)}
                    >
                      <RefreshCw />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Sacar"
                    disabled={pending}
                    onClick={() => runSource("delete", s)}
                  >
                    <Trash2 />
                  </Button>
                </li>
                )
            })}
          </ul>
        ) : null}
      </section>

      {items.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Todavía no hay publicaciones"
          description="Agregá la dirección de tu web o cargá una a mano."
          action={
            <Button variant="outline" onClick={() => open()}>
              <Plus />
              Cargar a mano
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {available === 1 ? "1 disponible" : `${available} disponibles`} de {items.length}
            </p>
            <Button variant="outline" onClick={() => open()}>
              <Plus />
              Cargar a mano
            </Button>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-lg border">
                <button type="button" onClick={() => open(item)} className="block w-full text-left">
                  <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                    {item.imageUrls[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- fotos de la web del negocio, de cualquier dominio
                      <img
                        src={item.imageUrls[0]}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className={`size-full object-cover ${item.available ? "" : "opacity-50 grayscale"}`}
                      />
                    ) : (
                      <ImageOff className="size-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="grid gap-1 p-3">
                    <p className="line-clamp-2 font-medium">{item.title}</p>
                    <p className="font-mono text-sm">{item.priceLabel}</p>
                    {item.location || item.operation ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {[item.operation, item.location].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </button>
                <div className="flex items-center gap-2 border-t px-3 py-2">
                  {item.available ? null : <Badge variant="secondary">No se ofrece</Badge>}
                  {item.fromWeb ? null : <Badge variant="outline">A mano</Badge>}
                  {item.fromWeb && item.editedManually ? <Badge variant="outline">Editada</Badge> : null}
                  <span className="flex-1" />
                  {item.url ? (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={item.url} target="_blank" rel="noreferrer" aria-label="Abrir en la web">
                        <ExternalLink />
                      </a>
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => toggle(item)}>
                    {item.available ? "Pausar" : "Ofrecer"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ResponsiveSheet
        open={draft !== null}
        onOpenChange={(o) => (o ? null : setDraft(null))}
        title={draft?.id ? "Editar publicación" : "Nueva publicación"}
        description={
          draft?.fromWeb ? "Viene de tu web. Si la editás acá, la lectura diaria ya no cambia sus datos." : undefined
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            {draft?.id ? (
              <Button variant="ghost" onClick={remove} disabled={pending} className="text-destructive">
                <Trash2 />
                {draft.fromWeb ? "Ocultar" : "Borrar"}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" form="catalog-item-form" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Guardar
            </Button>
          </div>
        }
      >
        {draft ? (
          <form id="catalog-item-form" onSubmit={save} className="grid gap-5">
            <Field label="Título" htmlFor="item-title" error={fieldErrors.title}>
              <Input
                id="item-title"
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Casa 3 dormitorios en Carrasco"
                aria-invalid={fieldErrors.title ? true : undefined}
              />
            </Field>
            <div className="grid grid-cols-[1fr_6rem] gap-4">
              <Field label="Precio (vacío = a consultar)" htmlFor="item-price" error={fieldErrors.price}>
                <Input
                  id="item-price"
                  inputMode="decimal"
                  className="font-mono"
                  value={draft.price}
                  onChange={(e) => set("price", e.target.value)}
                />
              </Field>
              <Field label="Moneda" htmlFor="item-currency" error={fieldErrors.currency}>
                <Input
                  id="item-currency"
                  className="font-mono uppercase"
                  maxLength={3}
                  value={draft.currency}
                  onChange={(e) => set("currency", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Operación" htmlFor="item-operation" error={fieldErrors.operation}>
                <Input
                  id="item-operation"
                  value={draft.operation}
                  onChange={(e) => set("operation", e.target.value)}
                  placeholder="Venta, alquiler…"
                />
              </Field>
              <Field label="Zona o dirección" htmlFor="item-location" error={fieldErrors.location}>
                <Input id="item-location" value={draft.location} onChange={(e) => set("location", e.target.value)} />
              </Field>
            </div>
            <Field label="Descripción" htmlFor="item-description" error={fieldErrors.description}>
              <Textarea
                id="item-description"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <Field
              label="Datos clave"
              htmlFor="item-attributes"
              hint="Uno por renglón, por ejemplo: Dormitorios: 3"
              error={fieldErrors.attributes}
            >
              <Textarea
                id="item-attributes"
                value={draft.attributes}
                onChange={(e) => set("attributes", e.target.value)}
              />
            </Field>
            <Field
              label="Fotos"
              htmlFor="item-images"
              hint="Links a las fotos, uno por renglón. La primera es la que manda el bot."
              error={fieldErrors.imageUrls}
            >
              <Textarea
                id="item-images"
                className="font-mono text-xs"
                value={draft.imageUrls}
                onChange={(e) => set("imageUrls", e.target.value)}
              />
            </Field>
            <Field label="Link a la publicación" htmlFor="item-url" error={fieldErrors.url}>
              <Input id="item-url" inputMode="url" value={draft.url} onChange={(e) => set("url", e.target.value)} />
            </Field>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={draft.available} onChange={(e) => set("available", e.target.checked)} />
              Disponible: el bot la puede ofrecer
            </label>
            <FormError message={error} />
          </form>
        ) : null}
      </ResponsiveSheet>
    </>
  )
}
