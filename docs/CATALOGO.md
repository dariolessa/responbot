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

## MercadoLibre

Dos formas, las dos con la API oficial (`lib/integrations/mercadolibre/api.ts`, `lib/listings/mercadolibre.ts`). No se usa el modelo: MercadoLibre ya da los datos ordenados.

- **Pegar el link de la tienda** (por ejemplo `https://listado.mercadolibre.com.uy/pagina/puenterural/`). Se entiende `…/pagina/<tienda>`, `perfil.mercadolibre…/<APODO>`, `…/_CustId_<id>` y el link de una publicación suelta. Con el token de la app (`client_credentials`) se buscan las publicaciones activas del vendedor (`/sites/MLU/search?nickname=…`, después por `seller_id`), se traen con `/items?ids=…` (de a 20) y la descripción de las primeras 60. Hasta 150 publicaciones.
- **Conectar MercadoLibre** (botón en Catálogo): el vendedor autoriza con su cuenta (OAuth con PKCE) y se leen sus publicaciones activas con `/users/{id}/items/search`. El token dura 6 horas y se renueva solo con el refresh token. Sirve si MercadoLibre no deja buscar la tienda desde afuera (algunas cuentas o países lo restringen) o si la tienda tiene otro apodo.

Si el negocio ya había pegado el link y después conecta la cuenta, se completa esa misma fuente.

### Configurar la app (una sola vez, la hace Dario)

1. Entrá a https://developers.mercadolibre.com.uy/devcenter con la cuenta de MercadoLibre de la empresa y creá una aplicación ("Responbot").
2. **URI de redirect:** `https://responbot-phi.vercel.app/api/integrations/mercadolibre/callback`.
3. Activá **PKCE**. Permisos: lectura (`read`) y acceso sin conexión (`offline_access`). No hacen falta notificaciones.
4. Copiá el **App ID** y la **Secret Key** a Vercel (Production) como `ML_CLIENT_ID` y `ML_CLIENT_SECRET`, y volvé a desplegar.

## Instagram

Solo con **Conectar Instagram** (cuenta profesional: empresa o creador). Instagram no deja leer el perfil desde afuera, así que pegar el link solo guarda un aviso. Se usa "Instagram API con inicio de sesión de Instagram" (`lib/integrations/instagram/api.ts`, `lib/listings/instagram.ts`): token de 60 días que se renueva cuando le quedan menos de 10, lectura de las últimas 60 publicaciones (foto o carrusel y texto) y el mismo extractor con Claude Haiku, de a 15 posts, que arma una ficha por cada post que ofrece algo (ignora saludos o "vendida").

### Configurar la app (una sola vez)

1. En la app de Meta que ya usás para WhatsApp (developers.facebook.com), agregá el producto **Instagram** → "API con inicio de sesión de Instagram".
2. En "Configurar el inicio de sesión para empresas", poné como URL de redirección `https://responbot-phi.vercel.app/api/integrations/instagram/callback`.
3. Copiá el **ID de la app de Instagram** y su **clave secreta** (no son los de la app de Meta) a Vercel como `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`, y volvé a desplegar.
4. Mientras la app no pase la revisión, solo funciona con cuentas agregadas como **evaluadoras de Instagram** (Roles de la app); cada una acepta la invitación desde Instagram → Configuración → Apps y sitios web. Para que lo use cualquier negocio, pedí en la revisión de la app el permiso `instagram_business_basic` (con un video mostrando el botón Conectar Instagram y el catálogo).

## Costos y límites

- Hasta 10 fuentes por negocio y 30 fichas por fuente en cada lectura. Cada lectura diaria hace hasta 31 llamadas a Haiku por fuente.
- Las fotos no se copian: se usan los links de la web del negocio, de MercadoLibre o de Instagram (WhatsApp las descarga al enviar). Si el link deja de andar, sale la ficha sin foto. Los links de Instagram vencen a los pocos días; la lectura diaria los renueva.
- Webs que arman todo con JavaScript sin HTML de base pueden no leerse bien; para esas está la carga a mano.

## Variables

`ANTHROPIC_API_KEY` y `CRON_SECRET` (ya estaban); `ML_CLIENT_ID` y `ML_CLIENT_SECRET` para MercadoLibre; `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` para Instagram. Sin las de una plataforma, su botón no aparece y sus links quedan con el aviso "todavía no está habilitada". Los tokens de cada negocio se guardan cifrados con `ENCRYPTION_KEY`.
