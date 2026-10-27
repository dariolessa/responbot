# Catálogo desde la web

El negocio pega la dirección de su web (el listado de propiedades o productos, o una ficha) en **Catálogo**. Responbot la lee, arma una ficha por publicación (título, precio, operación, zona, datos clave, fotos y link) y el bot las usa para responder "¿qué tienen en Pocitos hasta US$ 150.000?" mandando 2 o 3 fichas con foto por WhatsApp y ofreciendo coordinar una visita.

Pensado para inmobiliarias, pero sirve para cualquier negocio que publique un catálogo (autos, muebles, productos).

## Cómo funciona

1. **Lectura** (`lib/integrations/web/fetch.ts`): descarga la página con un lector propio (`ResponbotCatalog`), solo http/https públicos (bloquea IPs internas y revisa cada redirección), hasta 3 MB y 15 s.
2. **Resumen de la página** (`lib/listings/page.ts`): texto visible, links del mismo sitio, fotos candidatas (sin logos ni íconos, la versión más grande de cada `srcset`) y JSON-LD.
3. **Extracción** (`lib/listings/extract.ts`): Claude Haiku devuelve las publicaciones y, si es un listado, los links a cada ficha. Se valida con Zod; links y fotos que no están en la página se descartan.
4. **Fichas** (`lib/listings/import.ts`): abre hasta 30 fichas por fuente (4 a la vez), combina sus datos con los del listado y guarda. Lo nuevo se crea, lo que cambió se actualiza (salvo lo editado a mano en el panel) y lo que ya no aparece queda "no se ofrece".
5. **Reimportación**: cron `/api/cron/catalog-import` cada hora; lee hasta 6 fuentes que no se leyeron en las últimas 20 horas. También hay un botón "Volver a leer".
6. **Bot** (`lib/bot/tools/listings.ts`): `search_catalog` (palabras y precio, sin tildes ni plurales) y `send_catalog_items` (hasta 3). Las fichas salen como mensajes de imagen con epígrafe antes de la respuesta. El prompt suma una sección "Catálogo" solo si el negocio tiene publicaciones.
7. **WhatsApp**: imagen por link (`type: image`). Si WhatsApp no puede bajar la foto, se manda el mismo texto sin foto.

## Instagram y MercadoLibre

No se leen como una web: Instagram exige iniciar sesión y bloquea lectores automáticos, y sus términos lo prohíben; MercadoLibre también bloquea y cambia sus páginas. Si el negocio pega una de esas direcciones, queda guardada con el aviso "hay que conectar la cuenta (próximamente)".

La forma estable es la API oficial de cada uno, con el negocio conectando su cuenta:

- **MercadoLibre**: OAuth del vendedor (igual que Mercado Pago), `GET /users/{id}/items/search` y `GET /items?ids=…` traen título, precio, moneda, atributos, fotos y link. Hay que crear una app en developers.mercadolibre.com y pedir el permiso de lectura de publicaciones.
- **Instagram**: "Iniciar sesión con Instagram" (cuenta profesional), `GET /me/media` trae foto y texto de cada publicación; el texto se pasa por el mismo extractor. Requiere la revisión de la app de Meta (permiso `instagram_business_basic`).

## Costos y límites

- Hasta 10 fuentes por negocio y 30 fichas por fuente en cada lectura. Cada lectura diaria hace hasta 31 llamadas a Haiku por fuente.
- Las fotos no se copian: se usan los links de la web del negocio (WhatsApp las descarga al enviar). Si la web las borra, sale la ficha sin foto.
- Webs que arman todo con JavaScript sin HTML de base pueden no leerse bien; para esas está la carga a mano.

## Variables

Ninguna nueva: usa `ANTHROPIC_API_KEY` y `CRON_SECRET`.
