/*
 * Correo "Enlace de acceso" (docs/SPEC.md, "Correos transaccionales").
 * Versión en HTML simple; pasa a React Email junto con el resto de los correos
 * en la Fase 4.
 */

import { brand } from "@/lib/brand"

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function magicLinkEmail({ url, minutes }: { url: string; minutes: number }) {
  const safeUrl = escapeHtml(url)
  const subject = `Tu enlace para entrar a ${brand.name}`
  const text = [
    "Hola:",
    "",
    `Entrá a ${brand.name} con este enlace. Vale por ${minutes} minutos y se puede usar una sola vez:`,
    url,
    "",
    "Si no pediste este enlace, ignorá este correo: nadie puede entrar sin él.",
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
                <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;">Tu enlace de acceso</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#52525b;">
                  Tocá el botón para entrar. El enlace vale por ${minutes} minutos y se puede usar una sola vez.
                </p>
                <a href="${safeUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:8px;">Entrar a ${brand.name}</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a;">
                  Si no pediste este enlace, ignorá este correo: nadie puede entrar sin él.
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
