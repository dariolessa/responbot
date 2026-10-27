# Señas con Mercado Pago (Fase 5)

Qué hace la Fase 5 y qué hay que configurar. Sin las variables de Mercado Pago, Configuración lo muestra como "Muy pronto" y los turnos se confirman sin seña, como hasta ahora.

## Qué hace

- **Cada negocio conecta su propia cuenta** desde Configuración → Conexiones → "Conectar Mercado Pago" (OAuth oficial con PKCE). El dinero de las señas va directo a esa cuenta. Los tokens se guardan cifrados y se renuevan solos antes de vencer (Mercado Pago da 180 días); si la renovación falla, el dueño y los admins reciben el aviso "Mercado Pago desconectado" en el panel y por correo.
- **Cuánto se cobra:** en Reglas de reserva, seña fija o porcentaje; cada servicio puede tener la suya (o 0 para no pedir). Opcional: pedir la seña general a clientes con 1, 2 o 3 inasistencias aunque el servicio no la pida.
- **Retención:** un turno con seña queda "Pendiente de seña" durante el tiempo para pagar (15 minutos por defecto, configurable). El cliente recibe por WhatsApp el link de Checkout Pro y la hora límite. Al pagar, el turno se confirma, el cliente recibe la confirmación y el equipo ve "Seña pagada" en el panel.
- **Vencimiento:** el cron `expire-holds` (cada 5 minutos) primero le pregunta a Mercado Pago si hubo un pago (por si el aviso se perdió) y, si no, vence el turno, libera el horario y le avisa al cliente.
- **Reservas del bot por WhatsApp** piden seña siempre que corresponda. **Desde el panel** es opcional: "Pedir seña por Mercado Pago" en el turno nuevo. El chat de prueba no cobra señas.
- **Devoluciones:** si el cliente cancela con el bot dentro del plazo de la política, la seña se devuelve sola. Si cancela el equipo, al cancelar se elige "Devolver la seña" (viene marcado). En un turno cancelado con seña pagada hay un botón "Devolver seña" para dueño y admins, que avisa si la política dice que no corresponde. El cliente recibe un mensaje cuando se devolvió.
- **Pago tardío:** si alguien paga después del vencimiento y el horario sigue libre, el turno vuelve; si ya se ocupó, la seña se devuelve sola.
- **Lo que resta:** en el detalle de un turno con seña pagada se ve cuánto falta cobrar en el local.
- **Lista de espera:** cuando se libera un horario (cancelación, vencimiento o turno movido), se avisa por WhatsApp a los anotados de ese día, en orden de llegada (hasta 5 por lugar), con el botón "Lo quiero". El primero que lo toca se queda con el turno (con seña si corresponde) y al resto le llega "ya lo tomó otra persona; seguís en la lista".

## Qué tenés que configurar

### 1. La aplicación en Mercado Pago

1. Entrá a [Tus integraciones](https://www.mercadopago.com.uy/developers/panel/app) con la cuenta de Mercado Pago de la plataforma (la tuya, no la de un negocio) y creá una aplicación: solución **Pagos online**, producto **Checkout Pro**, y marcá que es una plataforma o marketplace que cobra en nombre de otros vendedores (para usar OAuth).
2. En la aplicación, **Editar → URLs de redireccionamiento**: agregá `https://<tu dominio>/api/integrations/mercadopago/callback` (y `http://localhost:3000/api/integrations/mercadopago/callback` si probás en local).
3. Copiá el **Client ID** (también llamado App ID) y el **Client Secret** de "Credenciales de producción".

### 2. Webhook de pagos

1. En la misma aplicación, **Webhooks → Configurar notificaciones**, modo productivo: URL `https://<tu dominio>/api/webhooks/mercadopago`, evento **Pagos**. Guardá.
2. Mercado Pago muestra una **clave secreta**: es `MP_WEBHOOK_SECRET`. Con ella se valida la firma `x-signature` de cada aviso.
3. Cada preferencia también manda su `notification_url` a esa misma ruta; los avisos repetidos no hacen nada dos veces.

### 3. Variables en Vercel

| Variable | Valor |
| --- | --- |
| `MP_CLIENT_ID` | Client ID de la aplicación |
| `MP_CLIENT_SECRET` | Client Secret de la aplicación |
| `MP_WEBHOOK_SECRET` | La clave secreta de los webhooks |

`AUTH_URL` (o el dominio de producción de Vercel) tiene que ser la URL pública: con ella se arman la redirección de OAuth y la URL del webhook. Redeployá después de cargarlas.

### 4. Plantillas de WhatsApp nuevas

Hay cuatro plantillas nuevas: `sena_pendiente` (link de pago), `retencion_vencida`, `sena_devuelta` y `lugar_tomado`. En Configuración → WhatsApp tocá "Enviar a revisión de Meta". Mientras no estén aprobadas, esos mensajes solo salen si el cliente escribió en las últimas 24 horas (que es lo normal cuando reserva con el bot).

### 5. Probar

- Mercado Pago no manda webhooks de pagos hechos con credenciales de prueba. Para probar de punta a punta usá [cuentas de prueba](https://www.mercadopago.com.uy/developers/es/docs/your-integrations/test/accounts): conectá con OAuth la cuenta de prueba "vendedor" y pagá con la cuenta de prueba "comprador". Si el webhook no llega, el cron `expire-holds` encuentra el pago igual al vencer la retención.
- Con la cuenta conectada, la sección muestra el email de la cuenta y "de prueba" si no es productiva.

## Qué queda para después

- El correo "Mercado Pago desconectado" usa el correo genérico de avisos; uno propio con más detalle puede venir después.
