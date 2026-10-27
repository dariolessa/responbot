import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { adminReview } from "@/lib/pilots/admin"
import { toDateString } from "@/lib/time"

import { ReviewActions } from "./review-actions"

export const metadata: Metadata = { title: "Revisión del bot" }
export const dynamic = "force-dynamic"

const DAY_MS = 86_400_000
const periods = [7, 14, 30] as const

export default async function RevisionPage({ searchParams }: PageProps<"/admin/revision">) {
  const { dias } = await searchParams
  const days = periods.find((p) => String(p) === dias) ?? 7
  const now = new Date()
  const markdown = await adminReview(new Date(now.getTime() - days * DAY_MS), now)

  return (
    <>
      <PageHeader
        title="Revisión del bot"
        description="Las respuestas que los negocios marcaron como malas y las que fallaron, con la conversación previa. Sin teléfonos ni nombres de clientes."
        actions={
          <>
            {periods.map((p) => (
              <Button key={p} asChild size="sm" variant={p === days ? "secondary" : "ghost"}>
                <Link href={`/admin/revision?dias=${p}`}>{p} días</Link>
              </Button>
            ))}
            <ReviewActions markdown={markdown} filename={`revision-bot-${toDateString(now, "America/Montevideo")}.md`} />
          </>
        }
      />
      <pre className="overflow-x-auto rounded-[10px] border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {markdown}
      </pre>
    </>
  )
}
