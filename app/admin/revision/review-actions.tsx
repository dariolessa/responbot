"use client"

import { Check, Copy, Download } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

/** Copiar o bajar la revisión en Markdown (para pegarla en una sesión de ajustes del bot). */
export function ReviewActions({ markdown, filename }: { markdown: string; filename: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copiado" : "Copiar"}
      </Button>
      <Button size="sm" variant="outline" onClick={download}>
        <Download />
        Bajar .md
      </Button>
    </>
  )
}
