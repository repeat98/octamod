import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins/bearer'
import { username } from 'better-auth/plugins/username'
import { verifyPassword } from 'better-auth/crypto'
import { isAPIError } from 'better-auth/api'
import type { BetterAuthOptions } from 'better-auth'
import type { Env, Database, User } from './platform'
import { throttle } from './auth'
import { appOrigin, digest, HttpError, jsonBody, response, token as randomToken } from './security'
import { AccountMailError, emailReady, sendAccountEmail } from './email'
import { accountRequest } from './account-requests'

export function authReady(env: Env) { return !!env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 }
export function accountAuth(env: Env, db: Database) {
  if (!authReady(env)) throw new HttpError(503,'Accounts are not configured yet.')
  const syncPublicUser = async (user:{id:string;name:string;emailVerified:boolean}) => {
    await db.prepare('INSERT INTO users(id,display_name,username,email_verified) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email_verified=excluded.email_verified').bind(user.id,user.name,user.name,Number(user.emailVerified)).run()
  }
  return betterAuth({
    appName:'Octamod', baseURL:new URL('/api/auth',env.APP_URL!).href, secret:env.AUTH_SECRET,
    database:db as unknown as NonNullable<BetterAuthOptions['database']>, trustedOrigins:[appOrigin(env)],
    user:{modelName:'auth_users'}, account:{modelName:'auth_accounts',accountLinking:{enabled:false}},
    session:{modelName:'auth_sessions',expiresIn:7*86400,updateAge:86400,cookieCache:{enabled:false}},
    verification:{modelName:'auth_verifications',storeIdentifier:'hashed'},
    // Only our explicit facade below is exposed; it applies persistent D1/IP/address throttles.
    rateLimit:{enabled:false}, logger:{disabled:true},
    advanced:{cookiePrefix:'octamod-account',ipAddress:{ipAddressHeaders:['cf-connecting-ip']}},
    emailAndPassword:{enabled:true,minPasswordLength:15,maxPasswordLength:128,requireEmailVerification:true,autoSignIn:false,resetPasswordTokenExpiresIn:1800,revokeSessionsOnPasswordReset:true,
      sendResetPassword:async({user,token})=>{await sendAccountEmail(env,db,user.email,'reset',token)},
      onPasswordReset:async({user})=>{await db.batch([db.prepare('DELETE FROM account_tokens WHERE user_id=?').bind(user.id),db.prepare('DELETE FROM auth_verifications WHERE value=?').bind(user.id),db.prepare('UPDATE auth_users SET emailVerified=1 WHERE id=?').bind(user.id),db.prepare('UPDATE users SET email_verified=1 WHERE id=?').bind(user.id)])},
    },
    emailVerification:{sendOnSignUp:true,sendOnSignIn:false,expiresIn:86400,autoSignInAfterVerification:false,
      sendVerificationEmail:async({user,token})=>{
        // Library JWTs can repeat within one second. A fresh nonce makes every
        // resend distinct, and only the hashed complete action link is accepted.
        const actionToken=token+'~'+randomToken()
        await db.batch([db.prepare('DELETE FROM account_tokens WHERE user_id=? AND purpose=\'verify\'').bind(user.id),db.prepare('INSERT INTO account_tokens(token_hash,user_id,purpose,expires) VALUES(?,?,\'verify\',?)').bind(await digest(actionToken),user.id,Math.floor(Date.now()/1000)+86400)])
        await sendAccountEmail(env,db,user.email,'verify',actionToken)
      },
    },
    plugins:[bearer({requireSignature:true}),username({minUsernameLength:3,maxUsernameLength:24,usernameValidator:value=>/^[a-z0-9_]{3,24}$/.test(value)&&!/^(admin|administrator|moderator|octamod|support|system|guest)$/.test(value)})],
    databaseHooks:{
      user:{create:{after:syncPublicUser},update:{after:syncPublicUser}},
      session:{create:{before:async session=>{
        const user=await db.prepare('SELECT suspended FROM users WHERE id=?').bind(session.userId).first<{suspended:number}>()
        if(!user||user.suspended)return false
        return {data:{...session,ipAddress:null,userAgent:null}}
      }}},
    },
  })
}
export async function accountUser(request: Request, env: Env, db: Database): Promise<User|null> {
  if(!authReady(env))return null
  const session=await accountAuth(env,db).api.getSession({headers:request.headers})
  if(!session?.user.emailVerified)return null
  return db.prepare('SELECT id,display_name,username,email_verified,suspended FROM users WHERE id=? AND suspended=0').bind(session.user.id).first<User>()
}
function emailAddress(value:unknown){if(typeof value!=='string'||value.trim().length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()))throw new HttpError(400,'Enter a valid email address.');return value.trim().toLowerCase()}
const genericMessage='If the address is eligible, an email will arrive shortly. Check your spam folder. You can request another message or reset your password if you already have an account.'
export async function accountRoutes(request: Request, env: Env, db: Database, path: string): Promise<Response|null> {
  if(path==='/api/auth/account-removal')return accountRequest(request,db,await accountUser(request,env,db))
  const route=path.match(/^\/api\/auth\/(register|login|resend|forgot|verify|reset|sessions|logout)$/)
  if(!route)return null
  const action=route[1]
  if(action==='register'&&env.REGISTRATION_OPEN!=='true')throw new HttpError(503,'New registrations are temporarily closed. Existing accounts can still sign in and recover access.')
  if(action==='logout'&&!authReady(env))return null
  if(action==='logout'&&!request.headers.get('Authorization')?.includes('.')&&!request.headers.get('Cookie')?.includes('octamod-account'))return null
  const auth=accountAuth(env,db),headers=request.headers
  try{
    if(action==='sessions'){
      if(!await accountUser(request,env,db))throw new HttpError(401,'Sign in to manage sessions.')
      if(request.method==='GET'){
        const own=await auth.api.getSession({headers}),sessions=await auth.api.listSessions({headers})
        return response(sessions.map(item=>({id:item.id,current:item.id===own?.session.id,expires:Math.floor(new Date(item.expiresAt).getTime()/1000)})))
      }
      if(request.method==='DELETE'){await auth.api.revokeOtherSessions({headers});return response({ok:true})}
      return null
    }
    if(request.method!=='POST')return null
    if(action==='logout'){
      const result=await auth.api.signOut({headers,asResponse:true}),out=response({ok:true})
      out.headers.set('X-Octamod-Session','')
      if(env.SESSION_TRANSPORT!=='bearer')for(const value of result.headers.getSetCookie())out.headers.append('Set-Cookie',value)
      return out
    }
    await throttle(db,'auth-ip:'+(headers.get('CF-Connecting-IP')??'local'),30,900)
    const body=await jsonBody(request)
    if(action==='verify'||action==='reset'){
      if(typeof body.token!=='string'||body.token.length<20||body.token.length>2000)throw new HttpError(400,'This link is invalid or expired.')
      if(typeof body.password!=='string'||body.password.length<15||body.password.length>128)throw new HttpError(400,'Use a password between 15 and 128 characters.')
      if(action==='verify'){
        const tokenHash=await digest(body.token),now=Math.floor(Date.now()/1000)
        const record=await db.prepare('SELECT a.password,t.user_id FROM account_tokens t JOIN auth_accounts a ON a.userId=t.user_id JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires>? AND t.purpose=\'verify\' AND a.providerId=\'credential\' AND u.suspended=0').bind(tokenHash,now).first<{password:string;user_id:string}>()
        if(!record||!await verifyPassword({hash:record.password,password:body.password}))throw new HttpError(400,'The link or password was not accepted. Use your registration password, or request a reset.')
        const consumed=await db.prepare('DELETE FROM account_tokens WHERE token_hash=? AND expires>? RETURNING user_id').bind(tokenHash,now).first()
        if(!consumed)throw new HttpError(400,'This link has already been used.')
        await auth.api.verifyEmail({query:{token:body.token.split('~')[0]},headers})
      }else await auth.api.resetPassword({body:{token:body.token,newPassword:body.password},headers})
      return response({ok:true,message:action==='verify'?'Email verified. You can now sign in.':'Password updated. All previous sessions have ended. Sign in with your new password.'})
    }
    const email=emailAddress(body.email)
    await throttle(db,(action==='login'?'auth-login:':'auth-mail:')+email,action==='login'?10:3,900)
    if(action!=='login'&&!emailReady(env))throw new HttpError(503,'Account email is not connected yet. Please try again later.')
    if(action==='login'){
      if(typeof body.password!=='string'||body.password.length>128)throw new HttpError(400,'Enter your password.')
      const result=await auth.api.signInEmail({body:{email,password:body.password},headers,asResponse:true})
      if(!result.ok)throw new HttpError(result.status,result.status===403?'Verify your email first, or request another verification message.':'Email or password was not accepted.')
      const out=response({ok:true}),value=result.headers.get('set-auth-token')
      if(env.SESSION_TRANSPORT==='bearer'){if(!value)throw new HttpError(500,'Sign-in could not be completed.');out.headers.set('X-Octamod-Session',value)}
      else for(const value of result.headers.getSetCookie())out.headers.append('Set-Cookie',value)
      return out
    }
    if(action==='register'){
      if(typeof body.username!=='string'||!/^[a-zA-Z0-9_]{3,24}$/.test(body.username))throw new HttpError(400,'Use 3–24 letters, numbers or underscores for your username.')
      if(typeof body.password!=='string')throw new HttpError(400,'Enter a password.')
      await auth.api.signUpEmail({body:{name:body.username.toLowerCase(),username:body.username.toLowerCase(),email,password:body.password},headers})
    }else if(action==='forgot')await auth.api.requestPasswordReset({body:{email},headers})
    else await auth.api.sendVerificationEmail({body:{email},headers})
    return response({message:genericMessage},202)
  }catch(error){
    // Delivery outcomes must not disclose whether an address owns an account.
    if(error instanceof AccountMailError)return response({message:genericMessage},202)
    if(isAPIError(error))throw new HttpError(error.statusCode,error.body?.message??'This account request was not accepted.')
    throw error
  }
}
export async function cleanupAccounts(db:Database){
  const now=Math.floor(Date.now()/1000)
  await db.batch([db.prepare('DELETE FROM account_tokens WHERE expires<=?').bind(now),db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now),db.prepare('DELETE FROM rate_limits WHERE expires<=?').bind(now),db.prepare('DELETE FROM admin_sessions WHERE expires<=?').bind(now),db.prepare('DELETE FROM auth_sessions WHERE expiresAt<=?').bind(now*1000),db.prepare('DELETE FROM auth_verifications WHERE expiresAt<=?').bind(now*1000)])
}
