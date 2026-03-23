import { Alert, AlertDescription } from "@/components/ui/alert"
import { PauseCircle } from "lucide-react"

interface PauseBannerProps {
  visible: boolean
}

export function PauseBanner({ visible }: PauseBannerProps) {
  if (!visible) return null

  return (
    <Alert className="rounded-none border-x-0 border-t-0 border-amber-500/50 bg-amber-950/50 text-amber-200">
      <PauseCircle className="h-4 w-4 text-amber-400" />
      <AlertDescription className="text-amber-200">
        Session paused — agent needs human input
      </AlertDescription>
    </Alert>
  )
}
