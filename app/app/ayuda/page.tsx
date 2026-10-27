import { ArrowRight, ChevronDown, Lightbulb } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { getTenant } from "@/lib/auth/tenant"
import { brand } from "@/lib/brand"
import { helpFor } from "@/lib/help"

export const metadata: Metadata = { title: "Ayuda" }

/*
 * Ayuda: cómo se usa el panel, pantalla por pantalla. El contenido vive en
 * lib/help.ts y se filtra por rol (un profesional no ve Facturación).
 */
export default async function AyudaPage() {
  const { role } = await getTenant()
  const { gettingStarted, topics, faq } = helpFor(role)

  return (
    <>
      <PageHeader title="Ayuda" description="Cómo se usa Responbot, paso a paso." />

      <div className="grid gap-10 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Temas de ayuda" className="lg:sticky lg:top-10 lg:self-start">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Temas</p>
          <ul className="flex flex-wrap gap-2 lg:grid lg:gap-0.5">
            {gettingStarted.length ? <TocLink href="#primeros-pasos">Primeros pasos</TocLink> : null}
            {topics.map((t) => (
              <TocLink key={t.id} href={`#${t.id}`}>
                {t.title}
              </TocLink>
            ))}
            <TocLink href="#preguntas">Preguntas frecuentes</TocLink>
          </ul>
        </nav>

        <div className="grid min-w-0 gap-10">
          {gettingStarted.length ? (
            <section id="primeros-pasos" className="scroll-mt-20 rounded-[10px] border p-4 sm:p-6">
              <h2 className="text-lg font-semibold tracking-tight">Primeros pasos</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                En este orden, y el bot queda listo para dar turnos por WhatsApp.
              </p>
              <ol className="mt-5 grid gap-2">
                {gettingStarted.map((step, i) => (
                  <li key={step.href}>
                    <Link
                      href={step.href}
                      className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-muted"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{step.title}</span>
                        <span className="block text-xs text-muted-foreground">{step.detail}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {topics.map((topic) => (
            <section key={topic.id} id={topic.id} className="scroll-mt-20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{topic.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{topic.summary}</p>
                </div>
                {topic.href ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={topic.href}>
                      {topic.hrefLabel}
                      <ArrowRight />
                    </Link>
                  </Button>
                ) : null}
              </div>
              <ol className="mt-4 grid gap-3">
                {topic.steps.map((step, i) => (
                  <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-2 text-sm leading-relaxed">
                    <span className="font-mono text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {topic.tips?.length ? (
                <ul className="mt-4 grid gap-2 rounded-md bg-muted/60 p-3 text-sm">
                  {topic.tips.map((tip) => (
                    <li key={tip} className="flex gap-2">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span className="text-muted-foreground">{tip}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <section id="preguntas" className="scroll-mt-20">
            <h2 className="text-lg font-semibold tracking-tight">Preguntas frecuentes</h2>
            <div className="mt-4 divide-y rounded-[10px] border">
              {faq.map((item) => (
                <details key={item.question} className="group px-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium">
                    {item.question}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
                  </summary>
                  <p className="pb-4 text-sm text-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
            {brand.contactEmail ? (
              <p className="mt-6 text-sm text-muted-foreground">
                ¿No encontraste lo que buscabas? Escribinos a{" "}
                <a href={`mailto:${brand.contactEmail}`} className="font-medium text-foreground underline underline-offset-4">
                  {brand.contactEmail}
                </a>{" "}
                y te ayudamos.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </>
  )
}

function TocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={href}
        className="flex min-h-9 items-center rounded-md border px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground lg:min-h-8 lg:border-0 lg:px-2"
      >
        {children}
      </a>
    </li>
  )
}
