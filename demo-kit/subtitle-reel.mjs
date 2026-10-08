/**
 * Burns the voice-over narration into the booth reel as on-screen subtitles,
 * for a muted show-floor loop where people read rather than listen.
 *
 *   node demo-kit/subtitle-reel.mjs
 *
 * Text comes from scenes.mjs (same source as voiceover-script.md); timing comes
 * from out/tour-timings.json, offset by the title card's length. The narration
 * sits bottom-right so it never covers the scene lower-third (bottom-left).
 *
 * Needs: out/sales-proration-reel.mp4 (record.mjs) and an ffmpeg with libass +
 * libx264 (same lookup as record.mjs).
 *
 * Output: out/sales-proration-reel-subtitled.mp4 and out/reel-subtitles.ass.
 * The clean reel is left untouched, so re-running never double-burns.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCENES, VIDEO, fmtTime } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const SLUG = 'sales-proration'
const REEL = join(OUT, `${SLUG}-reel.mp4`)
const ASS = join(OUT, 'reel-subtitles.ass')
const DEST = join(OUT, `${SLUG}-reel-subtitled.mp4`)
const FONTS = 'C:/Windows/Fonts'

const LEAD_IN = 0.4   // let the cut land before the text appears
const TAIL = 0.15     // clear just before the next scene

const timingsPath = join(OUT, 'tour-timings.json')
if (!existsSync(REEL)) { console.error('Run `node demo-kit/record.mjs` first (needs the reel MP4).'); process.exit(1) }
const timings = existsSync(timingsPath) ? JSON.parse(readFileSync(timingsPath, 'utf8')).scenes : []

const ff = findFfmpeg()
if (!ff) { console.error('No ffmpeg with libass + libx264 found (set $FFMPEG or pip install imageio-ffmpeg).'); process.exit(1) }

// 1. ASS subtitle file --------------------------------------------------------
// Bottom-right (alignment 3), white on the same midnight as the lower-third.
// MarginL keeps the box clear of the lower-third, which can run ~750 px wide.
const assTime = (s) => {
  const cs = Math.round(s * 100)
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}
const assText = (t) => t.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, '\\N')

let t = 0
const events = SCENES.map((s) => {
  const m = timings.find((x) => x.id === s.id)
  const start = m ? m.start : t
  const end = m ? m.end : t + s.seconds
  t += s.seconds
  const a = VIDEO.interstitialSeconds + start + LEAD_IN
  const b = VIDEO.interstitialSeconds + end - TAIL
  return { s, a, b }
})

const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Narration,Segoe UI Semibold,38,&H00FFFFFF,&H00FFFFFF,&H0F3D1500,&H0F3D1500,0,0,0,0,100,100,0,0,3,16,0,3,820,64,56,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.map(({ s, a, b }) => `Dialogue: 0,${assTime(a)},${assTime(b)},Narration,,0,0,0,,{\\fad(200,200)}${assText(s.vo)}`).join('\n')}
`
writeFileSync(ASS, ass)

// 2. burn in -----------------------------------------------------------------
// The subtitles filter wants forward slashes and an escaped drive colon.
const filt = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
const argv = ['-y', '-hide_banner', '-loglevel', 'error', '-i', REEL,
  '-vf', `subtitles='${filt(ASS)}':fontsdir='${filt(FONTS)}'`,
  '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', DEST]
const r = spawnSync(ff, argv, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
if (r.status !== 0) { console.error('ffmpeg burn-in failed', r.status); process.exit(1) }

console.log(`Subtitled reel — ${events.length} lines`)
for (const { s, a, b } of events) console.log(`  ${fmtTime(a)} – ${fmtTime(b)}  ${s.caption}`)
console.log(`\n→ ${DEST}`)

// ---------------------------------------------------------------------------
function findFfmpeg() {
  const c = []
  if (process.env.FFMPEG) c.push(process.env.FFMPEG)
  c.push('ffmpeg')
  const py = spawnSync('python', ['-c', 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
  if (py.status === 0 && py.stdout.trim()) c.push(py.stdout.trim())
  for (const x of c) {
    const enc = spawnSync(x, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    const fil = spawnSync(x, ['-hide_banner', '-filters'], { encoding: 'utf8' })
    if (enc.status === 0 && /libx264/.test(enc.stdout) && /\bsubtitles\b/.test(fil.stdout)) return x
  }
  return null
}
