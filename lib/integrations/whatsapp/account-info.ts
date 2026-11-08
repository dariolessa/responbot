import { graphRequest, type GraphOptions } from "./graph"

/*
 * Estado en vivo de la cuenta y el número conectados, leído de la Graph API
 * cada vez que se abre Configuración: nombre de la cuenta de WhatsApp
 * Business, nombre visible del número, estado y calidad.
 */

export type PhoneQuality = "GREEN" | "YELLOW" | "RED" | "UNKNOWN"

export type LiveAccountInfo = {
  wabaName: string | null
  displayPhone: string | null
  verifiedName: string | null
  /** CONNECTED, PENDING, DISCONNECTED, FLAGGED, RESTRICTED… */
  status: string | null
  /** APPROVED, PENDING_REVIEW, DECLINED, NONE… (nombre visible). */
  nameStatus: string | null
  quality: PhoneQuality
  /** Límite de conversaciones iniciadas por el negocio (TIER_250, TIER_1K…). */
  messagingLimit: string | null
}

type PhoneFields = {
  display_phone_number?: string
  verified_name?: string
  status?: string
  name_status?: string
  quality_rating?: string
  messaging_limit_tier?: string
}

export async function liveAccountInfo(
  wabaId: string,
  phoneNumberId: string,
  options: GraphOptions,
): Promise<LiveAccountInfo> {
  const [waba, phone] = await Promise.all([
    graphRequest<{ name?: string }>(options, "GET", `${wabaId}?fields=name`).catch(() => ({ name: undefined })),
    graphRequest<PhoneFields>(
      options,
      "GET",
      `${phoneNumberId}?fields=display_phone_number,verified_name,status,name_status,quality_rating,messaging_limit_tier`,
    ),
  ])
  const quality = phone.quality_rating?.toUpperCase()
  return {
    wabaName: waba.name ?? null,
    displayPhone: phone.display_phone_number ?? null,
    verifiedName: phone.verified_name ?? null,
    status: phone.status ?? null,
    nameStatus: phone.name_status ?? null,
    quality: quality === "GREEN" || quality === "YELLOW" || quality === "RED" ? quality : "UNKNOWN",
    messagingLimit: phone.messaging_limit_tier ?? null,
  }
}
