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
export const botFeedbackRatingEnum = pgEnum("bot_feedback_rating", ["good", "bad"])
export const scheduledKindEnum = pgEnum("scheduled_kind", [
  "reminder_24h",
  "reminder_2h",
  "reactivation",
  "waitlist_offer",
  "post_service",
  "booking_confirmation",
  "booking_cancelled",
  "deposit_request",
  "hold_expired",
  "deposit_refunded",
  "waitlist_taken",
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
  /** WhatsApp de la persona para los avisos al dueño (resumen diario, derivaciones), en E.164. */
  phoneE164: text("phone_e164"),
  /** Resend avisó un rebote o una queja: no se le mandan más correos de avisos. */
  emailBouncedAt: timestamp("email_bounced_at", { withTimezone: true }),
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
  /** Tipo de negocio dentro del rubro (peluquería, barbería…); elige las plantillas de servicios. */
  category: text("category"),
  logoUrl: text("logo_url"),
  plan: planEnum("plan").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  /** Suscripción de Stripe y su estado (active, trialing, past_due, unpaid, canceled…), copiados del webhook. */
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  subscriptionStatus: text("subscription_status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** Primer cobro fallido de la racha actual; cuenta los 7 días de gracia. Nulo = al día. */
  paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
  /** Última factura de la que se mandó el recibo (Stripe reintenta los eventos). */
  lastReceiptInvoiceId: text("last_receipt_invoice_id"),
  /** Pasos del asistente de alta ya completados (ver lib/onboarding/steps.ts). */
  onboardingCompleted: text("onboarding_completed")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Día local del último resumen diario enviado (evita mandarlo dos veces si el cron se repite). */
  dailySummarySentOn: date("daily_summary_sent_on"),
  /** Lunes local del último resumen semanal por correo. */
  weeklySummarySentOn: date("weekly_summary_sent_on"),
  /** Correos de ciclo de vida ya enviados (por ejemplo onboarding_24h, onboarding_3d). */
  lifecycleEmails: text("lifecycle_emails")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Negocio piloto (Fase 7): todo habilitado, sin cobro, hasta esta fecha. Lo pone el equipo de la plataforma en /admin. */
  pilotEndsAt: timestamp("pilot_ends_at", { withTimezone: true }),
  /** Negocio de la demo pública: nunca vence y sus clientes, turnos y conversaciones se borran cada noche. */
  isDemo: boolean("is_demo").notNull().default(false),
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
    /** Profesional de la agenda que pasa a ser esta persona al aceptar. */
    resourceId: uuid("resource_id").references((): AnyPgColumn => resources.id, {
      onDelete: "set null",
    }),
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
    /** Horas antes del turno del primer recordatorio (con botones); nulo = no se manda. */
    reminderFirstHours: integer("reminder_first_hours").default(24),
    /** Horas antes del segundo recordatorio (corto, con la dirección); nulo = no se manda. */
    reminderSecondHours: integer("reminder_second_hours").default(2),
    /** Inasistencias desde las que se pide la seña general aunque el servicio no la pida; nulo = nunca. */
    noShowDepositThreshold: integer("no_show_deposit_threshold"),
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
    /** Cada cuántos días suele repetirse (por ejemplo 35 para un corte); manda en la reactivación. Nulo = el intervalo del cliente. */
    rebookIntervalDays: integer("rebook_interval_days"),
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
    /** Cliente ficticio del chat de prueba del panel (uno por usuario); no aparece en Clientes. */
    isTest: boolean("is_test").notNull().default(false),
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
    /** Link de pago de la seña (init_point de Checkout Pro) y su preferencia en Mercado Pago. */
    paymentUrl: text("payment_url"),
    paymentPreferenceId: text("payment_preference_id"),
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
    /** Estado en Mercado Pago (approved, pending, rejected, refunded…). */
    status: text("status").notNull(),
    /** Devolución de la seña: pending (pedida, se procesa enseguida), refunded o failed; nulo = no se pidió. */
    refundStatus: text("refund_status").$type<"pending" | "refunded" | "failed">(),
    refundedAmount: integer("refunded_amount").notNull().default(0),
    refundError: text("refund_error"),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.provider, t.providerPaymentId), index().on(t.bookingId), index().on(t.refundStatus)],
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
    /** Horario que se le ofreció cuando se liberó un lugar (status offered). */
    offeredStartsAt: timestamp("offered_starts_at", { withTimezone: true }),
    offeredResourceId: uuid("offered_resource_id").references(() => resources.id, { onDelete: "set null" }),
    /** Turno que liberó el lugar: agrupa las ofertas del mismo horario ("ya fue tomado" al resto). */
    offerSourceBookingId: uuid("offer_source_booking_id").references(() => bookings.id, { onDelete: "set null" }),
    /** Turno que reservó desde la oferta. */
    bookedBookingId: uuid("booked_booking_id").references(() => bookings.id, { onDelete: "set null" }),
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
  /** Nombre verificado del negocio en WhatsApp (lo que ve el cliente). */
  verifiedName: text("verified_name"),
  /** PIN de verificación en dos pasos con el que se registró el número, cifrado. */
  pinEnc: text("pin_enc"),
  status: connectionStatusEnum("status").notNull().default("active"),
  ...timestamps,
})

