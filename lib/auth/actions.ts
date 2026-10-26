"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { signOut } from "@/lib/auth"
import { requireUser } from "@/lib/auth/tenant"
import { db } from "@/lib/db"
import { forUser } from "@/lib/db/scoped"

const switchSchema = z.object({ businessId: z.uuid() })

/** Selector de negocio activo: solo cambia a negocios donde el usuario es miembro. */
export async function switchBusiness(input: { businessId: string }) {
  const user = await requireUser()
  const { businessId } = switchSchema.parse(input)
  const ok = await forUser(db, user.id).setActiveBusiness(businessId)
  if (!ok) throw new Error("No sos miembro de ese negocio")
  revalidatePath("/app", "layout")
  redirect("/app/agenda")
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" })
}
