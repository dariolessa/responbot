import type { Metadata } from "next"
import Link from "next/link"

import { LegalPage } from "@/components/marketing/legal-page"
import { brand } from "@/lib/brand"

export const metadata: Metadata = { title: "Política de privacidad" }

/*
 * Política de privacidad (docs/SPEC.md, "Privacidad"): qué datos se guardan de
 * los negocios y de sus clientes, para qué y por cuánto tiempo. Borrador a
 * revisar con un profesional (Ley 18.331 de Uruguay) antes del lanzamiento
 * comercial; describe cómo funciona hoy el producto.
 */
export default function PrivacidadPage() {
  const provider = brand.legalName ?? brand.name
  return (
    <LegalPage title="Política de privacidad" updated="27 de octubre de 2026">
      <section>
        <p>
          Esta política explica qué datos trata {provider} al prestar {brand.name}, para qué y cómo podés ejercer tus
          derechos. Seguimos la Ley 18.331 de protección de datos personales de Uruguay.
        </p>
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
            encargado: los trata solo por su cuenta y para prestarle el servicio.
          </li>
        </ul>
      </section>
      <section>
        <h2>Qué datos guardamos</h2>
        <ul>
          <li>Del equipo del negocio: nombre, correo, foto de perfil de Google, WhatsApp para avisos (si lo cargás) y dispositivos con avisos activados.</li>
          <li>
            De los clientes del negocio: número de WhatsApp, nombre, los mensajes de la conversación, la transcripción
            de los audios, sus turnos, notas que cargue el negocio y si pidió no recibir recordatorios.
          </li>
          <li>Los audios se borran apenas se transcriben, y las imágenes no se guardan: queda solo una descripción breve.</li>
          <li>De los pagos de señas: el monto, el estado y el identificador del pago en Mercado Pago. No vemos ni guardamos datos de tarjetas.</li>
          <li>De la suscripción: el plan y su estado. Los datos de la tarjeta los guarda Stripe.</li>
          <li>Tokens de acceso a WhatsApp y Mercado Pago, cifrados.</li>
        </ul>
      </section>
      <section>
        <h2>Para qué los usamos</h2>
        <ul>
          <li>Responder a los clientes, reservar y recordar turnos, cobrar señas y avisar al equipo.</li>
          <li>Mostrar estadísticas al negocio y controlar el uso de cada plan.</li>
          <li>Dar soporte y mantener la seguridad del servicio.</li>
        </ul>
        <p>No vendemos datos ni los usamos para publicidad. No entrenamos modelos de inteligencia artificial con las conversaciones.</p>
      </section>
      <section>
        <h2>Con quién los compartimos</h2>
        <p>Solo con los proveedores que hacen funcionar el servicio, y solo lo necesario:</p>
        <ul>
          <li>Meta (WhatsApp), para recibir y mandar los mensajes.</li>
          <li>Anthropic, para que el asistente entienda y responda; OpenAI o ElevenLabs, para transcribir audios.</li>
          <li>Mercado Pago, para las señas; Stripe, para cobrar la suscripción.</li>
          <li>Vercel y Neon, donde corre la aplicación y se guarda la base de datos; Resend, para los correos; Google, para el inicio de sesión.</li>
        </ul>
        <p>Algunos de estos proveedores procesan datos fuera de Uruguay, con las garantías que exige la ley.</p>
      </section>
      <section>
        <h2>Cuánto tiempo</h2>
        <ul>
          <li>Mensajes y transcripciones: 12 meses.</li>
          <li>Turnos, clientes y pagos: mientras el negocio tenga su cuenta.</li>
          <li>Si el negocio pide dar de baja su cuenta, borramos sus datos dentro de los 30 días siguientes.</li>
        </ul>
      </section>
      <section>
        <h2>Tus derechos</h2>
        <ul>
          <li>Si sos cliente de un negocio: escribí BAJA por WhatsApp para dejar de recibir recordatorios e invitaciones (ALTA lo revierte). Para ver, corregir o borrar tus datos, pedíselo al negocio.</li>
          <li>Si usás el panel: podés pedirnos acceso, corrección o eliminación de tus datos.</li>
          <li>
            Si conectaste WhatsApp con tu cuenta de Facebook, mirá{" "}
            <Link href="/eliminacion-de-datos" className="underline underline-offset-4">
              eliminación de datos
            </Link>
            .
          </li>
        </ul>
        {brand.contactEmail ? (
          <p>
            Escribinos a{" "}
            <a href={`mailto:${brand.contactEmail}`} className="underline underline-offset-4">
              {brand.contactEmail}
            </a>
            . También podés reclamar ante la Unidad Reguladora y de Control de Datos Personales (URCDP).
          </p>
        ) : (
          <p>También podés reclamar ante la Unidad Reguladora y de Control de Datos Personales (URCDP).</p>
        )}
      </section>
      <section>
        <h2>Seguridad</h2>
        <p>
          Los datos viajan cifrados, los tokens de conexión se guardan cifrados y cada negocio solo puede ver sus
          propios datos. Si ocurriera un incidente que afecte tus datos, te vamos a avisar.
        </p>
      </section>
    </LegalPage>
  )
}
