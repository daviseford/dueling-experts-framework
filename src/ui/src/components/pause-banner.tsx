import { Alert, AlertDescription } from "@/components/ui/alert"
import { PauseCircle } from "lucide-react"

interface PauseBannerProps {
  visible: boolean
}

export function PauseBanner({ visible }: PauseBannerProps) {
  if (!visible) return null

  return (
    <Alert className="rounded-none border-x-0 border-t-0 border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <PauseCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertDescription className="text-amber-800 dark:text-amber-200">
        Session paused — agent needs human input
      </AlertDescription>
    </Alert>
  )
}