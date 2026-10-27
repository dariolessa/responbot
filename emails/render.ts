import { render } from "react-email"

export type RenderedEmail = { subject: string; html: string; text: string }

/** HTML y texto plano de un correo de React Email. */
export async function renderEmail(subject: string, element: React.ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { subject, html, text }
}
