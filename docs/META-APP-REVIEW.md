# App Review de Meta

Cómo dejar Responbot listo para que Meta revise la app **Responbot** (ID `2258883904957696`) y apruebe los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

## Lo que ven los revisores

| Qué | URL |
| --- | --- |
| Sitio | https://responbot.com |
| Login | https://responbot.com/login → "Entrar con email y contraseña" (con `?password=1` el formulario ya aparece abierto) |
| Política de privacidad | https://responbot.com/privacidad |
| Términos | https://responbot.com/terminos |
| Eliminación de datos (callback) | `POST https://responbot.com/api/meta/data-deletion` |
| Estado de un pedido de eliminación | https://responbot.com/eliminacion-datos?code=XXX |
| Ícono para subir a Meta | `public/brand/responbot-icon-1024.png` (1024×1024, fondo transparente) |

Las páginas legales se generan en el servidor (estáticas): el texto está en el HTML sin JavaScript.

## 1. Migración

Esta versión agrega la migración `0010_meta_app_review` (`users.password_hash`, `whatsapp_accounts.meta_user_id` y la tabla `data_deletion_requests`). Aplicala en la base de producción **antes** de desplegar:

```bash
DATABASE_URL='<url de Neon de producción>' pnpm db:migrate
```

## 2. Cuenta de prueba

`pnpm seed:reviewer` (`scripts/seed-meta-reviewer.ts` → `lib/pilots/reviewer.ts`) crea o actualiza:

- El usuario **reviewer@responbot.com** con la contraseña de `META_REVIEWER_PASSWORD` (mínimo 12 caracteres). En la base queda solo el hash (scrypt); la contraseña no está en el repo ni hace falta en Vercel.
- El negocio **Peluquería Demo** (Montevideo, pesos uruguayos): 8 servicios con precio y duración, dos profesionales (Carla y Sofía) de lunes a viernes de 9 a 19 y sábados de 9 a 14, tres turnos tomados en los próximos días (el resto de los 14 días queda libre) y tres conversaciones de ejemplo en Conversaciones.
- Todo habilitado sin pagar: el negocio queda como **piloto por 10 años** (plan Equipo, sin prueba que venza, sin pedir tarjeta).
- El alta queda completa salvo "Conectar WhatsApp", que es lo que prueban los revisores.

Es idempotente: se puede volver a correr para cambiar la contraseña o para renovar los turnos de ejemplo si ya pasaron.

Contra producción, desde tu máquina, con el repo clonado y `pnpm install` hecho:

```bash
DATABASE_URL='<url de Neon de producción>' META_REVIEWER_PASSWORD='<la contraseña>' pnpm seed:reviewer
```

(La URL de Neon está en Vercel → Settings → Environment Variables → `DATABASE_URL`, o en el panel de Neon. Las variables que pasás en la línea de comandos ganan sobre las de `.env.local`.)

Los clientes de las conversaciones de ejemplo tienen números ficticios: si un revisor les responde a mano con WhatsApp conectado, Meta lo rechaza. Para probar la respuesta manual, que escriban primero desde un teléfono real.

## 3. Flujo que prueban

1. Login con la cuenta de prueba → Agenda. El panel muestra "Terminá de configurar tu negocio" con el paso **Conectar WhatsApp**.
2. Configuración → WhatsApp → elegir el tipo de número → **Conectar WhatsApp**: abre el registro integrado de Meta (`FB.login` con `config_id` = `META_CONFIG_ID`, `response_type: code`).
3. Al volver, el servidor (`lib/integrations/whatsapp/signup.ts`):
   - canjea el código por el token del negocio;
   - suscribe la app a los webhooks de la WABA (`POST /{waba_id}/subscribed_apps`);
   - registra el número en Cloud API con un PIN propio (`POST /{phone_number_id}/register`), salvo en coexistencia;
   - lee el número visible y el nombre verificado, y pide las plantillas.
