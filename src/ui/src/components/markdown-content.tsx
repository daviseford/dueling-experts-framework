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

export default function MarkdownContent({ content }: MarkdownContentProps) {
  const body = stripFrontmatter(content)

  return (
    <div className="def-prose">
      <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
    </div>
  )
}
