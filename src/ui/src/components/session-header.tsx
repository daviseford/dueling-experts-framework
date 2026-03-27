import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "./theme-toggle"
import { CircleHelp, LayoutGrid, Maximize2, Radio } from "lucide-react"
import type { SessionSummary, SessionStatus, ViewMode } from "@/lib/types"

interface SessionHeaderProps {
  topic: string
  sessionId: string
  sessions: SessionSummary[]
  viewMode?: ViewMode
  canShowGrid?: boolean
  sessionStatus?: SessionStatus
  onToggleViewMode?: () => void
  onEndSession?: () => void
}

export function SessionHeader({ topic, sessionId, sessions, viewMode, canShowGrid, sessionStatus, onToggleViewMode, onEndSession }: SessionHeaderProps) {
  const isGrid = viewMode === "grid"
  const sessionCount = sessions.length
  const isReadOnly = sessionStatus !== "active"
  const isCompleted = sessionStatus === "completed"

  return (
    <header className="relative flex items-center justify-between border-b border-border/30 bg-card/80 px-5 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 shadow-sm">
            <Radio className="h-3.5 w-3.5 text-white" />
          </div>
          <h1 className="text-sm font-bold tracking-tight text-foreground">DEF</h1>
        </div>
        {isGrid ? (
          <>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-[13px] text-muted-foreground">{sessionCount} session{sessionCount !== 1 ? "s" : ""}</span>
          </>
        ) : (
          <>
            {topic && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-[13px] text-muted-foreground">{topic}</span>
              </>
            )}
            {sessionId && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="font-mono text-[11px] text-muted-foreground/50">{sessionId}</span>
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!isGrid && sessionStatus && (
          isReadOnly ? (
            <Badge variant="outline" className="h-7 border-muted-foreground/20 px-3 text-[11px] text-muted-foreground">
              Viewing — read-only
            </Badge>
          ) : onEndSession ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isCompleted}
                  className="h-7 px-3 text-xs"
                >
                  End Session
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End this session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will stop the session. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onEndSession}>
                    End Session
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null
        )}
        {canShowGrid && onToggleViewMode && (
          <Button
            data-testid="view-mode-toggle"
            variant="ghost"
            size="sm"
            className="h-7 w-7 min-h-11 min-w-11 p-0 text-muted-foreground hover:text-foreground"
            onClick={onToggleViewMode}
            aria-label={isGrid ? "Single session view" : "Grid view"}
          >
            {isGrid ? <Maximize2 className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 min-h-11 min-w-11 p-0 text-muted-foreground hover:text-foreground"
          asChild
        >
          <a
            href="https://github.com/daviseford/dueling-experts-framework#readme"
            target="_blank"
            rel="noopener noreferrer"
          >
            <CircleHelp className="h-4 w-4" />
            <span className="sr-only">Help</span>
          </a>
        </Button>
        <ThemeToggle />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-teal-500/20 to-transparent" />
    </header>
  )
}
