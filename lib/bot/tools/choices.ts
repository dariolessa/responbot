import { z } from "zod"

import { defineTool } from "./define"

/*
 * Opciones para tocar en vez de escribir (docs/SPEC.md, "Mensajes
 * interactivos"). En WhatsApp salen como botones (hasta 3) o como lista
 * (hasta 10) debajo de la respuesta; en el chat de prueba, como botones.
 */

export const showChoices = defineTool({
  name: "show_choices",
  description:
    "Muestra opciones para que el cliente toque en vez de escribir: servicios, profesionales, horarios o una pregunta de sí o no. Aparecen como botones (hasta 3) o como lista (hasta 10) debajo de tu próxima respuesta. Usala cuando el cliente tenga que elegir entre opciones concretas que salieron de tus herramientas. En tu respuesta no repitas la lista: escribí solo la pregunta o una frase corta.",
  input: z.object({
    options: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(24).describe("Lo que ve el cliente, máximo 24 caracteres. Ej.: 'Mar 3 · 09:00'."),
          description: z
            .string()
            .trim()
            .max(72)
            .optional()
            .describe("Detalle opcional en la lista, máximo 72 caracteres. Ej.: 'con Ana · $ 600'."),
        }),
      )
      .min(1)
      .max(10),
    button: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .optional()
      .describe("Texto del botón que abre la lista cuando hay más de 3 opciones. Ej.: 'Ver horarios'."),
  }),
  async run(input, ctx) {
    ctx.choices = {
      button: input.button,
      options: input.options.map((o, i) => ({ id: `opt_${i + 1}`, title: o.title, description: o.description })),
    }
    return {
      shown: true,
      hint: "Las opciones se muestran debajo de tu respuesta. Escribí solo la pregunta, sin repetir la lista.",
    }
  },
})
