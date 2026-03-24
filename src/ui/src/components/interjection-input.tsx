import { useState, useRef, useCallback } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Send } from "lucide-react"
import { toast } from "sonner"
import { sendInterjection } from "@/lib/api"

interface InterjectionInputProps {
  disabled: boolean
}

export function InterjectionInput({ disabled }: InterjectionInputProps) {
  const [value, setValue] = useState("")
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const doSend = useCallback(async () => {
    if (sending) return
    const content = value.trim()
    if (!content) return

    setSending(true)
    try {
      await sendInterjection(content)
      setValue("")
      textareaRef.current?.focus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send")
    } finally {
      setSending(false)
    }
  }, [value, sending])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        doSend()
      }
    },
    [doSend]
  )

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
        className="min-h-10 flex-1 resize-none rounded-xl border-border/30 bg-background/60 px-4 font-sans text-sm transition-colors focus-visible:border-teal-500/40 focus-visible:ring-teal-500/20"
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
