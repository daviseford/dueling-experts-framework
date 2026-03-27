import { CheckCircle2, GitBranch, ExternalLink, FolderOpen, FileText, Layers, ListChecks, Wrench } from "lucide-react"
import type { SessionPhase } from "@/lib/types"

export interface SessionSummaryProps {
  phase: SessionPhase
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  turnsPath: string | null
  artifactsPath: string | null
  decisions?: string[]
  implementations?: string[]
}

function shortenPath(p: string): string {
  const normalized = p.replace(/\\/g, "/")
  const defIdx = normalized.indexOf(".def/")
  if (defIdx >= 0) return normalized.slice(defIdx)
  const parts = normalized.split("/")
  if (parts.length <= 3) return normalized
  return ".../" + parts.slice(-3).join("/")
}

export function SessionSummary({
  phase,
  branchName,
  prUrl,
  prNumber,
  turnsPath,
  artifactsPath,
  decisions,
  implementations,
}: SessionSummaryProps) {
  return (
    <div className="animate-slide-up min-w-0 overflow-hidden rounded-xl border border-border/30 bg-card shadow-lg dark:shadow-teal-950/20">
      {/* Header */}
      <div className="border-b border-border/30 bg-teal-500/5 px-5 py-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500/15 ring-1 ring-teal-500/25">
            <CheckCircle2 className="h-5 w-5 text-teal-500" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
              Session Completed
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Layers className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[11px] capitalize text-muted-foreground">
                {phase} phase
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3 p-5">
        {/* Branch + PR in side-by-side cards */}
        {(branchName || prUrl) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {branchName && (
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3.5">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Branch
                  </span>
                </div>
                <code className="block truncate font-mono text-xs text-foreground/80">
                  {branchName}
                </code>
              </div>
            )}
            {prUrl && (
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3.5">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Pull Request
                  </span>
                </div>
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-500 underline decoration-blue-500/30 underline-offset-2 transition-colors hover:text-blue-400 hover:decoration-blue-400/50"
                >
                  PR #{prNumber}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Key Decisions */}
        {decisions && decisions.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-3.5">
            <div className="mb-2.5 flex items-center gap-2">
              <ListChecks className="h-3.5 w-3.5 shrink-0 text-teal-500/60" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Key Decisions
              </span>
            </div>
            <ul className="space-y-1.5 pl-6">
              {decisions.map((d, i) => (
                <li
                  key={i}
                  className="list-disc break-words text-[12px] leading-relaxed text-foreground/75 marker:text-teal-500/40"
                >
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Key Implementations */}
        {implementations && implementations.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-3.5">
            <div className="mb-2.5 flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 shrink-0 text-cyan-500/60" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Key Implementations
              </span>
            </div>
            <ul className="space-y-1.5 pl-6">
              {implementations.map((d, i) => (
                <li
                  key={i}
                  className="list-disc break-words text-[12px] leading-relaxed text-foreground/75 marker:text-cyan-500/40"
                >
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* File paths */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3.5">
          <div className="space-y-2.5">
            {turnsPath && (
              <div className="flex items-center gap-2.5">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Turns
                </span>
                <code className="min-w-0 truncate rounded bg-background/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground/80">
                  {shortenPath(turnsPath)}
                </code>
              </div>
            )}

            {artifactsPath && (
              <div className="flex items-center gap-2.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Artifacts
                </span>
                <code className="min-w-0 truncate rounded bg-background/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground/80">
                  {shortenPath(artifactsPath)}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
