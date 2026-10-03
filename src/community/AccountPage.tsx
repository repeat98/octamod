import { useEffect, useState } from 'react'
import { AccountInbox } from './AccountInbox'
import { AccountRemovalRequest } from './AccountRequests'
import { api, post } from './api'
import { useCommunity } from './context'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../support'
type DeviceSession = { id:string; current:boolean; expires:number }
export function AccountPage({route}:{route:string}) {
  const {session,refresh}=useCommunity(), [busy,setBusy]=useState(false), [error,setError]=useState(''), [message,setMessage]=useState(''), [devices,setDevices]=useState<DeviceSession[]>([])
  const [,action='login',linkToken='']=route.split('/'), mode=['login','register','resend','forgot','verify','reset'].includes(action)?action:'login'
  const linkAction=mode==='verify'||mode==='reset',member=!!session.user?.verified&&!linkAction
  const emailAvailable=session.emailAvailable??session.registrationAvailable
  const [lastLink,setLastLink]=useState(linkToken)
  // A fresh emailed link starts a fresh form; stripping a consumed token keeps
  // the successful confirmation visible without retaining the sensitive URL.
  if(linkAction&&linkToken&&linkToken!==lastLink){setLastLink(linkToken);setMessage('');setError('')}
  useEffect(()=>{let cancelled=false;if(member)void api<DeviceSession[]>('/auth/sessions').then(value=>{if(!cancelled)setDevices(value)}).catch(error=>{if(!cancelled)setError(error.message)});return()=>{cancelled=true}},[member])
  async function submit(form:HTMLFormElement) {
    setBusy(true);setError('');setMessage('')
    try {
      const fields=Object.fromEntries(new FormData(form))
      const result=await post<{message?:string}>('/auth/'+mode,{...fields,...(['verify','reset'].includes(mode)?{token:linkToken}:{})})
      form.reset();await refresh()
      if(mode==='login')window.location.assign('#forum')
      else setMessage(result.message??'Saved.')
      if(mode==='verify'||mode==='reset')history.replaceState(null,'','#account/'+mode)
    } catch(error){setError(error instanceof Error?error.message:'Unable to complete this request.')} finally{setBusy(false)}
  }
  async function endSessions(all:boolean){setBusy(true);setError('');try{if(all){await api('/auth/sessions',{method:'DELETE'});setDevices(await api<DeviceSession[]>('/auth/sessions'));setMessage('Other sessions signed out.')}else{await post('/auth/logout',{});await refresh();window.location.assign('#account/login')}}catch(error){setError(error instanceof Error?error.message:'Unable to sign out.')}finally{setBusy(false)}}
  const titles:Record<string,string>={login:'Welcome back',register:'Join the community',resend:'Verify your email',forgot:'Forgot your password?',verify:'Confirm your email',reset:'Choose a new password'}
  return <div className="community-page account-page"><a className="back-link" href="#forum">← Community forum</a><div className="page-heading"><div><p className="page-kicker">OCTAMOD / ACCOUNT</p><h1>{member?'Your account':titles[mode]}</h1><p>{member?'Your notifications, private reports and signed-in sessions.':'A place to exchange ideas, find help and share configurations.'}</p></div></div>
    {member?<section className="configuration-section"><h2>@{session.user!.username}</h2><p>Your email address is private. Your username appears alongside your posts.</p><div className="forum-actions"><a className="button button-quiet" href={'#forum/profile/'+session.user!.username}>Your public profile</a><a className="button button-quiet" href="#forum?saved=1">Your bookmarks</a><button className="button button-quiet" disabled={busy} onClick={()=>void endSessions(false)}>Sign out</button></div><h3>Active sessions</h3>{devices.map((device,index)=><p key={device.id}>{device.current?'This session':'Other session '+(index+1)} · expires {new Date(device.expires*1000).toLocaleDateString()}</p>)}<button className="button button-quiet" disabled={busy||devices.length<2} onClick={()=>void endSessions(true)}>Sign out other sessions</button></section>:<section className="configuration-section">
      {!session.available?<p className="service-note" role="status">Community services are unavailable. You can still use your local configurations.</p>:<>
      {session.user&&!session.user.username&&<p className="service-note">This browser holds a previous guest identity. Its private reports appear below until you sign in. Guest names do not reserve account usernames.</p>}
      {!(mode==='verify'||mode==='reset')&&<nav className="forum-actions" aria-label="Account actions"><a aria-current={mode==='login'?'page':undefined} href="#account/login">Sign in</a><a aria-current={mode==='register'?'page':undefined} href="#account/register">Create account</a></nav>}
      {mode==='register'&&!session.registrationAvailable&&<p className="service-note" role="status">New registrations are temporarily closed. Existing accounts can still sign in.</p>}
      {!emailAvailable&&['forgot','resend'].includes(mode)&&<p className="service-note" role="status">Account email is not available yet. Please try again later.</p>}
      {message&&(mode==='verify'||mode==='reset')?<a className="button button-primary" href="#account/login">Continue to sign in</a>:<form className="community-form" onSubmit={event=>{event.preventDefault();void submit(event.currentTarget)}}>
        {mode==='register'&&<label>Public username<input name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" autoComplete="username" spellCheck={false}/><small>3–24 letters, numbers or underscores.</small></label>}
        {mode!=='verify'&&mode!=='reset'&&<label>Email address<input type="email" name="email" required maxLength={254} autoComplete="email"/></label>}
        {['register','login','verify','reset'].includes(mode)&&<label>{mode==='verify'?'Password you chose when registering':mode==='reset'?'New password':'Password'}<input type="password" name="password" required minLength={15} maxLength={128} autoComplete={mode==='register'||mode==='reset'?'new-password':'current-password'}/>{(mode==='register'||mode==='reset')&&<small>At least 15 characters. Try a few unrelated words.</small>}</label>}
        {mode==='register'&&<p className="service-note">Verify your email before posting, rating or reporting issues. Your username and posts are public; your email is private. <a href="#privacy">Privacy details</a>.</p>}
        {mode==='verify'&&<p className="service-note">Only continue if you created this account. If you did not, you can ignore this message.</p>}
        <button className="button button-primary" disabled={busy||(mode==='register'&&!session.registrationAvailable)||(['forgot','resend'].includes(mode)&&!emailAvailable)}>{busy?'Please wait…':mode==='login'?'Sign in':mode==='register'?'Create account':mode==='verify'?'Verify email':mode==='reset'?'Save new password':'Send email'}</button>
      </form>}
      <div className="forum-actions"><a href="#account/forgot">Reset password</a><a href="#account/resend">Resend verification</a></div></>}
    </section>}
    {member&&<AccountRemovalRequest key={'removal-'+session.user!.id}/>}
    {session.user&&!linkAction&&<AccountInbox key={session.user.id}/>}
    {message&&<p className="success-note" role="status">{message}</p>}{error&&<p className="file-error" role="alert">{error}</p>}
    <p className="service-note">Need help with your account? <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>. Never send passwords, recovery links or firmware.</p>
  </div>
}
