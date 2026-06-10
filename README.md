# Sales Proration Accelerator — Shell

A vibed companion app to the D365 F&SCM proration build. Lets a planner:

1. Browse demand by **commodity → item → site/warehouse**.
2. Run **Straight-Line**, **Weighted (priority)**, or **History-Aware** proration.
3. Push the approved batch back to D365 via message queue.

> See [docs/BRD-Proration-App.md](docs/BRD-Proration-App.md) for the full design.

## Run it

```bash
npm install
npm start
# open http://localhost:5173
```

No build step.

### Connect to live D365

The read endpoints call a single D365 custom-service operation — the Sales Prorate
Accelerator feed — which returns the whole planning snapshot in one call:

```
POST {baseUrl}/api/services/SPASalesOrderServiceGroup/SPASalesOrderService/GetOpenSalesOrders
body: { "_inputContract": "<legal entity, e.g. USMF>" }
->   { Demand[], items[], commodities[], Supply[], customers[] }
```

There is **no mock fallback** — errors surface as `502`/`503`.

1. `cp .env.example .env` (gitignored) and set your client secret, e.g. `D365_CLIENT_SECRET=…`.
2. `npm start`, open `/setup.html`, and add an environment profile: base URL, tenant ID,
   client ID, **company** (legal entity), and which `.env` variable holds the secret.
3. Hit **Test active connection** — it pulls the snapshot and reports the row counts.

Auth is the Entra ID client-credentials flow ([server/d365Client.js](server/d365Client.js));
non-secret settings live in switchable profiles managed on the Setup page
([server/config.js](server/config.js), stored in `server/data/environments.json`). The snapshot
is cached ~30s and normalized into the shapes the SPA/proration code already used; the old
seed file [server/data/mockD365.js](server/data/mockD365.js) is no longer referenced.

> **Note:** items are grouped by their `CommodityId` (buyer group). Items with no
> `CommodityId` assigned in D365 won't appear under any commodity.

## Try it

Open the landing page → pick a **commodity** → **Run Proration** on an item that's short
(demand > supply).

- **Straight-Line** gives every line the same fill %.
- **Weighted** favors higher-priority customers (`priority` 1 beats 3).
- **History-Aware** additionally bumps customers shorted recently — note that the SPA feed
  currently returns no fill-rate history, so it behaves like Weighted until that data exists.

Click **Approve & Send to D365** — the batch is written to
`.outbox/d365-proration-inbound.log.jsonl` (the Service Bus stand-in; outbound publish is
still a local stub).

## Deploy: GitHub Pages + Azure Functions + Entra ID

The portal splits into a **static front-end** (GitHub Pages, custom domain) and a
**serverless API** (Azure Functions) that holds the D365 secret. Sign-in is
Microsoft Entra ID (single tenant — anyone in your tenant). Locally everything
still runs as one Express server with no sign-in; auth and the API split
activate purely through configuration.

```
GitHub Pages (public/, MSAL.js sign-in)
        │  Authorization: Bearer <Entra access token>
        ▼
Azure Functions (api/ + server/, validates JWT, holds D365 secret)
        ▼
D365 F&SCM (snapshot read + SysMessageService batch publish)
```

### 1. Entra app registration (once)

1. **Entra admin center → App registrations → New registration**
   - Name: e.g. `Sales Proration Portal`; single tenant.
   - Platform: **Single-page application**, redirect URIs:
     `http://localhost:5173` and `https://<your-custom-domain>/` (add each page
     path you use, or just the root — MSAL redirects back to the calling page).
2. **Expose an API** → *Add a scope*: accept the default
   `api://<client-id>`, scope name `access_as_user`, admins+users consent.
3. *(Recommended)* **Manifest** → set `"requestedAccessTokenVersion": 2`.
4. Note the **Application (client) ID** and **Directory (tenant) ID**.

### 2. Azure Function App (once)

1. Create a Function App — Linux, **Node 20**, Consumption plan is fine.
2. **Environment variables** (Settings → Environment variables):

   | Setting | Value |
   |---|---|
   | `D365_CONFIG_MODE` | `env` (read D365 config from settings, not files) |
   | `D365_BASE_URL` | `https://<env>.operations.dynamics.com` |
   | `D365_TENANT_ID` / `D365_CLIENT_ID` / `D365_CLIENT_SECRET` | D365 service principal |
   | `D365_COMPANY` | legal entity, e.g. `USMF` |
   | `AUTH_TENANT_ID` / `AUTH_CLIENT_ID` | the app registration from step 1 |

3. **API → CORS**: add your Pages origin, e.g. `https://prorate.yourdomain.com`.
4. Download the **publish profile**; in the GitHub repo add it as secret
   `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` and add variable
   `AZURE_FUNCTIONAPP_NAME`. Pushes to `main` touching `api/`/`server/` then
   deploy via [.github/workflows/deploy-api.yml](.github/workflows/deploy-api.yml).

