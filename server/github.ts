import type { Database, Env } from './platform'
import { HttpError } from './security'
import { FLASH_STATES, LOG_MISSING_REASONS, OT_MODELS } from '../src/community/issue-context'
import type { IssueContext, LogMissingReason } from '../src/community/issue-context'
import { describeOtLog } from '../src/community/ot-log'
import type { OtLogSummary } from '../src/community/ot-log'

const API = 'https://api.github.com'
const BODY_LIMIT = 60000
export type GithubConfig = { token: string; repository: string }

/** Mirroring is on only with a token and a valid owner/name repository. */
export function githubConfig(env: Env): GithubConfig | null {
  const token = env.GITHUB_TOKEN?.trim() ?? '', repository = env.GITHUB_REPOSITORY?.trim() || 'repeat98/octamod'
  return token && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) ? { token, repository } : null
}

async function github<T>(config: GithubConfig, path: string, method: string, body: unknown): Promise<T> {
  let result: Response
  try {
    result = await fetch(API + '/repos/' + config.repository + path, {
      method, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'octamod-community', 'X-GitHub-Api-Version': '2022-11-28' },
    })
  } catch { throw new Error('GitHub did not respond.') }
  if (!result.ok) {
    let message = ''
    try { message = String(((await result.json()) as { message?: unknown }).message ?? '') } catch { /* status is enough */ }
    throw new Error('GitHub answered ' + result.status + (message ? ': ' + message.slice(0, 200) : '') + '.')
  }
  return await result.json() as T
}

/**
 * Reporter text goes to a public issue: it must not ping people, link other
 * issues or inject markup. Mentions and #references get a zero-width space,
 * and angle brackets are escaped.
 */
export function inert(text: string) {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@(?=[A-Za-z0-9])/g, '@​').replace(/#(?=[0-9])/g, '#​')
}
const quote = (text: string) => inert(text).split(/\r?\n/).map(line => '> ' + line).join('\n')

export type MirroredIssue = {
  module_id: string; author_login: string; title: string; body: string; reporter: string
  context: IssueContext | null; log: { text: string; summary: OtLogSummary } | null
  log_missing: LogMissingReason | null; log_missing_note: string
}

export function issueTitle(issue: Pick<MirroredIssue, 'module_id' | 'title'>) { return ('[' + issue.module_id + '] ' + issue.title).slice(0, 256) }

export function issueMarkdown(issue: MirroredIssue) {
  const author = /^[A-Za-z0-9-]{1,39}$/.test(issue.author_login) ? '@' + issue.author_login : inert(issue.author_login)
  const lines = ['Reported on octamod.app for **`' + issue.module_id + '`** · module author ' + author, '', 'Reporter: ' + inert(issue.reporter), '', issue.body ? quote(issue.body) : '', '']
  const context = issue.context
  if (context) {
    lines.push('### Browser configuration', '', '| | |', '| --- | --- |',
      '| Device | ' + OT_MODELS[context.model] + ' |',
      '| State | ' + FLASH_STATES[context.flash] + ' |',
      '| Base OS | ' + context.os + ' |',
      '| Stock FX2 kept | ' + (context.keepStockFx2 === null ? 'n/a' : context.keepStockFx2 ? 'yes' : 'no') + ' |',
      '| Build SHA-256 | ' + (context.build ? '`' + context.build + '`' : 'not built in this browser') + ' |',
      '', context.modules.length ? context.modules.map(item => '- `' + item.id + '` ' + item.version).join('\n') : '_No modules selected._', '')
  }
  if (issue.log) {
    const summary = issue.log.summary
    lines.push('### Device log configuration', '', 'These values came from the device log; the browser selection above may differ.', '',
      '- OS: `' + summary.os + '`',
      '- Configuration: `' + (summary.configuration || summary.build) + '`',
      '- Modules: ' + (summary.modules.map(item => '`' + item.id + '@' + item.version + '`').join(', ') || 'none'), '')
    if (summary.version === 2) lines.push('- Source SHA-256: `' + summary.source + '`',
      '- FX1 order: ' + summary.fx1.map(key => '`' + key + '`').join(', '),
      '- FX2 order: ' + summary.fx2.map(key => '`' + key + '`').join(', '),
      '- Hidden modules: ' + (summary.hidden.map(key => '`' + key + '`').join(', ') || 'none'),
      '- Stock FX2 kept: ' + (summary.stockFx2 ? 'yes' : 'no'), '')
    // The grammar admits no backticks, so a fence cannot be broken out of.
    const text = issue.log.text.replace(/\n+$/, '\n')
    const used = lines.join('\n').length + 400
    const room = Math.max(0, BODY_LIMIT - used)
    const shown = text.length <= room ? text : text.slice(text.length - room).replace(/^[^\n]*\n/, '')
    lines.push('### OCTAMOD.LOG', '', describeOtLog(issue.log.summary) + (shown.length < text.length ? ' · showing the newest ' + shown.length + ' of ' + text.length + ' bytes' : ''), '',
      '<details><summary>Log</summary>', '', '```text', shown.replace(/\n$/, ''), '```', '', '</details>', '')
  } else if (issue.log_missing) {
    lines.push('### OCTAMOD.LOG', '', '_Not attached:_ ' + LOG_MISSING_REASONS[issue.log_missing] + (issue.log_missing_note ? ' — ' + inert(issue.log_missing_note) : ''), '')
  }
  lines.push('---', '_Status changes here are shown to the reporter on octamod.app._')
  return lines.join('\n').slice(0, BODY_LIMIT)
}

