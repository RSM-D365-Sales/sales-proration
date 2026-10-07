/**
 * Records the Sales Proration booth video with Playwright.
 *
 *   node demo-kit/record.mjs                       # tour + interstitial + reel
 *   node demo-kit/record.mjs --only tour           # just the app tour
 *   node demo-kit/record.mjs --only interstitial   # just the title card
 *   node demo-kit/record.mjs --only reel           # join title card + tour (needs both MP4s)
 *   node demo-kit/record.mjs --only frames         # pull check frames from the finished MP4s
 *   node demo-kit/record.mjs --base http://localhost:5199 --no-captions
 *
 * The app must be running at --base (default http://localhost:5199) in demo
 * snapshot mode — see demo-kit/README.md. There is no build step for this app;
 * `node server/index.js` serves public/ directly.
 *
 * Output (demo-kit/out/):
 *   sales-proration-tour.webm / .mp4   the tour (length = sum of scenes.mjs seconds), 1920×1080
 *   interstitial.webm / .mp4           the 12 s title card between clips
 *   sales-proration-reel.mp4           title card + tour, joined with ffmpeg concat (stream copy)
 *   tour-timings.json                  measured scene boundaries (for VO alignment)
 *   frames/*.png                       check frames (--only frames)
 *
 * MP4 (H.264) needs an ffmpeg with libx264. The script looks for, in order:
 * $FFMPEG, `ffmpeg` on PATH, the one bundled with Python's imageio-ffmpeg.
 * Playwright's own ffmpeg is VP8/WebM-only, so without one of those you get WebM.
 *
 * Nothing here mutates data: the tour navigates, filters, runs proration
 * proposals (POST /api/prorate is a pure calculation — it returns a proposal and
 * saves nothing), edits an allocation input in the browser, opens and cancels
 * the substitute picker, and hovers "Approve & Send". It never clicks Approve &
 * Send, Refresh, or anything on the Setup page.
 */