### 3. GitHub Pages + custom domain (once)

1. Edit [public/config.js](public/config.js): set `apiBase` to the Function App
   URL and fill `auth.tenantId` / `auth.clientId` (public identifiers — safe to
   commit; the secret only ever lives in Function App settings).
2. Repo **Settings → Pages** → Source: **GitHub Actions**. Pushes touching
   `public/` deploy via [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).
3. **Settings → Pages → Custom domain**: enter your domain; at your DNS
   provider add a `CNAME` record pointing it at `<github-username>.github.io`;
   enable **Enforce HTTPS** once the cert is issued.

### Local development (unchanged)

Leave `public/config.js` blank and `AUTH_*` unset in `.env` — `npm start`
serves everything from Express on `:5173` with no sign-in. To rehearse the
hosted setup locally, set `AUTH_TENANT_ID`/`AUTH_CLIENT_ID` in `.env` and fill
`config.js`; the Express API then demands the same bearer tokens the Functions
app does (`CORS_ORIGIN` adds cross-origin support if you serve the front-end
separately).

### Hosted-mode limitations (by design)

- **Setup page**: environment-profile editing and branding save are
  local-development features; the hosted API reads D365 config from app
  settings and serves branding read-only from the committed
  `server/data/branding.json`.
- **Batches page**: the local `.outbox` demo log doesn't exist serverless; the
  landing page tolerates the missing endpoint.

## Structure

```
docs/                       BRD (lite) for this app
api/                        Azure Functions front door (same routes as Express)
.github/workflows/          Pages + Functions deploy pipelines
server/                     Express BFF + shared service modules
  data/mockD365.js          Mock data mirroring the D365 service contracts
  data/branding.json        White-label config (created at runtime; commit per customer)
  proration.js              Straight-Line / Weighted / History-Aware
  portalService.js          Route logic shared by Express and Azure Functions
  entraAuth.js              Entra ID bearer-token validation (jose)
  messageQueue.js           Service Bus stub (file outbox)
  branding.js               Branding store + validation
  index.js                  HTTP API (Express host)
public/                     Static SPA (no build step)
  config.js                 Per-deployment config: API base + Entra ids
  js/auth.js                MSAL.js sign-in + bearer-token fetch
  styles/base.css           Design system (tokens + components, color-driven)
  styles/skin-editorial.css Default "produce-brand" front-end
  styles/skin-enterprise.css Alternate "refined enterprise" front-end
  js/shell.js               Shared sidebar shell + applies branding/skin
  js/icons.js               Commodity → SVG icon resolver (override + keywords)
  js/app.js                 Landing dashboard + commodity detail
  js/setup.js               Setup: environments + Branding tab
  img/commodities/*.svg     Commodity icon set + _fallback.svg
d365/X++/                   X++ stubs for the in-ERP service classes
.outbox/                    Created at runtime - the MQ stand-in
```

## Branding & theming (white-label per customer)

The whole look is driven by **one config** — `server/data/branding.json` — editable two
ways:

- **By hand:** edit the file and commit it per customer (logo path, brand name, colors, skin).
- **In-app:** open `/setup.html` → **Branding** tab to set the brand name, tagline, accent
  + sidebar colors, upload a logo, and pick the front-end skin. Changes preview live in the
  sidebar; **Save** persists them.

Colors flow through CSS custom properties: a single `accent` drives buttons, links, focus
rings, chips and tints via `color-mix()`, so one value re-themes the app. **Skins** are
swappable front-ends selected by `theme` (`editorial` | `enterprise`) — add another by
copying a `styles/skin-*.css`, changing its tokens, and registering the name in
`server/branding.js` (`THEMES`) and the Setup picker.

## Commodity imagery

Each commodity renders a bundled flat **SVG icon** (no external image service, works offline).
`public/js/icons.js` resolves an icon by:

1. an explicit **override map** (`COMMODITY_ICON_OVERRIDES`, keyed by commodity/buyer-group
   `id`) — use this for live D365 codes like `10` / "Buyer group 1" that have no descriptive
   name;
2. otherwise **keyword matching** the id/name/description (strawberry, citrus, lettuce, …);
3. otherwise a generic **produce-crate fallback**.

To add coverage, drop a new `public/img/commodities/<name>.svg` and add a rule (or override).

## Swap in real D365

1. ~~Replace mock reads with HTTP calls to the X++ services.~~ **Done** — see
   [server/d365Client.js](server/d365Client.js) and "Connect to live D365" above.
2. Replace [server/messageQueue.js](server/messageQueue.js) with `@azure/service-bus` and publish to topic `d365-proration-inbound`. *(Outbound batches still write to the local `.outbox` stub; the live send path uses SysMessageService directly.)*
3. ~~Add Entra ID auth to the Express middleware.~~ **Done** — see
   [server/entraAuth.js](server/entraAuth.js) and "Deploy" above.
