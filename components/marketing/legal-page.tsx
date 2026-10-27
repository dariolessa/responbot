import { SiteFooter, SiteHeader } from "./site-chrome"

/** Página de texto legal: encabezado, fecha de vigencia y secciones. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 md:py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Vigente desde el {updated}.</p>
        <div className="mt-10 grid gap-8 text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground [&_section]:grid [&_section]:gap-3 [&_ul]:grid [&_ul]:gap-1.5 [&_ul]:text-muted-foreground">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
