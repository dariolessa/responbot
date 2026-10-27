import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from "react-email"

import { brand } from "@/lib/brand"

/*
 * Plantilla base de los correos (docs/SPEC.md, "Correos transaccionales"):
 * logo, un botón principal y un pie con enlace a las preferencias. Los
 * correos van solo al equipo del negocio; a los clientes se les escribe por
 * WhatsApp.
 */

const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export const styles = {
  paragraph: { margin: "0 0 16px", fontSize: "15px", lineHeight: "1.6", color: "#52525b" },
  small: { margin: "0", fontSize: "13px", lineHeight: "1.6", color: "#71717a" },
  item: { margin: "0 0 6px", fontSize: "15px", lineHeight: "1.5", color: "#3f3f46" },
} as const

export function EmailLayout({
  preview,
  title,
  button,
  preferencesUrl,
  children,
}: {
  preview: string
  title: string
  button?: { label: string; url: string }
  /** Enlace a /app/notificaciones; los correos de acceso no lo llevan. */
  preferencesUrl?: string
  children: React.ReactNode
}) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, padding: 0, background: "#ffffff", fontFamily: font, color: "#18181b" }}>
        <Container style={{ maxWidth: "480px", padding: "40px 16px" }}>
          <Section style={{ border: "1px solid #e4e4e7", borderRadius: "10px", padding: "32px 24px" }}>
            <Text style={{ margin: "0 0 24px", fontSize: "15px", fontWeight: 700 }}>
              Respon<span style={{ color: brand.green }}>bot</span>
            </Text>
            <Text style={{ margin: "0 0 12px", fontSize: "20px", fontWeight: 600, lineHeight: "1.3" }}>{title}</Text>
            {children}
            {button ? (
              <Button
                href={button.url}
                style={{
                  display: "inline-block",
                  background: "#059669",
                  color: "#ffffff",
                  textDecoration: "none",
                  fontSize: "15px",
                  fontWeight: 500,
                  padding: "12px 20px",
                  borderRadius: "8px",
                  marginTop: "8px",
                }}
              >
                {button.label}
              </Button>
            ) : null}
          </Section>
          {preferencesUrl ? (
            <>
              <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0 12px" }} />
              <Text style={styles.small}>
                Te escribimos porque sos parte de un negocio en {brand.name}.{" "}
                <Link href={preferencesUrl} style={{ color: "#71717a", textDecoration: "underline" }}>
                  Elegí qué avisos recibir
                </Link>
                .
              </Text>
            </>
          ) : null}
        </Container>
      </Body>
    </Html>
  )
}
