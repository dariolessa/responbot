import { and, eq, isNull } from "drizzle-orm"

import * as schema from "@/lib/db/schema"
import type { ScopedDb } from "@/lib/db/scoped"

/*
 * Cuentas de MercadoLibre e Instagram conectadas al catálogo. El token queda
 * cifrado en la fuente; si el negocio ya había pegado el link de esa cuenta
 * (o uno sin cuenta conectada del mismo tipo), se completa esa fuente en vez
 * de crear otra.
 */

export type NewConnection = {
  kind: "mercadolibre" | "instagram"
  url: string
  externalId: string
  accountName: string
  accessToken: string
  refreshToken?: string | null
  expiresInSeconds: number
}

export async function saveConnection(
  scoped: ScopedDb,
  connection: NewConnection,
  crypto: { encrypt(value: string): string },
  now: Date = new Date(),
): Promise<schema.CatalogSource> {
  const values = {
    kind: connection.kind,
    externalId: connection.externalId,
    accountName: connection.accountName,
    accessTokenEnc: crypto.encrypt(connection.accessToken),
    refreshTokenEnc: connection.refreshToken ? crypto.encrypt(connection.refreshToken) : null,
    tokenExpiresAt: new Date(now.getTime() + connection.expiresInSeconds * 1000),
    status: "pending" as const,
    lastError: null,
  }
  const sameKind = eq(schema.catalogSources.kind, connection.kind)
  const existing =
    (await scoped.catalogSources.findFirst(and(sameKind, eq(schema.catalogSources.externalId, connection.externalId)))) ??
    (await scoped.catalogSources.findFirst(and(sameKind, eq(schema.catalogSources.url, connection.url)))) ??
    (await scoped.catalogSources.findFirst(and(sameKind, isNull(schema.catalogSources.accessTokenEnc))))
  if (existing) {
    const [updated] = await scoped.catalogSources.update(eq(schema.catalogSources.id, existing.id), values)
    return updated!
  }
  const [created] = await scoped.catalogSources.insert({ ...values, url: connection.url })
  return created!
}
