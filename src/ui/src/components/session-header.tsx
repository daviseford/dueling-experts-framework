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
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Radio } from "lucide-react"

interface SessionHeaderProps {
  topic: string
  disabled: boolean
  onEndSession: () => void
}

export function SessionHeader({ topic, disabled, onEndSession }: SessionHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border/50 bg-card/80 px-5 py-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-emerald-400" />
          <h1 className="text-sm font-bold tracking-tight text-foreground">DEF</h1>
        </div>
        {topic && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-[13px] text-muted-foreground">{topic}</span>
          </>
        )}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled}
            className="h-7 px-3 text-xs"
          >
            End Session
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the agent collaboration. This action cannot be undone.
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
    </header>
  )
}
