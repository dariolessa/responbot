# Responbot

**Seguí siempre [docs/SPEC.md](docs/SPEC.md).** Es la especificación completa del producto: modelo de datos, rutas, diseño, hoja de ruta. Si algo no está definido ahí, tomá la opción más simple y anotala en [docs/DECISIONS.md](docs/DECISIONS.md).

@AGENTS.md

## Producto

SaaS multi-negocio "Responbot" (en el SPEC figura como "Agendabot", nombre provisorio; la marca vive en `lib/brand.ts`): un asistente de WhatsApp que responde consultas, cotiza servicios con precio fijo y reserva turnos, más un panel web con agenda para el dueño y su equipo. El MVP apunta a servicios con turno (peluquerías, barberías, uñas, estética), Uruguay primero. Estado actual: Fase 0 (base) terminada; sigue la Fase 1 (agenda sin bot).

## Stack

- Next.js 16 (App Router, `proxy.ts` en lugar de `middleware.ts`) + TypeScript estricto, pnpm.
- Tailwind CSS 4 + shadcn/ui (base zinc, acento esmeralda) + lucide-react + next-themes. Fuente Geist.
- Postgres en Neon con Drizzle ORM (driver serverless) y drizzle-kit.
- Auth.js v5: Google + enlace mágico por email con Resend, sesiones en base.
- Zod para validar toda entrada. Vitest + PGlite para tests.
- Deploy en Vercel, región `gru1`, crons en `vercel.json`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Servidor de desarrollo en http://localhost:3000 |
| `pnpm build` | Build de producción (no necesita variables de entorno) |
| `pnpm test` | Tests con Vitest (Postgres en memoria con PGlite, sin servicios externos) |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm db:generate` | Genera una migración en `lib/db/migrations` a partir de `lib/db/schema.ts` |
| `pnpm db:migrate` | Aplica las migraciones a `DATABASE_URL` (lee `.env.local`) |
| `pnpm db:studio` | Drizzle Studio |

## Convenciones

- **TypeScript estricto.** Nada de `any` salvo dentro de `lib/db/scoped.ts`, comentado.
- **Zod en toda entrada:** server actions, rutas de API, webhooks, herramientas del bot, formularios y variables de entorno (`lib/env.ts`).
- **Todo acceso a datos pasa por `lib/db/scoped.ts`, filtrado por `business_id`.** Las páginas y server actions piden el negocio con `getTenant()` o `requirePermission()` de `lib/auth/tenant.ts` y usan `tenant.db.<tabla>`. Nunca importes `db` de `lib/db` en pantallas, acciones o rutas. Una tabla nueva con `business_id` se agrega a `tenantTables` (hay un test que lo exige).
- **Permisos en el servidor:** `requirePermission("…")` en cada página y server action sensible (`lib/auth/roles.ts`). Ocultar un botón no alcanza.
- **Fechas:** siempre en UTC en la base (`timestamptz`); en pantalla, en la zona horaria del negocio (`businesses.timezone`) con date-fns-tz.
- **Montos:** enteros en centésimos, con su moneda.
- **Textos en español rioplatense**, con voseo y sin jerga técnica, en la UI, los correos y los mensajes de error.
- **Diseño:** sección Diseño del SPEC. Mobile-first (botones de 44 px en celular), sin sombras salvo menús y diálogos, estados vacíos con una frase y una acción (`components/layout/empty-state.tsx`), esqueletos en vez de spinners.
- **Integraciones** detrás de `lib/integrations/<servicio>`. Nada de librerías no oficiales de WhatsApp.
- **Migraciones:** se generan con `pnpm db:generate` y se revisan. Lo que Drizzle no expresa (como la exclusión gist de `bookings`) se escribe a mano en la migración y se comenta en `lib/db/schema.ts`.
- Antes de cerrar un cambio: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Mapa rápido

- `app/(auth)/login`, `app/onboarding`, `app/app/*` (panel), `app/api/*` (auth, crons).
- `proxy.ts`: chequeo optimista de sesión para `/app` y `/onboarding`.
- `lib/auth/`: Auth.js (`index.ts`), roles, `tenant.ts` (sesión → negocio activo → scope).
- `lib/db/`: `schema.ts`, `scoped.ts`, `migrations/`.
- `tests/unit/`: tests; `tests/helpers/db.ts` levanta Postgres en memoria con las migraciones reales.
