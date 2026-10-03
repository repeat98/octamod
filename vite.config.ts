import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
 const api = loadEnv(mode, process.cwd(), 'VITE_').VITE_COMMUNITY_API_URL
 const origin = api ? new URL(api).origin : ''
 if (api && !['https:', 'http:'].includes(new URL(api).protocol)) throw new Error('Invalid community API protocol.')
 const csp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${origin}; media-src 'self' blob: ${origin}; font-src 'self'; worker-src 'self'; connect-src 'self' ${origin}; base-uri 'none'; form-action 'none'; object-src 'none'`
 return {
  plugins: [react(), { name:'static-security-policy', transformIndexHtml() {
   // GitHub Pages does not apply Cloudflare's _headers file. Vite HMR needs a separate dev policy.
   return command === 'build' ? [
    { tag:'meta', attrs:{ 'http-equiv':'Content-Security-Policy', content:csp }, injectTo:'head-prepend' },
    { tag:'meta', attrs:{ name:'referrer', content:'no-referrer' }, injectTo:'head-prepend' },
   ] : []
  } }],
  base: './',
  server: { fs: { deny: ['.env', '.env.*', '.dev.vars', '.dev.vars.*', '**/*.crt', '**/*.pem', '**/*.key', '**/*.bin', '**/*.syx', '**/.git/**', '**/downloads/**', '**/out/**'] }, port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8788' } },
  build: { sourcemap: false },
 }
})
