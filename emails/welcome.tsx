import { Text } from "react-email"

import { brand } from "@/lib/brand"

import { EmailLayout, styles } from "./layout"
import { renderEmail } from "./render"

/* Correo "Bienvenida" (primer ingreso): qué sigue para tener el bot andando. */

export function WelcomeEmail({ name, url }: { name: string | null; url: string }) {
  return (
    <EmailLayout
      preview={`Bienvenido a ${brand.name}: tres pasos para que el bot atienda por vos`}
      title={name ? `¡Hola, ${name}!` : "¡Te damos la bienvenida!"}
      button={{ label: "Seguir con el alta", url }}
    >
      <Text style={styles.paragraph}>
        Gracias por probar {brand.name}. En pocos minutos tu asistente puede responder por WhatsApp y reservar
        turnos solo:
      </Text>
      <Text style={styles.item}>1. Completá el alta: servicios, equipo, horarios y reglas.</Text>
      <Text style={styles.item}>2. Conectá el WhatsApp del negocio.</Text>
      <Text style={{ ...styles.item, marginBottom: "20px" }}>3. Probá el bot desde el chat de prueba del panel.</Text>
    </EmailLayout>
  )
}

export function welcomeEmail(props: { name: string | null; url: string }) {
  return renderEmail(`Bienvenido a ${brand.name}`, <WelcomeEmail {...props} />)
}