export const mpAccounts = pgTable("mp_accounts", {
  id: id(),
  businessId: businessRef().unique(),
  /** Usuario vendedor en Mercado Pago; llega como user_id en cada webhook. */
  mpUserId: text("mp_user_id").notNull().unique(),
  /** Email o apodo de la cuenta, para mostrar cuál está conectada. */
  displayName: text("display_name"),
  /** false = credenciales de prueba. */
  liveMode: boolean("live_mode").notNull().default(true),
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
    /** Último mensaje (de cualquier lado), para ordenar la bandeja y mostrar un adelanto. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.businessId, t.customerId), index().on(t.businessId, t.lastMessageAt)],
)

/** Opciones que el bot ofrece como botones o lista de WhatsApp (herramienta show_choices). */
export type MessageChoices = {
  /** Texto del botón que abre la lista (solo listas). */
  button?: string
  options: { id: string; title: string; description?: string }[]
}

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
    /** Id del medio en WhatsApp (audios e imágenes); el archivo no se guarda. */
    mediaId: text("media_id"),
    transcript: text("transcript"),
    status: messageStatusEnum("status").notNull(),
    toolTrace: jsonb("tool_trace"),
    /** Botones o lista que acompañan una respuesta del bot. */
    choices: jsonb("choices").$type<MessageChoices>(),
    /** Persona del equipo que lo mandó desde el panel (nulo = el bot o el cliente). */
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    /** Motivo si WhatsApp no lo pudo entregar. */
    error: text("error"),
    ...timestamps,
  },
  (t) => [index().on(t.conversationId, t.createdAt)],
)

/**
 * Opinión del equipo sobre una respuesta del bot (Fase 7, ajustes con
 * conversaciones reales). Una por mensaje; la última opinión reemplaza a la anterior.
 */
export const botFeedback = pgTable(
  "bot_feedback",
  {
    id: id(),
    businessId: businessRef(),
    messageId: uuid("message_id")
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    rating: botFeedbackRatingEnum("rating").notNull(),
    /** Qué tendría que haber contestado, en palabras del negocio. */
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index().on(t.businessId, t.createdAt)],
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
  /** Reactivación automática de clientes que pasaron su intervalo habitual (plan Equipo). */
  reactivationEnabled: boolean("reactivation_enabled").notNull().default(true),
  /** Pedido de reseña después del servicio: apagado hasta que se cargue el enlace. */
  reviewRequestEnabled: boolean("review_request_enabled").notNull().default(false),
  reviewUrl: text("review_url"),
  /** Horas después de marcar el turno atendido. */
  reviewDelayHours: integer("review_delay_hours").notNull().default(2),
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
    /** Lista de espera (ofertas de lugar liberado y "ya fue tomado"). */
    waitlistEntryId: uuid("waitlist_entry_id").references(() => waitlistEntries.id, { onDelete: "cascade" }),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: scheduledStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Mensaje de la conversación con el que salió. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    /** Por qué no salió (sin WhatsApp conectado, cliente dado de baja, llegó tarde…). */
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.sendAt), index().on(t.businessId), index().on(t.bookingId)],
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
  (t) => [index().on(t.userId, t.createdAt), index().on(t.businessId, t.createdAt)],
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
    /** Avisos de uso ya mandados en el mes (por ejemplo conversations_80, conversations_100). */
    alertsSent: text("alerts_sent")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
export type Service = typeof services.$inferSelect
export type Resource = typeof resources.$inferSelect
export type WorkingHours = typeof workingHours.$inferSelect
export type TimeOff = typeof timeOff.$inferSelect
export type Customer = typeof customers.$inferSelect
export type Booking = typeof bookings.$inferSelect
export type BookingEvent = typeof bookingEvents.$inferSelect
export type BookingRules = typeof bookingRules.$inferSelect
export type Invitation = typeof invitations.$inferSelect
export type Conversation = typeof conversations.$inferSelect
export type Message = typeof messages.$inferSelect
export type BotSettings = typeof botSettings.$inferSelect
export type WhatsAppAccount = typeof whatsappAccounts.$inferSelect
export type ScheduledMessage = typeof scheduledMessages.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type NotificationPrefs = typeof notificationPrefs.$inferSelect
export type Payment = typeof payments.$inferSelect
export type MpAccount = typeof mpAccounts.$inferSelect
export type WaitlistEntry = typeof waitlistEntries.$inferSelect
export type BotFeedback = typeof botFeedback.$inferSelect
