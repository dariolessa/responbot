"use client"

import { Smartphone, SquarePlus } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

import { ConnectWhatsAppButton } from "./connect-button"

/*
 * Antes de conectar: ¿el número que ya usás en la app WhatsApp Business
 * (coexistencia, sigue andando en el celular) o un número nuevo solo para el
 * bot? Cada opción abre la variante que corresponde del alta de Meta.
 */

type Choice = "app" | "new"

const options: { value: Choice; title: string; description: string; icon: typeof Smartphone }[] = [
  {
    value: "app",
    title: "Mi número de WhatsApp Business",
    description:
      "El que ya usás en la app WhatsApp Business del celular. Sigue andando ahí: vos y el bot atienden el mismo número.",
    icon: Smartphone,
  },
  {
    value: "new",
    title: "Un número nuevo solo para el bot",
    description:
      "Un número que no esté en WhatsApp (por ejemplo, un chip aparte). Se atiende solo desde Responbot, no desde la app.",
    icon: SquarePlus,
  },
]

export function ConnectWhatsAppChoice(props: { appId: string; configId: string; version: string }) {
  const [choice, setChoice] = useState<Choice>("app")

  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">¿Qué número querés conectar?</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
              choice === option.value && "border-primary bg-primary/5",
            )}
          >
            <input
              type="radio"
              name="whatsapp-number"
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              className="mt-1 accent-primary"
            />
            <option.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="grid gap-0.5">
              <span className="font-medium">{option.title}</span>
              <span className="text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {choice === "app" ? (
        <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
          <li>Tiene que ser la app WhatsApp Business (no el WhatsApp común), actualizada.</li>
          <li>Tené el celular a mano: Meta te pide escanear un código QR desde la app.</li>
          <li>Podés compartir tus contactos y los chats de los últimos 6 meses para verlos en Responbot.</li>
          <li>Cuando respondés desde el celular, el bot deja tranquilo a ese cliente por unas horas.</li>
        </ul>
      ) : null}

      <ConnectWhatsAppButton
        key={choice}
        {...props}
        coexistence={choice === "app"}
        label="Conectar WhatsApp"
      />
    </div>
  )
}
