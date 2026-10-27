# Responbot

**Seguí siempre [docs/SPEC.md](docs/SPEC.md).** Es la especificación completa del producto: modelo de datos, rutas, diseño, hoja de ruta. Si algo no está definido ahí, tomá la opción más simple y anotala en [docs/DECISIONS.md](docs/DECISIONS.md).

@AGENTS.md

## Producto

SaaS multi-negocio "Responbot" (en el SPEC figura como "Agendabot", nombre provisorio; la marca vive en `lib/brand.ts`): un asistente de WhatsApp que responde consultas, cotiza servicios con precio fijo y reserva turnos, más un panel web con agenda para el dueño y su equipo. El MVP apunta a servicios con turno (peluquerías, barberías, uñas, estética), Uruguay primero. Estado actual: Fases 0 (base), 1 (agenda sin bot), 2 (bot en el chat de prueba del panel), 3 (WhatsApp real), 4 (recordatorios y notificaciones), 5 (señas con Mercado Pago y lista de espera) y 6 (Stripe, planes y límites, landing, estadísticas, reactivación y reseñas) terminadas; sigue la Fase 7 (pilotos). Cómo configurar Meta: [docs/WHATSAPP.md](docs/WHATSAPP.md); push, Resend y avisos: [docs/NOTIFICACIONES.md](docs/NOTIFICACIONES.md); Mercado Pago: [docs/MERCADOPAGO.md](docs/MERCADOPAGO.md); Stripe y planes: [docs/STRIPE.md](docs/STRIPE.md).

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

- `app/(auth)/login`, `app/onboarding/*` (asistente por pasos), `app/app/*` (panel: agenda, conversaciones, clientes, servicios, equipo, configuración), `app/api/*` (auth, crons, webhook de WhatsApp, alta embebida, eliminación de datos de Meta). Las rutas delegan en `lib/` (no importan `db`).
- `proxy.ts`: chequeo optimista de sesión para `/app` y `/onboarding`.
- `lib/auth/`: Auth.js (`index.ts`), roles, `tenant.ts` (sesión → negocio activo → scope).
- `lib/db/`: `schema.ts`, `scoped.ts`, `migrations/`.
- `lib/booking/`: disponibilidad (`availability.ts`, pura), alta/mover/estados de turnos (`create.ts`), qué ve cada rol (`access.ts`).
- `lib/bot/`: `engine.ts` (motor: candado, límites, vueltas de herramientas, traza y consumo), `tools/` (las 11 herramientas con Zod), `prompts/` (reglas fijas y armado del system prompt), `templates/` (texto por arquetipo), `catalog.ts`, `test-chat.ts` (cliente ficticio del chat de prueba), `usage.ts`.
- `lib/integrations/anthropic/`: cliente de Claude detrás de la interfaz `BotModel` (y `ImageDescriber` con Haiku); los tests usan un modelo con guion (`tests/helpers/bot.ts`).
- `lib/integrations/whatsapp/`: Graph API oficial (`graph.ts`), envíos y medios (`client.ts`, interfaz `WhatsAppApi`), firma y lectura del webhook (`webhook.ts`), alta embebida (`signup.ts`), plantillas (`templates.ts`). `lib/integrations/transcriber/`: OpenAI o ElevenLabs.
- `lib/whatsapp/`: lo que hace la app con WhatsApp: eventos entrantes (`inbound.ts`, con dependencias inyectables `WhatsAppDeps`), envío (`outbound.ts`), botones/listas/ventana de 24 h (`messages.ts`), bandeja (`inbox.ts`, `panel.ts`), conexión (`connection.ts`), armado real desde el entorno (`deps.ts`) y los handlers de las rutas.
- `lib/booking/customer-messages.ts`: lo que dispara cada cambio de turno (recordatorios y mensajes al cliente en `scheduled_messages`, avisos al equipo). `lib/whatsapp/scheduled.ts`: los manda (ventana abierta → texto/botones; cerrada → plantilla) y atiende los botones del recordatorio.
- `lib/notifications/`: `types.ts` (catálogo de avisos, canales por defecto, textos), `dispatch.ts` (`notify` y `deliverPendingNotifications`, con canales inyectables `DeliveryDeps`), `inbox.ts` (bandeja y preferencias), `summaries.ts` (resumen diario y semanal, correos de alta incompleta), `deps.ts` (canales reales y `flushSoon`), `cron.ts` (trabajo de los crons). `lib/integrations/webpush/`, `lib/integrations/resend/webhook.ts`.
- `lib/payments/`: señas. `deposits.ts` (cuánto, pura), `mercadopago.ts` (conexión, token, link de pago, `applyPayment`, devoluciones, `expireHolds`, con dependencias inyectables `PaymentDeps`), `deps.ts` (armado real), rutas de OAuth y webhook. `lib/integrations/mercadopago/`: API oficial (`api.ts`, interfaz `MercadoPagoApi`) y firma del webhook (`webhook.ts`).
- `lib/billing/`: planes y límites (`plans.ts`, el único lugar donde viven), estado de la cuenta (`state.ts`, pura: prueba, activo, gracia, solo lectura), lo que preguntan acciones y crons (`access.ts`: `readOnlyFailure`, `staffLimitFailure`, `monthUsage`), Stripe (`stripe.ts`: Checkout, portal, webhook, con dependencias inyectables `BillingDeps`; `deps.ts` real), cron (`lifecycle.ts`: fin de prueba, avisos de uso, reactivaciones). `lib/integrations/stripe/`: API (`api.ts`) y firma (`webhook.ts`). Las acciones que cambian datos llaman a `readOnlyFailure(tenant.db)`.
- `lib/booking/follow-ups.ts`: reactivación de clientes y pedido de reseñas (encolan en `scheduled_messages`). `lib/stats.ts`: estadísticas del mes. `lib/privacy.ts`: borrado de mensajes viejos.
- `app/(marketing)/`: landing, precios, términos, privacidad (`components/marketing/`). `components/billing/`: tarjetas de planes, medidor de uso, aviso del panel y "viene con el plan…".
- `lib/booking/waitlist.ts`: lista de espera (oferta del lugar liberado desde `onBookingChange`, botón "Lo quiero" → `acceptWaitlistOffer`, "ya fue tomado" al resto).
- `emails/`: React Email (`layout.tsx` base, `render.ts`).
- `lib/crypto.ts`: AES-256-GCM para tokens. `lib/db/scoped.ts` → `forPlatform` para las únicas búsquedas entre negocios (webhook y crons).
- `lib/catalog.ts` (servicios, profesionales, horarios), `lib/onboarding/` (plantillas y pasos), `lib/forms.ts` (esquemas Zod y `ActionResult`), `lib/time.ts`, `lib/money.ts`, `lib/phone.ts`.
- `components/chat/test-chat.tsx` (chat de prueba de `/app/bot`), `components/conversations/thread-view.tsx` (hilo de la bandeja), `components/whatsapp/connect-button.tsx` (alta embebida).
- `components/agenda/` (vistas Día, Semana y Lista, hojas de turno y bloqueo), `components/forms/`.
- PWA: `app/manifest.ts`, `public/sw.js` (solo página sin conexión), `public/icons/`.
- `tests/unit/`: tests; `tests/helpers/db.ts` levanta Postgres en memoria con las migraciones reales.
