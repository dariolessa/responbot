import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { can } from "@/lib/auth/roles"
import { getTenant } from "@/lib/auth/tenant"
import { readOnlyFailure } from "@/lib/billing/access"
import * as ig from "@/lib/integrations/instagram/api"
import * as ml from "@/lib/integrations/mercadolibre/api"

import { saveConnection } from "./connections"
import { callbackUri, catalogCrypto, IG_CALLBACK_PATH, igApp, ML_CALLBACK_PATH, mlApp, importSoon } from "./deps"

/*
 * OAuth de las cuentas del catálogo: GET /api/integrations/<proveedor>/connect
 * manda a autorizar (state, y PKCE en MercadoLibre, en una cookie de 10
 * minutos) y /callback canjea el código, guarda el token cifrado en la fuente
 * y arranca la lectura.
 */

type Provider = "mercadolibre" | "instagram"

const CATALOG = "/app/catalogo"
const cookieName = (provider: Provider) => `catalog_oauth_${provider}`
const callbackPath = (provider: Provider) => (provider === "mercadolibre" ? ML_CALLBACK_PATH : IG_CALLBACK_PATH)

const cookieValue = z.object({ state: z.string(), verifier: z.string(), businessId: z.uuid(), siteId: z.string() })

function back(request: Request, provider: Provider, result: "conectado" | "error" | "cancelado") {
  return NextResponse.redirect(new URL(`${CATALOG}?${provider}=${result}`, request.url), 303)
}

function sameText(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function startCatalogOAuth(request: Request, provider: Provider): Promise<Response> {
  const tenant = await getTenant()
  const app = provider === "mercadolibre" ? mlApp() : igApp()
  if (!can(tenant.role, "manageCatalog") || !app) return back(request, provider, "error")

  const state = randomBytes(24).toString("base64url")
  const verifier = randomBytes(48).toString("base64url")
  // País de la cuenta de MercadoLibre: el del negocio (Uruguay salvo que la moneda diga otra cosa).
  const currency = (await tenant.db.business())?.currency
  const siteId = currency === "ARS" ? "MLA" : currency === "MXN" ? "MLM" : currency === "BRL" ? "MLB" : "MLU"
  const redirectUri = callbackUri(callbackPath(provider))
  const target =
    provider === "mercadolibre"
      ? ml.authorizationUrl(mlApp()!, {
          siteId,
          redirectUri,
          state,
          codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        })
      : ig.authorizationUrl(igApp()!, { redirectUri, state })
  const response = NextResponse.redirect(target, 303)
  response.cookies.set(
    cookieName(provider),
    JSON.stringify({ state, verifier, businessId: tenant.business.businessId, siteId }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: callbackPath(provider),
    },
  )
  return response
}

export async function finishCatalogOAuth(request: Request, provider: Provider): Promise<Response> {
  const tenant = await getTenant()
  const done = (result: Parameters<typeof back>[2]) => {
    const response = back(request, provider, result)
    response.cookies.set(cookieName(provider), "", { path: callbackPath(provider), maxAge: 0 })
    return response
  }
  if (!can(tenant.role, "manageCatalog") || (await readOnlyFailure(tenant.db))) return done("error")

  const params = new URL(request.url).searchParams
  const store = await cookies()
  let cookie: unknown = null
  try {
    cookie = JSON.parse(store.get(cookieName(provider))?.value ?? "null")
  } catch {
    // Cookie rota: se trata como si no estuviera.
  }
  const saved = cookieValue.safeParse(cookie)
  if (params.get("error")) return done("cancelado")
  const code = params.get("code")
  if (
    !code ||
    !saved.success ||
    !sameText(saved.data.state, params.get("state") ?? "") ||
    saved.data.businessId !== tenant.business.businessId
  ) {
    return done("error")
  }

  const crypto = catalogCrypto()
  const redirectUri = callbackUri(callbackPath(provider))
  try {
    if (provider === "mercadolibre") {
      const app = mlApp()
      if (!app) return done("error")
      const api = ml.mercadoLibreApi(app)
      const tokens = await api.exchangeCode({ code, redirectUri, codeVerifier: saved.data.verifier })
      const me = await api.me(tokens.access_token)
      const source = await saveConnection(
        tenant.db,
        {
          kind: "mercadolibre",
          url: me.permalink ?? `https://perfil.mercadolibre.com.uy/${encodeURIComponent(me.nickname)}`,
          externalId: String(me.id),
          accountName: me.nickname,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresInSeconds: tokens.expires_in,
        },
        crypto,
      )
      importSoon(tenant.db.businessId, source.id)
    } else {
      const app = igApp()
      if (!app) return done("error")
      // Instagram agrega "#_" al final del código.
      const result = await ig.instagramApi(app).exchangeCode({ code: code.replace(/#_$/, ""), redirectUri })
      const source = await saveConnection(
        tenant.db,
        {
          kind: "instagram",
          url: `https://www.instagram.com/${result.username}/`,
          externalId: result.userId,
          accountName: `@${result.username}`,
          accessToken: result.access_token,
          expiresInSeconds: result.expires_in,
        },
        crypto,
      )
      importSoon(tenant.db.businessId, source.id)
    }
  } catch (error) {
    console.error(`[catalogo] no se pudo conectar ${provider}`, error instanceof Error ? error.message : error)
    return done("error")
  }
  return done("conectado")
}
