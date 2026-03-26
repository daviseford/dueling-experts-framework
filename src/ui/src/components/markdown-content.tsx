import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? content.slice(match[0].length) : content
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-4 text-lg font-semibold leading-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-base font-semibold leading-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-sm font-semibold leading-snug text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-sm font-medium leading-snug text-foreground/90 first:mt-0">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-1 mt-2 text-[13px] font-medium text-foreground/80 first:mt-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1 mt-2 text-[13px] font-medium text-foreground/70 first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p className="mb-2 text-[13px] leading-relaxed text-foreground/85 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 ml-4 list-disc space-y-0.5 text-[13px] leading-relaxed text-foreground/85 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 text-[13px] leading-relaxed text-foreground/85 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-0.5">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-teal-600 underline decoration-teal-500/30 underline-offset-2 transition-colors hover:text-teal-500 hover:decoration-teal-500/60 dark:text-teal-400 dark:hover:text-teal-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-muted-foreground/20 pl-3 italic text-foreground/70 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[12px] text-foreground/90">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-muted/20 p-3 font-mono text-[12px] leading-relaxed last:mb-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:rounded-none">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-border/30" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border/40">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1.5 text-left text-[12px] font-semibold text-foreground/80">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-t border-border/20 px-2 py-1.5 text-foreground/80">
      {children}
    </td>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
}

interface MarkdownContentProps {
  content: string
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const stripped = stripFrontmatter(content)
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {stripped}
      </ReactMarkdown>
    </div>
  )
}
