# demo-kit — booth video and presenter kit

Everything needed to put Sales Proration into the IFPA looping reel and to walk
someone through the live demo. Built the same way as `grower-harvesting/demo-kit`.

| File | What it is |
|---|---|
| `seed.mjs` | **Data source of truth.** Generates the Bluestem demo snapshot (`data/bluestem-snapshot.json`) and two recent batches (`data/outbox.jsonl`) with a seeded RNG and dates relative to `--as-of` (default today). Prints a reconciliation summary. |
| `scenes.mjs` | **Video source of truth:** scene order, seconds per scene, captions, voice-over lines, title-card labels. Edit this, then re-run the scripts below. |
| `record.mjs` | Drives the running app with Playwright and records the tour (1920×1080) plus the title card, converts to MP4, and joins them into the reel. |
| `write-script.mjs` | Regenerates `voiceover-script.md`, injects the script into `cheat-sheet.html`, and writes the single-file `sales-proration-cheat-sheet.html`. |
| `scratch-vo.mjs` | Lays a Windows text-to-speech read over the tour so pacing can be checked before a real voice is recorded. |
| `shot.mjs` | Screenshots every page at the recording viewport, for a quick visual check before recording. |
| `voiceover-script.md` | Generated. The narrator's copy with timecodes. |
| `interstitial.html` | The 12 s "Up next" title card. Same card as the other Bluestem apps; labels come in on the query string (`?next=`, `?tag=`, `?eyebrow=`, `?nodes=`). |
| `cheat-sheet.html` | Presenter cheat sheet source: click path, what to say, cast, Q&A, resets, plus the voice-over script (injected from `scenes.mjs`). |
| `sales-proration-cheat-sheet.html` | **Generated.** The same sheet as one self-contained file (fonts and logos inlined). This is the one to share with the team. |
| `assets/` | Poppins woff2 and the RSM marks so the HTML pages work offline. |
| `data/` | Generated demo data (committed so the kit works without running the generator). |
| `out/` | Rendered videos, frames and timing JSON (git-ignored). |

## Why a demo snapshot

This app has no static seed: it reads a live planning snapshot from D365 F&SC.
The DEV08 / USMF environment it is wired to returns Contoso data (speakers and
HDMI cables grouped under "Blueberries", customers like Contoso Retail, ship
dates back to 2016), which cannot be shown under the bluestem brand.

So the server has an opt-in override: when `D365_SNAPSHOT_FILE` names a JSON
file in the raw `GetOpenSalesOrders` shape, `server/d365Client.js` reads that
file instead of calling D365, and "Approve & Send" appends to the local outbox
instead of posting to SysMessageService. Unset, nothing changes; the hosted
Function App never sets it. `OUTBOX_FILE` likewise points the Batches table at
the generated outbox so demo batches never mix with your own `.outbox` history.

Every figure in the snapshot is synthetic, every customer is fictional (every
customer on a short item is shown as "Needs proration"), and dates are relative
to the as-of day. To refresh the dates, re-run `seed.mjs`.

## Render the video

```powershell
# 1. generate the data (re-run any day to re-anchor the ship dates)
node demo-kit/seed.mjs

# 2. serve the app in demo snapshot mode (no build step for this app)
$env:D365_SNAPSHOT_FILE = 'demo-kit/data/bluestem-snapshot.json'
$env:OUTBOX_FILE = 'demo-kit/data/outbox.jsonl'
$env:PORT = '5199'
node server/index.js                            # leave running

# 3. check and record (new terminal)
node demo-kit/shot.mjs                          # optional: out/check-*.png
node demo-kit/record.mjs                        # tour + title card + reel → demo-kit/out/
node demo-kit/record.mjs --only frames          # pull check frames from the MP4s
node demo-kit/write-script.mjs                  # voiceover-script.md + cheat sheets
node demo-kit/scratch-vo.mjs                    # optional: TTS pacing check
```

`record.mjs` uses Playwright's full Chromium (`channel: 'chromium'`) so the
recording matches a real browser. For MP4 it needs an ffmpeg with libx264: set
`$env:FFMPEG`, put `ffmpeg` on PATH, or `pip install imageio-ffmpeg`. Without
one you still get WebM. Playwright is a devDependency of this repo
(`npm install` once).

The recorder never mutates data: it navigates, filters, runs proration
proposals (a pure calculation, nothing is saved), edits an allocation input in
the browser, opens and cancels the substitute picker, and hovers "Approve &
Send". It never clicks Approve & Send, Refresh, or anything on the Setup page.

## Change the script

Edit `scenes.mjs`, then:

```powershell
node demo-kit/write-script.mjs    # refresh voiceover-script.md and see the wpm check
node demo-kit/record.mjs          # re-record so the cuts land on the new timecodes
```

Keep each scene's narration under `seconds × 2.5` words; the generator flags any
line that is over. If a page's layout changes, the scene list in `scenes.mjs`
and the `actions` map in `record.mjs` are the only two things to rewrite; the
overlay, timing runner, MP4 conversion, reel join and title card carry over.
