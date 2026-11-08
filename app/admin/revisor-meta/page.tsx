import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { REVIEWER_BUSINESS_NAME, REVIEWER_EMAIL } from "@/lib/pilots/reviewer"

import { ReviewerForm } from "./reviewer-form"

export const metadata: Metadata = { title: "Revisor de Meta" }

/*
 * Cuenta de prueba para el App Review de Meta, desde el navegador: hace lo
 * mismo que `pnpm seed:reviewer` con la contraseña que se escribe acá (solo
 * se guarda su hash). Ver docs/META-APP-REVIEW.md.
 */
export default function RevisorMetaPage() {
  return (
    <>
      <PageHeader
        title="Revisor de Meta"
        description={`Crea o actualiza ${REVIEWER_EMAIL} con el negocio "${REVIEWER_BUSINESS_NAME}" (todo habilitado, sin cobro). Se puede repetir para cambiar la contraseña.`}
      />
      <ReviewerForm />
      <p className="mt-6 max-w-xl text-sm text-muted-foreground">
        Los revisores entran en https://responbot.com/login?password=1 con ese email y esta contraseña. No se guarda en
        ningún lado salvo su hash en la base.
      </p>
    </>
  )
}
