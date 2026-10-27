import { and, eq, gt, inArray, isNull, lte, sql, type SQL } from "drizzle-orm"
import type {
  PgColumn,
  PgDatabase,
  PgQueryResultHKT,
  PgTable,
} from "drizzle-orm/pg-core"

import * as schema from "./schema"

/*
 * Capa única de acceso a datos (docs/SPEC.md, "Login y cuentas").
 *
 * - `forBusiness(db, businessId)` devuelve repositorios que agregan
 *   `business_id = …` a TODA lectura, escritura y borrado, y fuerzan el
 *   business_id en cada inserción. No hay forma de pasarle otro negocio.
 * - `forUser(db, userId)` cubre lo que es de la cuenta y no de un negocio:
 *   sus membresías, el negocio activo, aceptar invitaciones y crear un negocio.
 *
 * Pantallas, server actions y rutas no importan `db` directo: piden un scope
 * con lib/auth/tenant.ts (que resuelve la sesión y el rol) y usan esto.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PgDatabase<PgQueryResultHKT, any, any>

type TenantTable = PgTable & { id: PgColumn; businessId: PgColumn }

/** Tablas que pertenecen a un negocio y solo se acceden con su business_id. */
export const tenantTables = {
  memberships: schema.memberships,
  invitations: schema.invitations,
  bookingRules: schema.bookingRules,
  resources: schema.resources,
  services: schema.services,
  resourceServices: schema.resourceServices,
  workingHours: schema.workingHours,
  timeOff: schema.timeOff,
  customers: schema.customers,
  bookings: schema.bookings,
  bookingEvents: schema.bookingEvents,
  payments: schema.payments,
  waitlistEntries: schema.waitlistEntries,
  whatsappAccounts: schema.whatsappAccounts,
  mpAccounts: schema.mpAccounts,
  conversations: schema.conversations,
  messages: schema.messages,
  botSettings: schema.botSettings,
  scheduledMessages: schema.scheduledMessages,
  notifications: schema.notifications,
  notificationPrefs: schema.notificationPrefs,
  usageCounters: schema.usageCounters,
  auditLogs: schema.auditLogs,
} as const

type TenantTables = typeof tenantTables

type Select<T extends TenantTable> = T["$inferSelect"]
/** Lo que se puede insertar: todo menos business_id, que lo pone el scope. */
export type TenantInsert<T extends TenantTable> = Omit<T["$inferInsert"], "businessId">
type TenantUpdate<T extends TenantTable> = Partial<Omit<T["$inferInsert"], "businessId" | "id">>

type OrderBy = SQL | PgColumn

export type FindOptions = {
  where?: SQL
  orderBy?: OrderBy | OrderBy[]
  limit?: number
  offset?: number
}

function assertBusinessId(businessId: string): void {
  if (!businessId || typeof businessId !== "string") {
    throw new Error("scoped: falta business_id; ninguna consulta corre sin negocio")
  }
}

function withoutBusinessId<V extends object>(values: V): V {
  if ("businessId" in values) {
    const rest = { ...values } as Record<string, unknown>
    delete rest.businessId
    return rest as V
  }
  return values
}

function tenantRepo<T extends TenantTable>(db: AnyDb, table: T, businessId: string) {
  const scope = (where?: SQL) => and(eq(table.businessId, businessId), where)

  async function findMany(options: FindOptions = {}): Promise<Select<T>[]> {
    let query = db
      .select()
      .from(table as PgTable)
      .where(scope(options.where))
      .$dynamic()
    if (options.orderBy) query = query.orderBy(...[options.orderBy].flat())
    if (options.limit !== undefined) query = query.limit(options.limit)
    if (options.offset !== undefined) query = query.offset(options.offset)
    return (await query) as Select<T>[]
  }

  async function findFirst(where?: SQL, orderBy?: FindOptions["orderBy"]) {
    const [row] = await findMany({ where, orderBy, limit: 1 })
    return row as Select<T> | undefined
  }

  return {
    findMany,
    findFirst,
    findById: (id: string) => findFirst(eq(table.id, id)),

    async count(where?: SQL): Promise<number> {
      const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(table as PgTable)
        .where(scope(where))
      return row?.value ?? 0
    },

    async insert(values: TenantInsert<T> | TenantInsert<T>[]): Promise<Select<T>[]> {
      const rows = ([values].flat() as object[]).map((v) => ({ ...v, businessId }))
      if (rows.length === 0) return []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await db.insert(table).values(rows as any).returning()) as Select<T>[]
    },

    async update(where: SQL | undefined, values: TenantUpdate<T>): Promise<Select<T>[]> {
      return (await db
        .update(table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set(withoutBusinessId(values) as any)
        .where(scope(where))
        .returning()) as Select<T>[]
    },

    async delete(where?: SQL): Promise<Select<T>[]> {
      return (await db.delete(table).where(scope(where)).returning()) as Select<T>[]
    },
  }
}

