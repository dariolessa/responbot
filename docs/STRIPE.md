# Planes, cobro con Stripe y crecimiento (Fase 6)

Qué hace la Fase 6 y qué hay que configurar. Sin las variables de Stripe, Facturación muestra los planes como "Muy pronto": la prueba de 14 días corre igual y, al vencer, el negocio queda sin poder reservar hasta que haya un plan (ver "Mientras Stripe no esté" abajo).

## Qué hace

- **Planes y límites** en `lib/billing/plans.ts` (el único lugar donde viven):

  | Plan | Precio (hipótesis) | Profesionales | Conversaciones/mes | Además |
  | --- | --- | --- | --- | --- |
  | Básico | US$ 19 | 1 | 300 | Bot, agenda, recordatorios, pedido de reseñas |
  | Pro | US$ 39 | 5 | 1.000 | Señas, lista de espera, ficha de clientes, estadísticas |
  | Equipo | US$ 79 | Sin límite | 3.000 | Reactivación automática, resumen semanal, soporte prioritario |

  La prueba incluye todo (como Equipo) con los límites de conversaciones del Pro. Los precios que se muestran salen de ese archivo; lo que se cobra es el precio de Stripe de cada plan.
- **Prueba de 14 días sin tarjeta.** Al vencer sin plan, el bot sigue respondiendo consultas pero no reserva (ni ofrece la lista de espera) y el panel queda en solo lectura: se puede mirar todo, contestar conversaciones y entrar a Facturación, pero no cargar turnos, clientes, servicios, equipo ni configuración. El dueño recibe un correo 3 días antes y otro el último día; el panel muestra el aviso.
- **Suscribirse:** Facturación → "Elegir Pro" abre Stripe Checkout. Si a la prueba le quedan más de 2 días, Stripe empieza a cobrar recién cuando termina (no se pierden días). Al volver, el webhook ya dejó el plan activo.
- **Cambiar de plan, tarjeta o cancelar:** "Cambiar plan, tarjeta o cancelar" abre el Customer Portal de Stripe. El cambio es inmediato con prorrateo; la cancelación rige al final del período.
- **Pago fallido:** el dueño recibe el aviso en el panel y por correo. Hay 7 días de gracia en los que todo funciona; después el panel queda en solo lectura y el bot no reserva hasta que se pague. Al cobrarse, vuelve todo solo.
- **Recibo:** con cada pago aprobado le llega al dueño un correo con el enlace a la factura de Stripe.
- **Uso:** Facturación muestra conversaciones, mensajes con plantilla y profesionales del mes contra el límite. Al 80 % y al 100 % el dueño recibe un aviso (panel y correo); al 100 % el panel muestra un aviso para pasar de plan. El bot nunca se corta.
- **Lo que limita cada plan:** sumar o reactivar un profesional más allá del límite (Equipo); señas (no se piden en Básico, aunque Mercado Pago esté conectado); lista de espera (el bot no anota y no se mandan ofertas); ficha de clientes y Estadísticas (muestran "viene con el plan Pro"); reactivación y resumen semanal (solo Equipo).
- **Estadísticas** (`/app/estadisticas`): turnos, ingresos cobrados y por cobrar, inasistencias, reservas que el bot tomó fuera de horario, horarios y días más pedidos, mes a mes.
- **Reactivación de clientes** (Bot → Mensajes automáticos, plan Equipo, prendida por defecto): a las 10 de la mañana, a quien pasó su intervalo habitual entre visitas (o el del servicio, en Servicios → "Cada cuántas semanas vuelve") sin turno nuevo le llega la plantilla `reactivacion_cliente` con "Sí, quiero" (el bot le ofrece turno con su profesional) y "Ahora no". Una por visita, como mucho una cada 30 días, hasta 30 por negocio por día.
- **Pedido de reseñas** (Bot → Mensajes automáticos, apagado hasta cargar el enlace): al marcar un turno atendido, 1, 2, 4 o 24 horas después le llega `pedido_resena` con el enlace de Google. Como mucho una vez cada 90 días por cliente.
- **Landing pública** en `/`, `/precios`, `/terminos` y `/privacidad`.
- **Retención:** los mensajes de más de 12 meses se borran solos (cron horario, a las 3 de la mañana).

