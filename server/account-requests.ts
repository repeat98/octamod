import { verifyPassword } from 'better-auth/crypto'
import type { Database, User } from './platform'
import { HttpError, jsonBody, required, response } from './security'
import { throttle } from './auth'

/** Requests are private and reversible. Data removal is a separate operator action. */
export async function accountRequest(request: Request, db: Database, owner: User|null) {
 if(!owner?.username||!owner.email_verified)throw new HttpError(401,'Sign in to manage an account-removal request.')
 if(request.method==='GET')return response(await db.prepare('SELECT id,status,created_at,updated_at FROM account_removal_requests WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(owner.id).first())
 await throttle(db,'account-request:'+owner.id,5,900)
 if(request.method==='DELETE'){
  await db.prepare("UPDATE account_removal_requests SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND status IN ('requested','reviewing')").bind(owner.id).run()
  return response({ok:true})
 }
 if(request.method!=='POST')throw new HttpError(405,'Choose a supported account-request action.')
 const body=await jsonBody(request)
 if(body.confirm!=='REQUEST'||typeof body.password!=='string'||body.password.length<15||body.password.length>128)throw new HttpError(400,'Enter your password and confirm the removal request.')
 const credential=await db.prepare("SELECT password FROM auth_accounts WHERE userId=? AND providerId='credential'").bind(owner.id).first<{password:string}>()
 if(!credential||!await verifyPassword({hash:credential.password,password:body.password}))throw new HttpError(403,'Your password was not accepted.')
 await db.prepare("INSERT OR IGNORE INTO account_removal_requests(id,user_id) VALUES(?,?)").bind(crypto.randomUUID(),owner.id).run()
 return response(await db.prepare("SELECT id,status,created_at,updated_at FROM account_removal_requests WHERE user_id=? AND status IN ('requested','reviewing')").bind(owner.id).first(),202)
}
export async function reviewAccountRequest(request:Request,db:Database,id:string){
 const body=await jsonBody(request)
 if(body.status!=='reviewing'&&body.status!=='cancelled'&&body.status!=='completed')throw new HttpError(400,'Choose reviewing, cancelled or completed.')
 const requestRow=await db.prepare('SELECT user_id,status FROM account_removal_requests WHERE id=?').bind(id).first<{user_id:string;status:string}>()
 if(!requestRow)throw new HttpError(404,'Request not found.')
 if(!['requested','reviewing'].includes(requestRow.status))throw new HttpError(409,'This request has already ended.')
 if(body.status==='completed'){
  const privateChecks=[['auth_users','id'],['auth_accounts','userId'],['auth_sessions','userId'],['account_tokens','user_id'],['auth_verifications','value'],['sessions','user_id'],['issues','reporter_id'],['configurations','user_id'],['forum_bookmarks','user_id'],['forum_follows','user_id'],['forum_notifications','user_id'],['forum_reports','user_id']] as const
  const checks=privateChecks.map(([table,column])=>`EXISTS(SELECT 1 FROM ${table} WHERE ${column}=?)`)
  checks.push("EXISTS(SELECT 1 FROM users WHERE id=? AND (username IS NOT NULL OR email_verified=1 OR suspended=0 OR display_name!='Deleted member'))")
  const remaining=await db.prepare('SELECT '+checks.join(' OR ')+' AS present').bind(...checks.map(()=>requestRow.user_id)).first<{present:number}>()
  if(remaining?.present)throw new HttpError(409,'Account data is still present. Complete and verify the separately authorized operator procedure first.')
 }
 const updated=await db.prepare("UPDATE account_removal_requests SET status=?,review_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('requested','reviewing') RETURNING id").bind(body.status,required(body.note,'Review note',1000),id).first()
 if(!updated)throw new HttpError(409,'This request has already ended.')
 return response({ok:true})
}
