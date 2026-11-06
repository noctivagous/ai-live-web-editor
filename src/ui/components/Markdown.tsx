import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

/** Agent text as rendered markdown, inside the existing deck cards.
 *
 * Safe by construction: react-markdown builds React elements (no
 * dangerouslySetInnerHTML), raw HTML is off (no rehype-raw), the default URL
 * transform is untouched, and rehype-sanitize strips anything plugins let
 * through. External links open in a new tab so the launcher never navigates.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="dcard-md">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        a: ({ href, title, children }) => (
          <a href={href} title={title} target="_blank" rel="noreferrer noopener">{children}</a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
    </div>
  )
}
