interface StatusBarProps {
  statusText: string
  turnCount: number
}

export function StatusBar({ statusText, turnCount }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-card px-5 py-1.5 text-xs text-muted-foreground">
      <span>{statusText}</span>
      <span>Turns: {turnCount}</span>
    </div>
  )
}
