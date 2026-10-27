import { NextResponse, type NextRequest } from "next/server"

/*
 * Protege /app, /onboarding y /admin (en Next.js 16 el middleware se llama proxy).
 *
 * Es un chequeo optimista: si no hay cookie de sesión, manda a /login sin tocar
 * la base. La validación real (sesión vigente, membresía activa y negocio) la
 * hacen los layouts con lib/auth/tenant.ts: usuario sin negocio va a
 * /onboarding y una invitación pendiente para su email lo une a ese negocio.
 */

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"]

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name))
  if (hasSession) return NextResponse.next()

  const login = new URL("/login", request.url)
  const { pathname, search } = request.nextUrl
  login.searchParams.set("callbackUrl", `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/admin/:path*"],
}
