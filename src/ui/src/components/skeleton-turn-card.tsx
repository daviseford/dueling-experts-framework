import { cn } from "@/lib/utils"

export function SkeletonTurnCard({ index = 0 }: { index?: number }) {
  const borders = ["border-l-blue-500/40", "border-l-emerald-500/40", "border-l-blue-500/40"]
  return (
    <div
      data-testid="skeleton-turn-card"
      className={cn(
        "overflow-hidden rounded-lg border-l-[3px] bg-card/60 ring-1 ring-border/10",
        borders[index % borders.length]
      )}
    >
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {/* Row 1: badge + turn number + preview */}
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-14 animate-pulse rounded bg-muted" />
          <div className="h-3 w-6 animate-pulse rounded bg-muted" />
          <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        </div>
        {/* Row 2: phase + model */}
        <div className="flex items-center gap-2 pl-5">
          <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-12 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}