export type TenantRepo<T extends TenantTable> = ReturnType<typeof tenantRepo<T>>

export type ScopedDb = { readonly businessId: string } & {
  readonly [K in keyof TenantTables]: TenantRepo<TenantTables[K]>
} & {
  /** El negocio del scope. */
  business(): Promise<schema.Business | undefined>
  updateBusiness(
    values: Partial<Omit<typeof schema.businesses.$inferInsert, "id" | "slug">>,
  ): Promise<schema.Business | undefined>
  /** Miembros del negocio con su nombre y email (la tabla users no es del negocio). */
  members(): Promise<MemberWithUser[]>
  /** Dispositivos con push de un miembro del negocio (vacío si no es miembro). */
  memberPushSubscriptions(userId: string): Promise<(typeof schema.pushSubscriptions.$inferSelect)[]>
  /** Borra una suscripción push vencida (404/410) de un miembro del negocio. */
  deleteMemberPushSubscription(userId: string, endpoint: string): Promise<void>
  /** Corre `fn` en una transacción, con un scope del mismo negocio. */
  transaction<R>(fn: (tx: ScopedDb) => Promise<R>): Promise<R>
}

export type MemberWithUser = {
  membershipId: string
  userId: string
  role: schema.Role
  active: boolean
  name: string | null
  email: string | null
  image: string | null
  /** WhatsApp de la persona para avisos, en E.164. */
  phoneE164: string | null
  emailBouncedAt: Date | null
}

/** Acceso a datos de un negocio. Toda consulta queda filtrada por `businessId`. */
export function forBusiness(db: AnyDb, businessId: string): ScopedDb {
  assertBusinessId(businessId)

  const repos = Object.fromEntries(
    Object.entries(tenantTables).map(([key, table]) => [key, tenantRepo(db, table, businessId)]),
  ) as { [K in keyof TenantTables]: TenantRepo<TenantTables[K]> }

  return Object.freeze({
    businessId,
    ...repos,

    async business() {
      const [row] = await db
        .select()
        .from(schema.businesses)
        .where(eq(schema.businesses.id, businessId))
        .limit(1)
      return row
    },

    async updateBusiness(values) {
      const set = { ...values } as Record<string, unknown>
      delete set.id
      delete set.slug
      const [row] = await db
        .update(schema.businesses)
        .set(set)
        .where(eq(schema.businesses.id, businessId))
        .returning()
      return row
    },

    async members() {
      return db
        .select({
          membershipId: schema.memberships.id,
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          active: schema.memberships.active,
          name: schema.users.name,
          email: schema.users.email,
          image: schema.users.image,
          phoneE164: schema.users.phoneE164,
          emailBouncedAt: schema.users.emailBouncedAt,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.businessId, businessId))
        .orderBy(schema.memberships.createdAt)
    },

    async memberPushSubscriptions(userId) {
      return db
        .select({ subscription: schema.pushSubscriptions })
        .from(schema.pushSubscriptions)
        .innerJoin(
          schema.memberships,
          and(
            eq(schema.memberships.userId, schema.pushSubscriptions.userId),
            eq(schema.memberships.businessId, businessId),
            eq(schema.memberships.active, true),
          ),
        )
        .where(eq(schema.pushSubscriptions.userId, userId))
        .then((rows) => rows.map((r) => r.subscription))
    },

    async deleteMemberPushSubscription(userId, endpoint) {
      const member = await db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.businessId, businessId)))
        .limit(1)
      if (member.length === 0) return
      await db
        .delete(schema.pushSubscriptions)
        .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)))
    },

    transaction<R>(fn: (tx: ScopedDb) => Promise<R>) {
      return db.transaction((tx) => fn(forBusiness(tx, businessId)))
    },
  })
}

// ---------------------------------------------------------------------------
// Datos de la cuenta (no de un negocio)
// ---------------------------------------------------------------------------

