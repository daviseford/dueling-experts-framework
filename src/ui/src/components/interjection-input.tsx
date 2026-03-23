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
    <div className="flex gap-2 border-t border-border bg-card px-5 py-3">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message to interject..."
        disabled={disabled || sending}
        rows={1}
        className="min-h-10 flex-1 resize-none font-sans"
      />
      <Button
        onClick={doSend}
        disabled={disabled || sending || !value.trim()}
        className="bg-green-700 text-white hover:bg-green-600"
      >
        <Send className="mr-1 h-4 w-4" />
        Send
      </Button>
    </div>
  )
}