import { chromium } from 'playwright'
import { mkdirSync, renameSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { SCENES, VIDEO, TOTAL_SECONDS } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
const BASE = (args.base ?? 'http://localhost:5199').replace(/\/$/, '')
const OUT = resolve(args.out ?? join(here, 'out'))
const CAPTIONS = !args['no-captions']
const ONLY = args.only ?? 'all'
const { width: W, height: H } = VIDEO.frame
const SLUG = 'sales-proration'
const TOUR_MP4 = join(OUT, `${SLUG}-tour.mp4`)
const CARD_MP4 = join(OUT, 'interstitial.mp4')
const REEL_MP4 = join(OUT, `${SLUG}-reel.mp4`)

mkdirSync(OUT, { recursive: true })

const rsmWhite = 'data:image/png;base64,' + readFileSync(join(here, 'assets', 'rsm-logo-white.png')).toString('base64')

// ---------------------------------------------------------------------------
// Overlay injected into the app: a visible cursor, the lower-third caption and
// the closing card. Everything lives under window.__demo so scenes can call it.
// The app's chrome is a 48 px top ribbon, so the caption sits bottom-left.
// ---------------------------------------------------------------------------
const OVERLAY = String.raw`
(() => {
  if (window.__demo) return;
  const css = document.createElement('style');
  css.textContent = ${JSON.stringify(`
    #__demo-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:${2147483600};pointer-events:none;
      transform:translate(-9999px,-9999px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));will-change:transform}
    .__demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:${2147483500};
      pointer-events:none;border:3px solid #009CDE;opacity:.9;animation:__demo-rip .55s ease-out forwards}
    @keyframes __demo-rip{from{transform:scale(.25);opacity:.9}to{transform:scale(1.15);opacity:0}}
    #__demo-caption{position:fixed;left:48px;bottom:40px;z-index:${2147483400};display:flex;align-items:stretch;
      opacity:0;transform:translateY(14px);transition:opacity .35s ease,transform .35s ease;pointer-events:none;
      font-family:'Segoe UI',system-ui,sans-serif;max-width:960px}
    #__demo-caption.on{opacity:1;transform:translateY(0)}
    #__demo-caption .bar{width:6px;background:#009CDE;border-radius:3px 0 0 3px;flex:none}
    #__demo-caption .box{background:rgba(0,21,61,.94);color:#fff;padding:12px 22px 13px 18px;border-radius:0 8px 8px 0;
      box-shadow:0 12px 32px rgba(0,21,61,.35)}
    #__demo-caption .t{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:22px;line-height:1.2;letter-spacing:-.005em}
    #__demo-caption .s{font-size:14.5px;color:#C9D1DB;margin-top:3px;line-height:1.35}
    #__demo-end{position:fixed;inset:0;z-index:${2147483450};background:#00153D;color:#fff;opacity:0;transition:opacity .5s ease;
      font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center}
    #__demo-end.on{opacity:1}
    #__demo-end .inner{display:flex;flex-direction:column;align-items:center;gap:18px;transform:translateY(-20px);max-width:1500px;text-align:center;padding:0 60px}
    #__demo-end .wm{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:58px;letter-spacing:-.01em;line-height:1;display:flex;align-items:center;gap:16px}
    #__demo-end .wm .stem{color:#3F9C35}
    #__demo-end .title{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:92px;letter-spacing:-.015em;line-height:1.05;margin-top:12px}
    #__demo-end .tag{font-family:Poppins,'Segoe UI',sans-serif;font-weight:500;font-size:34px;color:#009CDE;margin-top:4px;line-height:1.25;text-wrap:balance}
    #__demo-end .campus{font-size:17px;color:#9FB0CC;letter-spacing:.08em;text-transform:uppercase;margin-top:26px}
    #__demo-end .rsm{position:absolute;right:72px;bottom:56px;display:flex;align-items:center;gap:12px;color:#C9D1DB;font-size:15px}
    #__demo-end .rsm img{height:30px;width:auto;display:block}
    #__demo-end .inner > *{opacity:0;transform:translateY(10px);transition:opacity .5s ease,transform .5s ease}
    #__demo-end.on .inner > *{opacity:1;transform:none}
    #__demo-end.on .inner > :nth-child(2){transition-delay:.15s}
    #__demo-end.on .inner > :nth-child(3){transition-delay:.3s}
    #__demo-end.on .inner > :nth-child(4){transition-delay:.45s}
    #__demo-end.on .rsm{transition-delay:.6s}
  `)};
  const mark = (size) => '<svg viewBox="40 30 200 220" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    '<path d="M62 232 Q75 150 150 130" stroke="#009CDE" stroke-width="26" stroke-linecap="round" fill="none"/>' +
    '<g transform="translate(155 108) rotate(-45)"><path d="M-72 0 C-40 -50 40 -50 72 0 C40 50 -40 50 -72 0 Z" fill="#3F9C35"/>' +
    '<path d="M-45 0 L45 0" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/></g></svg>';
  const mount = () => {
    document.head.appendChild(css);
    const cur = document.createElement('div');
    cur.id = '__demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 28 28" width="28" height="28"><path d="M4 2.5 L4 22.5 L9.3 17.6 L13 26 L16.6 24.4 L12.9 16.2 L20.5 16.2 Z" fill="#fff" stroke="#00153D" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    const cap = document.createElement('div');
    cap.id = '__demo-caption';
    cap.innerHTML = '<div class="bar"></div><div class="box"><div class="t"></div><div class="s"></div></div>';
    document.body.appendChild(cap);
    window.addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__demo-ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  window.__demo = {
    caption(title, sub) {
      const el = document.getElementById('__demo-caption'); if (!el) return;
      const swap = () => { el.querySelector('.t').textContent = title; el.querySelector('.s').textContent = sub || ''; el.classList.add('on'); };
      if (el.classList.contains('on')) { el.classList.remove('on'); setTimeout(swap, 260); } else swap();
    },
    hideCaption() { const el = document.getElementById('__demo-caption'); if (el) el.classList.remove('on'); },
    hideCursor() { const el = document.getElementById('__demo-cursor'); if (el) el.style.display = 'none'; },
    endCard(opts) {
      const el = document.createElement('div'); el.id = '__demo-end';
      el.innerHTML = '<div class="inner">' +
        '<div class="wm">' + mark(66) + '<span>blue<span class="stem">stem</span></span></div>' +
        '<div class="title">' + opts.title + '</div>' +
        '<div class="tag">' + opts.tagline + '</div>' +
        '<div class="campus">' + opts.campus + '</div>' +
        '</div><div class="rsm"><span>Powered by</span><img alt="RSM" src="' + opts.rsm + '"></div>';
      document.body.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    },
  };
})();`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function moveTo(page, locator, steps = 18) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('moveTo: element not visible: ' + locator)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
}

