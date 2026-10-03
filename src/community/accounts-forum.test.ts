import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testServer } from './test-server'
import type { DatabaseSync } from 'node:sqlite'
import { digest } from '../../server/security'
import { MODULES } from '../catalog/modules'
import { handleCommunity } from '../../server/transport'
const databases:DatabaseSync[]=[]
const sent:{to:string[];text:string}[]=[]
const password='a long original test passphrase'
beforeEach(()=>{sent.length=0;vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{expect(url).toBe('https://api.resend.com/emails');sent.push(JSON.parse(String(options.body)));return Response.json({id:crypto.randomUUID()})}))})
afterEach(()=>{vi.unstubAllGlobals();for(const db of databases.splice(0))db.close()})
async function fixture(){
 const server=await testServer();databases.push(server.db)
 async function member(username:string){
  const email=username+'@example.test'
  const register=await server.call('/auth/register','POST',{username,email,password});expect(await register.json()).not.toHaveProperty('error');expect(register.status).toBe(202)
  const message=[...sent].reverse().find(message=>message.to[0]===email)!,token=message.text.match(/#account\/verify\/([^\s]+)/)![1]
  const verified=await server.call('/auth/verify','POST',{token,password});expect(await verified.json()).not.toHaveProperty('error');expect(verified.status).toBe(200)
  const login=await server.call('/auth/login','POST',{email,password});expect(await login.json()).not.toHaveProperty('error');expect(login.status).toBe(200)
  const session=login.headers.get('X-Octamod-Session')!;expect(session).toContain('.')
  return {email,session,username}
 }
 return {...server,member}
}
const thread={title:'How do you use Mini Verb?',body:'Share your settings.',category:'modules',moduleId:'miniverb'}
describe('verified email accounts',()=>{
 it('requires inbox verification and a signed session, keeping secrets out of public/session responses',async()=>{
  const {call,db}=await fixture(),email='listener@example.test'
  expect((await call('/auth/register','POST',{username:'listener',email,password})).status).toBe(202)
  expect((await call('/auth/login','POST',{email,password})).status).toBe(403)
  const token=sent[0].text.match(/#account\/verify\/([^\s]+)/)![1]
  expect(JSON.stringify(db.prepare('SELECT * FROM account_tokens').all())).not.toContain(token)
  expect((await call('/auth/verify','POST',{token,password:'a completely different password'})).status).toBe(400)
  expect((await call('/auth/verify','POST',{token,password})).status).toBe(200)
  expect((await call('/auth/verify','POST',{token,password})).status).toBe(400)
  const login=await call('/auth/login','POST',{email,password}),session=login.headers.get('X-Octamod-Session')!
  expect(login.status).toBe(200);expect(login.headers.get('set-cookie')).toBeNull()
  const own=await(await call('/auth/session','GET',undefined,session)).json();expect(own.user).toMatchObject({username:'listener',verified:true});expect(JSON.stringify(own)).not.toContain(email)
  const raw=String(db.prepare('SELECT token FROM auth_sessions').get()!.token)
  expect((await(await call('/auth/session','GET',undefined,raw)).json()).user).toBeNull()
  expect((await(await call('/auth/session','GET',undefined,session+'tampered')).json()).user).toBeNull()
  expect((await call('/modules/miniverb/rating','POST',{value:5},session)).status).toBe(200)
  expect((await(await call('/auth/sessions','GET',undefined,session)).text())).not.toContain(raw)
  expect(db.prepare('SELECT ipAddress,userAgent FROM auth_sessions').get()).toEqual({ipAddress:null,userAgent:null})
  await call('/auth/logout','POST',{},session)
  expect((await(await call('/auth/session','GET',undefined,session)).json()).user).toBeNull()
 })
 it('resets once, revokes all sessions and all outstanding recovery links',async()=>{
  const {call,member,db}=await fixture(),user=await member('resetuser')
  await call('/auth/forgot','POST',{email:user.email})
  const reset=sent.at(-1)!.text.match(/#account\/reset\/([^\s]+)/)![1]
  await call('/auth/forgot','POST',{email:user.email})
  const second=sent.at(-1)!.text.match(/#account\/reset\/([^\s]+)/)![1]
  const nextPassword='another sufficiently long password'
  expect(JSON.stringify(db.prepare('SELECT * FROM auth_verifications').all())).not.toContain(reset)
  expect((await call('/auth/reset','POST',{token:reset,password:nextPassword})).status).toBe(200)
  expect((await call('/auth/reset','POST',{token:reset,password:nextPassword})).status).toBe(400)
  expect((await call('/auth/reset','POST',{token:second,password:nextPassword})).status).toBe(400)
  expect((await(await call('/auth/session','GET',undefined,user.session)).json()).user).toBeNull()
  expect((await call('/auth/login','POST',{email:user.email,password})).status).toBe(401)
  expect((await call('/auth/login','POST',{email:user.email,password:nextPassword})).status).toBe(200)
 })
 it('supports secure same-origin cookies, other-device revocation and private duplicate responses',async()=>{
  const {call,member,env}=await fixture(),user=await member('devices')
  const second=await call('/auth/login','POST',{email:user.email,password}),secondToken=second.headers.get('X-Octamod-Session')!
  expect(await(await call('/auth/sessions','GET',undefined,user.session)).json()).toHaveLength(2)
  expect((await call('/auth/sessions','DELETE',undefined,user.session)).status).toBe(200)
  expect((await(await call('/auth/session','GET',undefined,secondToken)).json()).user).toBeNull()
  const duplicate=await call('/auth/register','POST',{username:'anothername',email:user.email,password})
  expect(duplicate.status).toBe(202);expect(await duplicate.text()).not.toContain(user.email)
  const absent=await call('/auth/forgot','POST',{email:'absent@example.test'})
  expect(absent.status).toBe(202)
  env.SESSION_TRANSPORT=undefined
  const login=await call('/auth/login','POST',{email:user.email,password})
  expect(login.status).toBe(200);expect(login.headers.get('X-Octamod-Session')).toBeNull()
  const cookies=login.headers.getSetCookie()
  expect(cookies.join(';')).toMatch(/HttpOnly/i);expect(cookies.join(';')).toMatch(/Secure/i);expect(cookies.join(';')).toMatch(/SameSite=Lax/i)
  const cookie=cookies.map(value=>value.split(';')[0]).join('; ')
  const session=await handleCommunity(new Request('https://octamod.test/api/auth/session',{headers:{Cookie:cookie}}),env)
  expect((await session.json()).user.username).toBe(user.username)
  expect((await handleCommunity(new Request('https://octamod.test/api/auth/logout',{method:'POST',headers:{Cookie:cookie}}),env)).status).toBe(403)
 })
 it('rejects expired verification and recovery links, weak passwords and reserved usernames',async()=>{
  const {call,db}=await fixture()
  expect((await call('/auth/register','POST',{username:'admin',email:'admin@example.test',password})).status).toBeGreaterThanOrEqual(400)
  expect((await call('/auth/register','POST',{username:'short',email:'short@example.test',password:'short'})).status).toBeGreaterThanOrEqual(400)
  expect((await call('/auth/register','POST',{username:'expired',email:'expired@example.test',password})).status).toBe(202)
  const token=sent.at(-1)!.text.match(/#account\/verify\/([^\s]+)/)![1]
  db.exec('UPDATE account_tokens SET expires=0')
  expect((await call('/auth/verify','POST',{token,password})).status).toBe(400)
  await call('/auth/forgot','POST',{email:'expired@example.test'})
  const reset=sent.at(-1)!.text.match(/#account\/reset\/([^\s]+)/)![1];db.exec('UPDATE auth_verifications SET expiresAt=0')
  expect((await call('/auth/reset','POST',{token:reset,password})).status).toBe(400)
 })
 it('does not give guest content to a matching username and rejects guest mutations',async()=>{
  const {call,db,member}=await fixture(),guest='a'.repeat(64)
  db.prepare("INSERT INTO users(id,display_name) VALUES('old','listener')").run()
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest(guest),'old',Math.floor(Date.now()/1000)+600)
  db.prepare("INSERT INTO issues(id,module_id,author_login,reporter_id,title,body) VALUES('private','miniverb','author','old','Private report','Sensitive details')").run()
  for(const path of ['/modules/miniverb/comments','/modules/miniverb/rating','/modules/miniverb/like','/modules/miniverb/issues','/forum/threads']){
   const body=path.endsWith('rating')?{value:4}:path.endsWith('like')?{liked:true}:path.endsWith('issues')?{title:'Problem',body:'Details'}:path.endsWith('threads')?thread:{body:'Text'}
   expect((await call(path,'POST',body,guest)).status).toBe(401)
  }
  const user=await member('listener')
  expect(await(await call('/issues/mine','GET',undefined,user.session)).json()).toEqual([])
  expect(await(await call('/issues/mine','GET',undefined,guest)).json()).toHaveLength(1)
 })
 it('fails closed without secrets, throttles guesses, and rejects cross-origin and bypass auth routes',async()=>{
  const {call,env,member,db}=await fixture(),user=await member('throttled')
  expect((await call('/auth/login','POST',{email:user.email,password},'','','https://evil.example')).status).toBe(403)
  expect((await call('/auth/sign-up/email','POST',{name:'bypass',email:'bypass@example.test',password})).status).toBe(404)
  for(let i=0;i<9;i++)expect((await call('/auth/login','POST',{email:user.email,password:'wrong long password here'})).status).toBe(401)
  expect((await call('/auth/login','POST',{email:user.email,password})).status).toBe(429)
  expect(JSON.stringify(db.prepare('SELECT * FROM rate_limits').all())).not.toContain(user.email)
  env.AUTH_SECRET=undefined;expect((await call('/auth/register','POST',{username:'closed',email:'closed@example.test',password})).status).toBe(503)
  expect((await(await call('/auth/session')).json()).registrationAvailable).toBe(false)
 })
})
describe('forum ownership and sharing',()=>{
 it('supports threads, replies, following, bookmarks and reactions with private notifications',async()=>{
  const {call,member}=await fixture(),author=await member('authorone'),other=await member('othertwo')
  const created=await call('/forum/threads','POST',thread,author.session);expect(created.status).toBe(201);const {id}=await created.json()
  expect((await call('/forum/threads/'+id+'/replies','POST',{body:'Another idea.'},other.session)).status).toBe(201)
  const detail=await(await call('/forum/threads/'+id)).json();expect(detail.posts).toHaveLength(2);expect(JSON.stringify(detail)).not.toMatch(/email|token_hash|password|user_id/)
  expect((await call('/forum/posts/'+detail.posts[0].id,'PATCH',{body:'Hijacked'},other.session)).status).toBe(403)
  expect((await call('/forum/posts/'+detail.posts[0].id,'PATCH',{body:'Edited by author'},author.session)).status).toBe(200)
  for(let i=0;i<2;i++)expect((await call('/forum/posts/'+detail.posts[0].id+'/react','POST',{liked:true},other.session)).status).toBe(200)
  expect((await(await call('/forum/threads/'+id)).json()).posts[0].likes).toBe(1)
  expect(await(await call('/forum/notifications','GET',undefined,author.session)).json()).toHaveLength(1)
  expect(await(await call('/forum/notifications','GET',undefined,other.session)).json()).toHaveLength(0)
  expect((await call('/forum/notifications')).status).toBe(401)
  await call('/forum/threads/'+id+'/bookmark','POST',{enabled:true},other.session)
  expect((await(await call('/forum/threads?saved=1','GET',undefined,other.session)).json()).threads).toHaveLength(1)
  expect((await(await call('/forum/threads?saved=1','GET',undefined,author.session)).json()).threads).toHaveLength(0)
  expect((await(await call('/forum/threads?q=Edited')).json()).threads).toHaveLength(1)
  expect((await call('/forum/threads?page=-1')).status).toBe(400)
  expect((await call('/forum/threads?category=constructor')).status).toBe(400)
  expect((await call('/forum/threads','POST',{...thread,body:'x'.repeat(33000)},author.session)).status).toBe(413)
 })
 it('only shares immutable configuration fields, with exact versions and no firmware or arbitrary fields',async()=>{
  const {call,member}=await fixture(),author=await member('sharer')
  const configuration={name:'Ambient',moduleIds:['miniverb'],moduleVersions:{miniverb:MODULES.find(module=>module.id==='miniverb')!.version},keepStockFx2:true}
  for(const value of [{...configuration,firmware:'stock bytes'},{...configuration,extra:'untrusted'},{...configuration,moduleVersions:{}},{...configuration,moduleIds:['invented']}])expect((await call('/forum/threads','POST',{...thread,category:'configs',configuration:value},author.session)).status).toBe(400)
  const created=await call('/forum/threads','POST',{...thread,category:'configs',configuration},author.session);expect(created.status).toBe(201)
  const {id}=await created.json();expect((await(await call('/forum/threads/'+id)).json()).configuration).toEqual(configuration)
  expect((await call('/forum/threads/'+id,'PATCH',{configuration:{...configuration,name:'Changed'}},author.session)).status).toBe(404)
 })
 it('protects moderation, hides content everywhere and revokes a suspended author',async()=>{
  const {call,member}=await fixture(),author=await member('poster'),reporter=await member('reporter')
  const {id}=await(await call('/forum/threads','POST',thread,author.session)).json(),detail=await(await call('/forum/threads/'+id)).json(),postId=detail.posts[0].id
  await call('/forum/posts/'+postId+'/report','POST',{reason:'Spam'},reporter.session)
  expect((await call('/admin/forum/reports','GET',undefined,reporter.session)).status).toBe(403)
  expect((await call('/admin/forum/posts/'+postId,'PATCH',{action:'hidden',value:true,reason:'Spam'},author.session)).status).toBe(403)
  const {token:admin}=await(await call('/auth/admin','POST',{key:'e'.repeat(64)})).json()
  const reports=await(await call('/admin/forum/reports','GET',undefined,'',admin)).json();expect(reports).toHaveLength(1)
  expect((await call('/admin/forum/threads/'+id,'PATCH',{action:'locked',value:true,reason:'Resolved discussion'},'',admin)).status).toBe(200)
  expect((await call('/forum/threads/'+id+'/replies','POST',{body:'Bypass lock'},author.session)).status).toBe(409)
  expect((await call('/admin/forum/posts/'+postId,'PATCH',{action:'hidden',value:true,reason:'Spam'},'',admin)).status).toBe(200)
  expect((await(await call('/forum/threads/'+id)).json()).posts[0].body).toBe('')
  expect((await(await call('/forum/threads?q=Share')).json()).threads).toHaveLength(0)
  expect((await call('/admin/forum/threads/'+id,'PATCH',{action:'hidden',value:true,reason:'Spam'},'',admin)).status).toBe(200)
  expect((await call('/forum/threads/'+id)).status).toBe(404)
  expect((await(await call('/forum/threads')).json()).threads).toHaveLength(0)
  await call('/admin/forum/users/'+reports[0].user_id,'PATCH',{action:'suspended',value:true,reason:'Repeated spam'},'',admin)
  expect((await(await call('/auth/session','GET',undefined,author.session)).json()).user).toBeNull()
  expect((await call('/forum/threads','POST',thread,author.session)).status).toBe(401)
  expect((await call('/admin/forum/history','GET',undefined,'',admin)).status).toBe(200)
 })
})
