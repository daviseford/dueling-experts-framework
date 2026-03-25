import { Card, CardContent } from "@/components/ui/card"
import { Terminal } from "lucide-react"

export function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="max-w-md border-border/30 bg-card/60">
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
            <Terminal className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">No sessions found</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
                def --topic &apos;Your topic&apos;
              </code>{" "}
              to start your first session.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