async function click(page, locator, { settle = 250 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.scrollIntoViewIfNeeded()
  await moveTo(page, locator)
  await sleep(140)
  await page.mouse.down()
  await sleep(70)
  await page.mouse.up()
  await sleep(settle)
}

async function hover(page, locator, steps = 30) {
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.scrollIntoViewIfNeeded()
  await moveTo(page, locator, steps)
}

/** Smooth-ish wheel scroll in small steps so the recording shows motion. */
async function wheel(page, dy, steps = 14) {
  const step = dy / steps
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, step)
    await sleep(28)
  }
}

async function scrollTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await sleep(450)
}

// The shell renders the nav into <aside class="sidebar"> (the bluestem skin
// re-flows it into the top ribbon); links are plain <a class="nav__item">.
const nav = (page, name) => page.locator('aside').getByRole('link', { name, exact: true })

/** Navigate via the ribbon and wait for the page's data to paint. */
async function goTo(page, linkName, ready) {
  await click(page, nav(page, linkName), { settle: 100 })
  await ready.waitFor({ timeout: 20000 })
  await sleep(300)
}

/** Commodity icons are loading="lazy"; wait until every card image has painted. */
async function cardIcons(page) {
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.card img')]
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0)
  }, null, { timeout: 15000 }).catch(() => {})
}

async function caption(page, scene, step) {
  if (!CAPTIONS) return
  const c = step ?? scene
  await page.evaluate(([t, s]) => window.__demo?.caption(t, s), [c.caption, c.sub])
}

