/**
 * Quick page screenshots for checking the app before recording.
 *   node demo-kit/shot.mjs [--base http://localhost:5199]
 * Writes demo-kit/out/check-*.png (1920×1080, same viewport as the recording).
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:5199').replace(/\/$/, '')
const OUT = join(here, 'out')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const shots = [
  ['overview', '/', () => page.locator('#kpis .kpi').first().waitFor()],
  ['customers', '/customers.html', () => page.locator('#cust-table tbody tr').first().waitFor()],
  ['blueberries', '/commodity.html?id=BLU', () => page.locator('.item-card').first().waitFor()],
  ['blueberries-prorated', '/commodity.html?id=BLU&prorate=all', () => page.locator('.alloc-input').first().waitFor()],
  ['batches', '/index.html#batches', () => page.locator('#batch-table tbody tr').first().waitFor()],
]
for (const [name, path, ready] of shots) {
  await page.goto(BASE + path, { waitUntil: 'load' })
  await ready()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  const file = join(OUT, `check-${name}.png`)
  await page.screenshot({ path: file })
  console.log('→', file)
}
await browser.close()
