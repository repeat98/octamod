import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountPage } from './AccountPage'
import { CommunityContext } from './context'
import type { Session } from './api'
const session:Session={available:true,emailAvailable:true,registrationAvailable:true,admin:false,user:{id:'member',displayName:'Member',username:'member',verified:true}}
function render(route:string){return renderToStaticMarkup(createElement(CommunityContext.Provider,{value:{session,catalog:[],refresh:async()=>{}}},createElement(AccountPage,{route})))}
describe('email action links in a signed-in browser',()=>{
 it('shows the recovery form so a member can use an emailed link without signing out',()=>{
  const html=render('account/reset/synthetic-private-token')
  expect(html).toContain('Choose a new password')
  expect(html).toContain('New password')
  expect(html).toContain('autoComplete="new-password"')
  expect(html).not.toContain('synthetic-private-token')
  expect(html).not.toContain('Your issue reports')
  expect(html).not.toContain('Active sessions')
 })
 it('shows the verification form even when another member is already signed in',()=>{
  const html=render('account/verify/synthetic-private-token')
  expect(html).toContain('Confirm your email')
  expect(html).toContain('Password you chose when registering')
  expect(html).not.toContain('Your issue reports')
 })
 it('keeps the normal account workspace available away from action links',()=>{
  const html=render('account')
  expect(html).toContain('Your account')
  expect(html).toContain('Active sessions')
  expect(html).toContain('Account removal')
 })
})