export async function createGithubIssue(config: GithubConfig, issue: MirroredIssue) {
  const created = await github<{ number: number; html_url: string }>(config, '/issues', 'POST', { title: issueTitle(issue), body: issueMarkdown(issue), labels: ['issue-report', 'module:' + issue.module_id] })
  if (!Number.isInteger(created.number) || typeof created.html_url !== 'string' || !created.html_url.startsWith('https://github.com/')) throw new Error('GitHub returned an unexpected issue.')
  return { number: created.number, url: created.html_url }
}

export async function setGithubIssueState(config: GithubConfig, number: number, status: 'open' | 'closed') {
  await github(config, '/issues/' + number, 'PATCH', status === 'closed' ? { state: 'closed', state_reason: 'completed' } : { state: 'open' })
}

type IssueRow = { id: string; module_id: string; author_login: string; title: string; body: string; reporter: string; context_json: string | null; log_missing: LogMissingReason | null; log_missing_note: string; github_state: string; public_sharing: number; log_text: string | null; summary_json: string | null }

/**
 * Create the GitHub issue for a stored report. The report is kept whatever GitHub answers.
 * `stale` lets the administrator take over a claim left by a request that died mid-sync.
 */
export async function mirrorIssue(db: Database, env: Env, id: string, stale = false) {
  const config = githubConfig(env)
  if (!config) return { state: 'none' as const }
  const row = await db.prepare('SELECT i.id,i.module_id,i.author_login,i.title,i.body,i.context_json,i.log_missing,i.log_missing_note,i.github_state,i.public_sharing,u.display_name AS reporter,l.text AS log_text,l.summary_json FROM issues i JOIN users u ON u.id=i.reporter_id LEFT JOIN issue_logs l ON l.issue_id=i.id WHERE i.id=?').bind(id).first<IssueRow>()
  if (!row) throw new HttpError(404, 'Issue not found.')
  // No new or historical report is granted publication by the account migration.
  if (!row.public_sharing) throw new HttpError(400, 'This report is private and cannot be published to GitHub.')
  // Claim the row so concurrent requests cannot open two GitHub issues.
  const claimable = stale ? "('none','pending','failed','syncing')" : "('none','pending','failed')"
  if (!await db.prepare("UPDATE issues SET github_state='syncing',github_error='' WHERE id=? AND github_state IN " + claimable + " RETURNING id").bind(id).first()) return { state: row.github_state as 'synced' | 'syncing' }
  try {
    const created = await createGithubIssue(config, {
      ...row, context: row.context_json ? JSON.parse(row.context_json) as IssueContext : null,
      log: row.log_text && row.summary_json ? { text: row.log_text, summary: JSON.parse(row.summary_json) as OtLogSummary } : null,
    })
    await db.prepare("UPDATE issues SET github_state='synced',github_number=?,github_url=?,github_error='' WHERE id=?").bind(created.number, created.url, id).run()
    return { state: 'synced' as const, url: created.url }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub mirroring failed.'
    await db.prepare("UPDATE issues SET github_state='failed',github_error=? WHERE id=?").bind(message.slice(0, 300), id).run()
    return { state: 'failed' as const, error: message }
  }
}

function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('') }
function sameText(a: string, b: string) { if (a.length !== b.length) return false; let difference = 0; for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index); return difference === 0 }

export async function signGithubPayload(secret: string, body: ArrayBuffer) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, body))
}

/**
 * GitHub "issues" webhook: closing or reopening the mirrored issue updates the
 * reporter's status. Only signed deliveries for the configured repository count.
 */
export async function handleGithubWebhook(request: Request, env: Env, db: Database, body: ArrayBuffer) {
  const secret = env.GITHUB_WEBHOOK_SECRET?.trim() ?? '', config = githubConfig(env)
  if (!secret || !config) throw new HttpError(503, 'GitHub webhooks are not configured.')
  if (!sameText(request.headers.get('X-Hub-Signature-256') ?? '', await signGithubPayload(secret, body))) throw new HttpError(401, 'Invalid signature.')
  const event = request.headers.get('X-GitHub-Event')
  if (event === 'ping') return { ok: true, handled: false }
  if (event !== 'issues') return { ok: true, handled: false }
  let payload: { action?: unknown; issue?: { number?: unknown }; repository?: { full_name?: unknown } }
  try { payload = JSON.parse(new TextDecoder().decode(body)) } catch { throw new HttpError(400, 'Invalid payload.') }
  const status = payload.action === 'closed' ? 'closed' : payload.action === 'reopened' ? 'open' : null
  const number = payload.issue?.number
  if (!status || !Number.isInteger(number) || String(payload.repository?.full_name ?? '').toLowerCase() !== config.repository.toLowerCase()) return { ok: true, handled: false }
  const updated = await db.prepare('UPDATE issues SET status=? WHERE github_number=? RETURNING id').bind(status, number).first()
  return { ok: true, handled: !!updated }
}
