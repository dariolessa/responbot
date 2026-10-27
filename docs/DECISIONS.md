# Decisiones

Decisiones que el SPEC no define, tomadas con el criterio "la opción más simple". Todas se pueden cambiar.

## Fase 0

| Tema | Decisión | Motivo |
| --- | --- | --- |
| Versión de Next.js | Next.js 16. El "middleware" se llama `proxy.ts` en esta versión. | Es la versión actual de `create-next-app`. |
| Cache Components | Desactivado (`cacheComponents` fuera de `next.config.ts`). | El panel lee sesión en cada página; con Cache Components habría que envolver cada lectura en `<Suspense>`. Se puede activar más adelante. |
| shadcn/ui | Componentes del registro `new-york-v4` copiados a `components/ui`, con colores zinc y acento esmeralda en `app/globals.css`. Se quitaron las sombras de botones, inputs y tarjetas; botones e inputs miden 44 px en celular. | El CLI de shadcn no pudo descargar el registro desde este entorno; el resultado es el mismo. `components.json` queda listo para `pnpm dlx shadcn add`. |
| Variables de entorno | Obligatorias solo las que usa la Fase 0 (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `ENCRYPTION_KEY`, `CRON_SECRET`). Las demás están declaradas pero opcionales hasta su fase. `AUTH_URL` es opcional (Vercel la infiere). | Poder desplegar la Fase 0 sin tener todavía cuentas de Meta, Stripe o Mercado Pago. |
| Cuándo se valida el entorno | Al arrancar el servidor (`instrumentation.ts`) y al importar `lib/env.ts`. No durante `next build` ni con `SKIP_ENV_VALIDATION=1`. | El build no necesita secretos; un deploy sin variables falla al arrancar con un mensaje claro. |
| Driver de base | `drizzle-orm/neon-serverless` (WebSocket). Con `DATABASE_URL` en `localhost` usa `node-postgres`. `drizzle-kit` usa `pg`. | El driver serverless soporta transacciones (las necesitan las reservas); `pg` local permite desarrollar sin Neon. |
| Migraciones | En `lib/db/migrations`. La extensión `btree_gist` y la restricción `bookings_no_overlap` están escritas a mano en `0000_init.sql`. | Drizzle no expresa restricciones de exclusión. |
| Exclusión de turnos | Por `resource_id` sobre `tstzrange(starts_at, ends_at, '[)')`, ignorando `cancelled` y `expired`. Turnos contiguos (uno termina 10:30, otro empieza 10:30) se permiten. `no_show` y `completed` siguen ocupando el horario. | Es lo que pide el SPEC; el buffer se aplica en el cálculo de disponibilidad, no en la base. |
| IDs | UUID en todas las tablas, incluida `users`. | El SPEC pide UUID para las tablas de negocio; se unifica. |
| Moneda | El negocio tiene `currency`; `bookings` y `payments` copian la moneda. Servicios, reglas y recursos usan la del negocio. | Que el histórico no cambie si el negocio cambia de moneda. |
| Columnas extra | `users.last_business_id` (negocio activo y "último usado"), `invitations.invited_by`, `bookings.currency`, `payments.currency`, `notifications.business_id`, `notification_prefs.business_id`. | Necesarias para el selector, el texto de la invitación y el aislamiento. |
| `push_subscriptions` | Sin `business_id`: es por dispositivo del usuario. | Un mismo celular recibe avisos de todos sus negocios. |
| Valores de enums no definidos | `booking_source`: whatsapp, panel, test_chat. `deposit_status`: none, pending, paid, refunded. `actor_type`: user, customer, bot, system. `channel`: panel, whatsapp, system. `waitlist_status`: waiting, offered, booked, cancelled, expired. `scheduled_kind`: reminder_24h, reminder_2h, reactivation, waitlist_offer, post_service. `plan`: trial, basic, pro, team. | Lo mínimo para cubrir los flujos del SPEC. |
| `working_hours.weekday` | 0 = domingo … 6 = sábado. | Igual que `Date#getDay` y date-fns. |
| Negocio activo | Se guarda en `users.last_business_id` (no en una cookie). Si no es válido, se usa el primero alfabéticamente. | Un solo lugar; sirve también para "entrar al último negocio usado". |
| Protección de rutas | `proxy.ts` solo mira si hay cookie de sesión (sin tocar la base). La validación real (sesión vigente, membresía activa, negocio) está en `getTenant()`, que llaman el layout del panel y cada página. | Recomendación de Next.js: el proxy hace chequeos optimistas, no es la barrera de seguridad. |
| Invitaciones | Se aceptan al entrar (en `/app` o `/onboarding`) si hay una invitación vigente para el email de la cuenta, sin importar mayúsculas. Si el usuario ya era miembro, se reactiva con el rol de la invitación. | Es el paso 3 del flujo de entrada del SPEC. |
| Vinculación de cuentas | `allowDangerousEmailAccountLinking` en Google: si alguien entró primero con enlace mágico y después con Google, se vincula. | Google verifica el email; evita el error "OAuthAccountNotLinked". |
| Correo del enlace mágico | HTML simple en `emails/magic-link.ts`, enviado con el SDK de Resend. | React Email llega con el resto de los correos en la Fase 4. |
| Onboarding | Solo el paso 1 (nombre, rubro, zona horaria, moneda). Solo el rubro "servicios" está habilitado. Crea el negocio con prueba de 14 días, el dueño, `booking_rules` y `bot_settings` por defecto. | Lo mínimo para entrar al panel; el resto del asistente es Fase 1. |
| Permisos de `staff` | Ve Agenda, Conversaciones, Clientes, Notificaciones y Configuración (su cuenta). Servicios, Equipo, Estadísticas y Bot son de dueño y admin; Facturación solo del dueño. | Lectura directa de la tabla de roles del SPEC. |
| 403 | `forbidden()` de Next.js (opción experimental `authInterrupts`) con `app/forbidden.tsx`. | Responde 403 con una pantalla clara. |
| Encabezados de seguridad | HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. La CSP queda para cuando estén los scripts de Meta (Embedded Signup) y Mercado Pago. | Una CSP escrita ahora habría que rehacerla en la Fase 3. |
| Tests | Vitest con PGlite (Postgres en WebAssembly con `btree_gist`) y las migraciones reales. | Corren sin Docker ni Neon, en local y en CI. |
| Crons | Las cuatro rutas validan `Authorization: Bearer CRON_SECRET` (comparación en tiempo constante) y responden 200; `maxDuration` 60 s. | Lo que pide la Fase 0. |
| Nombre y logo | El producto se llama **Responbot** (logo que mandó Dario y nombre del repo). El nombre vive en `lib/brand.ts`; el SPEC sigue diciendo "Agendabot" como nombre provisorio. El isotipo (globo de chat con el robot) está redibujado en SVG (`public/brand/responbot-mark.svg`, `components/layout/logo.tsx`, `app/icon.svg`) porque el PNG original trae un fondo negro con brillo; el original queda en `public/brand/`. | Un SVG se ve nítido en el favicon y en claro y oscuro. Si hay un SVG oficial, se reemplaza ese archivo. |
| Verde de marca vs. acento | El verde del logo (#02A82F) se usa solo en la marca; el acento de la interfaz sigue siendo esmeralda, como pide el SPEC. | Son tonos cercanos y el esmeralda de Tailwind ya tiene sus variantes para claro y oscuro con contraste AA. |

## Fase 1

| Tema | Decisión | Motivo |
| --- | --- | --- |
| Rubro del negocio | Se guarda en `businesses.category` (peluquería, barbería, uñas, estética u otro). | Sirve para elegir plantillas y, más adelante, el tono del bot. |
| Pasos del onboarding | `businesses.onboarding_completed` (lista de pasos hechos). Los pasos de WhatsApp, Mercado Pago y "probar el bot" se muestran como "Muy pronto" y no bloquean. La agenda muestra una tarjeta con lo que falta. | Se puede retomar en cualquier momento sin tablas nuevas. |
| Plantillas de servicios | Precios de referencia en pesos uruguayos; con otra moneda se precargan nombre y duración y el precio queda vacío. | Uruguay primero; un precio convertido sería inventado. |
| Invitación con profesional | `invitations.resource_id`: al aceptar, la columna de la agenda queda vinculada a esa cuenta. | Así un profesional invitado ve su propia columna desde el primer ingreso. |
| Turnos desde el panel | Ignoran anticipación mínima y días máximos, pero no se pueden superponer ni caer en un bloqueo. Fuera del horario laboral se permiten (se muestran todos los horarios libres del día). | El dueño necesita excepciones; superponer turnos nunca es correcto. |
| Buffer | Se suma al final de cada turno al calcular disponibilidad; los bloqueos no llevan buffer. | Es el tiempo de limpieza después de atender. |
| Estado inicial de turnos manuales | `confirmed`, sin seña. La seña llega con Mercado Pago en la Fase 5. | No hay cobros en esta fase. |
| Transiciones | `pending_payment` también puede pasar a `cancelled`. | Que el dueño pueda anular un turno sin esperar al vencimiento. |
| Cancelados | Solo aparecen en la vista Lista; en Día y Semana liberan el lugar. | Que la grilla muestre lo que ocupa tiempo. |
| Arrastrar turnos | Con mouse en la vista Día. En celular se reprograma desde el detalle del turno. | Arrastrar con el dedo choca con el scroll. |
| "Cualquiera disponible" | Toma el primer profesional libre, por orden alfabético. | Simple y predecible; el reparto equitativo puede venir después. |
| Formularios | `useState` + server actions + Zod en el servidor, sin react-hook-form. | Formularios chicos; una dependencia menos. |
| Clientes que ve un profesional | Los que tienen al menos un turno en su columna. | Lectura directa de "ve solo su agenda y sus clientes". |
| Rol de dueño | No se cambia desde el panel (ni se quita ni se asigna). | Transferir la propiedad es un flujo aparte, con facturación de por medio. |
| Logo del negocio | Queda para más adelante. | Necesita Vercel Blob, que todavía no está configurado. |
| PWA | Manifest, íconos y un service worker que solo muestra una página sin conexión; no guarda datos en caché. Se registra solo en producción. | Instalable sin el riesgo de mostrar una agenda vieja. |
| Fechas | `date-fns` y `date-fns-tz`; los horarios laborales son hora local del negocio y se convierten a UTC al calcular. | Lo que pide el SPEC. |
