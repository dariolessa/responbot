"use client"

import { Pencil } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { ResponsiveSheet } from "@/components/layout/responsive-sheet"
import { Button } from "@/components/ui/button"

import { CustomerForm } from "../new-customer"

export function EditCustomer({
  id,
  initial,
}: {
  id: string
  initial: { name: string; phone: string; notes: string }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil />
        Editar
      </Button>
      <ResponsiveSheet open={open} onOpenChange={setOpen} title="Editar cliente">
        {open ? (
          <CustomerForm
            id={id}
            initial={initial}
            onSaved={() => {
              setOpen(false)
              router.refresh()
            }}
          />
        ) : null}
      </ResponsiveSheet>
    </>
  )
}
