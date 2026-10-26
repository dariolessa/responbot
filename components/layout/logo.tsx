import { brand } from "@/lib/brand"
import { cn } from "@/lib/utils"

/** Isotipo de Responbot: globo de chat con el robot (public/brand/responbot-mark.svg). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn("size-7", className)}>
      <defs>
        <linearGradient id="rb-g" x1="14" y1="6" x2="50" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#04BB38" />
          <stop offset="1" stopColor="#029723" />
        </linearGradient>
      </defs>
      <path d="M32 4a27 27 0 1 1-13.4 50.4L6 59l4.4-12A27 27 0 0 1 32 4Z" fill="url(#rb-g)" />
      <path d="M32 21v-6" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="12.5" r="3.5" fill="#fff" />
      <rect x="12" y="27" width="6" height="12" rx="3" fill="#E9ECEF" />
      <rect x="46" y="27" width="6" height="12" rx="3" fill="#E9ECEF" />
      <rect x="15" y="20" width="34" height="26" rx="11" fill="#fff" />
      <rect x="19.5" y="25" width="25" height="15" rx="7" fill="#030A14" />
      <path
        d="M24.5 34.5c1.2-2.2 4.3-2.2 5.5 0M34 34.5c1.2-2.2 4.3-2.2 5.5 0"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Logo completo: isotipo + "Respon" + "bot" en verde. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold tracking-tight", className)}>
      <LogoMark />
      <span aria-label={brand.name}>
        Respon<span className="text-[#02A82F] dark:text-[#0BC53F]">bot</span>
      </span>
    </span>
  )
}
