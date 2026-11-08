# Configurar WhatsApp (Meta)

Lo que hay que hacer una sola vez en Meta y en Vercel para que los negocios conecten su número desde **Configuración → Conexiones → Conectar WhatsApp**. Todo usa la API oficial de WhatsApp Cloud; no hay librerías no oficiales.

Mientras falten estas variables, el panel muestra WhatsApp como "Muy pronto" y el resto de la app funciona igual.

## 1. App de Meta

1. En [developers.facebook.com](https://developers.facebook.com/apps) creá una app del tipo **Business**, asociada al Business Manager de la empresa (tiene que estar verificada).
2. Agregá los productos **WhatsApp** y **Facebook Login for Business**.
3. En **Configuración de la app → Básica**: dominio de la app, URL de política de privacidad y de términos, y en **Eliminación de datos** la URL de devolución de llamada `https://<dominio>/api/meta/data-deletion` (detalles en [META-APP-REVIEW.md](META-APP-REVIEW.md)).
4. Anotá el **ID de la app** (`META_APP_ID`) y la **clave secreta** (`META_APP_SECRET`).

## 2. Alta embebida (Embedded Signup)

1. Registrate como **Tech Provider** (WhatsApp → Primeros pasos) para poder usar el alta embebida con números de otros negocios.
2. En **Facebook Login for Business → Configuraciones**, creá una configuración con la variante **WhatsApp Embedded Signup**, token de usuario del sistema de integración comercial y los permisos `whatsapp_business_management` y `whatsapp_business_messaging`. Su ID es `META_CONFIG_ID`.
3. En **Facebook Login for Business → Configuración**, activá "Iniciar sesión con el SDK para JavaScript" y agregá `https://<dominio>` (y `http://localhost:3000` si probás en local) en "Dominios permitidos para el SDK para JavaScript".

## 3. Webhook

1. En **WhatsApp → Configuración**, URL de devolución de llamada: `https://<dominio>/api/webhooks/whatsapp`.
2. Token de verificación: una frase larga que elijas vos; es `WHATSAPP_VERIFY_TOKEN`.
3. Suscribí los campos **messages**, **account_update** y, para la coexistencia (sección 7), **smb_message_echoes**, **history** y **smb_app_state_sync**. Sin esos tres un número compartido con la app funciona igual, pero el bot no se entera cuando el dueño responde desde el celular y le pisa la charla.

Cada negocio que se conecta suscribe la app a su propia cuenta de WhatsApp Business automáticamente; no hay que hacer nada por negocio.

## 4. Variables en Vercel

| Variable | Valor |
| --- | --- |
| `META_APP_ID` | ID de la app |
| `META_APP_SECRET` | Clave secreta de la app (firma de los webhooks) |
| `META_CONFIG_ID` | ID de la configuración del alta embebida |
| `WHATSAPP_VERIFY_TOKEN` | La frase del paso 3 |
| `WHATSAPP_API_VERSION` | Opcional, por defecto `v23.0` |
| `ANTHROPIC_API_KEY` | Para que el bot responda. Sin ella, los mensajes quedan en Conversaciones para una persona |
| `TRANSCRIBER_PROVIDER`, `TRANSCRIBER_API_KEY` | `openai` o `elevenlabs` y su clave, para entender audios |

`ENCRYPTION_KEY` ya existe desde la Fase 0: con ella se cifran los tokens de cada negocio. Si se cambia, hay que volver a conectar los números.

## 5. Revisión de Meta

Para salir del modo de desarrollo, Meta pide revisar la app con los permisos `whatsapp_business_management` y `whatsapp_business_messaging` y un video del flujo: conectar un número desde Configuración, recibir un mensaje y que el bot responda (se ve en Conversaciones). Mientras tanto se puede probar con el número de prueba de Meta y cuentas agregadas como testers.

## 6. Plantillas

Al conectar un número, Responbot manda a revisión las diez plantillas: las siete del SPEC (recordatorio, confirmación, cancelación, lugar liberado, reactivación, resumen diario y aviso de derivación) y tres que sumó la Fase 4 (recordatorio corto del mismo día, aviso de reserva nueva y aviso de turno cancelado o movido para el equipo). Su estado se ve en Configuración y se pueden reenviar con "Enviar a revisión de Meta": si conectaste el número antes de la Fase 4, tocá ese botón para mandar las tres nuevas. Mientras una plantilla no esté aprobada, ese mensaje solo sale si el cliente escribió en las últimas 24 horas (como texto o botones normales).

## 7. Mismo número en el celular (coexistencia)

Meta deja que un número siga andando en la **app WhatsApp Business** del celular y, a la vez, en Cloud API. En Configuración → Conexiones → WhatsApp el dueño elige:

- **Mi número de WhatsApp Business**: coexistencia. El alta embebida se abre con `featureType: "whatsapp_business_app_onboarding"`; el dueño escanea un código QR desde la app y Meta termina con el evento `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`.
- **Un número nuevo solo para el bot**: el alta de siempre. El número deja de poder usarse en la app.

### Qué hace Responbot

- **No registra el número** con PIN (`/register`): en coexistencia Meta no lo permite. Si el popup no trae el `phone_number_id`, se busca en `GET /<waba_id>/phone_numbers`.
- Apenas se conecta, pide a Meta **los contactos y el historial** de la app (`POST /<phone_number_id>/smb_app_data` con `sync_type` `smb_app_state_sync` y después `history`). Meta lo acepta una sola vez y solo en las **24 horas** siguientes al alta; si un pedido falla, Configuración muestra "Volver a pedir" dentro de ese plazo. Para repetirlo después hay que desconectar y volver a conectar.
- **Historial** (webhook `history`): los chats de hasta 6 meses que el dueño aceptó compartir se guardan en Conversaciones, sin respuesta del bot ni "sin leer". Los grupos se ignoran. Si el dueño no lo compartió (error `2593109`), Configuración lo dice y sigue todo igual.
- **Contactos** (webhook `smb_app_state_sync`): los nuevos pasan a Clientes con su nombre; a un cliente sin nombre se le completa. Un contacto borrado en el celular no se borra de Responbot.
- **Respuestas desde el celular** (webhook `smb_message_echoes`): se guardan en la conversación como "Desde el celular" y el bot deja de responderle a ese cliente por **12 horas** (`PHONE_PAUSE_HOURS` en `lib/whatsapp/coexistence.ts`). Pasado ese tiempo, el próximo mensaje del cliente vuelve al bot. Si la conversación la tomó alguien desde el panel, sigue tomada sin vencimiento.
- Si el dueño desconecta Responbot desde la app, llega `account_update` con `PARTNER_REMOVED` y el número queda "Desconectado".

### Qué tenés que configurar en Meta

1. En el webhook (sección 3), suscribí `smb_message_echoes`, `history` y `smb_app_state_sync`.
2. La configuración del alta embebida (`META_CONFIG_ID`) tiene que ser nueva: Meta dejó de lado las versiones 2 y 3 del alta embebida y la versión sale de la configuración, no del código. Si la creaste antes de mediados de octubre de 2026, creá otra y cambiá `META_CONFIG_ID`.
3. En la revisión de la app (sección 5), sumá al video el flujo con "Mi número de WhatsApp Business".

### Límites que pone Meta (revisalos en su documentación antes de lanzar)

Este resumen sale de la documentación de Meta y de integraciones de terceros; no se pudo verificar contra la página oficial desde el entorno de desarrollo, así que confirmalo en [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/):

- Solo la app **WhatsApp Business**, actualizada (no el WhatsApp común).
- Hay países donde Meta no la ofrece todavía; revisá que Uruguay y los países de los pilotos estén incluidos.
- El dueño tiene que abrir la app al menos una vez cada 14 días para que la conexión siga.
- Con el número compartido, la app deja de tener algunas funciones (por ejemplo mensajes temporales y de una sola vista, y las listas de difusión quedan solo de lectura) y el número queda limitado a unos 20 mensajes por segundo por API.
- Lo que el dueño manda desde la app es gratis; lo que manda el bot se cobra como siempre. Lo que manda desde la app no abre ni alarga la ventana de 24 horas.

## Probar sin Meta

- El **chat de prueba** de `/app/bot` usa el mismo motor y muestra las opciones como botones.
- Los tests (`pnpm test`, archivos `tests/unit/whatsapp.test.ts` y `tests/unit/coexistence.test.ts`) simulan a Meta de punta a punta: webhook firmado, audios, imágenes, botones, estados y la bandeja.
- En local, con las variables cargadas, se puede mandar un evento firmado:

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"<phone_number_id conectado>"},"contacts":[{"wa_id":"59899111222","profile":{"name":"Lucía"}}],"messages":[{"from":"59899111222","id":"wamid.prueba.1","timestamp":"1793624400","type":"text","text":{"body":"Hola"}}]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | awk '{print $2}')"
curl -X POST localhost:3000/api/webhooks/whatsapp -H "x-hub-signature-256: $SIG" -H 'content-type: application/json' --data "$BODY"
```
