import { CheckCircle2, GitBranch, ExternalLink, FolderOpen, FileText } from "lucide-react"

export interface SessionSummaryProps {
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  turnsPath: string | null
  artifactsPath: string | null
  artifactNames: string[]
}

export function SessionSummary({
  branchName,
  prUrl,
  prNumber,
  turnsPath,
  artifactsPath,
  artifactNames,
}: SessionSummaryProps) {
  return (
    <div className="rounded-lg border-l-[3px] border-l-teal-500 bg-card/50">
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">
        <CheckCircle2 className="h-4 w-4 text-teal-500" />
        <span className="font-mono text-xs font-semibold tracking-wide text-teal-600 dark:text-teal-400">
          SESSION COMPLETED
        </span>
      </div>
      <div className="space-y-2 px-4 py-3">
        {branchName && (
          <Row icon={<GitBranch className="h-3.5 w-3.5" />} label="Branch">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{branchName}</code>
          </Row>
        )}
        {prUrl && (
          <Row icon={<ExternalLink className="h-3.5 w-3.5" />} label="PR">
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 underline underline-offset-2 hover:text-blue-400"
            >
              PR #{prNumber}
            </a>
          </Row>
        )}
        {turnsPath && (
          <Row icon={<FolderOpen className="h-3.5 w-3.5" />} label="Turns">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{turnsPath}</code>
          </Row>
        )}
        {artifactsPath && (
          <Row icon={<FileText className="h-3.5 w-3.5" />} label="Artifacts">
            <div className="flex flex-col gap-1">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{artifactsPath}</code>
              {artifactNames.length > 0 && (
                <ul className="ml-1 space-y-0.5">
                  {artifactNames.map((name) => (
                    <li key={name} className="font-mono text-[11px] text-muted-foreground">
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Row>
        )}
      </div>
    </div>
  )
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="w-16 shrink-0 font-mono text-xs font-medium">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
