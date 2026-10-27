import { Link, Text } from "react-email"

import { EmailLayout, styles } from "./layout"
import { renderEmail } from "./render"

/* Correo "Alta incompleta" (24 horas y 3 días después, si faltan pasos). */

type Props = {
  businessName: string
  steps: { title: string; url: string }[]
  url: string
  preferencesUrl: string
}

export function OnboardingIncompleteEmail({ businessName, steps, url, preferencesUrl }: Props) {
  return (
    <EmailLayout
      preview={`Te ${steps.length === 1 ? "falta un paso" : `faltan ${steps.length} pasos`} para que el bot atienda en ${businessName}`}
      title={`Falta poco para ${businessName}`}
      button={{ label: "Terminar el alta", url }}
      preferencesUrl={preferencesUrl}
    >
      <Text style={styles.paragraph}>Estos pasos todavía están pendientes:</Text>
      {steps.map((step) => (
        <Text key={step.url} style={styles.item}>
          ·{" "}
          <Link href={step.url} style={{ color: "#059669" }}>
            {step.title}
          </Link>
        </Text>
      ))}
      <Text style={{ ...styles.paragraph, marginTop: "16px" }}>Cada uno lleva un par de minutos.</Text>
    </EmailLayout>
  )
}

export function onboardingIncompleteEmail(props: Props) {
  return renderEmail(`Te falta poco para terminar el alta de ${props.businessName}`, <OnboardingIncompleteEmail {...props} />)
}
