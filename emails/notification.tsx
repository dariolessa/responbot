import { Text } from "react-email"

import { EmailLayout, styles } from "./layout"
import { renderEmail } from "./render"

/*
 * Correo de un aviso del despachador (WhatsApp desconectado, resumen diario
 * opcional): el mismo título y texto que en el panel, con un botón al lugar
 * del panel donde se resuelve.
 */

type Props = {
  businessName: string
  title: string
  body: string
  button: { label: string; url: string }
  preferencesUrl: string
  /** Líneas extra debajo del texto (por ejemplo el detalle de un resumen). */
  lines?: string[]
}

export function NotificationEmail({ businessName, title, body, button, preferencesUrl, lines = [] }: Props) {
  return (
    <EmailLayout preview={body} title={title} button={button} preferencesUrl={preferencesUrl}>
      <Text style={{ ...styles.small, margin: "0 0 12px" }}>{businessName}</Text>
      <Text style={styles.paragraph}>{body}</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.item}>
          {line}
        </Text>
      ))}
      {lines.length ? <Text style={{ margin: "0 0 12px" }}>{" "}</Text> : null}
    </EmailLayout>
  )
}

export function notificationEmail(subject: string, props: Props) {
  return renderEmail(subject, <NotificationEmail {...props} />)
}