## Qué tenés que configurar

### 1. Productos y precios en Stripe

En el [panel de Stripe](https://dashboard.stripe.com) de la LLC:

1. **Catálogo de productos → Agregar producto**, uno por plan: "Responbot Básico", "Responbot Pro" y "Responbot Equipo", cada uno con un precio **recurrente mensual en USD** (19, 39 y 79, o lo que decidas; si cambiás los montos, cambialos también en `lib/billing/plans.ts` para que la landing muestre lo mismo).
2. Copiá el ID de cada precio (`price_...`).

### 2. Customer Portal

**Configuración → Facturación → Portal de clientes**:

- Activá "Actualizar método de pago", "Ver historial de facturas" y "Cancelar suscripciones" (al final del período).
- En "Cambiar de plan", agregá los tres productos con su precio y elegí **prorratear** con cobro inmediato.
- Completá el nombre del negocio, y los enlaces a `https://<tu dominio>/terminos` y `https://<tu dominio>/privacidad`.

### 3. Webhook

**Desarrolladores → Webhooks → Agregar destino**: URL `https://<tu dominio>/api/webhooks/stripe`, con los eventos:

- `checkout.session.completed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `invoice.payment_failed`, `invoice.paid`

Copiá el **secreto de firma** (`whsec_...`).

En **Configuración → Facturación → Suscripciones y correos** conviene dejar que Stripe reintente los cobros fallidos (Smart Retries) y que la suscripción pase a "impaga" al final, no a cancelada: así el negocio no pierde el plan por una tarjeta vencida.

### 4. Variables en Vercel

| Variable | Valor |
| --- | --- |
| `STRIPE_SECRET_KEY` | Clave secreta (`sk_live_...`; en previews, `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Secreto del webhook (`whsec_...`) |
| `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM` | ID de precio de cada plan |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Correo de contacto que muestran la landing y los legales |
| `NEXT_PUBLIC_LEGAL_NAME` | Razón social de la LLC (pie de la landing, términos y privacidad) |

Redeployá después de cargarlas. Para previews usá claves y precios de prueba de Stripe, con su propio webhook.

### 5. Plantilla de WhatsApp nueva

Hay una plantilla nueva, `pedido_resena` (marketing). `reactivacion_cliente` ya existía. En Configuración → WhatsApp tocá "Enviar a revisión de Meta". Mientras no estén aprobadas, esos mensajes solo salen si el cliente escribió en las últimas 24 horas.

### 6. Revisar los textos legales

`/terminos` y `/privacidad` son un borrador que describe cómo funciona hoy el producto. Conviene que los revise un profesional (Ley 18.331) antes del lanzamiento comercial, y que la URL de privacidad sea la que cargues en Meta y en la pantalla de consentimiento de Google.

### 7. Probar

- Con claves de prueba, en Facturación elegí un plan y pagá con la tarjeta `4242 4242 4242 4242`. Para probar un pago fallido, usá `4000 0000 0000 0341` (se guarda bien pero falla el cobro) y adelantá el reloj con un [reloj de prueba](https://docs.stripe.com/billing/testing/test-clocks).
- En local, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` te da un `whsec_` para `STRIPE_WEBHOOK_SECRET`.

## Mientras Stripe no esté

Sin las variables, nadie puede elegir plan: un negocio cuya prueba vence queda sin reservas. Para los pilotos (Fase 7), alargale la prueba desde la base: `update businesses set trial_ends_at = '2027-03-01' where slug = '…';`, o dale un plan a mano: `update businesses set plan = 'pro', subscription_status = 'active' where slug = '…';`.

## Qué queda para después

- Exportación de datos y borrado de cuenta desde el panel (hoy se hacen a pedido).
- Facturas con datos fiscales de Uruguay: Stripe emite la factura de la LLC.
