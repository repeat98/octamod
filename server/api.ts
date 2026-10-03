import { forum } from './forum'
import { recordUsage, recordModuleDownload, usageStatistics } from './usage'
import { moduleStatistics } from './module-statistics'
import { adminInsights } from './admin-insights'
import recipes from '../src/catalog/module-sets.json'
import type { Database, Env, Media, User } from './platform'
import { reviewAccountRequest } from './account-requests'
import { ADMIN_ACTOR, authentication, currentUser, needMember, isAdmin, throttle } from './auth'
import { boundedBody, checkOrigin, HttpError, jsonBody, required, response } from './security'
import { MODULES } from '../src/catalog/modules'
import { handleGithubWebhook, githubConfig, mirrorIssue, setGithubIssueState } from './github'
import { IssueInputError, validateIssueContext, validateLogMissing } from '../src/community/issue-context'
import { OT_LOG_MAX_BYTES, OtLogError, parseOtLog } from '../src/community/ot-log'

function needUser(user: User | null): User { if (!user) throw new HttpError(401,'Sign in to manage your activity.'); return user }
async function knownModule(db: Database, id: string) {
  if (MODULES.some(module => module.id === id)||recipes.some(recipe=>'remix-'+recipe.id===id)) return
  if (!await db.prepare("SELECT submission_id FROM module_publications WHERE module_id=?").bind(id).first()) throw new HttpError(404,'Module not found.')
}
function issueInput<T>(read:()=>T):T{try{return read()}catch(error){if(error instanceof IssueInputError||error instanceof OtLogError)throw new HttpError(400,error.message);throw error}}
export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname
    // GitHub calls this server-to-server without an Origin; the HMAC signature authenticates it instead.
    if (path === '/api/github/webhook' && request.method === 'POST') {
      if (!env.DB) throw new HttpError(503,'Community services are not connected yet.')
      return response(await handleGithubWebhook(request,env,env.DB,await boundedBody(request,1024*1024)))
    }
    checkOrigin(request,env)
    const auth = await authentication(request,env,path)
    if (auth) return auth
    if (/^\/api\/(submissions|review|repository)(?:\/|$)/.test(path)) throw new HttpError(410,'Module contributions and updates are accepted through GitHub pull requests only.')
    if (/^\/api\/configurations(?:\/|$)/.test(path)) throw new HttpError(410,'Configurations are saved on your device. Use Export to copy one to another device.')
    const db = env.DB
    if (!db) throw new HttpError(503,'Community services are not connected yet. Your device workspace still works.')
    if (path === '/api/usage/events' && request.method === 'POST') return await recordUsage(request,env,db)
    if (path === '/api/usage/module-downloads' && request.method === 'POST') return await recordModuleDownload(request,env,db)
    const user = await currentUser(request,db,env)
    const admin = await isAdmin(request,env,db)
    const discussion = await forum(request,db,user,admin)
    if(discussion)return discussion
    let match: RegExpMatchArray | null
    if ((match = path.match(/^\/api\/media\/([^/]+)$/)) && request.method === 'GET') {
      const item = await db.prepare('SELECT m.*,s.status,s.owner_id,p.submission_id AS published FROM media m JOIN submissions s ON s.id=m.submission_id LEFT JOIN module_publications p ON p.submission_id=s.id WHERE m.id=?').bind(match[1]).first<Media & {status:string;owner_id:string;published:string|null}>()
      if (!item || (!item.published && !admin && item.owner_id !== user?.id)) throw new HttpError(404,'Media not found.')
      const object = await env.MEDIA?.get(item.object_key)
      if (!object) throw new HttpError(404,'Media not found.')
      return new Response(object.body,{headers:{'Content-Type':item.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"}})
    }
    if (path === '/api/catalog' && request.method === 'GET') return response((await db.prepare("SELECT s.module_id,s.title,s.repository_url,s.description,s.usage,s.resource_notes,s.test_report_url,s.reviewed_at,(SELECT strftime('%Y-%m-%dT%H:%M:%SZ', MIN(first.reviewed_at)) FROM submissions first WHERE first.module_id=s.module_id AND first.status='approved') AS added_at,u.github_login AS author FROM module_publications p JOIN submissions s ON s.id=p.submission_id JOIN users u ON u.id=s.owner_id ORDER BY s.reviewed_at DESC").all()).results)
    if ((match = path.match(/^\/api\/modules\/([a-z0-9-]+)$/)) && request.method === 'GET') {
      await knownModule(db,match[1])
      const comments = (await db.prepare('SELECT c.id,c.body,c.created_at,u.display_name AS author,c.user_id FROM comments c JOIN users u ON u.id=c.user_id WHERE c.module_id=? ORDER BY c.created_at DESC LIMIT 100').bind(match[1]).all<{id:string;body:string;created_at:string;author:string;user_id:string}>()).results.map(comment => ({...comment,user_id:undefined,canDelete:admin || comment.user_id === user?.id}))
      const ratings = await db.prepare('SELECT AVG(value) AS average,COUNT(*) AS count FROM ratings WHERE module_id=?').bind(match[1]).first()
      const ownRating = user ? await db.prepare('SELECT value FROM ratings WHERE module_id=? AND user_id=?').bind(match[1],user.id).first<{value:number}>() : null
      const media = (await db.prepare("SELECT m.id,m.kind,m.caption,m.capture_type FROM media m JOIN module_publications p ON p.submission_id=m.submission_id WHERE p.module_id=?").bind(match[1]).all()).results
      const likes=await db.prepare('SELECT COUNT(*) AS count FROM likes WHERE module_id=?').bind(match[1]).first<{count:number}>()
      const liked=!!(user&&await db.prepare('SELECT user_id FROM likes WHERE module_id=? AND user_id=?').bind(match[1],user.id).first())
      const downloads=(await db.prepare('SELECT downloads FROM module_downloads WHERE module_id=?').bind(match[1]).first<{downloads:number}>())?.downloads??0
      const downloadsStarted=(await db.prepare("SELECT value FROM module_download_meta WHERE key='collection_started'").first<{value:string}>())?.value??null
      return response({comments,ratings,ownRating:ownRating?.value ?? 0,media,likes:likes?.count??0,liked,downloads,downloadsStarted})
    }
    if ((match = path.match(/^\/api\/modules\/([a-z0-9-]+)\/(comments|rating|like)$/)) && request.method === 'POST') {
      await knownModule(db,match[1])
      const body = await jsonBody(request)
      await throttle(db,'community-ip:'+(request.headers.get('CF-Connecting-IP')??'local'),30)
      if(match[2]==='comments')required(body.body,'Comment',2000)
      else if(match[2]==='rating'&&(!Number.isInteger(body.value)||Number(body.value)<1||Number(body.value)>5))throw new HttpError(400,'Choose a rating from 1 to 5.')
      const owner=needMember(user)
      await throttle(db,'community:' + owner.id,30)
      if (match[2] === 'comments') { await db.prepare('INSERT INTO comments(id,module_id,user_id,body) VALUES(?,?,?,?)').bind(crypto.randomUUID(),match[1],owner.id,required(body.body,'Comment',2000)).run() }
      else if(match[2]==='like'){if(typeof body.liked!=='boolean')throw new HttpError(400,'Choose liked or unliked.');if(body.liked)await db.prepare('INSERT INTO likes(module_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING').bind(match[1],owner.id).run();else await db.prepare('DELETE FROM likes WHERE module_id=? AND user_id=?').bind(match[1],owner.id).run()}
      else { const rating = Number(body.value); if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400,'Choose a rating from 1 to 5.'); await db.prepare('INSERT INTO ratings(module_id,user_id,value) VALUES(?,?,?) ON CONFLICT(module_id,user_id) DO UPDATE SET value=excluded.value').bind(match[1],owner.id,rating).run() }
      return response({ok:true})
    }
    if ((match = path.match(/^\/api\/comments\/([^/]+)$/)) && request.method === 'DELETE') {
      if (admin) await db.prepare('DELETE FROM comments WHERE id=?').bind(match[1]).run()
      else await db.prepare('DELETE FROM comments WHERE id=? AND user_id=?').bind(match[1],needUser(user).id).run()
      return response({ok:true})
    }
    if ((match=path.match(/^\/api\/modules\/([a-z0-9-]+)\/issues$/)) && request.method==='POST') {
      const owner=needMember(user)
      await knownModule(db,match[1]);const body=await jsonBody(request,OT_LOG_MAX_BYTES+32*1024)
      if(typeof body.steps!=='string'&&typeof body.body==='string')throw new HttpError(400,'Issue reports now include your configuration and OCTAMOD.LOG. Reload the page and report again.')
      const title=required(body.title,'Issue title',160),steps=required(body.steps,'Steps to reproduce',3000),expected=required(body.expected,'Expected result',1000),actual=required(body.actual,'Actual result',2000)
      const context=issueInput(()=>validateIssueContext(body.context))
      const attached=body.log!==undefined&&body.log!==null&&body.log!==''
      if(attached&&typeof body.log!=='string')throw new HttpError(400,'Attach OCTAMOD.LOG as text.')
      const log=attached?issueInput(()=>parseOtLog(body.log as string)):null
      const missing=log?null:issueInput(()=>validateLogMissing(body.logMissing,context))
      await throttle(db,'issue-ip:'+(request.headers.get('CF-Connecting-IP')??'local'),10)
      // Bound stored reports across the site as well as per IP and member.
      await throttle(db,'issue-global',60)
      const core=MODULES.find(item=>item.id===match![1])
      const recipe=recipes.find(item=>'remix-'+item.id===match![1])
      const published=core||recipe?null:await db.prepare("SELECT u.github_login FROM module_publications p JOIN submissions s ON s.id=p.submission_id JOIN users u ON u.id=s.owner_id WHERE p.module_id=?").bind(match[1]).first<{github_login:string}>()
      const author=core?.author??recipe?.author??published?.github_login
      if(!author)throw new HttpError(400,'No author is registered for this module.')
      await throttle(db,'issue-member:'+owner.id,10)
      const id=crypto.randomUUID(),details='Steps to reproduce:\n'+steps+'\n\nExpected:\n'+expected+'\n\nActual:\n'+actual
      const statements=[db.prepare('INSERT INTO issues(id,module_id,author_login,reporter_id,title,body,context_json,log_missing,log_missing_note,github_state) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,match[1],author,owner.id,title,details,JSON.stringify(context),missing?.reason??null,missing?.note??'','none')]
      if(log)statements.push(db.prepare('INSERT INTO issue_logs(issue_id,text,bytes,summary_json) VALUES(?,?,?,?)').bind(id,log.text,log.text.length,JSON.stringify(log.summary)))
      await db.batch(statements)
      // Account reports stay private, even when GitHub credentials are configured.
      return response({ok:true,author,github:'none',githubUrl:null},201)
    }
    if(path==='/api/issues/mine'&&request.method==='GET'){
      if(!user)return response([])
      return response((await db.prepare('SELECT id,module_id,author_login,title,body,status,created_at,github_url,public_sharing FROM issues WHERE reporter_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all()).results)
    }
    if (path.startsWith('/api/admin/')) {
      if (!admin) throw new HttpError(403,'Administrator access is required.')
      if(path==='/api/admin/account-requests'&&request.method==='GET')return response((await db.prepare('SELECT r.id,r.user_id,r.status,r.created_at,r.updated_at,r.review_note,u.username FROM account_removal_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 100').all()).results)
      if(path==='/api/admin/account-mail'&&request.method==='GET')return response((await db.prepare('SELECT day,purpose,accepted,failed,limited FROM account_mail_daily ORDER BY day DESC,purpose LIMIT 60').all()).results)
      if((match=path.match(/^\/api\/admin\/account-requests\/([a-zA-Z0-9-]+)$/))&&request.method==='PATCH')return reviewAccountRequest(request,db,match[1])
      if (path === '/api/admin/insights' && request.method === 'GET') return response(await adminInsights(db))
      if (path === '/api/admin/statistics' && request.method === 'GET') return await usageStatistics(db,Number(url.searchParams.get('days') ?? 7))
      if (path === '/api/admin/overview' && request.method === 'GET') return response(await db.prepare("SELECT (SELECT COUNT(*) FROM submissions WHERE status='pending') AS pending,(SELECT COUNT(*) FROM module_publications) AS published,(SELECT COUNT(*) FROM comments) AS comments,(SELECT COUNT(*) FROM issues WHERE status='open') AS issues,(SELECT COALESCE(SUM(bytes),0) FROM media) AS mediaBytes").first())
      if (path === '/api/admin/history' && request.method === 'GET') return response((await db.prepare('SELECT e.id,e.module_id,e.action,e.note,e.created_at,u.display_name AS actor FROM review_events e JOIN users u ON u.id=e.actor_id ORDER BY e.rowid DESC LIMIT 100').all()).results)
      if (path === '/api/admin/issues' && request.method === 'GET') {
        const moduleId = url.searchParams.has('moduleId') ? required(url.searchParams.get('moduleId'),'Module ID',100) : '', status = url.searchParams.get('status')??'all'
        if (!['all','open','closed'].includes(status)) throw new HttpError(400,'Choose all, open or closed issues.')
        return response((await db.prepare("SELECT i.id,i.module_id,i.author_login,i.title,i.body,i.status,i.created_at,i.context_json,i.log_missing,i.log_missing_note,i.github_state,i.github_url,i.github_error,i.public_sharing,l.summary_json AS log_summary_json,u.display_name AS reporter FROM issues i JOIN users u ON u.id=i.reporter_id LEFT JOIN issue_logs l ON l.issue_id=i.id WHERE (?='' OR i.module_id=?) AND (?='all' OR i.status=?) ORDER BY i.created_at DESC,i.rowid DESC LIMIT 200").bind(moduleId,moduleId,status,status).all<Record<string,unknown>&{context_json:string|null;log_summary_json:string|null}>()).results.map(({context_json,log_summary_json,...item})=>({...item,context:context_json?JSON.parse(context_json):null,log:log_summary_json?JSON.parse(log_summary_json):null})))
      }
      if ((match=path.match(/^\/api\/admin\/issues\/([^/]+)\/log$/)) && request.method === 'GET') {
        const log=await db.prepare('SELECT text FROM issue_logs WHERE issue_id=?').bind(match[1]).first<{text:string}>()
        if(!log)throw new HttpError(404,'No log is attached to this issue.')
        return new Response(log.text,{headers:{'Content-Type':'text/plain; charset=us-ascii','Content-Disposition':'attachment; filename="OCTAMOD-'+match[1].replace(/[^a-f0-9-]/g,'')+'.LOG"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
      }
      if ((match=path.match(/^\/api\/admin\/issues\/([^/]+)\/github$/)) && request.method === 'POST') {
        if(!githubConfig(env))throw new HttpError(503,'GitHub mirroring is not configured for this backend.')
        return response(await mirrorIssue(db,env,match[1],true))
      }
      if ((match=path.match(/^\/api\/admin\/issues\/([^/]+)$/)) && request.method === 'PATCH') {
        const body=await jsonBody(request)
        if(body.status!=='open'&&body.status!=='closed')throw new HttpError(400,'Choose open or closed.')
        const issue=await db.prepare('UPDATE issues SET status=? WHERE id=? RETURNING github_number').bind(body.status,match[1]).first<{github_number:number|null}>()
        if(!issue)throw new HttpError(404,'Issue not found.')
        // Keep the GitHub issue in step; the local status is authoritative for the reporter either way.
        const config=githubConfig(env);let github='none'
        if(config&&issue.github_number){try{await setGithubIssueState(config,issue.github_number,body.status);github='synced'}catch{github='failed'}}
        return response({ok:true,github})
      }
      if (path === '/api/admin/comments' && request.method === 'GET') return response((await db.prepare('SELECT c.id,c.module_id,c.body,c.created_at,u.display_name AS author FROM comments c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 100').all()).results)
      if ((match=path.match(/^\/api\/admin\/modules\/([a-z0-9-]+)\/withdraw$/)) && request.method === 'POST') {
        const body=await jsonBody(request),note=required(body.note,'Withdrawal reason',2000),event=crypto.randomUUID(),id=match[1]
        const [recorded]=await db.batch([
          db.prepare("INSERT INTO review_events(id,actor_id,module_id,submission_id,action,note) SELECT ?,?,module_id,submission_id,'withdrawn',? FROM module_publications WHERE module_id=?").bind(event,ADMIN_ACTOR,note,id),
          db.prepare('DELETE FROM module_publications WHERE module_id=? AND EXISTS(SELECT 1 FROM review_events WHERE id=?)').bind(id,event),
        ])
        if (!(recorded as {meta:{changes:number}}).meta.changes) throw new HttpError(404,'Published contribution not found.')
        return response({ok:true})
      }
      throw new HttpError(404,'API route not found.')
    }
    if(path==='/api/community/summary'&&request.method==='GET')return response(await moduleStatistics(db))
    throw new HttpError(404,'API route not found.')
  } catch (error) { return response({error:error instanceof HttpError ? error.message : 'The community service could not complete this request.'},error instanceof HttpError ? error.status : 500) }
}
