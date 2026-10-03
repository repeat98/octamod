import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { testServer } from './test-server'
import { digest } from '../../server/security'
const databases:DatabaseSync[]=[]
const password='a private synthetic mail test passphrase'
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();for(const db of databases.splice(0))db.close()})
async function fixture(){const server=await testServer();databases.push(server.db);return server}
describe('account-mail failures and quotas',()=>{
 it('reports delivery failure without exposing provider details and supports a fresh resend',async()=>{
  const {call,db}=await fixture(),messages:{text:string}[]=[]
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date())
  const logs=[vi.spyOn(console,'error').mockImplementation(()=>{}),vi.spyOn(console,'warn').mockImplementation(()=>{})]
  const sender=vi.fn(async(_url:string,options:RequestInit)=>{messages.push(JSON.parse(String(options.body)));return Response.json({error:'private provider response recipient=retry@example.test token=secret-provider-token'}, {status:503})})
  vi.stubGlobal('fetch',sender)
  const failure=await call('/auth/register','POST',{username:'retry',email:'retry@example.test',password})
  expect(failure.status).toBe(202)
  expect(await failure.text()).not.toMatch(/retry@example|secret-provider|test-resend|#account|private provider/)
  expect(logs.flatMap(log=>log.mock.calls)).toEqual([])
  expect(db.prepare('SELECT failed FROM account_mail_daily').get()).toEqual({failed:1})
  const resendFailure=await call('/auth/resend','POST',{email:'retry@example.test'})
  const absent=await call('/auth/resend','POST',{email:'absent@example.test'})
  expect(resendFailure.status).toBe(202);expect(await resendFailure.text()).toBe(await absent.text())
  const oldToken=messages[0].text.match(/#account\/verify\/([^\s]+)/)![1]
  sender.mockImplementation(async(_url:string,options:RequestInit)=>{messages.push(JSON.parse(String(options.body)));return Response.json({id:'synthetic-success'})})
  expect((await call('/auth/resend','POST',{email:'retry@example.test'})).status).toBe(202)
  const newToken=messages.at(-1)!.text.match(/#account\/verify\/([^\s]+)/)![1]
  expect(newToken).not.toBe(oldToken)
  expect((await call('/auth/verify','POST',{token:oldToken,password})).status).toBe(400)
  expect((await call('/auth/verify','POST',{token:newToken,password})).status).toBe(200)
 })
 it('keeps mail counters private and closes new registration without disabling recovery',async()=>{
  const {call,env}=await fixture(),sender=vi.fn(async()=>Response.json({id:'synthetic-email'}))
  vi.stubGlobal('fetch',sender)
  expect((await call('/auth/register','POST',{username:'existing',email:'existing@example.test',password})).status).toBe(202)
  env.REGISTRATION_OPEN='false'
  expect(await(await call('/auth/session')).json()).toMatchObject({emailAvailable:true,registrationAvailable:false})
  expect((await call('/auth/register','POST',{username:'closed',email:'closed@example.test',password})).status).toBe(503)
  expect((await call('/auth/forgot','POST',{email:'existing@example.test'})).status).toBe(202)
  expect(sender).toHaveBeenCalledTimes(2)
  expect((await call('/admin/account-mail')).status).toBe(403)
  const {token:admin}=await(await call('/auth/admin','POST',{key:'e'.repeat(64)})).json()
  const counters=await(await call('/admin/account-mail','GET',undefined,'',admin)).json()
  expect(counters).toHaveLength(2);expect(JSON.stringify(counters)).not.toMatch(/example.test|token|password|id/)
  expect(counters.map((row:{accepted:number})=>row.accepted)).toEqual([1,1])
 })
 it('contains network failures and missing mail configuration',async()=>{
  const {call,env,db}=await fixture()
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('private network payload with address and key')}))
  const failure=await call('/auth/register','POST',{username:'network',email:'network@example.test',password})
  expect(failure.status).toBe(202);expect(await failure.text()).not.toContain('private network')
  expect(db.prepare('SELECT failed FROM account_mail_daily').get()).toEqual({failed:1})
  env.RESEND_API_KEY=undefined
  expect((await call('/auth/resend','POST',{email:'network@example.test'})).status).toBe(503)
  expect((await(await call('/auth/session')).json()).registrationAvailable).toBe(false)
 })
 it.each([['account-mail:daily',86400,80],['account-mail:monthly',30*86400,2400]] as const)('rejects exhausted %s quota before contacting the provider',async(key,seconds,limit)=>{
  const {call,db}=await fixture(),sender=vi.fn(async()=>Response.json({id:'should-not-send'}))
  vi.stubGlobal('fetch',sender)
  const now=Math.floor(Date.now()/1000)
  db.prepare('INSERT INTO rate_limits(key,count,expires) VALUES(?,?,?)').run(await digest(key+':'+Math.floor(now/seconds)),limit,now+seconds)
  expect((await call('/auth/register','POST',{username:'quota',email:'quota@example.test',password})).status).toBe(202)
  expect(sender).not.toHaveBeenCalled()
  expect(db.prepare('SELECT limited FROM account_mail_daily').get()).toEqual({limited:1})
 })
})
