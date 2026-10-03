// Encrypted D1 backups. Restore is deliberately limited to a fresh local sandbox.
import { execFileSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
const [action,...args]=process.argv.slice(2),options=new Map()
for(let index=0;index<args.length;index++){
 const option=args[index]
 if(!['--config','--database','--persist-to','--archive','--key-file','--local','--remote'].includes(option)||options.has(option))throw new Error('Unknown or duplicate backup option.')
 if(option==='--local'||option==='--remote')options.set(option,true)
 else {const value=args[++index];if(!value||value.startsWith('--'))throw new Error('A backup option is missing its value.');options.set(option,value)}
}
if(!['backup','restore-local'].includes(action))throw new Error('Use backup or restore-local. See docs/COMMUNITY_OPERATIONS.md.')
const need=name=>{const value=options.get(name);if(typeof value!=='string')throw new Error('Missing '+name);return value}
const config=need('--config'),database=need('--database'),archive=resolve(need('--archive')),keyFile=resolve(need('--key-file'))
if(!/^[a-zA-Z0-9_-]+$/.test(database))throw new Error('Invalid database name.')
const privateRoot=resolve('.wrangler')+sep
if(!archive.startsWith(privateRoot)||!keyFile.startsWith(privateRoot)||archive===keyFile)throw new Error('Keep the archive and separate key file in ignored .wrangler storage.')
if(process.platform!=='win32'&&(statSync(keyFile).mode&0o077)!==0)throw new Error('The key file must be readable only by its owner (chmod 600).')
const keyText=readFileSync(keyFile,'utf8').trim()
if(!/^[a-f0-9]{64}$/.test(keyText))throw new Error('Use a 32-byte random key encoded as lowercase hex.')
const key=Buffer.from(keyText,'hex'),magic=Buffer.from('OCTAMOD-D1-1\n'),limit=256*1024*1024
const privateDirectory=resolve('.wrangler/private-backups')
mkdirSync(privateDirectory,{recursive:true,mode:0o700});if(process.platform!=='win32')chmodSync(privateDirectory,0o700)
const temporary=mkdtempSync(privateDirectory+sep+'working-'),sqlFile=temporary+sep+'database.sql'
const wrangler=['node_modules/wrangler/bin/wrangler.js','d1'],base=['--config',config]
function run(args){try{return execFileSync(process.execPath,[...wrangler,...args],{stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024})}catch{throw new Error('D1 operation failed. Provider output is withheld because it may contain private SQL. Check configuration and access without logging the dump.')}}
try{
 if(action==='backup'){
  if(options.has('--local')===options.has('--remote'))throw new Error('Choose exactly one of --local or --remote.')
  if(existsSync(archive))throw new Error('Choose a fresh archive path; existing backups are never overwritten.')
  if(options.has('--remote'))run(['export',database,...base,'--remote','--output',sqlFile])
  else {
   // Wrangler export has no --persist-to. Use the same local D1 exporter with
   // an explicit persistence root so the preview database is actually backed up.
   const persistence=resolve(need('--persist-to'))
   if(!persistence.startsWith(privateRoot)||!existsSync(persistence))throw new Error('Choose an existing local database under .wrangler.')
   const {unstable_readConfig}=await import('wrangler')
   const {Miniflare,convertV4MiniflareOptions}=await import('miniflare')
   const binding=unstable_readConfig({config}).d1_databases.find(item=>item.database_name===database||item.binding===database)
   if(!binding)throw new Error('The selected database is not configured.')
   const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {}',resourcePersistencePath:resolve(persistence,'v3'),d1Databases:{DATABASE:binding.preview_database_id??binding.database_id??binding.binding}}))
   try{
    const db=await runtime.getD1Database('DATABASE')
    const dump=await db.prepare('PRAGMA miniflare_d1_export(?,?,?);').bind(false,false).raw()
    writeFileSync(sqlFile,dump[0].join('\n'),{mode:0o600,flag:'wx'})
   }catch{throw new Error('Local D1 export failed. Database output is withheld to protect private data.')}
   finally{await runtime.dispose()}
  }
  if(statSync(sqlFile).size>limit)throw new Error('Use a streaming backup procedure for databases over 256 MiB.')
  const plain=readFileSync(sqlFile),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv)
  cipher.setAAD(magic)
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()])
  mkdirSync(dirname(archive),{recursive:true,mode:0o700})
  writeFileSync(archive,Buffer.concat([magic,iv,cipher.getAuthTag(),encrypted]),{mode:0o600,flag:'wx'})
  plain.fill(0)
  console.log(JSON.stringify({action:'encrypted-backup',target:options.has('--remote')?'remote':'local',bytes:statSync(archive).size,archive}))
 }else{
  if(options.has('--remote')||!options.has('--local'))throw new Error('Restore supports --local only; production restores require separate approval.')
  const destination=resolve(need('--persist-to'))
  if(!destination.startsWith(privateRoot)||existsSync(destination))throw new Error('Restore must use a fresh, absent directory under .wrangler.')
  if(statSync(archive).size>limit+magic.length+28)throw new Error('The archive is too large for this restore helper.')
  const sealed=readFileSync(archive)
  if(sealed.length<magic.length+28||!sealed.subarray(0,magic.length).equals(magic))throw new Error('Invalid backup format.')
  const offset=magic.length,decipher=createDecipheriv('aes-256-gcm',key,sealed.subarray(offset,offset+12))
  decipher.setAAD(magic);decipher.setAuthTag(sealed.subarray(offset+12,offset+28))
  let plain
  try{plain=Buffer.concat([decipher.update(sealed.subarray(offset+28)),decipher.final()])}catch{throw new Error('Backup authentication failed. The key is wrong or the archive has changed.')}
  writeFileSync(sqlFile,plain,{mode:0o600,flag:'wx'});plain.fill(0)
  run(['execute',database,...base,'--local','--persist-to',destination,'--file',sqlFile])
  console.log(JSON.stringify({action:'restored-to-isolated-local-database',destination}))
 }
}finally{key.fill(0);rmSync(temporary,{recursive:true,force:true})}