// ---------------------------------------------------------------------------
// Scene choreography. Each must finish inside its scenes.mjs budget; the runner
// pads to the budget so the cut lands on the scripted timecode.
// ---------------------------------------------------------------------------
const actions = {
  async overview(page) {
    await page.mouse.move(W * 0.5, H * 0.3, { steps: 20 })
    await sleep(1800)
    // rest on the Short commodity so its card lifts
    await hover(page, page.locator('.card[data-id="BLU"]'), 26)
    await sleep(1700)
    await hover(page, page.locator('.card[data-id="STR"]'), 20)
    await sleep(1200)
  },

  async customers(page) {
    await goTo(page, 'Customers', page.locator('#cust-table tbody tr').first())
    await page.mouse.move(W * 0.5, H * 0.55, { steps: 14 })
    await sleep(1500)
    await click(page, page.locator('label.check', { hasText: 'needing proration' }), { settle: 300 })
    await sleep(1200)
    await hover(page, page.locator('#cust-table tbody tr').first(), 18)
    await sleep(600)
    await hover(page, page.locator('#cust-table tbody tr').nth(3), 18)
  },

  async blueberries(page) {
    await goTo(page, 'Commodities', page.locator('.card[data-id="BLU"]'))
    await cardIcons(page)
    await click(page, page.locator('.card[data-id="BLU"]'), { settle: 100 })
    await page.locator('.item-card').first().waitFor({ timeout: 20000 })
    await page.getByRole('heading', { level: 1, name: 'Blueberries' }).waitFor({ timeout: 20000 })
    await sleep(1400)
    await page.mouse.move(W * 0.5, H * 0.62, { steps: 16 })
    await wheel(page, 260, 10)
    await sleep(1500)
    await scrollTop(page)
  },

  async 'prorate-weighted'(page) {
    await click(page, page.locator('#pp-run-all'), { settle: 200 })
    await page.locator('.alloc-input').first().waitFor({ timeout: 20000 })
    await sleep(900)
    // walk the cursor down the new Allocated column
    const first = page.locator('.item-card').first().locator('.alloc-input').first()
    const last = page.locator('.item-card').first().locator('.alloc-input').last()
    await hover(page, first, 16)
    await sleep(700)
    await hover(page, last, 28)
    await sleep(900)
    await hover(page, page.locator('.item-card').first().locator('[data-rem]'), 18)
    await sleep(1200)
  },

  async 'prorate-straight'(page) {
    const select = page.locator('#pp-strategy')
    await hover(page, select, 16)
    await sleep(200)
    await select.selectOption('StraightLine')
    await sleep(700)
    await click(page, page.locator('#pp-run-all'), { settle: 200 })
    await page.locator('.alloc-input').first().waitFor({ timeout: 20000 })
    await sleep(500)
    await hover(page, page.locator('.item-card').first().locator('.fill-cell').first(), 14)
    await sleep(500)
    await hover(page, page.locator('.item-card').first().locator('.fill-cell').last(), 24)
  },

  async adjust(page) {
    // nudge the last (spot) line of the pint item down; chip goes green
    const card = page.locator('.item-card').first()
    const input = card.locator('.alloc-input').last()
    await click(page, input, { settle: 150 })
    await input.fill('')
    await page.keyboard.type('60', { delay: 90 })
    await input.dispatchEvent('input')
    await sleep(500)
    await hover(page, card.locator('[data-rem]'), 18)
    await sleep(1300)
    // substitute picker for the first (Great Lakes Grocers) line
    await click(page, card.locator('button[data-sub-item]').first(), { settle: 300 })
    await page.locator('.overlay__card').waitFor({ timeout: 10000 })
    await page.mouse.move(W * 0.5, H * 0.5, { steps: 10 })
    await sleep(2200)
    await click(page, page.locator('[data-sub-cancel]'), { settle: 250 })
  },

  async send(page) {
    await scrollTop(page)
    await hover(page, page.locator('#pp-approve'), 22)
    await sleep(2300)
    await goTo(page, 'Batches', page.locator('#batch-table tbody tr').first())
    await cardIcons(page)
    // the #batches anchor is processed before the data paints, so scroll to it now
    await page.evaluate(() => document.getElementById('batches')?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
    await sleep(900)
    await hover(page, page.locator('#batch-table tbody tr').first(), 16)
    await sleep(500)
    await hover(page, page.locator('#batch-table tbody tr').last(), 14)
  },

  async 'end-card'(page) {
    await page.evaluate(() => { window.__demo?.hideCaption(); window.__demo?.hideCursor() })
    await sleep(250)
    await page.evaluate(
      (o) => window.__demo?.endCard(o),
      { title: VIDEO.title, tagline: VIDEO.tagline, campus: VIDEO.campus, rsm: rsmWhite },
    )
  },
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------
async function recordTour(browser) {
  console.log(`\nRecording tour from ${BASE} (${TOTAL_SECONDS}s, captions ${CAPTIONS ? 'on' : 'off'})`)
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/Detroit',
  })
  await context.addInitScript(OVERLAY)
  const videoStart = Date.now()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.getByRole('heading', { level: 1, name: 'Planning overview' }).waitFor({ timeout: 30000 })
  await page.locator('#kpis .kpi').first().waitFor({ timeout: 30000 })
  await page.locator('.card[data-id]').first().waitFor({ timeout: 30000 })
  await cardIcons(page)
  await page.evaluate(() => document.fonts.ready)
  await sleep(600)
  await page.mouse.move(W * 0.5, H * 0.5)

  const t0 = Date.now()
  const timings = []
  for (const scene of SCENES) {
    const start = Date.now()
    process.stdout.write(`  ${scene.caption.padEnd(30)} ${String(scene.seconds).padStart(4)}s … `)
    await caption(page, scene)
    try {
      await actions[scene.id](page, scene)
    } catch (e) {
      console.log(`\n  ! ${scene.id}: ${e.message.split('\n')[0]}`)
    }
    const used = (Date.now() - start) / 1000
    const pad = scene.seconds * 1000 - (Date.now() - start)
    if (pad < 0) console.log(`ran long by ${(-pad / 1000).toFixed(1)}s`)
    else { await sleep(pad); console.log(`ok (${used.toFixed(1)}s of action)`) }
    timings.push({ id: scene.id, caption: scene.caption, start: +((start - t0) / 1000).toFixed(2), end: +((Date.now() - t0) / 1000).toFixed(2) })
  }

  const video = page.video()
  const wallEnd = Date.now()
  await context.close()
  const raw = await video.path()
  const webm = join(OUT, `${SLUG}-tour.webm`)
  if (existsSync(webm)) unlinkSync(webm)
  renameSync(raw, webm)

  const leadIn = (t0 - videoStart) / 1000
  const duration = timings.at(-1).end
  const span = (wallEnd - t0) / 1000
  writeFileSync(join(OUT, 'tour-timings.json'), JSON.stringify({ base: BASE, leadInSeconds: +leadIn.toFixed(2), durationSeconds: duration, wallSpanSeconds: +span.toFixed(2), scenes: timings }, null, 2))
  if (errors.length) console.log('  page errors:', errors)
  console.log(`  → ${webm}`)
  toMp4(webm, TOUR_MP4, leadIn, duration, span)
}