export type MembershipWithBusiness = {
  membershipId: string
  role: schema.Role
  businessId: string
  businessName: string
  businessSlug: string
  timezone: string
  logoUrl: string | null
}

export type NewBusinessInput = {
  name: string
  slug: string
  archetype: (typeof schema.archetypeEnum.enumValues)[number]
  timezone: string
  currency: string
  trialEndsAt: Date
  address?: string | null
  onboardingCompleted?: string[]
}

/** Lo que pertenece a la cuenta de un usuario: membresías e invitaciones. */
export function forUser(db: AnyDb, userId: string) {
  if (!userId) throw new Error("scoped: falta user_id")

  async function listMemberships(): Promise<MembershipWithBusiness[]> {
    return db
      .select({
        membershipId: schema.memberships.id,
        role: schema.memberships.role,
        businessId: schema.businesses.id,
        businessName: schema.businesses.name,
        businessSlug: schema.businesses.slug,
        timezone: schema.businesses.timezone,
        logoUrl: schema.businesses.logoUrl,
      })
      .from(schema.memberships)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.memberships.businessId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.active, true)))
      .orderBy(schema.businesses.name)
  }

  /** Membresía activa del usuario en ese negocio, o undefined. */
  async function membershipIn(businessId: string) {
    const [row] = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, userId),
          eq(schema.memberships.businessId, businessId),
          eq(schema.memberships.active, true),
        ),
      )
      .limit(1)
    return row
  }

  return {
    listMemberships,

    membershipIn,

    async lastBusinessId(): Promise<string | null> {
      const [row] = await db
        .select({ id: schema.users.lastBusinessId })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1)
      return row?.id ?? null
    },

    /** Cambia el negocio activo; solo si el usuario es miembro activo de él. */
    async setActiveBusiness(businessId: string): Promise<boolean> {
      const membership = await membershipIn(businessId)
      if (!membership) return false
      await db
        .update(schema.users)
        .set({ lastBusinessId: businessId })
        .where(eq(schema.users.id, userId))
      return true
    },

    /**
     * Une al usuario a los negocios que lo invitaron a su email (invitaciones
     * vigentes y no aceptadas). Devuelve los business_id a los que se unió.
     */
    async acceptPendingInvitations(email: string): Promise<string[]> {
      const normalized = email.trim().toLowerCase()
      return db.transaction(async (tx) => {
        const pending = await tx
          .select()
          .from(schema.invitations)
          .where(
            and(
              sql`lower(${schema.invitations.email}) = ${normalized}`,
              isNull(schema.invitations.acceptedAt),
              gt(schema.invitations.expiresAt, new Date()),
            ),
          )
          .for("update")

        const joined: string[] = []
        for (const invitation of pending) {
          await tx
            .insert(schema.memberships)
            .values({ businessId: invitation.businessId, userId, role: invitation.role })
            .onConflictDoUpdate({
              target: [schema.memberships.businessId, schema.memberships.userId],
              set: { role: invitation.role, active: true },
            })
          await tx
            .update(schema.invitations)
            .set({ acceptedAt: new Date() })
            .where(eq(schema.invitations.id, invitation.id))
          // Si la invitación era para un profesional de la agenda, esa columna pasa a ser suya.
          if (invitation.resourceId) {
            await tx
              .update(schema.resources)
              .set({ userId })
              .where(
                and(
                  eq(schema.resources.id, invitation.resourceId),
                  eq(schema.resources.businessId, invitation.businessId),
                ),
              )
          }
          joined.push(invitation.businessId)
        }

        if (joined.length > 0) {
          await tx
            .update(schema.users)
            .set({ lastBusinessId: joined[0] })
            .where(eq(schema.users.id, userId))
        }
        return joined
      })
    },

    /** Datos de la cuenta que se ven en Notificaciones (WhatsApp para avisos). */
    async profile() {
      const [row] = await db
        .select({ phoneE164: schema.users.phoneE164, emailBouncedAt: schema.users.emailBouncedAt })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1)
      return row
    },

    async setPhone(phoneE164: string | null) {
      await db.update(schema.users).set({ phoneE164 }).where(eq(schema.users.id, userId))
    },

    /** Guarda el dispositivo para push. Si el endpoint era de otra cuenta (otro login en el mismo navegador), pasa a esta. */
    async savePushSubscription(input: { endpoint: string; p256dh: string; auth: string; userAgent: string | null }) {
      await db
        .insert(schema.pushSubscriptions)
        .values({ ...input, userId })
        .onConflictDoUpdate({
          target: schema.pushSubscriptions.endpoint,
          set: { userId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent },
        })
    },

    async deletePushSubscription(endpoint: string) {
      await db
        .delete(schema.pushSubscriptions)
        .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)))
    },

    async hasPushSubscription(endpoint: string): Promise<boolean> {
      const rows = await db
        .select({ id: schema.pushSubscriptions.id })
        .from(schema.pushSubscriptions)
        .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)))
        .limit(1)
      return rows.length > 0
    },

    /** Alta de un negocio: el usuario queda como dueño y como negocio activo. */
    async createBusiness(input: NewBusinessInput): Promise<schema.Business> {
      return db.transaction(async (tx) => {
        const [business] = await tx.insert(schema.businesses).values(input).returning()
        if (!business) throw new Error("No se pudo crear el negocio")
        const scoped = forBusiness(tx, business.id)
        await scoped.memberships.insert({ userId, role: "owner" })
        await scoped.bookingRules.insert({})
        await scoped.botSettings.insert({})
        await tx
          .update(schema.users)
          .set({ lastBusinessId: business.id })
          .where(eq(schema.users.id, userId))
        return business
      })
    },
  }
}

