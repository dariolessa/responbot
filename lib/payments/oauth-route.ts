import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { can } from "@/lib/auth/roles"
import { getTenant } from "@/lib/auth/tenant"
import { authorizationUrl, exchangeCode, getMe } from "@/lib/integrations/mercadopago/api"

import { isMercadoPagoConfigured, MP_CALLBACK_PATH, mpApp, mpRedirectUri, paymentDeps } from "./deps"
import { PaymentError, saveMpConnection } from "./mercadopago"

/*
 * OAuth de Mercado Pago (docs/SPEC.md): cada negocio conecta su propia
 * cuenta. GET /api/integrations/mercadopago/connect manda al dueño a
 * autorizar (con state y PKCE en una cookie de 10 minutos) y
 * GET /api/integrations/mercadopago/callback canjea el código y guarda los
 * tokens cifrados.
 */

const COOKIE = "mp_oauth"
const SETTINGS = "/app/configuracion"

const cookieValue = z.object({ state: z.string(), verifier: z.string(), businessId: z.uuid() })

function back(request: Request, result: "conectado" | "error" | "cancelado" | "ocupado") {
  return NextResponse.redirect(new URL(`${SETTINGS}?mercadopago=${result}#mercadopago`, request.url), 303)
}

export async function startMpOAuth(request: Request): Promise<Response> {
  const tenant = await getTenant()
  if (!can(tenant.role, "manageConnections") || !isMercadoPagoConfigured()) return back(request, "error")

  const state = randomBytes(24).toString("base64url")
  const verifier = randomBytes(48).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const response = NextResponse.redirect(
    authorizationUrl(mpApp(), { redirectUri: mpRedirectUri(), state, codeChallenge: challenge }),
    303,
  )
  response.cookies.set(COOKIE, JSON.stringify({ state, verifier, businessId: tenant.business.businessId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: MP_CALLBACK_PATH,
  })
  return response
}

function sameText(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function finishMpOAuth(request: Request): Promise<Response> {
  const tenant = await getTenant()
  const deps = paymentDeps()
  if (!can(tenant.role, "manageConnections") || !deps) return back(request, "error")

  const params = new URL(request.url).searchParams
  const store = await cookies()
  let cookie: unknown = null
  try {
    cookie = JSON.parse(store.get(COOKIE)?.value ?? "null")
  } catch {
    // Cookie rota: se trata como si no estuviera.
  }
  const saved = cookieValue.safeParse(cookie)
  const done = (result: Parameters<typeof back>[1]) => {
    const response = back(request, result)
    response.cookies.set(COOKIE, "", { path: MP_CALLBACK_PATH, maxAge: 0 })
    return response
  }
  if (params.get("error")) return done("cancelado")
  const code = params.get("code")
  const state = params.get("state") ?? ""
  if (
    !code ||
    !saved.success ||
    !sameText(saved.data.state, state) ||
    saved.data.businessId !== tenant.business.businessId
  ) {
    return done("error")
  }

  let result: "conectado" | "error" | "ocupado" = "conectado"
  try {
    const tokens = await exchangeCode(mpApp(), { code, redirectUri: mpRedirectUri(), codeVerifier: saved.data.verifier })
    const me = await getMe(tokens.access_token).catch(() => null)
    await saveMpConnection(
      tenant.db,
      tenant.user.id,
      { tokens, displayName: me?.email ?? me?.nickname ?? null },
      deps.encrypt,
    )
  } catch (error) {
    console.error("[mercadopago] no se pudo conectar", error instanceof Error ? error.message : error)
    result = error instanceof PaymentError ? "ocupado" : "error"
  }
  return done(result)
}
