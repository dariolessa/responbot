import type { Metadata } from "next"
import Link from "next/link"

import { LegalPage } from "@/components/marketing/legal-page"
import { GRACE_DAYS, TRIAL_DAYS } from "@/lib/billing/plans"
import { brand } from "@/lib/brand"

export const metadata: Metadata = { title: "Términos y condiciones" }

/*
 * Términos del servicio (docs/SPEC.md, "Privacidad": publicados en la
 * landing). Borrador a revisar con un profesional antes del lanzamiento
 * comercial; describe cómo funciona hoy el producto.
 */
export default function TerminosPage() {
  const provider = brand.legalName ?? brand.name
  return (
    <LegalPage title="Términos y condiciones" updated="27 de octubre de 2026">
      <section>
        <p>
          Estos términos regulan el uso de {brand.name}, un servicio de {provider} que ofrece a negocios un asistente
          de WhatsApp y un panel con agenda. Al crear una cuenta aceptás estos términos en nombre de tu negocio.
        </p>
      </section>
      <section>
        <h2>1. El servicio</h2>
        <p>
          {brand.name} responde consultas de tus clientes por WhatsApp, informa precios de tu lista de servicios y
          reserva turnos en tu agenda, con recordatorios, avisos y, si lo activás, cobro de señas con tu cuenta de
          Mercado Pago. El asistente usa inteligencia artificial: puede equivocarse, y vos sos responsable de la
          información que cargás (servicios, precios, horarios y preguntas frecuentes) y de revisar tu agenda.
        </p>
      </section>
      <section>
        <h2>2. Tu cuenta y tu equipo</h2>
        <ul>
          <li>Entrás con Google o con un enlace por correo. Cuidá el acceso a esa cuenta.</li>
          <li>Podés invitar a tu equipo con distintos permisos; sos responsable de lo que hagan en el panel.</li>
          <li>Tenés que tener derecho a usar el número de WhatsApp y la cuenta de Mercado Pago que conectes.</li>
        </ul>
      </section>
      <section>
        <h2>3. WhatsApp y Meta</h2>
        <p>
          El número se conecta con la API oficial de WhatsApp de Meta. Al usarlo aceptás también las políticas de
          WhatsApp Business y de comercio de Meta. Meta puede cobrarte directamente los mensajes con plantilla según su
          tabla de precios, y puede limitar o suspender números que no cumplan sus políticas. No mandes mensajes a
          personas que no te dieron su número para eso.
        </p>
      </section>
      <section>
        <h2>4. Planes, prueba y pagos</h2>
        <ul>
          <li>Hay {TRIAL_DAYS} días de prueba gratis, sin tarjeta.</li>
          <li>
            Los planes son mensuales, en dólares, y se cobran con tarjeta a través de Stripe. Se renuevan solos hasta
            que los canceles desde Facturación; la cancelación rige al final del período pagado.
          </li>
          <li>Los cambios de plan son inmediatos y Stripe prorratea la diferencia.</li>
          <li>
            Cada plan tiene límites de uso (profesionales, conversaciones y mensajes por mes) que se muestran en{" "}
            <Link href="/precios" className="underline underline-offset-4">
              Precios
            </Link>
            . Si los superás te avisamos; el bot no se corta en mitad de una reserva.
          </li>
          <li>
            Si al terminar la prueba no elegís un plan, o si un cobro falla y no se resuelve en {GRACE_DAYS} días, el
            bot sigue respondiendo consultas pero deja de reservar y el panel queda en solo lectura hasta regularizarlo.
          </li>
          <li>Las señas que cobrás a tus clientes van directo a tu cuenta de Mercado Pago; no pasan por nosotros.</li>
        </ul>
      </section>
      <section>
        <h2>5. Uso aceptable</h2>
        <p>
          No podés usar {brand.name} para mandar publicidad no pedida, para actividades ilegales ni para engañar a
          tus clientes. Podemos suspender cuentas que lo hagan.
        </p>
      </section>
      <section>
        <h2>6. Datos</h2>
        <p>
          Los datos de tus clientes son tuyos: vos sos el responsable y nosotros los tratamos por tu cuenta, solo para
          prestarte el servicio. Los detalles están en la{" "}
          <Link href="/privacidad" className="underline underline-offset-4">
            política de privacidad
          </Link>
          .
        </p>
      </section>
      <section>
        <h2>7. Disponibilidad y responsabilidad</h2>
        <p>
          Hacemos lo posible para que el servicio funcione siempre, pero depende de terceros (Meta, Mercado Pago,
          proveedores de nube y de inteligencia artificial) y puede tener interrupciones. En la medida que permite la
          ley, nuestra responsabilidad se limita a lo que pagaste por el servicio en los últimos tres meses.
        </p>
      </section>
      <section>
        <h2>8. Cambios y baja</h2>
        <p>
          Podemos actualizar estos términos; si el cambio es importante te avisamos por correo antes de que rija.
          Podés dejar de usar el servicio cuando quieras.
          {brand.contactEmail ? (
            <>
              {" "}
              Por cualquier consulta escribinos a{" "}
              <a href={`mailto:${brand.contactEmail}`} className="underline underline-offset-4">
                {brand.contactEmail}
              </a>
              .
            </>
          ) : null}
        </p>
      </section>
    </LegalPage>
  )
}
