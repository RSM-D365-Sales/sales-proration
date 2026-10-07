/**
 * Single source of truth for the Sales Proration booth video.
 *
 * Every other file in demo-kit/ derives from this one:
 *   record.mjs        — drives the app and records the tour, scene by scene,
 *                       holding each scene for exactly `seconds`
 *   write-script.mjs  — regenerates voiceover-script.md (timecodes + VO text)
 *                       and injects the script into the cheat sheet
 *   scratch-vo.mjs    — builds a Windows text-to-speech scratch track so the
 *                       narration can be checked against the picture
 *
 * Edit the copy or the timings here, then re-run the scripts. Don't hand-edit
 * voiceover-script.md.
 *
 * Pacing: a relaxed read is ~150 words a minute (2.5 words a second). Each
 * scene's VO should sit just under `seconds * 2.5` words so the narrator is
 * never racing the cut.
 */

export const VIDEO = {
  title: 'Sales Proration',
  company: 'Bluestem Fresh Produce',
  // Hook line from Blustem-company-details/PUN_BANK.md ("Sales Pro Rate")
  tagline: 'Short on supply? Split it fair and square — squash the phone calls.',
  campus: 'Grand Rapids HQ · Sites GRP · HOL · HRT',
  // What the title card between loop videos says this clip is
  interstitialSeconds: 12,
  // Pipeline nodes drawn on the title card (keeps the card's layout identical
  // across apps; only the labels change)
  interstitialNodes: [
    { n: 'Open demand',        d: 'Every open sales line, by commodity' },
    { n: 'Available supply',   d: 'On-hand and inbound, by site' },
    { n: 'Prorate',            d: 'Straight-line · weighted by priority' },
    { n: 'Review & approve',   d: 'Nudge a line, substitute, send' },
  ],
  frame: { width: 1920, height: 1080 },
}

export const SCENES = [
  {
    id: 'overview',
    seconds: 9,
    caption: 'Planning overview',
    sub: 'Demand vs. available supply, every commodity',
    vo: 'A wet week shorted the Michigan blueberry harvest. Bluestem sees it here first: every commodity, demand against supply.',
    onScreen: 'KPI row (Commodities, Total demand, Available supply, Overall fill with "2 need attention"), then the commodity cards: Blueberries red Short, Strawberries amber At risk, five green.',
  },
  {
    id: 'customers',
    seconds: 9,
    caption: 'Customers',
    sub: 'Priority 1–5 and who is sitting on a short item',
    vo: 'Customers carry a priority from one to five, straight from D365. Filter to the ones whose orders need proration.',
    onScreen: 'Customers table sorted by priority; the "Only customers with orders needing proration" checkbox narrows it to the red "Needs proration" rows.',
  },
  {
    id: 'blueberries',
    seconds: 9,
    caption: 'Blueberries',
    sub: 'Three items · open lines by customer, site and ship date',
    vo: 'Open the short commodity. Three blueberry items, every open line by customer, ship-from site and requested ship date.',
    onScreen: 'Commodity KPIs (Total demand, Available supply, Gap, Fill rate), the strategy bar, then the pint item\'s demand grid: 7 lines, 2,400 requested against 1,440 available.',
  },
  {
    id: 'prorate-weighted',
    seconds: 10,
    caption: 'Prorate all items · Weighted',
    sub: 'Higher priority, richer fill. Nobody gets more than they asked for.',
    vo: 'Prorate all items. Weighted by priority, the strategic accounts land seventy-three percent of their pints; the spot buyer gets a quarter.',
    onScreen: 'Three new columns per line: Allocated (editable), Fill % and Weight; the chip beside the item reads "fully allocated".',
  },
  {
    id: 'prorate-straight',
    seconds: 7.5,
    caption: 'Straight-Line',
    sub: 'Same fill percentage for every line',
    vo: 'Switch to Straight-Line and re-run: everyone takes the same sixty percent cut. The planner picks the policy.',
    onScreen: 'Strategy select changed to Straight-Line, Prorate all again; the Fill % column reads 60.0% down every line.',
  },
  {
    id: 'adjust',
    seconds: 9,
    caption: 'Nudge and substitute',
    sub: 'Edit a line, see what frees up, offer a substitute from the same buyer group',
    vo: 'Nudge a line and the freed cases turn green. Still short? Offer a substitute, ranked by D365\'s whitelist.',
    onScreen: 'The QuickCart allocation is typed down; the chip turns green "+N to allocate". The Sub… picker opens for the Great Lakes line with "rule · rank 1" badges, then Cancel.',
  },
  {
    id: 'send',
    seconds: 7,
    caption: 'Approve & Send to D365',
    sub: 'One batch message to the proration queue, then Batches',
    vo: 'Approve, and the whole batch goes to D365 as one message. Every earlier batch is here.',
    onScreen: 'Cursor rests on "Approve & Send … to D365" without clicking; then the Batches nav scrolls the overview to "Recent batches sent to D365" with two rows.',
  },
  {
    id: 'end-card',
    seconds: 6,
    caption: 'Sales Proration',
    sub: 'Short on supply? Split it fair and square — squash the phone calls.',
    vo: 'Sales Proration, powered by RSM. Fair and square, no phone calls.',
    onScreen: 'Midnight end card: bluestem mark, Sales Proration, the hook line, Powered by RSM bottom-right.',
  },
]

export const TOTAL_SECONDS = SCENES.reduce((t, s) => t + s.seconds, 0)

/** Alternate openers from PUN_BANK.md — swap into scene 1 if the room wants a hook. */
export const ALT_OPENERS = [
  'Spreadsheets are where margins go to hide. Let\'s go find them.',
  'Here\'s a problem every produce company knows by heart: the truck is short, and six customers are on the phone.',
]

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
