import { cn } from "@/lib/utils"

const PHASE_COLORS: Record<string, { line: string; text: string; bg: string }> = {
  plan: {
    line: "border-orange-500/30",
    text: "text-orange-600/70 dark:text-orange-400/70",
    bg: "bg-orange-500/8",
  },
  debate: {
    line: "border-orange-500/30",
    text: "text-orange-600/70 dark:text-orange-400/70",
    bg: "bg-orange-500/8",
  },
  implement: {
    line: "border-cyan-500/30",
    text: "text-cyan-600/70 dark:text-cyan-400/70",
    bg: "bg-cyan-500/8",
  },
  review: {
    line: "border-pink-500/30",
    text: "text-pink-600/70 dark:text-pink-400/70",
    bg: "bg-pink-500/8",
  },
}

const PHASE_LABELS: Record<string, string> = {
  plan: "PLAN",
  debate: "DEBATE",
  implement: "IMPLEMENT",
  review: "REVIEW",
}

interface PhaseDividerProps {
  phase: string
}

export function PhaseDivider({ phase }: PhaseDividerProps) {
  const colors = PHASE_COLORS[phase] || {
    line: "border-muted-foreground/20",
    text: "text-muted-foreground/60",
    bg: "bg-muted/30",
  }
  const label = PHASE_LABELS[phase] || phase.toUpperCase()

  return (
    <div className="flex items-center gap-3 py-1">
      <div className={cn("flex-1 border-t", colors.line)} />
      <span
        className={cn(
          "rounded-full px-3 py-0.5 font-mono text-[10px] font-semibold tracking-widest",
          colors.text,
          colors.bg
        )}
      >
        {label} PHASE
      </span>
      <div className={cn("flex-1 border-t", colors.line)} />
    </div>
  )
}
