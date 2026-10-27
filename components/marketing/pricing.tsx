import { ArrowRight } from "lucide-react"
import Link from "next/link"

import { PlanCards } from "@/components/billing/plan-cards"
import { Button } from "@/components/ui/button"
import { TRIAL_DAYS } from "@/lib/billing/plans"

/** Precios de la landing y de /precios: los planes de lib/billing/plans.ts con el botón para empezar la prueba. */
export function Pricing() {
  return (
    <>
      <PlanCards
        action={(plan) => (
          <Button asChild className="w-full" variant={plan.id === "pro" ? "default" : "outline"}>
            <Link href="/login">
              Probar {TRIAL_DAYS} días gratis
              <ArrowRight />
            </Link>
          </Button>
        )}
      />
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Precios en dólares, por mes. {TRIAL_DAYS} días de prueba con todo incluido y sin tarjeta. Cambiás o cancelás
        cuando quieras.
      </p>
    </>
  )
}

export const faq: { q: string; a: string }[] = [
  {
    q: "¿Necesito cambiar mi número de WhatsApp?",
    a: "No hace falta. Conectás el número del negocio con el alta guiada de Meta y las conversaciones se atienden desde el panel. Te recomendamos que sea un número dedicado al negocio, no tu WhatsApp personal.",
  },
  {
    q: "¿Es la API oficial de WhatsApp?",
    a: "Sí. Conectamos tu número con la API oficial de Meta, con el alta guiada de Meta. No usamos programas no oficiales, así que tu número no corre riesgo de bloqueo.",
  },
  {
    q: "¿El bot puede inventar horarios o precios?",
    a: "No. Cada horario libre y cada precio salen de tu agenda y tu lista de servicios en ese momento. Si algo no lo sabe, deriva la conversación a una persona del equipo.",
  },
  {
    q: "¿Qué pasa si un cliente quiere hablar con una persona?",
    a: "El bot le avisa que alguien del equipo le va a responder, la conversación queda marcada en el panel y te llega un aviso al celular. Respondés desde el panel y, cuando terminás, se la devolvés al bot.",
  },
  {
    q: "¿Cómo cobro las señas?",
    a: "Conectás tu propia cuenta de Mercado Pago. El cliente recibe el link de pago por WhatsApp, el turno se confirma solo cuando paga y la plata va directo a tu cuenta. Viene con los planes Pro y Equipo.",
  },
  {
    q: "¿Qué pasa cuando termina la prueba?",
    a: "Si no elegiste un plan, el bot sigue contestando consultas pero deja de reservar y el panel queda en solo lectura. Elegís un plan y todo vuelve a funcionar al instante, con tus datos intactos.",
  },
  {
    q: "¿Cuánto cuesta WhatsApp aparte?",
    a: "Responder a un cliente que te escribió no tiene costo de Meta. Los recordatorios y avisos que salen fuera de las 24 horas usan plantillas que Meta cobra aparte, según su tabla de precios vigente.",
  },
]