export type UserScope = ReturnType<typeof forUser>

// ---------------------------------------------------------------------------
// Plataforma (webhooks y crons)
// ---------------------------------------------------------------------------

/**
 * Las únicas búsquedas entre negocios: un evento de Meta trae el
 * phone_number_id (o el waba_id) y hay que saber de qué negocio es antes de
 * tener un scope; el cron de tokens recorre todas las cuentas conectadas.
 * Devuelven la cuenta con su business_id; todo lo demás se hace con
 * `forBusiness`.
 */
export function forPlatform(db: AnyDb) {
  return {
    async whatsAppAccountByPhoneNumberId(phoneNumberId: string) {
      const [row] = await db
        .select()
        .from(schema.whatsappAccounts)
        .where(eq(schema.whatsappAccounts.phoneNumberId, phoneNumberId))
        .limit(1)
      return row
    },

    whatsAppAccountsByWabaId(wabaId: string) {
      return db.select().from(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.wabaId, wabaId))
    },

    activeWhatsAppAccounts() {
      return db
        .select()
        .from(schema.whatsappAccounts)
        .where(eq(schema.whatsappAccounts.status, "active"))
    },

    /** Negocios con su zona horaria, para los crons que dependen de la hora local (resúmenes, correos de alta). */
    businessesForCron() {
      return db
        .select({ id: schema.businesses.id, timezone: schema.businesses.timezone })
        .from(schema.businesses)
        .orderBy(schema.businesses.createdAt)
    },

    /**
     * Negocios con mensajes programados vencidos o avisos sin entregar; el
     * cron de cada 5 minutos procesa cada uno con su scope.
     */
    async businessesWithPendingWork(now: Date, maxAttempts: number): Promise<string[]> {
      const due = await db
        .selectDistinct({ id: schema.scheduledMessages.businessId })
        .from(schema.scheduledMessages)
        .where(
          and(
            eq(schema.scheduledMessages.status, "pending"),
            lte(schema.scheduledMessages.sendAt, now),
            sql`${schema.scheduledMessages.attempts} < ${maxAttempts}`,
          ),
        )
      const pending = await db
        .selectDistinct({ id: schema.notifications.businessId })
        .from(schema.notifications)
        .where(
          and(
            gt(schema.notifications.createdAt, new Date(now.getTime() - 86_400_000)),
            sql`exists (select 1 from jsonb_each_text(${schema.notifications.sentStatus}) s where s.value = 'pending')`,
          ),
        )
      return [...new Set([...due, ...pending].map((r) => r.id))]
    },

    /** Resend avisó un rebote o una queja: no se le mandan más correos de avisos a esa dirección. */
    async markEmailBounced(email: string, at: Date) {
      const rows = await db
        .update(schema.users)
        .set({ emailBouncedAt: at })
        .where(inArray(sql`lower(${schema.users.email})`, [email.trim().toLowerCase()]))
        .returning({ id: schema.users.id })
      return rows.length
    },
  }
}
