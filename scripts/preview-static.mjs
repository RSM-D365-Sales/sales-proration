/**
 * Serve a static build locally the way Cloudflare Pages does: clean URLs
 * (/customers → customers.html, *.html → 308 to the clean URL) and the build's
 * Content-Security-Policy, so a CSP violation shows up here before it ships.
 *
 *   node scripts/preview-static.mjs dist-sunset [port]
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'

const dir = resolve(process.argv[2] || 'dist-sunset')
const port = Number(process.argv[3] || process.env.PORT || 5180)
if (!existsSync(dir)) { console.error(`No build at ${dir} — run the build first.`); process.exit(1) }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const headers = readFileSync(join(dir, '_headers'), 'utf8')
const csp = (headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1]

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = decodeURIComponent(url.pathname)
  if (p.endsWith('.html')) {
    res.writeHead(308, { location: p.replace(/(index)?\.html$/, '') + url.search }); res.end(); return
  }
  if (p.endsWith('/')) p += 'index'
  let file = join(dir, p)
  if (!file.startsWith(dir + sep) && file !== dir) { res.writeHead(403); res.end(); return }
  if (!extname(file) && existsSync(file + '.html')) file += '.html'
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...(csp ? { 'content-security-policy': csp } : {}) })
  res.end(readFileSync(file))
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}/`))
