import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import type { AdapterAccountType } from "next-auth/adapters"

/*
 * Esquema completo de docs/SPEC.md, sección "Modelo de datos".
 *
 * - Fechas en timestamptz (UTC). La zona del negocio se aplica solo al mostrar.
 * - Montos en enteros de centésimos; la moneda vive en businesses.currency y se
 *   copia en bookings y payments para que el histórico no cambie.
 * - Las tablas de negocio tienen business_id y se acceden solo desde
 *   lib/db/scoped.ts.
 * - La restricción de exclusión gist de bookings no la expresa Drizzle: está
 *   escrita a mano en la migración inicial (ver drizzle/0000_*.sql).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

const id = () => uuid("id").primaryKey().defaultRandom()

const businessRef = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" })

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const archetypeEnum = pgEnum("archetype", ["services", "health", "real_estate", "spaces"])
export const planEnum = pgEnum("plan", ["trial", "basic", "pro", "team"])
export const roleEnum = pgEnum("membership_role", ["owner", "admin", "staff"])
export const depositModeEnum = pgEnum("deposit_mode", ["none", "fixed", "percent"])
export const resourceTypeEnum = pgEnum("resource_type", ["staff", "room", "court", "agent"])
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending_payment",
  "confirmed",
  "client_confirmed",
  "completed",
  "no_show",
  "cancelled",
  "expired",
])
export const depositStatusEnum = pgEnum("deposit_status", ["none", "pending", "paid", "refunded"])
export const bookingSourceEnum = pgEnum("booking_source", ["whatsapp", "panel", "test_chat"])
export const actorTypeEnum = pgEnum("actor_type", ["user", "customer", "bot", "system"])
export const channelEnum = pgEnum("channel", ["panel", "whatsapp", "system"])
export const paymentProviderEnum = pgEnum("payment_provider", ["mercadopago"])
export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "waiting",
  "offered",
  "booked",
  "cancelled",
  "expired",
])
export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "disconnected",
  "token_expired",
])
export const conversationModeEnum = pgEnum("conversation_mode", ["bot", "human"])
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"])
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "audio",
  "image",
  "interactive",
  "template",
  "system",
])
export const messageStatusEnum = pgEnum("message_status", [
  "received",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
])
export const toneEnum = pgEnum("bot_tone", ["informal", "formal"])
export const replyHoursEnum = pgEnum("reply_hours", ["always", "business_hours"])
export const scheduledKindEnum = pgEnum("scheduled_kind", [
  "reminder_24h",
  "reminder_2h",
  "reactivation",
  "waitlist_offer",
  "post_service",
])
export const scheduledStatusEnum = pgEnum("scheduled_status", [
  "pending",
  "sent",
  "failed",
  "cancelled",
])

// ---------------------------------------------------------------------------
// Auth.js (adapter de Drizzle)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  /** Negocio activo del selector; se usa también como "último negocio usado". */
  lastBusinessId: uuid("last_business_id").references((): AnyPgColumn => businesses.id, {
    onDelete: "set null",
  }),
  ...timestamps,
})

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] }), index().on(t.userId)],
)

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index().on(t.userId)],
)

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

// ---------------------------------------------------------------------------
// Negocios, miembros e invitaciones
// ---------------------------------------------------------------------------

export const businesses = pgTable("businesses", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  archetype: archetypeEnum("archetype").notNull().default("services"),
  timezone: text("timezone").notNull().default("America/Montevideo"),
  currency: text("currency").notNull().default("UYU"),
  address: text("address"),
  logoUrl: text("logo_url"),
  plan: planEnum("plan").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  ...timestamps,
})

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    businessId: businessRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.businessId, t.userId), index().on(t.userId)],
)

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    businessId: businessRef(),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.email), index().on(t.businessId)],
)

// ---------------------------------------------------------------------------
// Configuración de reservas, recursos y servicios
// ---------------------------------------------------------------------------

