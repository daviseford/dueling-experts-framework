import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface MarkdownContentProps {
  content: string
}

/** Strip YAML frontmatter (--- delimited blocks at the start of content) */
function stripFrontmatter(text: string): string {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith("---")) return text
  const end = trimmed.indexOf("\n---", 3)
  if (end === -1) return text
  return trimmed.slice(end + 4).trimStart()
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const body = stripFrontmatter(content)

  return (
    <div className="def-prose">
      <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
    </div>
  )
}

/**
 * Extract a clean preview string from markdown content.
 * Prefers the first meaningful paragraph or heading.
 * Strips markdown syntax for a plain-text preview.
 */
export function extractPreview(content: string, maxLen = 120): string {
  if (!content) return ""

  const body = stripFrontmatter(content)
  const lines = body.split(/\r?\n/)

  let preview = ""
  for (const raw of lines) {
    const line = raw.trim()
    // Skip empty lines, code fences, horizontal rules, HTML comments
    if (!line) continue
    if (line.startsWith("```")) continue
    if (line === "---" || line === "***" || line === "___") continue
    if (line.startsWith("<!--")) continue
    // Skip pure image/link lines
    if (/^!\[/.test(line) && line.endsWith(")")) continue

    // Strip heading markers
    let clean = line.replace(/^#{1,6}\s+/, "")
    // Strip bold/italic
    clean = clean.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    clean = clean.replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Strip inline code
    clean = clean.replace(/`([^`]+)`/g, "$1")
    // Strip links, keep text
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Strip list markers
    clean = clean.replace(/^[-*+]\s+/, "")
    clean = clean.replace(/^\d+\.\s+/, "")
    // Strip remaining markdown artifacts
    clean = clean.replace(/[~]{2}([^~]+)[~]{2}/g, "$1")

    if (clean.length > 0) {
      preview = clean
      break
    }
  }

  if (!preview) return ""
  if (preview.length > maxLen) return preview.slice(0, maxLen) + "..."
  return preview
}
