import { Text } from "react-email"

import { brand } from "@/lib/brand"

import { EmailLayout, styles } from "./layout"
import { renderEmail } from "./render"

/* Correo "Invitación al equipo" (docs/SPEC.md, "Correos transaccionales"). */

type Props = { url: string; inviterName: string; businessName: string; roleLabel: string; days: number }

export function InvitationEmail({ url, inviterName, businessName, roleLabel, days }: Props) {
  return (
    <EmailLayout
      preview={`${inviterName} te invitó a ${businessName}`}
      title={`Te invitaron a ${businessName}`}
      button={{ label: `Entrar a ${brand.name}`, url }}
    >
      <Text style={styles.paragraph}>
        {inviterName} te sumó al equipo como {roleLabel.toLowerCase()}. Entrá con tu cuenta de Google (o pedí un
        enlace de acceso) usando este mismo email.
      </Text>
      <Text style={{ ...styles.small, margin: "0 0 16px" }}>
        La invitación vence en {days} días. Si no esperabas este correo, podés ignorarlo.
      </Text>
    </EmailLayout>
  )
}

export function invitationEmail(props: Props) {
  return renderEmail(`${props.inviterName} te invitó a ${props.businessName} en ${brand.name}`, <InvitationEmail {...props} />)
}
