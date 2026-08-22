'use client'

import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Markdown renderer for assistant bubbles.
// remark-gfm adds tables, task lists, and strikethrough.
// All links open in a new tab with a safe rel.

// Defined once, outside the component, so react-markdown does not
// see a new component identity on every render.
const components = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
}

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
