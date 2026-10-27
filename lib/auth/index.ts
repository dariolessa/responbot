import { DrizzleAdapter } from "@auth/drizzle-adapter"
import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Resend from "next-auth/providers/resend"

import { magicLinkEmail } from "@/emails/magic-link"
import { db } from "@/lib/db"
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema"
import { env } from "@/lib/env"
import { sendEmail } from "@/lib/integrations/resend/client"

/** Validez del enlace mágico (docs/SPEC.md, "Recuperación de acceso"). */
const MAGIC_LINK_MINUTES = 15

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // Sesiones en base: desactivar a un miembro o "cerrar todas las sesiones"
  // tiene efecto inmediato.
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      // Google verifica el email: si la cuenta se creó antes con enlace mágico,
      // se vincula en vez de dar error.
      allowDangerousEmailAccountLinking: true,
    }),
    Resend({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      maxAge: MAGIC_LINK_MINUTES * 60,
      normalizeIdentifier: (identifier) => identifier.trim().toLowerCase(),
      async sendVerificationRequest({ identifier, url }) {
        const email = magicLinkEmail({ url, minutes: MAGIC_LINK_MINUTES })
        await sendEmail({ to: identifier, ...email })
      },
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/revisa-tu-correo",
    error: "/login",
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
})
