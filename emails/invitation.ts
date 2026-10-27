/*
 * Correo "Invitación al equipo" (docs/SPEC.md, "Correos transaccionales").
 * HTML simple como el del enlace de acceso; pasa a React Email en la Fase 4.
 */

import { brand } from "@/lib/brand"

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function invitationEmail({
  url,
  inviterName,
  businessName,
  roleLabel,
  days,
}: {
  url: string
  inviterName: string
  businessName: string
  roleLabel: string
  days: number
}) {
  const subject = `${inviterName} te invitó a ${businessName} en ${brand.name}`
  const text = [
    "Hola:",
    "",
    `${inviterName} te invitó a sumarte a ${businessName} en ${brand.name} como ${roleLabel.toLowerCase()}.`,
    "Entrá con tu cuenta de Google (o pedí un enlace de acceso) usando este mismo email:",
    url,
    "",
    `La invitación vence en ${days} días.`,
  ].join("\n")

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;border:1px solid #e4e4e7;border-radius:10px;">
            <tr>
              <td style="padding:32px 24px;">
                <p style="margin:0 0 24px;font-size:15px;font-weight:700;">Respon<span style="color:#02A82F;">bot</span></p>
                <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;">Te invitaron a ${escapeHtml(businessName)}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#52525b;">
                  ${escapeHtml(inviterName)} te sumó al equipo como ${escapeHtml(roleLabel.toLowerCase())}. Entrá con tu cuenta de Google usando este mismo email.
                </p>
                <a href="${escapeHtml(url)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:8px;">Entrar a ${brand.name}</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a;">
                  La invitación vence en ${days} días. Si no esperabas este correo, podés ignorarlo.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, html, text }
}
