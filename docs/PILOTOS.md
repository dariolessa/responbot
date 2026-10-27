# Pilotos y demo pública (Fase 7)

La Fase 7 del SPEC pide **3 a 5 negocios reales**, **ajustes del bot con conversaciones reales** y un **número de demo pública**. El código ya trae las herramientas; lo que sigue depende de vos (conseguir los negocios, el número y las cuentas). Esta guía dice qué hace cada cosa y en qué orden hacerla.

## Qué hace el código

- **Negocios piloto.** Un negocio marcado como piloto tiene todo habilitado (como el plan Equipo, con sus límites) y no paga hasta la fecha que elijas, aunque su prueba de 14 días haya vencido. En Facturación ve "Piloto hasta el …" y, 7 días antes, un aviso para elegir plan. Si se suscribe durante el piloto, Stripe empieza a cobrar cuando termina. Una suscripción paga activa manda sobre el piloto.
- **Calificar al bot.** En cada conversación, debajo de cada respuesta del bot, el dueño y los admins tienen "Bien" y "Mal". Con "Mal" se anota qué tendría que haber contestado. El negocio ve sus respuestas a mejorar en **Bot → Respuestas a mejorar**, al lado del chat de prueba, para cargar lo que falte en las preguntas frecuentes o en los servicios.
- **Panel de la plataforma** en `/admin` (solo para los emails de `PLATFORM_ADMIN_EMAILS`; al resto le da 404). Si sos admin, aparece "Pilotos" en el menú de tu cuenta. **Soporte** (`/admin/soporte`) busca un negocio por nombre, email de su equipo o número de WhatsApp y muestra su ficha (cuenta y Stripe, conexiones, configuración, equipo, problemas de 14 días, conversaciones con la traza del bot y auditoría), con acciones para extender la prueba, marcar piloto y entrar a su panel en modo soporte (rol Admin, franja amarilla, auditado, dura 2 horas). La guía de uso está en `/admin/ayuda`.
  - **Pilotos:** todos los negocios con su dueño, el estado de la cuenta, si conectaron WhatsApp y, en los últimos 7 o 30 días, clientes que escribieron, turnos que tomó el bot, derivaciones a una persona, respuestas con error y respuestas marcadas Bien/Mal. Desde cada tarjeta lo marcás como piloto por 30, 60 o 90 días, o se lo quitás (queda en la auditoría del negocio).
  - **Revisión del bot:** un Markdown con cada respuesta marcada como mala y cada respuesta que falló, con los mensajes previos de la conversación y las herramientas que usó el bot. No lleva teléfonos ni nombres de clientes. Se copia o se baja como `.md`.
- **Demo pública.** Un negocio "Barbería Demo" (con servicios de barbería, dos profesionales y preguntas frecuentes) marcado como demo: nunca vence, el bot avisa que los turnos son de prueba y, si le preguntan, explica qué es Responbot y pasa la web. Todas las noches (03:00 de Montevideo, cron `demo-reset`) se borran sus clientes, turnos, señas, lista de espera, avisos y conversaciones; quedan el catálogo, el equipo y la configuración.
- **Landing:** con `NEXT_PUBLIC_DEMO_WHATSAPP`, el titular suma el botón "Probá la demo en WhatsApp", que abre el chat con "Hola, quiero sacar un turno" ya escrito.

## Qué tenés que hacer

### 1. Variables y migración

En Vercel (Production):

| Variable | Valor |
| --- | --- |
| `PLATFORM_ADMIN_EMAILS` | Tu email de login (varios, separados por coma). |
| `NEXT_PUBLIC_DEMO_WHATSAPP` | El número de la demo, solo dígitos con código de país (`59899123456`). Dejala vacía hasta que el número funcione. |

Aplicá la migración `0007_fase_7` (`pnpm db:migrate` con la `DATABASE_URL` de producción) y volvé a desplegar. El cron nuevo ya está en `vercel.json`.

### 2. La demo

1. Conseguí un número para la demo que no esté en la app de WhatsApp (un chip nuevo o un fijo que reciba SMS o llamada para el código). Meta lo pide en la lista de requisitos del SPEC.
2. Entrá a `/admin` → **Crear la demo**. Quedás como dueño de "Barbería Demo".
3. En el panel, cambiá a "Barbería Demo" con el selector de negocios y andá a **Configuración → Conexiones → WhatsApp** con ese número (el mismo alta embebida de [WHATSAPP.md](WHATSAPP.md)).
4. Probala vos desde otro celular: pedí un turno, cambialo, cancelalo, mandá un audio.
5. En **Notificaciones**, apagá los avisos que no quieras recibir de la demo (cada reserva de un visitante te llegaría como a cualquier dueño).
6. Cargá `NEXT_PUBLIC_DEMO_WHATSAPP` en Vercel y redesplegá: aparece el botón en la landing.

