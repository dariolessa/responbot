import { eq } from "drizzle-orm"
import { Bell, CheckCheck } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { PreferencesForm } from "@/components/notifications/preferences-form"
import { PushToggle } from "@/components/notifications/push-toggle"
import { Button } from "@/components/ui/button"
import { getTenant } from "@/lib/auth/tenant"
import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { forUser } from "@/lib/db/scoped"
import { env } from "@/lib/env"
import { listNotifications, loadPrefs } from "@/lib/notifications/inbox"
import { formatPhone } from "@/lib/phone"
import { formatZoned, toDateString } from "@/lib/time"
import { cn } from "@/lib/utils"

import { markAllReadAction, openNotificationAction } from "./actions"

export const metadata: Metadata = { title: "Notificaciones" }

export default async function NotificacionesPage() {
  const tenant = await getTenant()
  const { db: scoped, user, role, business } = tenant
  const timezone = business.timezone
  const [items, prefs, profile, whatsapp] = await Promise.all([
    listNotifications(scoped, user.id),
    loadPrefs(scoped, user.id, role),
    forUser(db, user.id).profile(),
    scoped.whatsappAccounts.findFirst(eq(schema.whatsappAccounts.status, "active")),
  ])
  const unread = items.filter((i) => !i.read).length
  const today = toDateString(new Date(), timezone)
  const when = (at: Date) =>
    toDateString(at, timezone) === today ? formatZoned(at, timezone, "HH:mm") : formatZoned(at, timezone, "d MMM, HH:mm")
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? env.NEXT_PUBLIC_VAPID_PUBLIC_KEY : null

  return (
    <>
      <PageHeader
        title="Notificaciones"
        description="Avisos del negocio y cómo querés recibirlos."
        actions={
          unread > 0 ? (
            <form action={markAllReadAction}>
              <Button variant="outline" type="submit">
                <CheckCheck />
                Marcar todo como leído
              </Button>
            </form>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No tenés notificaciones"
          description="Te avisamos acá de reservas nuevas, cancelaciones y conversaciones que necesitan una persona."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id}>
              <form action={openNotificationAction}>
                <input type="hidden" name="id" value={item.id} />
                <button
                  type="submit"
                  className="flex w-full gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-primary")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", item.read ? "text-muted-foreground" : "font-medium")}>
                      {item.title}
                      {item.read ? null : <span className="sr-only"> (sin leer)</span>}
                    </span>
                    <span className="block text-sm text-muted-foreground">{item.body}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{when(item.createdAt)}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10 grid gap-4">
        <div>
          <h2 className="font-medium">Cómo te avisamos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Elegí los canales de cada aviso. Los correos van a {user.email}.
          </p>
        </div>
        {publicKey ? <PushToggle publicKey={publicKey} /> : null}
        <PreferencesForm
          initial={{ ...prefs, phone: profile?.phoneE164 ? formatPhone(profile.phoneE164) : "" }}
          whatsappAvailable={Boolean(whatsapp)}
        />
        {profile?.emailBouncedAt ? (
          <p className="text-sm text-destructive">
            Los correos a {user.email} rebotaron, (la dirección no existe o los marcó como spam), así que dejamos de mandarlos.
          </p>
        ) : null}
      </section>
    </>
  )
}
