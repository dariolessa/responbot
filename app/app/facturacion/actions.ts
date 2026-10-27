"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { requirePermission } from "@/lib/auth/tenant"
import { billingDeps } from "@/lib/billing/deps"
import { paidPlanIds } from "@/lib/billing/plans"
import { openPortal, startCheckout } from "@/lib/billing/stripe"

/*
 * Facturación: elegir plan (Checkout de Stripe) y administrar la suscripción
 * (Customer Portal). Solo el dueño. Se llaman desde formularios: terminan en
 * una redirección a Stripe o de vuelta con el error en la URL.
 */

const planInput = z.enum(paidPlanIds)

export async function subscribeAction(formData: FormData) {
  const tenant = await requirePermission("manageBilling")
  const plan = planInput.safeParse(formData.get("plan"))
  const deps = billingDeps()
  if (!plan.success || !deps) redirect("/app/facturacion?estado=error")
  let url: string
  try {
    url = await startCheckout(tenant.db, { plan: plan.data, ownerEmail: tenant.user.email }, deps)
  } catch (error) {
    console.error("[facturación] no se pudo abrir Checkout", tenant.business.businessId, error)
    redirect("/app/facturacion?estado=error")
  }
  redirect(url)
}

export async function portalAction() {
  const tenant = await requirePermission("manageBilling")
  const deps = billingDeps()
  if (!deps) redirect("/app/facturacion?estado=error")
  let url: string | null
  try {
    url = await openPortal(tenant.db, deps)
  } catch (error) {
    console.error("[facturación] no se pudo abrir el portal", tenant.business.businessId, error)
    redirect("/app/facturacion?estado=error")
  }
  redirect(url ?? "/app/facturacion")
}
