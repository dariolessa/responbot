# Configurar WhatsApp (Meta)

Lo que hay que hacer una sola vez en Meta y en Vercel para que los negocios conecten su número desde **Configuración → Conexiones → Conectar WhatsApp**. Todo usa la API oficial de WhatsApp Cloud; no hay librerías no oficiales.

Mientras falten estas variables, el panel muestra WhatsApp como "Muy pronto" y el resto de la app funciona igual.

## 1. App de Meta

1. En [developers.facebook.com](https://developers.facebook.com/apps) creá una app del tipo **Business**, asociada al Business Manager de la empresa (tiene que estar verificada).
2. Agregá los productos **WhatsApp** y **Facebook Login for Business**.
3. En **Configuración de la app → Básica**: dominio de la app, URL de política de privacidad y de términos, y en **Eliminación de datos** la URL de devolución de llamada `https://<dominio>/api/meta/data-deletion`.
4. Anotá el **ID de la app** (`META_APP_ID`) y la **clave secreta** (`META_APP_SECRET`).

## 2. Alta embebida (Embedded Signup)

1. Registrate como **Tech Provider** (WhatsApp → Primeros pasos) para poder usar el alta embebida con números de otros negocios.
2. En **Facebook Login for Business → Configuraciones**, creá una configuración con la variante **WhatsApp Embedded Signup**, token de usuario del sistema de integración comercial y los permisos `whatsapp_business_management` y `whatsapp_business_messaging`. Su ID es `META_CONFIG_ID`.
3. En **Facebook Login for Business → Configuración**, activá "Iniciar sesión con el SDK para JavaScript" y agregá `https://<dominio>` (y `http://localhost:3000` si probás en local) en "Dominios permitidos para el SDK para JavaScript".

## 3. Webhook

1. En **WhatsApp → Configuración**, URL de devolución de llamada: `https://<dominio>/api/webhooks/whatsapp`.
2. Token de verificación: una frase larga que elijas vos; es `WHATSAPP_VERIFY_TOKEN`.
3. Suscribí los campos **messages** y **account_update**.

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

Al conectar un número, Responbot manda a revisión las siete plantillas del SPEC (recordatorio, confirmación, cancelación, lugar liberado, reactivación, resumen diario y aviso de derivación). Su estado se ve en Configuración y se pueden reenviar con "Enviar a revisión de Meta". Las usan los recordatorios y avisos de la Fase 4.

## Probar sin Meta

- El **chat de prueba** de `/app/bot` usa el mismo motor y muestra las opciones como botones.
- Los tests (`pnpm test`, archivo `tests/unit/whatsapp.test.ts`) simulan a Meta de punta a punta: webhook firmado, audios, imágenes, botones, estados y la bandeja.
- En local, con las variables cargadas, se puede mandar un evento firmado:

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"<phone_number_id conectado>"},"contacts":[{"wa_id":"59899111222","profile":{"name":"Lucía"}}],"messages":[{"from":"59899111222","id":"wamid.prueba.1","timestamp":"1793624400","type":"text","text":{"body":"Hola"}}]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | awk '{print $2}')"
curl -X POST localhost:3000/api/webhooks/whatsapp -H "x-hub-signature-256: $SIG" -H 'content-type: application/json' --data "$BODY"
```
