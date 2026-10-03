import type { Database, User } from './platform'
import { ADMIN_ACTOR, needMember, throttle } from './auth'
import { HttpError, jsonBody, required, response } from './security'
import { FORUM_CATEGORIES, sharedConfiguration } from '../src/community/forum-contract'
import { MODULES } from '../src/catalog/modules'

type Thread = {id:string;user_id:string;locked:number;hidden:number;configuration_json:string|null;issue_json:string|null}
function page(url: URL) { const value = Number(url.searchParams.get('page') ?? 0); if (!Number.isInteger(value) || value < 0 || value > 10000) throw new HttpError(400,'Invalid page.'); return value }
const threadFields = 't.id,t.title,t.category,t.module_id,t.status,t.locked,t.pinned,t.created_at,t.updated_at,u.username,(SELECT MAX(COUNT(*)-1,0) FROM forum_posts p WHERE p.thread_id=t.id AND p.hidden=0) AS replies'
async function threadById(db: Database, id: string, admin: boolean) {
  const thread = await db.prepare('SELECT * FROM forum_threads WHERE id=? AND (hidden=0 OR ?=1)').bind(id, Number(admin)).first<Thread>()
  if (!thread) throw new HttpError(404,'Thread not found.')
  return thread
}
function bool(value: unknown) { if (typeof value !== 'boolean') throw new HttpError(400,'Choose on or off.'); return Number(value) }
function cleanBody(value: unknown) { return required(value,'Post',12000) }
function moduleId(value: unknown) {
  if (value === '' || value === undefined || value === null) return null
  if (typeof value !== 'string' || !MODULES.some(module => module.id === value)) throw new HttpError(400,'Choose a known module.')
  return value
}
export async function forum(request: Request, db: Database, user: User|null, admin: boolean): Promise<Response|null> {
  const url = new URL(request.url), path = url.pathname
  if (!path.startsWith('/api/forum') && !path.startsWith('/api/admin/forum')) return null
  let match: RegExpMatchArray|null
  if (path.startsWith('/api/admin/forum')) {
    if (!admin) throw new HttpError(403,'Administrator access is required.')
    if (path === '/api/admin/forum/reports' && request.method === 'GET') return response((await db.prepare('SELECT r.id,r.reason,r.resolved,r.created_at,p.id AS post_id,p.body,p.hidden,p.thread_id,p.user_id,u.username,t.title FROM forum_reports r JOIN forum_posts p ON p.id=r.post_id JOIN forum_threads t ON t.id=p.thread_id JOIN users u ON u.id=p.user_id ORDER BY r.resolved,r.created_at DESC LIMIT 100').all()).results)
    if (path === '/api/admin/forum/history' && request.method === 'GET') return response((await db.prepare('SELECT id,target,action,reason,created_at FROM forum_moderation ORDER BY rowid DESC LIMIT 100').all()).results)
    if ((match = path.match(/^\/api\/admin\/forum\/(posts|threads|users|reports)\/([a-zA-Z0-9-]+)$/)) && request.method === 'PATCH') {
      const body = await jsonBody(request), reason = required(body.reason,'Moderation reason',1000), target = match[2]
      const allowed = match[1] === 'posts' ? ['hidden'] : match[1] === 'threads' ? ['locked','pinned','hidden'] : match[1] === 'users' ? ['suspended'] : ['resolved']
      if (typeof body.action !== 'string' || !allowed.includes(body.action)) throw new HttpError(400,'Unknown moderation action.')
      const value = bool(body.value), table = {posts:'forum_posts',threads:'forum_threads',users:'users',reports:'forum_reports'}[match[1]]!
      if (target === ADMIN_ACTOR) throw new HttpError(400,'The administrator cannot be suspended here.')
      const result = await db.batch([
        db.prepare(`UPDATE ${table} SET ${body.action}=? WHERE id=?`).bind(value,target),
        db.prepare(`INSERT INTO forum_moderation(id,actor_id,target,action,reason) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=?)`).bind(crypto.randomUUID(),ADMIN_ACTOR,target,`${body.action}:${value}`,reason,target),
        ...(body.action === 'suspended' && value ? [db.prepare('DELETE FROM sessions WHERE user_id=?').bind(target),db.prepare('DELETE FROM auth_sessions WHERE userId=?').bind(target)] : []),
      ])
      if (!(result[0] as {meta:{changes:number}}).meta.changes) throw new HttpError(404,'Item not found.')
      return response({ok:true})
    }
    throw new HttpError(404,'Moderation route not found.')
  }
  if (path === '/api/forum/threads' && request.method === 'GET') {
    const category = url.searchParams.get('category') ?? '', module = moduleId(url.searchParams.get('module')), query = (url.searchParams.get('q') ?? '').trim().slice(0,120), saved = url.searchParams.get('saved') === '1', author = url.searchParams.get('author') ?? ''
    if (category && !Object.hasOwn(FORUM_CATEGORIES,category)) throw new HttpError(400,'Unknown category.')
    if (saved) needMember(user)
    const escaped = '%' + query.replace(/[\\%_]/g, '\\$&') + '%'
    const rows = (await db.prepare(`SELECT ${threadFields} FROM forum_threads t JOIN users u ON u.id=t.user_id WHERE t.hidden=0 AND (?='' OR t.category=?) AND (? IS NULL OR t.module_id=?) AND (?='' OR u.username=?) AND (?=0 OR EXISTS(SELECT 1 FROM forum_bookmarks b WHERE b.thread_id=t.id AND b.user_id=?)) AND (?='' OR t.title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM forum_posts p WHERE p.thread_id=t.id AND p.hidden=0 AND p.body LIKE ? ESCAPE '\\')) ORDER BY t.pinned DESC,t.updated_at DESC,t.id LIMIT 31 OFFSET ?`).bind(category,category,module,module,author,author,Number(saved),user?.id??'',query,escaped,escaped,page(url)*30).all()).results
    return response({threads:rows.slice(0,30),hasMore:rows.length>30})
  }
  if (path === '/api/forum/notifications' && request.method === 'GET') {
    const member = needMember(user)
    return response((await db.prepare('SELECT n.id,n.thread_id,n.post_id,n.seen,n.created_at,t.title FROM forum_notifications n JOIN forum_threads t ON t.id=n.thread_id JOIN forum_posts p ON p.id=n.post_id WHERE n.user_id=? AND t.hidden=0 AND p.hidden=0 ORDER BY n.created_at DESC,n.id LIMIT 100').bind(member.id).all()).results)
  }
  if (path === '/api/forum/notifications' && request.method === 'PATCH') {
    await db.prepare('UPDATE forum_notifications SET seen=1 WHERE user_id=?').bind(needMember(user).id).run()
    return response({ok:true})
  }
  if ((match=path.match(/^\/api\/forum\/profiles\/([a-z0-9_]{3,24})$/)) && request.method === 'GET') {
    const profile = await db.prepare('SELECT username,created_at FROM users WHERE username=? AND email_verified=1 AND suspended=0').bind(match[1]).first()
    if (!profile) throw new HttpError(404,'Profile not found.')
    return response(profile)
  }
  if ((match=path.match(/^\/api\/forum\/threads\/([a-zA-Z0-9-]+)$/)) && request.method === 'GET') {
    const thread = await threadById(db,match[1],admin)
    const summary = await db.prepare(`SELECT ${threadFields},t.hidden FROM forum_threads t JOIN users u ON u.id=t.user_id WHERE t.id=?`).bind(thread.id).first()
    const posts = (await db.prepare('SELECT p.*,u.username,(SELECT COUNT(*) FROM forum_reactions r WHERE r.post_id=p.id) AS likes,EXISTS(SELECT 1 FROM forum_reactions r WHERE r.post_id=p.id AND r.user_id=?) AS liked FROM forum_posts p JOIN users u ON u.id=p.user_id WHERE p.thread_id=? ORDER BY p.created_at,p.rowid LIMIT 31 OFFSET ?').bind(user?.id??'',thread.id,page(url)*30).all<{id:string;user_id:string;hidden:number;body:string;username:string;created_at:string;edited_at:string|null;likes:number;liked:number}>()).results
    const following = !!user && !!await db.prepare('SELECT user_id FROM forum_follows WHERE thread_id=? AND user_id=?').bind(thread.id,user.id).first()
    const bookmarked = !!user && !!await db.prepare('SELECT user_id FROM forum_bookmarks WHERE thread_id=? AND user_id=?').bind(thread.id,user.id).first()
    return response({thread:summary,posts:posts.slice(0,30).map(post=>({id:post.id,body:post.hidden&&!admin?'':post.body,username:post.hidden&&!admin?null:post.username,created_at:post.created_at,edited_at:post.edited_at,hidden:post.hidden,likes:post.hidden?0:post.likes,liked:!post.hidden&&!!post.liked,canEdit:!thread.locked&&!post.hidden&&post.user_id===user?.id&&!!user?.email_verified,...(admin?{user_id:post.user_id}:{})})),configuration:thread.configuration_json?JSON.parse(thread.configuration_json):null,issue:thread.issue_json?JSON.parse(thread.issue_json):null,following,bookmarked,hasMore:posts.length>30})
  }
  const member = needMember(user)
  await throttle(db,'forum:'+member.id,60)
  await throttle(db,'forum-ip:'+(request.headers.get('CF-Connecting-IP')??'local'),120)
  const body = await jsonBody(request)
  if (path === '/api/forum/threads' && request.method === 'POST') {
    await throttle(db,'new-thread:'+member.id,10)
    if (typeof body.category !== 'string' || !Object.hasOwn(FORUM_CATEGORIES,body.category)) throw new HttpError(400,'Choose a category.')
    const title=required(body.title,'Title',160), content=cleanBody(body.body), module=moduleId(body.moduleId), id=crypto.randomUUID(), postId=crypto.randomUUID()
    let config=null,issue=null
    if(body.category==='configs'){try{config=sharedConfiguration(body.configuration)}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid configuration.')}}
    else if(body.configuration!==undefined)throw new HttpError(400,'Shared configurations belong in the configurations category.')
    if(body.category==='issues'){
      if(!module)throw new HttpError(400,'Choose the affected module.')
      if(!body.issue||typeof body.issue!=='object'||Array.isArray(body.issue))throw new HttpError(400,'Include the device, module version and reproduction steps.')
      const item=body.issue as Record<string,unknown>
      if(Object.keys(item).some(key=>!['device','version','steps','expected','actual'].includes(key)))throw new HttpError(400,'Unexpected issue field. Attachments are not accepted.')
      issue={device:required(item.device,'Device',80),version:required(item.version,'Module version',80),steps:required(item.steps,'Steps',4000),expected:required(item.expected,'Expected result',2000),actual:required(item.actual,'Actual result',2000)}
    }
    await db.batch([
      db.prepare('INSERT INTO forum_threads(id,user_id,title,category,module_id,configuration_json,issue_json) VALUES(?,?,?,?,?,?,?)').bind(id,member.id,title,body.category,module,config?JSON.stringify(config):null,issue?JSON.stringify(issue):null),
      db.prepare('INSERT INTO forum_posts(id,thread_id,user_id,body) VALUES(?,?,?,?)').bind(postId,id,member.id,content),
      db.prepare('INSERT INTO forum_follows(thread_id,user_id) VALUES(?,?)').bind(id,member.id),
    ])
    return response({id},201)
  }
  if ((match=path.match(/^\/api\/forum\/threads\/([a-zA-Z0-9-]+)\/(replies|follow|bookmark|status)$/))) {
    const thread = await threadById(db,match[1],false), action=match[2]
    if(action==='replies'&&request.method==='POST'){
      if(thread.locked)throw new HttpError(409,'This thread is locked.')
      const text=cleanBody(body.body),id=crypto.randomUUID()
      const result=await db.batch([
        db.prepare('INSERT INTO forum_posts(id,thread_id,user_id,body) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM forum_threads WHERE id=? AND locked=0 AND hidden=0)').bind(id,thread.id,member.id,text,thread.id),
        db.prepare('UPDATE forum_threads SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM forum_posts WHERE id=?)').bind(thread.id,id),
        db.prepare('INSERT INTO forum_notifications(id,user_id,thread_id,post_id) SELECT lower(hex(randomblob(16))),f.user_id,f.thread_id,? FROM forum_follows f JOIN users u ON u.id=f.user_id WHERE f.thread_id=? AND f.user_id<>? AND u.suspended=0 AND EXISTS(SELECT 1 FROM forum_posts WHERE id=?)').bind(id,thread.id,member.id,id),
        db.prepare('INSERT INTO forum_follows(thread_id,user_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM forum_posts WHERE id=?) ON CONFLICT DO NOTHING').bind(thread.id,member.id,id),
      ])
      if(!(result[0] as {meta:{changes:number}}).meta.changes)throw new HttpError(409,'This thread is locked or unavailable.')
      return response({id},201)
    }
    if((action==='follow'||action==='bookmark')&&request.method==='POST'){
      const table=action==='follow'?'forum_follows':'forum_bookmarks'
      if(bool(body.enabled))await db.prepare(`INSERT INTO ${table}(thread_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING`).bind(thread.id,member.id).run()
      else await db.prepare(`DELETE FROM ${table} WHERE thread_id=? AND user_id=?`).bind(thread.id,member.id).run()
      return response({ok:true})
    }
    if(action==='status'&&request.method==='PATCH'){
      if(thread.user_id!==member.id&&!admin)throw new HttpError(403,'Only the thread author or administrator can change its status.')
      if(!['open','resolved'].includes(String(body.status)))throw new HttpError(400,'Choose open or resolved.')
      await db.prepare('UPDATE forum_threads SET status=? WHERE id=? AND category=\'issues\'').bind(body.status,thread.id).run()
      return response({ok:true})
    }
  }
  if((match=path.match(/^\/api\/forum\/posts\/([a-zA-Z0-9-]+)(?:\/(react|report))?$/))){
    const post=await db.prepare('SELECT p.id,p.user_id,p.thread_id,t.locked FROM forum_posts p JOIN forum_threads t ON t.id=p.thread_id WHERE p.id=? AND p.hidden=0 AND t.hidden=0').bind(match[1]).first<{id:string;user_id:string;thread_id:string;locked:number}>()
    if(!post)throw new HttpError(404,'Post not found.')
    if(match[2]==='react'&&request.method==='POST'){
      if(bool(body.liked))await db.prepare('INSERT INTO forum_reactions(post_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING').bind(post.id,member.id).run()
      else await db.prepare('DELETE FROM forum_reactions WHERE post_id=? AND user_id=?').bind(post.id,member.id).run()
      return response({ok:true})
    }
    if(match[2]==='report'&&request.method==='POST'){
      await db.prepare('INSERT INTO forum_reports(id,post_id,user_id,reason) VALUES(?,?,?,?) ON CONFLICT(post_id,user_id) DO NOTHING').bind(crypto.randomUUID(),post.id,member.id,required(body.reason,'Reason',1000)).run()
      return response({ok:true})
    }
    if(!match[2]&&request.method==='PATCH'){
      if(post.user_id!==member.id)throw new HttpError(403,'You can edit only your own posts.')
      if(post.locked)throw new HttpError(409,'This thread is locked.')
      const edited=await db.prepare('UPDATE forum_posts SET body=?,edited_at=CURRENT_TIMESTAMP WHERE id=? AND hidden=0 AND EXISTS(SELECT 1 FROM forum_threads WHERE id=? AND locked=0 AND hidden=0) RETURNING id').bind(cleanBody(body.body),post.id,post.thread_id).first()
      if(!edited)throw new HttpError(409,'This post is locked or unavailable.')
      return response({ok:true})
    }
  }
  throw new HttpError(404,'Forum route not found.')
}
