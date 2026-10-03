import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ForumPostBody } from './ForumPostBody'

const render = (body: string) => renderToStaticMarkup(createElement(ForumPostBody, {body}))

describe('forum post formatting', () => {
  it('groups paragraphs and quoted lines without losing line breaks', () => {
    expect(render('First line\nSecond line\n\n> A quote\n> Its next line\n\nReply'))
      .toBe('<div class="forum-post-body"><p>First line\nSecond line</p><blockquote>A quote\nIts next line</blockquote><p>Reply</p></div>')
  })
  it('preserves settings and quote symbols inside fenced code', () => {
    expect(render('Settings\n\n```json\n{ "gain": 0.5 }\n> literal\n\n```\n\nDone'))
      .toContain('<pre><code>{ &quot;gain&quot;: 0.5 }\n&gt; literal\n</code></pre><p>Done</p>')
  })
  it('keeps an unfinished code fence readable while composing', () => {
    expect(render('```\nline one\n\nline two')).toContain('<pre><code>line one\n\nline two</code></pre>')
  })
  it('renders HTML and script-like text as escaped content in every block', () => {
    const html = render('<img src=x onerror=alert(1)>\n\n> <script>alert(1)</script>\n\n```html\n<a href="javascript:alert(1)">click</a>\n```')
    expect(html).not.toMatch(/<img|<script|<a /)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;click&lt;/a&gt;')
  })
})
