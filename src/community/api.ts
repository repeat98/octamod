import { apiUrl, communityBase } from '../hosting'
const sessionKey = () => 'octamod.community.session:' + communityBase()
const adminKey = () => 'octamod.community.admin:' + communityBase()
function validSession(value:string){return /^[a-f0-9]{64}$/.test(value)||/^[A-Za-z0-9_%+./=-]{40,600}$/.test(value)&&value.includes('.')}
function savedSession() { try { return localStorage.getItem(sessionKey()) ?? '' } catch { return '' } }
function savedAdmin() { try { return sessionStorage.getItem(adminKey()) ?? '' } catch { return '' } }
/** Administrator sessions are separate from member and legacy guest sessions and last only for this tab. */
export function setAdminSession(value: string) { try { if (value) sessionStorage.setItem(adminKey(), value); else sessionStorage.removeItem(adminKey()) } catch { throw new Error('Your browser could not keep the administrator session for this tab.') } }
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers), session = savedSession()
  if (validSession(session)) headers.set('Authorization', 'Bearer ' + session)
  const admin = savedAdmin()
  if (/^[a-f0-9]{64}$/.test(admin)) headers.set('X-Octamod-Admin', admin)
  let result: Response
  try { result = await fetch(apiUrl(path), { ...options, headers, credentials: 'same-origin', redirect: 'error' }) }
  catch { throw new Error('Community services are not connected yet. Your local workspace still works.') }
  const next = result.headers.get('X-Octamod-Session')
  if (result.ok && next !== null) {
    try { if (validSession(next)) localStorage.setItem(sessionKey(), next); else if (next === '') localStorage.removeItem(sessionKey()) }
    catch { throw new Error('Your browser could not save this community session. Enable site storage to keep ownership of posts.') }
  }
  return result
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const result = await apiFetch(path, options)
  let body: T & { error?: string }
  try { body = await result.json() as T & { error?: string } }
  catch { throw new Error('Community services are not connected yet. Your local workspace still works.') }
  if (!result.ok) throw new Error(body.error ?? 'The request could not be completed.')
  return body
}
export function post<T>(path: string, body: unknown, method = 'POST') { return api<T>(path, { method, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) }) }
export type CommunityUser = { id: string; displayName: string; username: string | null; verified: boolean }
export type Session = { available: boolean; emailAvailable?: boolean; registrationAvailable?: boolean; admin: boolean; user: CommunityUser | null }
export type PublicMedia = { id: string; kind: 'image' | 'audio'; caption: string; capture_type: string }
export type PublishedModule = { module_id: string; title: string; repository_url: string; description: string; usage: string; resource_notes: string; test_report_url: string; reviewed_at: string; added_at?: string | null; author: string }