export const bookingRules = pgTable(
  "booking_rules",
  {
    id: id(),
    businessId: businessRef().unique(),
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(60),
    maxDaysAhead: integer("max_days_ahead").notNull().default(60),
    slotStepMinutes: integer("slot_step_minutes").notNull().default(15),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    depositMode: depositModeEnum("deposit_mode").notNull().default("none"),
    /** Centésimos si es fijo; porcentaje entero (0–100) si es porcentaje. */
    depositValue: integer("deposit_value").notNull().default(0),
    cancelHours: integer("cancel_hours").notNull().default(24),
    holdMinutes: integer("hold_minutes").notNull().default(15),
    ...timestamps,
  },
  (t) => [
    check("booking_rules_slot_step_positive", sql`${t.slotStepMinutes} > 0`),
    check(
      "booking_rules_deposit_percent_range",
      sql`${t.depositMode} <> 'percent' OR ${t.depositValue} BETWEEN 0 AND 100`,
    ),
  ],
)

export const resources = pgTable(
  "resources",
  {
    id: id(),
    businessId: businessRef(),
    type: resourceTypeEnum("type").notNull().default("staff"),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(1),
    /** Usuario del panel cuando el recurso es un profesional con acceso. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    color: text("color"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index().on(t.businessId)],
)

export const services = pgTable(
  "services",
  {
    id: id(),
    businessId: businessRef(),
    name: text("name").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull(),
    price: integer("price").notNull(),
    depositOverride: integer("deposit_override"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index().on(t.businessId),
    check("services_duration_positive", sql`${t.durationMinutes} > 0`),
    check("services_price_non_negative", sql`${t.price} >= 0`),
  ],
)

export const resourceServices = pgTable(
  "resource_services",
  {
    id: id(),
    businessId: businessRef(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    customDuration: integer("custom_duration"),
    customPrice: integer("custom_price"),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.resourceId, t.serviceId), index().on(t.businessId)],
)

export const workingHours = pgTable(
  "working_hours",
  {
    id: id(),
    businessId: businessRef(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    /** 0 = domingo … 6 = sábado (como Date#getDay). */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    ...timestamps,
  },
  (t) => [
    index().on(t.businessId),
    index().on(t.resourceId, t.weekday),
    check("working_hours_weekday_range", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("working_hours_range", sql`${t.startTime} < ${t.endTime}`),
  ],
)

export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    businessId: businessRef(),
    /** Nulo = bloqueo de todo el negocio (feriado, cierre). */
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [
    index().on(t.businessId, t.startsAt),
    check("time_off_range", sql`${t.startsAt} < ${t.endsAt}`),
  ],
)

// ---------------------------------------------------------------------------
// Clientes y turnos
// ---------------------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: id(),
    businessId: businessRef(),
    phoneE164: text("phone_e164").notNull(),
    name: text("name"),
    notes: text("notes"),
    noShowCount: integer("no_show_count").notNull().default(0),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    avgIntervalDays: integer("avg_interval_days"),
    optedOut: boolean("opted_out").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.businessId, t.phoneE164)],
)

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    businessId: businessRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    price: integer("price").notNull(),
    currency: text("currency").notNull(),
    depositAmount: integer("deposit_amount").notNull().default(0),
    depositStatus: depositStatusEnum("deposit_status").notNull().default("none"),
    source: bookingSourceEnum("source").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    ...timestamps,
  },
  (t) => [
    index().on(t.businessId, t.startsAt),
    index().on(t.resourceId, t.startsAt),
    index().on(t.customerId),
    check("bookings_range", sql`${t.startsAt} < ${t.endsAt}`),
    // + bookings_no_overlap (EXCLUDE USING gist), en la migración.
  ],
)

export const bookingEvents = pgTable(
  "booking_events",
  {
    id: id(),
    businessId: businessRef(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    fromStatus: bookingStatusEnum("from_status"),
    toStatus: bookingStatusEnum("to_status").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    channel: channelEnum("channel").notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.bookingId)],
)

