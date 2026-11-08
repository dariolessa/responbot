import type { Metadata } from "next"
import Link from "next/link"

import { LegalPage } from "@/components/marketing/legal-page"
import { brand } from "@/lib/brand"
import { MESSAGE_RETENTION_DAYS } from "@/lib/privacy"

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: `Qué datos trata ${brand.legalName} al prestar ${brand.name}, incluidos los de Meta y WhatsApp, para qué, dónde se guardan y cómo pedir su eliminación.`,
}

// Texto estático: se genera en el servidor y no depende de JavaScript (lo lee el rastreador de Meta).
export const dynamic = "force-static"

/*
 * Política de privacidad (docs/SPEC.md, "Privacidad"): qué datos se guardan de
 * los negocios y de sus clientes, qué datos de Meta/WhatsApp se usan, para
 * qué, dónde y por cuánto tiempo. Borrador a revisar con un profesional
 * antes del lanzamiento comercial; describe cómo funciona hoy el producto.
 */
export default function PrivacidadPage() {
  const provider = brand.legalName
  const months = Math.round(MESSAGE_RETENTION_DAYS / 30.4)
  const mail = (
    <a href={`mailto:${brand.contactEmail}`} className="underline underline-offset-4">
      {brand.contactEmail}
    </a>
  )
  return (
    <LegalPage title="Política de privacidad" updated="8 de noviembre de 2026">
      <section>
        <p>
          {brand.name} es un servicio que presta {provider}, una sociedad de responsabilidad limitada constituida en{" "}
          {brand.legalJurisdiction}, que usa {brand.name} como nombre comercial (en esta política, &quot;
          {brand.name}&quot;, &quot;nosotros&quot;). Esta política explica qué datos tratamos, para qué, dónde se
          guardan, por cuánto tiempo y cómo podés pedir que se borren. Seguimos la Ley 18.331 de protección de datos
          personales de Uruguay y las condiciones de la Plataforma de Meta y de WhatsApp Business.
        </p>
        <p>Contacto para cualquier tema de privacidad: {mail}.</p>
      </section>

      <section>
        <h2>Quién es responsable</h2>
        <ul>
          <li>
            De los datos de las personas que usan el panel (dueños y equipo de cada negocio), el responsable es{" "}
            {provider}.
          </li>
          <li>
            De los datos de los clientes de cada negocio, el responsable es ese negocio. {brand.name} actúa como
            encargado: los trata solo por cuenta del negocio y para prestarle el servicio.
          </li>
        </ul>
      </section>

      <section>
        <h2>Datos de Meta y WhatsApp que usamos</h2>
        <p>
          Cuando un negocio conecta su número con el botón &quot;Conectar WhatsApp&quot; (el registro integrado de
          Meta), nos autoriza a usar la API oficial de WhatsApp Business con los permisos
          whatsapp_business_management y whatsapp_business_messaging. Con eso tratamos:
        </p>
        <ul>
          <li>
            <strong>Información de la cuenta de WhatsApp Business:</strong> el identificador y el nombre de la cuenta,
            el identificador del número, el número visible, el nombre verificado, su estado, la calificación de calidad
            y el estado de las plantillas de mensajes. Un token de acceso que Meta emite para el negocio, guardado
            cifrado.
          </li>
          <li>
            <strong>Números de teléfono:</strong> el número del negocio y los números de WhatsApp de los clientes que
            le escriben.
          </li>
          <li>
            <strong>Mensajes:</strong> el contenido de los mensajes que los clientes mandan al número del negocio y de
            las respuestas (del asistente o del equipo), con su fecha y estado de entrega. Los audios se transcriben y
            se borran; de las imágenes guardamos solo una descripción breve.
          </li>
          <li>
            <strong>Identificador de Facebook</strong> (con alcance de la app) de la persona que hizo la conexión, solo
            para poder atender un pedido de eliminación de datos.
          </li>
        </ul>
        <p>
          No pedimos ni guardamos la contraseña de Facebook, la lista de amigos, las publicaciones ni otros datos del
          perfil de Facebook.
        </p>
      </section>

      <section>
        <h2>Para qué los usamos</h2>
        <ul>
          <li>
            Recibir los mensajes que los clientes mandan al negocio y responderlos: el asistente contesta consultas,
            informa precios, ofrece turnos libres y los agenda.
          </li>
          <li>Mostrar las conversaciones en el panel para que el equipo del negocio pueda leerlas y responder a mano.</li>
          <li>
            Mandar recordatorios y avisos de turnos con plantillas aprobadas por Meta, y mostrarle al negocio el estado
            de su número y de sus plantillas.
          </li>
          <li>Mostrar estadísticas al negocio, controlar el uso de cada plan, dar soporte y mantener la seguridad.</li>
        </ul>
        <p>
          No vendemos datos, no los usamos para publicidad ni los compartimos con terceros para sus propios fines. No
          entrenamos modelos de inteligencia artificial con las conversaciones.
        </p>
      </section>

      <section>
        <h2>Otros datos que guardamos</h2>
        <ul>
          <li>
            Del equipo del negocio: nombre, correo, foto de perfil de Google, WhatsApp para avisos (si lo cargás) y
            dispositivos con avisos activados.
          </li>
          <li>De los clientes del negocio: nombre, sus turnos, notas que cargue el negocio y si pidió no recibir recordatorios.</li>
          <li>
            De los pagos de señas: el monto, el estado y el identificador del pago en Mercado Pago. No vemos ni guardamos
            datos de tarjetas.
          </li>
          <li>De la suscripción: el plan y su estado. Los datos de la tarjeta los guarda Stripe.</li>
        </ul>
      </section>

      <section>
        <h2>Dónde se guardan</h2>
        <p>
          La aplicación corre en Vercel y la base de datos es Postgres en Neon, ambas en servidores de Amazon Web Services
          en São Paulo, Brasil. Los datos viajan cifrados (HTTPS) y están cifrados en reposo; además, los tokens de
          WhatsApp y Mercado Pago se guardan cifrados con AES-256. Cada negocio solo puede ver sus propios datos.
        </p>
        <p>Los compartimos solo con los proveedores que hacen funcionar el servicio, y solo lo necesario:</p>
        <ul>
          <li>Meta (WhatsApp), para recibir y mandar los mensajes.</li>
          <li>Anthropic, para que el asistente entienda y responda; OpenAI o ElevenLabs, para transcribir audios.</li>
          <li>Mercado Pago, para las señas; Stripe, para cobrar la suscripción.</li>
          <li>Vercel y Neon (alojamiento y base de datos); Resend, para los correos; Google, para el inicio de sesión.</li>
        </ul>
        <p>Algunos de estos proveedores procesan datos en Estados Unidos u otros países, con las garantías que exige la ley.</p>
      </section>

      <section>
        <h2>Cuánto tiempo los guardamos</h2>
        <ul>
          <li>Mensajes y transcripciones: {months} meses; después se borran solos.</li>
          <li>
            Información de la cuenta de WhatsApp Business y token de acceso: mientras el número esté conectado. Se borran
            en el momento en que el negocio lo desconecta desde Configuración o cuando recibimos un pedido de eliminación
            de datos de Meta.
          </li>
          <li>Turnos, clientes y pagos: mientras el negocio tenga su cuenta.</li>
          <li>Si el negocio pide dar de baja su cuenta, borramos todos sus datos dentro de los 30 días siguientes.</li>
        </ul>
      </section>

      <section>
        <h2>Cómo pedir la eliminación de tus datos</h2>
        <ul>
          <li>
            <strong>Si conectaste WhatsApp con tu cuenta de Facebook:</strong> podés quitar {brand.name} desde la
            configuración de tu cuenta de Facebook (Configuración y privacidad → Integraciones comerciales) y pedir que
            se borren tus datos. Meta nos avisa y borramos la conexión de WhatsApp (token e identificadores) y las
            conversaciones de WhatsApp de ese negocio. Te damos un código para seguir el pedido en{" "}
            <Link href="/eliminacion-datos" className="underline underline-offset-4">
              /eliminacion-datos
            </Link>
            .
          </li>
          <li>
            <strong>Si usás el panel:</strong> podés desconectar WhatsApp en Configuración en cualquier momento (se
            borra el token al instante) y pedirnos acceso, corrección o eliminación de todos tus datos escribiendo a{" "}
            {mail}. Respondemos dentro de los 30 días.
          </li>
          <li>
            <strong>Si sos cliente de un negocio:</strong> escribí BAJA por WhatsApp para dejar de recibir
            recordatorios e invitaciones (ALTA lo revierte). Para ver, corregir o borrar tus datos, pedíselo al negocio
            o escribinos a {mail} y lo gestionamos con él.
          </li>
        </ul>
        <p>También podés reclamar ante la Unidad Reguladora y de Control de Datos Personales (URCDP) de Uruguay.</p>
      </section>

      <section>
        <h2>Seguridad</h2>
        <p>
          Limitamos el acceso a los datos a lo necesario para operar y dar soporte, y queda registro de cada acceso de
          soporte. Si ocurriera un incidente que afecte tus datos, te vamos a avisar.
        </p>
      </section>

      <section>
        <h2>Cambios</h2>
        <p>
          Si cambiamos esta política de forma importante, lo avisamos por correo a los negocios antes de que rija.
          Consultas: {mail}.
        </p>
      </section>
    </LegalPage>
  )
}
