import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Cómo se usa" }

/*
 * Guía del panel de la plataforma para quien da soporte: qué hay en cada
 * pantalla de /admin y los pasos para los casos más comunes.
 */

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-[10px] border p-5">
      <h2 className="font-medium">{title}</h2>
      <div className="grid gap-2 text-sm leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ul]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  )
}

const link = "font-medium text-foreground underline"

export default function AyudaPage() {
  return (
    <>
      <PageHeader
        title="Cómo se usa"
        description="Guía rápida del panel de la plataforma: quién entra, qué hay en cada pantalla y cómo resolver los pedidos de soporte más comunes."
      />

      <div className="grid max-w-3xl gap-4">
        <Block title="Quién entra">
          <p>
            Entran solo los emails cargados en la variable <b>PLATFORM_ADMIN_EMAILS</b> de Vercel (separados por coma).
            Al resto, /admin le responde “página no encontrada”. Para sumar a alguien del equipo, agregá su email a esa
            variable y volvé a publicar el sitio.
          </p>
          <ol>
            <li>
              Abrí <b>/admin</b> en el navegador. Si no tenés la sesión iniciada, te lleva a ingresar.
            </li>
            <li>
              Elegí <b>Continuar con Google</b> con el mismo email que está en la variable.
            </li>
            <li>Listo: volvés a /admin. No hace falta tener un negocio propio.</li>
          </ol>
        </Block>

        <Block title="Las pantallas">
          <ul>
            <li>
              <Link href="/admin" className={link}>
                Pilotos
              </Link>
              : todos los negocios con su estado de cuenta y los números del bot de los últimos 7 o 30 días. Desde acá
              marcás un negocio como piloto y creás la demo pública.
            </li>
            <li>
              <Link href="/admin/soporte" className={link}>
                Soporte
              </Link>
              : buscador de negocios y la ficha completa de cada uno.
            </li>
            <li>
              <Link href="/admin/revision" className={link}>
                Revisión del bot
              </Link>
              : las respuestas que los negocios marcaron como malas y las que fallaron, para mejorar el bot.
            </li>
          </ul>
        </Block>

        <Block title="Encontrar a quien te escribió">
          <ol>
            <li>
              Entrá a <b>Soporte</b> y buscá por una parte del nombre del negocio, el email de cualquier persona del
              equipo (dueño, admin o profesional) o el número de WhatsApp del negocio.
            </li>
            <li>Tocá el negocio para abrir su ficha.</li>
          </ol>
        </Block>

        <Block title="Qué muestra la ficha">
          <ul>
            <li>
              <b>Cuenta</b>: estado (prueba, pago, piloto…), cuándo termina la prueba, la suscripción de Stripe con un
              enlace directo al cliente en Stripe, y el uso del mes contra el límite del plan.
            </li>
            <li>
              <b>Conexiones</b>: si WhatsApp y Mercado Pago están conectados o se cayeron, y cómo viene la importación del
              catálogo web.
            </li>
            <li>
              <b>Configuración</b>: cuántos servicios, profesionales, clientes y turnos tiene, si configuró el bot y qué
              pasos del alta le faltan.
            </li>
            <li>
              <b>Equipo</b>: quiénes son, con qué rol, y si su correo rebota (por eso no le llegan los avisos).
            </li>
            <li>
              <b>Problemas de los últimos 14 días</b>: respuestas del bot que fallaron, mensajes que WhatsApp no
              entregó, recordatorios que no salieron, avisos al equipo que fallaron y errores del catálogo. Cada uno con
              el motivo técnico y, si corresponde, el enlace a la conversación.
            </li>
            <li>
              <b>Conversaciones</b>: las últimas 30. Al abrir una ves cada mensaje con quién lo mandó (cliente, bot o
              equipo), las herramientas que usó el bot, los errores y lo que el negocio marcó como Bien o Mal.
            </li>
            <li>
              <b>Auditoría</b>: lo último que pasó en la cuenta, incluido lo que hiciste vos desde acá.
            </li>
          </ul>
        </Block>

        <Block title="Acciones de soporte">
          <ul>
            <li>
              <b>Extender la prueba</b>: suma 7, 14 o 30 días. Si la prueba todavía no terminó, se suman a la fecha de fin;
              si ya terminó, se cuentan desde hoy. Le vuelve a habilitar las reservas al instante.
            </li>
            <li>
              <b>Piloto</b>: todo habilitado, con los límites del plan Equipo y sin cobro, por 30, 60 o 90 días. “Quitar
              el piloto” lo devuelve a su estado normal.
            </li>
            <li>
              <b>Entrar a su panel</b> (modo soporte): ves el panel del negocio como lo ve un Admin de su equipo, para
              revisar la agenda, el bot o la configuración y corregir lo que haga falta. No ves Facturación ni podés
              transferir o borrar el negocio.
            </li>
          </ul>
        </Block>

        <Block title="El modo soporte, paso a paso">
          <ol>
            <li>
              En la ficha del negocio tocá <b>Entrar a su panel</b>. Te lleva a su agenda.
            </li>
            <li>
              Arriba vas a ver una franja amarilla que dice <b>Modo soporte en …</b>. Mientras esté, todo lo que veas y
              cambies es de ese negocio.
            </li>
            <li>
              Lo que hagas queda a tu nombre (no al del dueño) y la entrada y la salida quedan en la auditoría del
              negocio.
            </li>
            <li>
              Para terminar tocá <b>Salir del modo soporte</b> en la franja: volvés a la ficha. Si te olvidás, se corta
              solo a las dos horas.
            </li>
          </ol>
          <p>
            Ojo con el chat de prueba y con los mensajes a clientes: si contestás una conversación desde su bandeja, el
            mensaje le llega de verdad al cliente por WhatsApp.
          </p>
        </Block>

        <Block title="Casos comunes">
          <ul>
            <li>
              <b>“El bot no contesta”</b>: mirá Conexiones (¿WhatsApp está conectado?) y Problemas (errores del bot o de
              WhatsApp). Si la cuenta dice “Prueba terminada” o “Suspendido”, el bot responde pero no reserva.
            </li>
            <li>
              <b>“No me llegan los recordatorios”</b>: buscá en Problemas los mensajes programados que no salieron; el
              motivo suele ser WhatsApp desconectado o el cliente que se dio de baja.
            </li>
            <li>
              <b>“No me llegan los avisos por correo”</b>: en Equipo fijate si su correo figura como que rebota.
            </li>
            <li>
              <b>“Se me terminó la prueba y todavía no lo probé”</b>: extendé la prueba 14 días.
            </li>
            <li>
              <b>“El bot contestó cualquier cosa”</b>: abrí la conversación desde la ficha, mirá qué herramientas usó y,
              si hace falta, entrá a su panel para ajustar sus preguntas frecuentes o servicios.
            </li>
          </ul>
        </Block>
      </div>
    </>
  )
}
