# Recordatorios y notificaciones (Fase 4)

Qué hace la Fase 4 y qué hay que configurar para que cada canal funcione. Todo es opcional: sin una variable, ese canal queda apagado y el resto sigue andando.

## Qué hace

- **Recordatorios al cliente por WhatsApp:** 24 horas antes con botones "Confirmo", "Reprogramar" y "Cancelar", y 2 horas antes uno corto con la dirección. Las horas se cambian (o se apagan) en Configuración → Reglas de reserva. "Confirmo" deja el turno como confirmado por el cliente sin usar IA; "Reprogramar" y "Cancelar" los resuelve el bot respetando la política de cancelación. Quien escribió BAJA no recibe recordatorios.
- **Confirmación y cancelación:** si el equipo reserva, mueve o cancela un turno desde el panel, el cliente recibe la confirmación o el aviso por WhatsApp. Si lo hizo el cliente con el bot, ya se lo dijo el bot.
- **Avisos al equipo** (`lib/notifications/dispatch.ts`): reserva nueva, cancelada o movida, cliente que no confirmó a 2 horas del turno, conversación que necesita una persona, WhatsApp desconectado e invitación aceptada. En el panel (campanita con contador), push, WhatsApp al número personal de cada uno y correo, según la tabla del SPEC. Cada persona elige canales y horas de silencio en Notificaciones. Un profesional recibe solo los de sus turnos.
- **Resumen diario** a las 8:00 hora del negocio por WhatsApp al dueño (y por correo a quien lo prenda). **Resumen semanal** los lunes por correo, para quien lo prenda.
- **Correos** con React Email: enlace de acceso, invitación, bienvenida, alta incompleta (24 horas y 3 días), WhatsApp desconectado y resúmenes.

## Qué tenés que configurar

### 1. Push web (VAPID)

```bash
npx web-push generate-vapid-keys
```

En Vercel, Project Settings → Environment Variables:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | La "Public Key" |
| `VAPID_PRIVATE_KEY` | La "Private Key" |
| `VAPID_SUBJECT` | `mailto:` con un correo tuyo, por ejemplo `mailto:hola@tudominio.com` |

Después de redeployar aparece "Push en este dispositivo · Activar" en Notificaciones. En iPhone funciona con el panel instalado en la pantalla de inicio (iOS 16.4 o más).

### 2. Webhook de Resend (rebotes y quejas)

1. En Resend → Webhooks → Add endpoint: `https://<tu dominio>/api/webhooks/resend`, eventos `email.bounced` y `email.complained`.
2. Copiá el "Signing secret" (empieza con `whsec_`) a `RESEND_WEBHOOK_SECRET` en Vercel.

Si un correo rebota, esa persona deja de recibir correos de avisos y la pantalla de Notificaciones se lo dice.

### 3. Plantillas nuevas de WhatsApp

Si ya conectaste un número, en Configuración → WhatsApp tocá "Enviar a revisión de Meta" para mandar las tres plantillas nuevas (`recordatorio_corto`, `aviso_reserva_dueno`, `aviso_cambio_turno_dueno`). Ver [WHATSAPP.md](WHATSAPP.md).

### 4. Tu número de WhatsApp

En Notificaciones, cada persona del equipo carga su WhatsApp personal para recibir el resumen diario y los avisos de derivación. Los mensajes salen desde el número del negocio, así que tiene que ser otro número.

### 5. Crons

Ya están en `vercel.json` (necesitan el plan Pro por el de cada 5 minutos) y usan `CRON_SECRET`. Se pueden probar a mano:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<tu dominio>/api/cron/scheduled-messages
```

`AUTH_URL` (o el dominio de producción de Vercel) se usa para los enlaces de los correos y los push.
