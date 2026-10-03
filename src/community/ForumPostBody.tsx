type Block = { kind: 'text' | 'quote' | 'code'; lines: string[] }

export function ForumPostBody({ body }: { body: string }) {
  const blocks: Block[] = []
  let fenced = false
  let current: Block | undefined
  for (const line of body.split('\n')) {
    if (/^```[\w+-]*\s*$/.test(line)) {
      if (fenced && !/^```\s*$/.test(line)) {
        current!.lines.push(line)
        continue
      }
      fenced = !fenced
      current = fenced ? { kind: 'code', lines: [] } : undefined
      if (current) blocks.push(current)
      continue
    }
    if (fenced) {
      current!.lines.push(line)
      continue
    }
    if (!line.trim()) {
      current = undefined
      continue
    }
    const kind = line.startsWith('>') ? 'quote' : 'text'
    if (!current || current.kind !== kind) {
      current = { kind, lines: [] }
      blocks.push(current)
    }
    current.lines.push(kind === 'quote' ? line.replace(/^>\s?/, '') : line)
  }
  return <div className="forum-post-body">{blocks.map((block, index) => {
    const content = block.lines.join('\n')
    if (block.kind === 'code') return <pre key={index}><code>{content}</code></pre>
    if (block.kind === 'quote') return <blockquote key={index}>{content}</blockquote>
    return <p key={index}>{content}</p>
  })}</div>
}