async function recordInterstitial(browser) {
  const secs = VIDEO.interstitialSeconds
  console.log(`\nRecording interstitial (${secs}s)`)
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  })
  const videoStart = Date.now()
  const page = await context.newPage()
  const q = new URLSearchParams({
    dur: String(secs), manual: '1',
    next: VIDEO.title, tag: VIDEO.tagline,
    eyebrow: `${VIDEO.company} · ${VIDEO.campus}`,
    nodes: JSON.stringify(VIDEO.interstitialNodes),
  })
  const url = pathToFileURL(join(here, 'interstitial.html')).href + '?' + q.toString()
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  const t0 = Date.now()
  await page.evaluate(() => window.__startTimeline())
  await sleep(secs * 1000 + 300)
  const video = page.video()
  const wallEnd = Date.now()
  await context.close()
  const webm = join(OUT, 'interstitial.webm')
  if (existsSync(webm)) unlinkSync(webm)
  renameSync(await video.path(), webm)
  console.log(`  → ${webm}`)
  toMp4(webm, CARD_MP4, (t0 - videoStart) / 1000, secs, (wallEnd - t0) / 1000)
}

// ---------------------------------------------------------------------------
// Reel: title card + tour as one MP4. Both inputs come out of toMp4 with the
// same codec settings, so the concat demuxer can stream-copy (no re-encode).
// ---------------------------------------------------------------------------
function buildReel() {
  console.log('\nBuilding reel')
  for (const f of [CARD_MP4, TOUR_MP4]) {
    if (!existsSync(f)) { console.log(`  missing ${f} — record it first`); return }
  }
  const ff = findFfmpeg()
  if (!ff) { console.log('  (no ffmpeg found — cannot join)'); return }
  const list = join(OUT, 'reel-list.txt')
  // concat demuxer wants forward slashes and single quotes
  writeFileSync(list, [CARD_MP4, TOUR_MP4].map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n')
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', REEL_MP4],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) { console.log('  ffmpeg concat failed with status', r.status); return }
  console.log(`  → ${REEL_MP4}  (${probeSeconds(ff, CARD_MP4).toFixed(1)}s + ${probeSeconds(ff, TOUR_MP4).toFixed(1)}s = ${probeSeconds(ff, REEL_MP4).toFixed(1)}s)`)
}

/** Pull PNG frames: either side of the reel's join, plus the midpoint of every tour scene. */
function pullFrames() {
  const ff = findFfmpeg()
  if (!ff) { console.log('no ffmpeg found'); return }
  const dir = join(OUT, 'frames')
  mkdirSync(dir, { recursive: true })
  const grab = (src, t, name) => {
    const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', src, '-frames:v', '1', join(dir, name)], { encoding: 'utf8' })
    console.log(r.status === 0 ? `  → frames/${name} (${t.toFixed(2)}s)` : `  ! ${name}: ffmpeg status ${r.status}`)
  }
  console.log('\nPulling check frames')
  if (existsSync(REEL_MP4)) {
    const join_ = VIDEO.interstitialSeconds
    grab(REEL_MP4, join_ - 0.5, 'reel-before-join.png')
    grab(REEL_MP4, join_ + 0.5, 'reel-after-join.png')
    grab(REEL_MP4, 6, 'reel-title-card.png')
  }
  if (existsSync(TOUR_MP4)) {
    let t = 0
    SCENES.forEach((s, i) => {
      grab(TOUR_MP4, t + s.seconds * 0.6, `tour-${String(i + 1).padStart(2, '0')}-${s.id}.png`)
      t += s.seconds
    })
    grab(TOUR_MP4, Math.max(0, TOTAL_SECONDS - 0.3), 'tour-last.png')
  }
}

// ---------------------------------------------------------------------------
// MP4 conversion
// ---------------------------------------------------------------------------
function findFfmpeg() {
  const candidates = []
  if (process.env.FFMPEG) candidates.push(process.env.FFMPEG)
  candidates.push('ffmpeg')
  try {
    const py = spawnSync('python', ['-c', 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
    if (py.status === 0 && py.stdout.trim()) candidates.push(py.stdout.trim())
  } catch { /* no python */ }
  for (const c of candidates) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    if (r.status === 0 && /libx264/.test(r.stdout)) return c
  }
  return null
}

function probeSeconds(ff, file) {
  // ffmpeg -i prints "Duration: 00:01:02.50" to stderr; good enough without ffprobe
  const r = spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr || '')
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN
}

/**
 * Trim the WebM to [leadIn, leadIn + duration] and encode H.264.
 *
 * Playwright's WebM only starts at the page's first paint, so wall-clock lead-in
 * over-trims by however long the blank page took to render (2–3 s here) and
 * every cut lands early. The end of the recording is reliable, so when `span`
 * (wall-clock seconds from the scene clock's t0 to just before context.close)
 * is given, the lead-in is re-derived from the end: webmDuration − span.
 */
function toMp4(webm, mp4, leadIn, duration, span) {
  const ff = findFfmpeg()
  if (!ff) {
    console.log('  (no H.264 ffmpeg found — keeping WebM. Install imageio-ffmpeg via pip, or set $FFMPEG.)')
    return
  }
  if (span) {
    const webmSeconds = probeSeconds(ff, webm)
    if (Number.isFinite(webmSeconds)) {
      const fromEnd = Math.max(0, webmSeconds - span)
      console.log(`  lead-in: wall-clock ${leadIn.toFixed(2)}s, webm ${webmSeconds.toFixed(2)}s long for a ${span.toFixed(2)}s span → trimming ${fromEnd.toFixed(2)}s`)
      leadIn = fromEnd
    }
  }
  const argv = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', leadIn.toFixed(3), '-i', webm, '-t', duration.toFixed(3),
    '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-vf', `scale=${W}:${H}:flags=lanczos`, '-movflags', '+faststart', '-an', mp4,
  ]
  const r = spawnSync(ff, argv, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status === 0) console.log(`  → ${mp4}  (trimmed ${leadIn.toFixed(2)}s lead-in, ${duration}s)`)
  else console.log('  ffmpeg failed with status', r.status)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2)
    const v = argv[i + 1]
    if (v && !v.startsWith('--')) { out[k] = v; i++ } else out[k] = true
  }
  return out
}

// ---------------------------------------------------------------------------
if (ONLY === 'frames') {
  pullFrames()
} else if (ONLY === 'reel') {
  buildReel()
} else {
  const browser = await chromium.launch({ channel: 'chromium' })
  try {
    if (ONLY === 'all' || ONLY === 'tour') await recordTour(browser)
    if (ONLY === 'all' || ONLY === 'interstitial') await recordInterstitial(browser)
  } finally {
    await browser.close()
  }
  if (ONLY === 'all') buildReel()
}
console.log('\nDone.')
