import { useState, useRef, useCallback, useEffect } from "react"
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

  const MAX_HEIGHT = 96 // ~4 lines

  const autoGrow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + "px"
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden"
  }, [])

  useEffect(() => {
    autoGrow()
  }, [value, autoGrow])

  const doSend = useCallback(async () => {
    if (sending) return
    const content = value.trim()
    if (!content) return

    setSending(true)
    try {
      await sendInterjection(sessionId, content)
      onSent?.(content)
      setValue("")
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
        textareaRef.current.style.overflowY = "hidden"
      }
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
    <div className="flex gap-2.5 border-t border-border/30 bg-card/80 px-5 py-3">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message to interject..."
        disabled={disabled || sending}
        rows={1}
        className="min-h-10 flex-1 resize-none overflow-hidden rounded-xl border-border/30 bg-background/60 px-4 font-sans text-sm transition-colors focus-visible:border-teal-500/40 focus-visible:ring-teal-500/20"
      />
      <Button
        onClick={doSend}
        disabled={disabled || sending || !value.trim()}
        size="sm"
        className="h-10 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 px-5 text-xs font-semibold text-white shadow-sm transition-all hover:from-teal-500 hover:to-emerald-500 hover:shadow-md disabled:from-muted disabled:to-muted disabled:shadow-none"
      >
        <Send className="mr-1.5 h-3.5 w-3.5" />
        Send
      </Button>
    </div>
  )
}