Si querés cambiar nombre, servicios o horarios de la demo, se hace desde su panel como en cualquier negocio; el borrado nocturno no los toca.

### 3. Elegir los pilotos

Apuntá a 3 a 5 negocios del rubro del MVP (peluquería, barbería, uñas, estética), en lo posible:

- Que ya reciban turnos por WhatsApp todos los días (mínimo unas 10 consultas por semana), así hay conversaciones para ajustar.
- Con un dueño que conteste rápido y quiera dar su opinión.
- Con un número que puedan pasar a la API de WhatsApp. **Ojo:** un número conectado a la Cloud API deja de funcionar en la app de WhatsApp Business del celular; el negocio atiende desde el panel (Conversaciones, que funciona bien en el celular como PWA). Si no quieren perder la app, que usen un número nuevo y lo publiquen.
- Mezclá tamaños: al menos uno con una sola persona y uno con equipo.

Lo que les ofrecés: uso gratis durante el piloto (sugerencia: 60 días) a cambio de una charla semanal de 15 minutos y de marcar Bien/Mal en las conversaciones. Al final, un precio de fundador si siguen.

### 4. Alta de cada piloto (una visita o videollamada de una hora)

1. Que el dueño cree su cuenta desde la landing (Google o enlace por email) y haga el alta: datos, servicios, equipo y horarios, reglas.
2. En `/admin`, marcalo como piloto por 60 días.
3. Que pruebe el bot en **Bot → Probalo** con 5 preguntas reales que le hacen sus clientes; ajustá juntos preguntas frecuentes, tono y bienvenida.
4. Conectá su WhatsApp (Configuración → Conexiones). Si cobra señas, Mercado Pago ([MERCADOPAGO.md](MERCADOPAGO.md)).
5. Instalá el panel en su celular (PWA) y prendé las notificaciones push, así se entera de las derivaciones.
6. Mostrale cómo tomar una conversación, devolverla al bot y marcar Bien/Mal.

### 5. Seguimiento semanal

Cada lunes:

1. `/admin` con 7 días: mirá quién no tiene WhatsApp conectado, quién tiene muchas derivaciones o errores y quién no está usando el bot.
2. `/admin/revision` → **Bajar .md**. Para cada respuesta:
   - Si faltaba un dato del negocio (horario especial, un precio, una política), cargalo en sus preguntas frecuentes o en la descripción del servicio, o pedile al dueño que lo haga.
   - Si el bot se equivocó en algo que le pasaría a cualquier negocio, es un ajuste del prompt (`lib/bot/prompts/rules.ts` y `lib/bot/templates/services.ts`) o de una herramienta (`lib/bot/tools`). Podés abrir una sesión con Claude en el repo, pegarle el Markdown y pedirle los cambios con un test en `tests/unit/bot-engine.test.ts` o `bot-tools.test.ts` que reproduzca la conversación.
   - Si fue un error ("Falló"), revisá los logs de Vercel de esa hora.
3. Charla de 15 minutos con cada dueño: qué le molestó, qué le gustó, qué le preguntaron sus clientes que el bot no supo.
4. Anotá en una tabla (por negocio y por semana): clientes, turnos del bot, derivaciones, respuestas malas y lo que se cambió.

### 6. Cuándo dar la fase por cerrada

Sugerencia de criterios, a ajustar:

- Al menos 3 negocios con WhatsApp conectado durante 4 semanas seguidas.
- Menos de 1 de cada 20 respuestas del bot marcada como mala en las últimas 2 semanas, y ninguna con error.
- Más de la mitad de las consultas de turno terminan reservadas por el bot sin derivar.
- Al menos 2 dueños dispuestos a pagar el precio del plan que usan (con eso se validan los precios de `lib/billing/plans.ts`).
- La demo funcionando y enlazada desde la landing.

Al cerrar: los pilotos que sigan eligen plan en Facturación (si lo hacen antes de que termine el piloto, Stripe cobra desde esa fecha).

## Privacidad

Las conversaciones de los pilotos son datos de sus clientes. La revisión no lleva teléfonos ni nombres, pero sí el texto de los mensajes: no la compartas fuera del equipo y borrá los `.md` cuando termines de usarlos. Avisale a cada piloto que vas a leer conversaciones para mejorar el bot y dejalo por escrito en el acuerdo del piloto: la política de privacidad dice que tratás esos datos solo por cuenta del negocio y para prestarle el servicio.
