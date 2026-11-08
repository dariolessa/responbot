import type { Metadata } from "next"
import Link from "next/link"

import { LegalPage } from "@/components/marketing/legal-page"
import { brand } from "@/lib/brand"
import { formatInTimeZone } from "date-fns-tz"
import { deletionRequestStatus } from "@/lib/whatsapp/data-deletion-route"

export const metadata: Metadata = {
  title: "Eliminación de datos",
  description: `Cómo pedir que ${brand.name} borre tus datos y estado de un pedido de eliminación.`,
}

/*
 * Página de estado del pedido de eliminación de datos de Meta
 * (/api/meta/data-deletion devuelve esta URL con ?code=…). Se arma en el
 * servidor: funciona sin JavaScript.
 */
export default async function EliminacionDatosPage({ searchParams }: PageProps<"/eliminacion-datos">) {
  const { code } = await searchParams
  const value = typeof code === "string" ? code.slice(0, 64) : null
  const request = value ? await deletionRequestStatus(value) : null
  const when = (date: Date) => `${formatInTimeZone(date, "UTC", "dd/MM/yyyy HH:mm")} (UTC)`

  return (
    <LegalPage title="Eliminación de datos" updated="8 de noviembre de 2026">
      {value ? (
        <section aria-live="polite">
          <h2>Estado de tu pedido</h2>
          {request ? (
            <ul>
              <li>
                Código de confirmación: <span className="font-mono text-foreground">{request.code}</span>
              </li>
              <li>Recibido: {when(request.createdAt)}</li>
              <li>
                Estado:{" "}
                <strong className="text-foreground">
                  {request.status === "completed" ? "Completado: los datos ya se borraron" : "Recibido: lo estamos procesando"}
                </strong>
                {request.completedAt ? ` (${when(request.completedAt)})` : null}
              </li>
              {request.status === "completed" && request.result ? (
                <li>
                  {request.result.whatsappAccounts === 0
                    ? "No teníamos datos asociados a tu cuenta de Facebook."
                    : `Borramos ${request.result.whatsappAccounts === 1 ? "1 conexión" : `${request.result.whatsappAccounts} conexiones`} de WhatsApp Business y ${request.result.conversations === 1 ? "1 conversación" : `${request.result.conversations} conversaciones`}.`}
                </li>
              ) : null}
            </ul>
          ) : (
            <p>
              No encontramos un pedido con el código <span className="font-mono">{value}</span>. Revisá que esté bien
              escrito o escribinos a{" "}
              <a href={`mailto:${brand.contactEmail}`} className="underline underline-offset-4">
                {brand.contactEmail}
              </a>
              .
            </p>
          )}
        </section>
      ) : null}

      <section>
        <h2>Qué borramos</h2>
        <p>
          Cuando quitás {brand.name} de tu cuenta de Facebook y pedís que se borren tus datos, Meta nos avisa y
          borramos, de cada número de WhatsApp que conectaste con esa cuenta:
        </p>
        <ul>
          <li>la conexión: el token de acceso y los identificadores de la cuenta de WhatsApp Business y del número;</li>
          <li>las conversaciones de WhatsApp de ese negocio, con sus mensajes y los números de los clientes que escribieron.</li>
        </ul>
        <p>
          El borrado se hace en el momento en que llega el pedido. Te damos un código de confirmación para consultar el
          estado en esta página.
        </p>
      </section>

      <section>
        <h2>Otras formas de pedirlo</h2>
        <ul>
          <li>Si usás el panel, podés desconectar WhatsApp en Configuración: el token se borra al instante.</li>
          <li>
            Para borrar toda tu cuenta y los datos de tu negocio, escribinos a{" "}
            <a href={`mailto:${brand.contactEmail}`} className="underline underline-offset-4">
              {brand.contactEmail}
            </a>
            . Lo hacemos dentro de los 30 días.
          </li>
          <li>
            Si sos cliente de un negocio que usa {brand.name}, escribí BAJA por WhatsApp para dejar de recibir
            recordatorios, y pedile al negocio (o a nosotros) que borre tus datos.
          </li>
        </ul>
        <p>
          Más detalles en la{" "}
          <Link href="/privacidad" className="underline underline-offset-4">
            política de privacidad
          </Link>
          . {brand.name} es un servicio de {brand.legalName} ({brand.legalJurisdiction}).
        </p>
      </section>
    </LegalPage>
  )
}
