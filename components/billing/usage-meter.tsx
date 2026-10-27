import { cn } from "@/lib/utils"

/** Barra de uso del mes: verde, ámbar desde el 80 % y roja al pasar el límite. */
export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const tone = !limit ? "bg-primary" : used >= limit ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary"
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {used.toLocaleString("es-UY")}
          {limit === null ? " · sin límite" : ` de ${limit.toLocaleString("es-UY")}`}
        </span>
      </div>
      {limit === null ? null : (
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${percent}%` }} />
      </div>
      )}
    </div>
  )
}