export const payments = pgTable(
  "payments",
  {
    id: id(),
    businessId: businessRef(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    provider: paymentProviderEnum("provider").notNull().default("mercadopago"),
    providerPaymentId: text("provider_payment_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.provider, t.providerPaymentId), index().on(t.bookingId)],
)

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: id(),
    businessId: businessRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    fromTime: time("from_time"),
    toTime: time("to_time"),
    status: waitlistStatusEnum("status").notNull().default("waiting"),
    ...timestamps,
  },
  (t) => [index().on(t.businessId, t.date, t.status)],
)

// ---------------------------------------------------------------------------
// Conexiones externas
// ---------------------------------------------------------------------------

export const whatsappAccounts = pgTable("whatsapp_accounts", {
  id: id(),
  businessId: businessRef().unique(),
  wabaId: text("waba_id").notNull(),
  /** Identifica al negocio en cada evento del webhook. */
  phoneNumberId: text("phone_number_id").notNull().unique(),
  displayPhone: text("display_phone").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  status: connectionStatusEnum("status").notNull().default("active"),
  ...timestamps,
})

export const mpAccounts = pgTable("mp_accounts", {
  id: id(),
  businessId: businessRef().unique(),
  mpUserId: text("mp_user_id").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: connectionStatusEnum("status").notNull().default("active"),
  ...timestamps,
})

// ---------------------------------------------------------------------------
// Conversaciones y bot
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    businessId: businessRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    mode: conversationModeEnum("mode").notNull().default("bot"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    /** Define la ventana de 24 horas de WhatsApp. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.businessId, t.customerId)],
)

export const messages = pgTable(
  "messages",
  {
    id: id(),
    businessId: businessRef(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    /** Id de mensaje de WhatsApp; único para que un reintento de Meta no se procese dos veces. */
    wamid: text("wamid").unique(),
    type: messageTypeEnum("type").notNull().default("text"),
    body: text("body"),
    mediaUrl: text("media_url"),
    transcript: text("transcript"),
    status: messageStatusEnum("status").notNull(),
    toolTrace: jsonb("tool_trace"),
    ...timestamps,
  },
  (t) => [index().on(t.conversationId, t.createdAt)],
)

export const botSettings = pgTable("bot_settings", {
  id: id(),
  businessId: businessRef().unique(),
  assistantName: text("assistant_name").notNull().default("Asistente"),
  tone: toneEnum("tone").notNull().default("informal"),
  welcomeMessage: text("welcome_message"),
  faq: jsonb("faq").$type<{ question: string; answer: string }[]>().notNull().default([]),
  replyHours: replyHoursEnum("reply_hours").notNull().default("always"),
  offHoursMessage: text("off_hours_message"),
  ...timestamps,
})

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: id(),
    businessId: businessRef(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: scheduledKindEnum("kind").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: scheduledStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.sendAt), index().on(t.businessId)],
)

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    businessId: businessRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Estado por canal, por ejemplo { push: "sent", email: "failed" }. */
    sentStatus: jsonb("sent_status").$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index().on(t.userId, t.createdAt), index().on(t.businessId)],
)

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    id: id(),
    businessId: businessRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    push: boolean("push").notNull().default(true),
    whatsapp: boolean("whatsapp").notNull().default(false),
    email: boolean("email").notNull().default(false),
    quietStart: time("quiet_start").notNull().default("22:00"),
    quietEnd: time("quiet_end").notNull().default("08:00"),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.businessId, t.userId, t.type)],
)

/** Por dispositivo del usuario; no depende del negocio (un mismo celular recibe de todos). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
)

// ---------------------------------------------------------------------------
// Uso y auditoría
// ---------------------------------------------------------------------------

export const usageCounters = pgTable(
  "usage_counters",
  {
    id: id(),
    businessId: businessRef(),
    /** Mes calendario en formato YYYY-MM. */
    period: text("period").notNull(),
    conversations: integer("conversations").notNull().default(0),
    aiInputTokens: integer("ai_input_tokens").notNull().default(0),
    aiOutputTokens: integer("ai_output_tokens").notNull().default(0),
    templatesSent: integer("templates_sent").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.businessId, t.period)],
)

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    businessId: businessRef(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (t) => [index().on(t.businessId, t.createdAt)],
)

export type Role = (typeof roleEnum.enumValues)[number]
export type Business = typeof businesses.$inferSelect
export type Membership = typeof memberships.$inferSelect
