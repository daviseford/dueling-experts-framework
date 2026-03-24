import { CheckCircle2, GitBranch, ExternalLink, FolderOpen, FileText, Layers } from "lucide-react"
import type { SessionPhase } from "@/lib/types"

export interface SessionSummaryProps {
  phase: SessionPhase
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  turnsPath: string | null
  artifactsPath: string | null
  artifactNames: string[]
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
  artifactNames,
}: SessionSummaryProps) {
  return (
    <div className="animate-slide-up overflow-hidden rounded-xl border border-border/30 bg-card shadow-lg dark:shadow-teal-950/20">
      {/* Header */}
      <div className="border-b border-border/30 bg-gradient-to-r from-teal-500/8 via-cyan-500/5 to-transparent px-5 py-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500/15 ring-1 ring-teal-500/25">
            <CheckCircle2 className="h-5 w-5 text-teal-500" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
              Session Completed
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Layers className="h-3 w-3 text-muted-foreground/50" />
              <span className="text-[11px] capitalize text-muted-foreground">
                {phase} phase
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4 p-5">
        {/* Branch + PR in side-by-side cards */}
        {(branchName || prUrl) && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {branchName && (
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 transition-colors hover:bg-muted/40">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                    Branch
                  </span>
                </div>
                <code className="block truncate font-mono text-xs text-foreground/80">
                  {branchName}
                </code>
              </div>
            )}
            {prUrl && (
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 transition-colors hover:bg-muted/40">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
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

        {/* File paths */}
        <div className="space-y-2">
          {turnsPath && (
            <div className="flex items-center gap-2.5">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                Turns
              </span>
              <code className="min-w-0 truncate rounded bg-muted/30 px-2 py-0.5 font-mono text-[11px] text-muted-foreground/60">
                {shortenPath(turnsPath)}
              </code>
            </div>
          )}

          {artifactsPath && (
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                  Artifacts
                </span>
                <code className="min-w-0 truncate rounded bg-muted/30 px-2 py-0.5 font-mono text-[11px] text-muted-foreground/60">
                  {shortenPath(artifactsPath)}
                </code>
              </div>
              {artifactNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-6">
                  {artifactNames.map((name) => (
                    <span
                      key={name}
                      className="inline-flex rounded-md border border-border/30 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-muted-foreground"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
