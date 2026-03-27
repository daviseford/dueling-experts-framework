import { useState, useRef, useCallback } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Send } from "lucide-react"
import { toast } from "sonner"
import { sendInterjection } from "@/lib/api"

interface InterjectionInputProps {
  sessionId: string
  disabled: boolean
  isReadOnly?: boolean
  onSent?: (content: string) => void
}

export function InterjectionInput({ sessionId, disabled, isReadOnly, onSent }: InterjectionInputProps) {
  const [value, setValue] = useState("")
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const doSend = useCallback(async () => {
    if (sending) return
    const content = value.trim()
    if (!content) return

    setSending(true)
    try {
      await sendInterjection(sessionId, content)
      onSent?.(content)
      setValue("")
      textareaRef.current?.focus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send")
    } finally {
      setSending(false)
    }
  }, [sessionId, value, sending, onSent])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        doSend()
      }
    },
    [doSend]
  )

  if (isReadOnly) return null

  return (
    <div className="border-t border-border/30 bg-card/80 px-5 py-3">
      <div className="flex gap-2.5">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message to agents at the next turn boundary..."
          disabled={disabled || sending}
          rows={1}
          className="min-h-10 flex-1 resize-none rounded-xl border-border/30 bg-background/60 px-4 font-sans text-sm transition-colors focus-visible:border-teal-500/40 focus-visible:ring-teal-500/20"
        />
        <Button
          onClick={doSend}
          disabled={disabled || sending || !value.trim()}
          size="sm"
          className="h-10 rounded-xl bg-teal-600 px-5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-gradient-to-r hover:from-teal-500 hover:to-emerald-500 hover:shadow-md focus-visible:bg-gradient-to-r focus-visible:from-teal-500 focus-visible:to-emerald-500 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          Send
        </Button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground/70">
        Your message will be delivered when the current turn ends.
      </p>
    </div>
  )
}
