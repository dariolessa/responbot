"use client"

import { Check, Loader2, Plus, Trash2 } from "lucide-react"
import { useState, useTransition } from "react"

import { Field, FormError } from "@/components/forms/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"

import { saveBotSettings } from "./actions"

export type BotSettingsValues = {
  assistantName: string
  tone: "informal" | "formal"
  welcomeMessage: string
  faq: { question: string; answer: string }[]
  replyHours: "always" | "business_hours"
  offHoursMessage: string
}

export function BotSettingsForm({ initial }: { initial: BotSettingsValues }) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function set<K extends keyof BotSettingsValues>(key: K, value: BotSettingsValues[K]) {
    setSaved(false)
    setValues((v) => ({ ...v, [key]: value }))
  }

  function setFaq(index: number, patch: Partial<BotSettingsValues["faq"][number]>) {
    set(
      "faq",
      values.faq.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await saveBotSettings(values)
      if (result.ok) setSaved(true)
      else {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Nombre del asistente" htmlFor="bot-name" error={fieldErrors.assistantName}>
          <Input
            id="bot-name"
            value={values.assistantName}
            maxLength={40}
            onChange={(e) => set("assistantName", e.target.value)}
          />
        </Field>
        <Field label="Tono" htmlFor="bot-tone" error={fieldErrors.tone}>
          <NativeSelect
            id="bot-tone"
            value={values.tone}
            onChange={(e) => set("tone", e.target.value as BotSettingsValues["tone"])}
          >
            <option value="informal">Informal, de vos</option>
            <option value="formal">Formal, de usted</option>
          </NativeSelect>
        </Field>
        <Field
          label="Mensaje de bienvenida"
          htmlFor="bot-welcome"
          hint="El bot lo usa como base para saludar en el primer mensaje."
          error={fieldErrors.welcomeMessage}
          className="sm:col-span-2"
        >
          <Textarea
            id="bot-welcome"
            value={values.welcomeMessage}
            maxLength={500}
            placeholder="¡Hola! Soy el asistente de la peluquería. ¿En qué te ayudo?"
            onChange={(e) => set("welcomeMessage", e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Preguntas frecuentes</legend>
        <p className="-mt-1 text-xs text-muted-foreground">
          Medios de pago, estacionamiento, qué traer: lo que no esté acá ni en tus servicios, el bot no lo inventa.
        </p>
        {values.faq.map((item, index) => (
          <div key={index} className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <Field
                label={`Pregunta ${index + 1}`}
                htmlFor={`faq-q-${index}`}
                error={fieldErrors[`faq.${index}.question`]}
                className="flex-1"
              >
                <Input
                  id={`faq-q-${index}`}
                  value={item.question}
                  maxLength={200}
                  placeholder="¿Aceptan tarjeta?"
                  onChange={(e) => setFaq(index, { question: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-7 shrink-0"
                aria-label={`Quitar la pregunta ${index + 1}`}
                onClick={() =>
                  set(
                    "faq",
                    values.faq.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
            <Field label="Respuesta" htmlFor={`faq-a-${index}`} error={fieldErrors[`faq.${index}.answer`]}>
              <Textarea
                id={`faq-a-${index}`}
                value={item.answer}
                maxLength={1000}
                placeholder="Sí, débito, crédito y transferencia."
                onChange={(e) => setFaq(index, { answer: e.target.value })}
              />
            </Field>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={values.faq.length >= 30}
            onClick={() => set("faq", [...values.faq, { question: "", answer: "" }])}
          >
            <Plus />
            Agregar pregunta
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Cuándo responde"
          htmlFor="bot-hours"
          hint="El horario de atención es el del equipo."
          error={fieldErrors.replyHours}
        >
          <NativeSelect
            id="bot-hours"
            value={values.replyHours}
            onChange={(e) => set("replyHours", e.target.value as BotSettingsValues["replyHours"])}
          >
            <option value="always">Siempre, las 24 horas</option>
            <option value="business_hours">Solo en horario de atención</option>
          </NativeSelect>
        </Field>
        {values.replyHours === "business_hours" ? (
          <Field
            label="Mensaje fuera de horario"
            htmlFor="bot-off-hours"
            error={fieldErrors.offHoursMessage}
            className="sm:col-span-2"
          >
            <Textarea
              id="bot-off-hours"
              value={values.offHoursMessage}
              maxLength={500}
              placeholder="¡Hola! Ahora estamos fuera de horario. Te respondemos apenas volvamos."
              onChange={(e) => set("offHoursMessage", e.target.value)}
            />
          </Field>
        ) : null}
      </div>

      <FormError message={error} />
      <div className="flex items-center justify-end gap-3">
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
            <Check className="size-4 text-primary" />
            Guardado
          </span>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Guardar
        </Button>
      </div>
    </form>
  )
}
