import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { testServer } from './test-server'
const databases:DatabaseSync[]=[],messages:{text:string}[]=[]
const password='private account request test passphrase'
beforeEach(()=>{messages.length=0;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'mock-email'})))} )
afterEach(()=>{vi.unstubAllGlobals();for(const db of databases.splice(0))db.close()})
async function fixture(){
 const server=await testServer();databases.push(server.db)
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{messages.push(JSON.parse(String(options.body)));return Response.json({id:'mock-email'})}))
 async function member(username:string){
  const email=username+'@example.test'
  expect((await server.call('/auth/register','POST',{username,email,password})).status).toBe(202)
  const token=messages.at(-1)!.text.match(/#account\/verify\/([^\s]+)/)![1]
  expect((await server.call('/auth/verify','POST',{token,password})).status).toBe(200)
  return (await server.call('/auth/login','POST',{email,password})).headers.get('X-Octamod-Session')!
 }
 const token=await member('removal')
 const admin=(await(await server.call('/auth/admin','POST',{key:'e'.repeat(64)})).json()).token as string
 return {...server,member,token,admin}
}
describe('private, reversible account-removal requests',()=>{
 it('requires the owner session, current password and explicit request confirmation',async()=>{
  const {call,token,db}=await fixture()
  expect((await call('/auth/account-removal')).status).toBe(401)
  expect((await call('/auth/account-removal','POST',{confirm:'REQUEST',password})).status).toBe(401)
  expect((await call('/auth/account-removal','POST',{confirm:'REQUEST',password},token,'','https://evil.example')).status).toBe(403)
  expect((await call('/auth/account-removal','POST',{password},token)).status).toBe(400)
  expect((await call('/auth/account-removal','POST',{confirm:'REQUEST',password:'wrong current password here'},token)).status).toBe(403)
  expect(db.prepare('SELECT COUNT(*) AS count FROM account_removal_requests').get()).toEqual({count:0})
  const response=await call('/auth/account-removal','POST',{confirm:'REQUEST',password},token)
  expect(response.status).toBe(202);expect(await response.json()).toMatchObject({status:'requested'})
  expect(db.prepare('SELECT COUNT(*) AS count FROM auth_users').get()).toEqual({count:1})
  expect(db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({count:1})
  expect((await(await call('/auth/session','GET',undefined,token)).json()).user.username).toBe('removal')
 })
 it('keeps requests private, deduplicates submission and allows only the owner to withdraw',async()=>{
  const {call,member,token,db}=await fixture(),other=await member('another')
  const first=await(await call('/auth/account-removal','POST',{confirm:'REQUEST',password},token)).json()
  const repeated=await(await call('/auth/account-removal','POST',{confirm:'REQUEST',password},token)).json()
  expect(repeated.id).toBe(first.id)
  expect(await(await call('/auth/account-removal','GET',undefined,other)).json()).toBeNull()
  await call('/auth/account-removal','DELETE',undefined,other)
  expect((await(await call('/auth/account-removal','GET',undefined,token)).json()).status).toBe('requested')
  await call('/auth/account-removal','DELETE',undefined,token)
  expect((await(await call('/auth/account-removal','GET',undefined,token)).json()).status).toBe('cancelled')
  expect(db.prepare('SELECT COUNT(*) AS count FROM auth_users').get()).toEqual({count:2})
 })
 it('requires separate administrator authorization and cannot claim completion while data remains',async()=>{
  const {call,token,admin,db}=await fixture()
  const request=await(await call('/auth/account-removal','POST',{confirm:'REQUEST',password},token)).json()
  expect((await call('/admin/account-requests')).status).toBe(403)
  expect((await call('/admin/account-requests','GET',undefined,token)).status).toBe(403)
  expect((await call('/admin/account-requests/'+request.id,'PATCH',{status:'completed',note:'Attempt'},token)).status).toBe(403)
  expect((await call('/admin/account-requests/'+request.id,'PATCH',{status:'completed',note:'Attempt'},'',admin)).status).toBe(409)
  expect((await call('/admin/account-requests/'+request.id,'PATCH',{status:'reviewing',note:'Scope review pending'},'',admin)).status).toBe(200)
  const rows=await(await call('/admin/account-requests','GET',undefined,'',admin)).json()
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({username:'removal',status:'reviewing'})
  expect(JSON.stringify(rows)).not.toContain('@example.test');expect(JSON.stringify(rows)).not.toContain(password)
  expect(db.prepare('SELECT COUNT(*) AS count FROM auth_users').get()).toEqual({count:1})
 })
 it('throttles repeated password guesses before they can generate requests',async()=>{
  const {call,token,db}=await fixture()
  for(let index=0;index<5;index++)expect((await call('/auth/account-removal','POST',{confirm:'REQUEST',password:'wrong sufficiently long password'},token)).status).toBe(403)
  expect((await call('/auth/account-removal','POST',{confirm:'REQUEST',password},token)).status).toBe(429)
  expect(db.prepare('SELECT COUNT(*) AS count FROM account_removal_requests').get()).toEqual({count:0})
 })
})
