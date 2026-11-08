import { brand } from "@/lib/brand"
import { cn } from "@/lib/utils"

/** Isotipo de Responbot: carita de robot sobre un cuadrado redondeado índigo (public/brand/responbot-mark.svg). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn("size-7", className)}>
      <defs>
        <linearGradient id="rb-g" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#rb-g)" />
      <path d="M32 19.5v-5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="12" r="3.5" fill="#fff" />
      <rect x="12" y="19" width="40" height="31" rx="12" fill="#fff" />
      <rect x="17.5" y="25" width="29" height="15" rx="7.5" fill="#1E1B4B" />
      <circle cx="26" cy="32.5" r="3" fill="#A5B4FC" />
      <circle cx="38" cy="32.5" r="3" fill="#A5B4FC" />
      <path d="M27 44.5h10" stroke="#C4B5FD" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/** Logo completo: isotipo + "Respon" + "bot" en violeta. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold tracking-tight", className)}>
      <LogoMark />
      <span aria-label={brand.name}>
        Respon<span className="text-[#6D28D9] dark:text-[#A78BFA]">bot</span>
      </span>
    </span>
  )
}
