import { Text } from "react-email"

import { brand } from "@/lib/brand"

import { EmailLayout, styles } from "./layout"
import { renderEmail } from "./render"

/* Correo "Enlace de acceso" (docs/SPEC.md, "Correos transaccionales"). */

export function MagicLinkEmail({ url, minutes }: { url: string; minutes: number }) {
  return (
    <EmailLayout
      preview={`Tu enlace para entrar a ${brand.name}`}
      title="Tu enlace de acceso"
      button={{ label: `Entrar a ${brand.name}`, url }}
    >
      <Text style={styles.paragraph}>
        Tocá el botón para entrar. El enlace vale por {minutes} minutos y se puede usar una sola vez.
      </Text>
      <Text style={{ ...styles.small, margin: "0 0 16px" }}>
        Si no pediste este enlace, ignorá este correo: nadie puede entrar sin él.
      </Text>
    </EmailLayout>
  )
}

export function magicLinkEmail(props: { url: string; minutes: number }) {
  return renderEmail(`Tu enlace para entrar a ${brand.name}`, <MagicLinkEmail {...props} />)
}