4. Configuración muestra, leídos en vivo de la Graph API: nombre de la cuenta de WhatsApp Business, número, nombre visible y su estado de revisión, estado del número y calidad (`lib/integrations/whatsapp/account-info.ts`).
5. Un cliente escribe al número → `POST /api/webhooks/whatsapp` (firma `X-Hub-Signature-256`) → el bot responde, ofrece turnos libres y agenda (`lib/whatsapp/inbound.ts`, `lib/bot/engine.ts`).
6. La conversación aparece en Conversaciones; el dueño puede tocar "Tomar conversación" y responder a mano (`sendReplyAction` → Cloud API).

## 4. Eliminación de datos

En la app de Meta → Configuración → Básica → **Eliminación de datos de usuario** → "URL de devolución de llamada": `https://responbot.com/api/meta/data-deletion`.

- Acepta `POST` con `signed_request` (form o JSON) y lo valida con `META_APP_SECRET` (HMAC-SHA256).
- Busca las conexiones de WhatsApp hechas por ese `user_id` (guardado en `whatsapp_accounts.meta_user_id` al conectar, a partir de `authResponse.userID` del SDK), desuscribe la app de esa WABA, y borra la conexión (token, PIN, ids) y las conversaciones de WhatsApp del negocio. La agenda (turnos y fichas) queda: es de la cuenta de Responbot y se borra a pedido por correo.
- Registra el pedido en `data_deletion_requests` y responde `{ "url": "https://responbot.com/eliminacion-datos?code=XXX", "confirmation_code": "XXX" }`.
- `/eliminacion-datos?code=XXX` muestra el estado. La dirección vieja `/eliminacion-de-datos?codigo=…` redirige ahí.

Las conexiones hechas antes de esta versión no tienen `meta_user_id`: un pedido de esas personas queda registrado como "sin datos asociados". Si hace falta, se borran a mano desconectando WhatsApp.

## 5. Texto para "Instrucciones para revisores" (en inglés)

> Responbot (a trade name of AppsGuru, LLC) gives small businesses (hair salons, barbershops, real estate agencies) an AI WhatsApp assistant that answers customers, offers free appointment slots and books them in the business's calendar.
>
> 1. Go to https://responbot.com/login?password=1 and sign in with email `reviewer@responbot.com` and the password provided below ("Entrar con email y contraseña"). This test account has every feature enabled; no payment is required.
> 2. You land on the calendar (Agenda) of the demo business "Peluquería Demo". Click "Configuración" in the left menu, scroll to "WhatsApp", choose "Un número nuevo solo para el bot" and click "Conectar WhatsApp". This opens Meta's Embedded Signup.
> 3. Complete Embedded Signup with your test WhatsApp Business Account and phone number. When it finishes, Responbot subscribes the app to the WABA webhooks (whatsapp_business_management), registers the number, and the WhatsApp section shows the connected WhatsApp Business Account name, phone number, display name, status and quality rating, read from the Graph API.
> 4. From another phone, send a WhatsApp message to the connected number (for example "Hola, quiero un turno para corte"). The assistant replies, offers free time slots and books the appointment (whatsapp_business_messaging). The appointment appears in "Agenda".
> 5. Open "Conversaciones": the conversation is listed. Open it, click "Tomar conversación" and type a manual reply; it is sent to the customer through the WhatsApp Cloud API.
>
> Privacy policy: https://responbot.com/privacidad — Terms: https://responbot.com/terminos — Data deletion: https://responbot.com/eliminacion-datos

## 6. Variables de entorno

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `META_APP_ID` | Vercel | `2258883904957696` |
| `META_APP_SECRET` | Vercel | Firma de webhooks y del `signed_request` de eliminación de datos |
| `META_CONFIG_ID` | Vercel | `883379298200873` (configuración del registro integrado) |
| `AUTH_URL` | Vercel (recomendado) | `https://responbot.com`: así las URLs que devuelve el callback de eliminación usan ese dominio |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Vercel (opcional) | Contacto en legales y footer; si falta, `soporte@responbot.com` |
| `NEXT_PUBLIC_LEGAL_NAME` | Vercel (opcional) | Si falta, `AppsGuru, LLC` |
| `META_REVIEWER_PASSWORD` | Solo donde corrés el seed | Contraseña de reviewer@responbot.com |
