import { z } from "zod"

/**
 * Variables de entorno validadas con Zod (docs/SPEC.md, sección Vercel).
 *
 * Las que usa la Fase 0 son obligatorias. Las de integraciones que todavía no
 * existen (WhatsApp, Mercado Pago, Stripe, IA, push, Blob, Sentry) se declaran
 * acá pero quedan opcionales hasta la fase que las implementa, donde pasan a
 * obligatorias. Ver docs/DECISIONS.md.
 */

const optional = z.string().min(1).optional()

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Base de datos
  DATABASE_URL: z.url({ error: "DATABASE_URL tiene que ser una URL de Postgres" }),

  // Auth.js
  AUTH_SECRET: z.string().min(32, { error: "AUTH_SECRET tiene que tener al menos 32 caracteres" }),
  AUTH_URL: z.url().optional(),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),

  // Correo
  RESEND_API_KEY: z.string().startsWith("re_", { error: "RESEND_API_KEY empieza con re_" }),
  EMAIL_FROM: z.string().min(3),
  RESEND_WEBHOOK_SECRET: optional,

  // Meta / WhatsApp (Fase 3)
  META_APP_ID: optional,
  META_APP_SECRET: optional,
  META_CONFIG_ID: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),

  // IA (Fase 2) y transcripción (Fase 3)
  ANTHROPIC_API_KEY: optional,
  TRANSCRIBER_PROVIDER: z.enum(["openai", "elevenlabs"]).optional(),
  TRANSCRIBER_API_KEY: optional,

  // Mercado Pago (Fase 5)
  MP_CLIENT_ID: optional,
  MP_CLIENT_SECRET: optional,
  MP_WEBHOOK_SECRET: optional,

  // Catálogo: MercadoLibre e Instagram (APIs oficiales, docs/CATALOGO.md)
  ML_CLIENT_ID: optional,
  ML_CLIENT_SECRET: optional,
  INSTAGRAM_APP_ID: optional,
  INSTAGRAM_APP_SECRET: optional,

  // Stripe (Fase 6)
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_BASIC: optional,
  STRIPE_PRICE_PRO: optional,
  STRIPE_PRICE_TEAM: optional,

  // Push web (Fase 4)
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: optional,

  // Pilotos y demo (Fase 7): emails (separados por coma) que entran a /admin.
  PLATFORM_ADMIN_EMAILS: optional,

  // Seguridad
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      error: "ENCRYPTION_KEY tiene que ser 32 bytes en base64 (openssl rand -base64 32)",
    }),
  CRON_SECRET: z.string().min(16, { error: "CRON_SECRET tiene que tener al menos 16 caracteres" }),

  // Servicios de Vercel
  BLOB_READ_WRITE_TOKEN: optional,
  SENTRY_DSN: z.url().optional(),
})

export type Env = z.infer<typeof serverSchema>

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
    .join("\n")
}

/** Valida un objeto de variables y devuelve el resultado o tira un error legible. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Las variables vacías cuentan como no definidas.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  )
  const result = serverSchema.safeParse(cleaned)
  if (!result.success) {
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n${formatIssues(result.error)}\n` +
        "Revisá .env.example y la configuración del proyecto en Vercel.",
    )
  }
  return result.data
}

/**
 * Durante `next build` (y con SKIP_ENV_VALIDATION=1, para CI y tests) no se
 * valida: el build no necesita secretos. La validación real corre al arrancar
 * el servidor, desde instrumentation.ts.
 */
const skipValidation =
  process.env.SKIP_ENV_VALIDATION === "1" ||
  process.env.NEXT_PHASE === "phase-production-build"

export const env: Env = skipValidation
  ? (process.env as unknown as Env)
  : parseEnv(process.env)
