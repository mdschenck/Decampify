# Decampify — BUILD SPEC (authoritative)

This is the **single source of truth** every builder works against. Do not invent class names,
colors, endpoints, or data shapes not defined here. If something is missing, follow the closest
pattern already defined and keep it consistent.

Project root: this folder. Lightest stack: static HTML + vanilla CSS + vanilla JS
frontend, Vercel serverless functions (Node) for the store. **No frameworks, no build step,
no external CDN/webfont requests** (keep it self-contained and fast).

---

## 1. Design identity — neutral light theme

Mirror Bandcamp's *structure* (album grid, per-release track list, simple player), rendered in a
clean, neutral light theme with a standard system sans-serif — a broadly acceptable starting
point that template users re-skin by editing the `:root` tokens only.

### CSS custom properties (define in `:root` in css/style.css, use everywhere)
```css
:root{
  --bg:        #f4f4f5;   /* page background — light gray */
  --bg-elev:   #ffffff;   /* cards / panels — white */
  --bg-elev-2: #e9e9ec;   /* raised controls, hover */
  --text:      #1a1a1a;   /* primary text */
  --text-dim:  #5c5c66;   /* secondary text */
  --accent:    #26262b;   /* charcoal — interactive / links / focus / primary buttons */
  --accent-2:  #26262b;   /* charcoal — now-playing cue fill */
  --success:   #2e7d32;   /* purchase actions only */
  --success-hover: #1b5e20;
  --line:      #d7d7dc;   /* borders / dividers */
  --radius:    4px;       /* small radius */
  --maxw:      1080px;    /* content max width, centered */
  --gap:       clamp(12px,2vw,24px);
  --font-display: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-body:    system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
```
- Conventional typography: normal case, medium weights — no forced uppercase or heavy letter-spacing.
- Accent usage: `--accent` for interactive/hover/active; `--accent-2` for the now-playing cue
  (dark fill + light text). Focus states must be visible (2px `--accent` outline — dark on light).
- Buttons: `.btn` = light surface + `--line` border; `.btn-primary` (Enter) = charcoal bg + light
  text; `.btn-buy` (purchase) = `--success` green + white text.
- Motion: subtle only; respect `@media (prefers-reduced-motion: reduce)`.
- Fully responsive; mobile-first; content column maxes at `--maxw`, centered, side padding `--gap`.
- Single light look by default; a dark theme is a `:root` token edit (documented in SETUP.md).

### Shared page shell (identical on index.html, press.html, epk.html)
Every page uses this exact header + footer so they match. `aria-current="page"` on the active nav link.
```html
<header class="site-header">
  <a class="brand" href="/index.html"><img src="/assets/img/logo-horizontal.svg" alt="Artist Name" class="brand-logo"></a>
  <nav class="site-nav" aria-label="Primary">
    <a href="/index.html">Music</a>
    <a href="/press.html">Press &amp; Videos</a>
    <a href="/epk.html">EPK</a>
  </nav>
</header>
<!-- page main content here: <main class="wrap"> ... </main> -->
<footer class="site-footer">
  <p>Artist Name — Genre, City ST</p>
  <nav class="social" aria-label="Social">
    <!-- links pulled from window.MR_CONFIG.socials by js/main.js, or hardcoded to match config.js -->
  </nav>
  <p class="fineprint">© Artist Name. All rights reserved.</p>
</footer>
```
`.wrap` = centered column: `max-width:var(--maxw); margin-inline:auto; padding-inline:var(--gap);`

---

## 2. Data model — `data/releases.json`

Already written (see the file). Builders READ it; do not restructure it. Shape:
```
{
  "artist": { "name", "location", "genre", "bio", "contactEmail" },
  "releases": [ {
      "id", "title", "year", "date",
      "art",                       // path to cover (placeholder SVG for now)
      "priceModel",                // "nyp-floor" | "nyp" | "fixed" | "free"
      "priceFloor",                // number (min $ for nyp-floor / price for fixed); 0 for nyp/free
      "currency", "bandcampUrl", "credits", "notes",
      "tracks": [ { "n","title","duration","streamKey","downloadKeys":{"wav","mp3"} } ],
      "downloadBundle": { "wav","mp3" }   // whole-release zip keys (optional)
  } ],
  "mixes": [ { "id","title","date","art","streamKey","sourceUrl" } ]
}
```
- `streamKey` / `downloadKeys` / bundle keys are **R2 object keys** (files uploaded later). They may
  not exist yet — that's expected. Never hardcode real bcbits/SoundCloud URLs as the play source.
- Price model meaning:
  - `nyp-floor` → "$X or more" — buyer may pay `priceFloor` or higher (not less).
  - `nyp` → name your price — buyer may pay anything **including $0** (free download allowed).
  - `fixed` → exact `priceFloor`.
  - `free` → always free.

---

## 3. Runtime config — `js/config.js`

Already written (see file). Exposes `window.MR_CONFIG`:
```
{ mock: true, api: {...endpoints}, emailFormUrl, epkDriveNote, socials:{...}, merchUrl, bandcampUrl,
  soundcloudUrl, spotifyUrl, youtubeUrl, contactEmail }
```
- **`mock: true`** is the master switch that lets the entire site be clicked through with NO Stripe
  account, NO R2, and NO uploaded audio. All builders MUST honor it (details in each section).
  Production flips it to `false`.

---

## 4. Home page — `index.html` + `js/player.js` + `js/main.js`

Single page = Home + Music + Radio/Mixes + Connect. The page renders immediately on load
(no entry overlay). Sections top-to-bottom:

### 4b. Stations player module (`js/player.js`) — pinned at TOP of the page
A persistent player bar/panel. Playback continues while the user scrolls/browses the album grid.
- **Stations** (built at runtime from releases.json + mixes):
  1. `Shuffle All` — random order across every release track.
  2. One station per release — plays that release's tracks in natural order (label = release title).
  3. One station per mix — each mix is its own station (label = mix title).
- UI: a station selector (dropdown or horizontal scroll list of station chips), transport controls
  (prev / play-pause / next), current track title + release, a seek/progress bar, elapsed/duration,
  volume, and a shuffle toggle (shuffle toggle applies within/across as noted; "Shuffle All" is also
  a preset station). Now-playing track highlighted with `--accent-2`.
- Auto-advance to next track; at end of a release station, stop (or loop — your call, document it).
- Audio source: request a signed URL from `MR_CONFIG.api.streamUrl?key=<streamKey>` then set
  `<audio>.src`. Cache the returned URL for the session.
- **MOCK mode (`MR_CONFIG.mock`)**: no audio files exist, so DO NOT hit the network. Instead prove the
  UX works with zero assets: use a Web Audio oscillator to emit a short, quiet tone per track and drive
  the progress bar on a **compressed timer (~8s per track)** so auto-advance, next/prev, station
  switching, and shuffle are all audibly/visibly demonstrable. Clearly label somewhere subtle
  "demo audio — real tracks load after upload". In production (`mock:false`) use the real `<audio>` src.
- Keyboard accessible; ARIA labels on all controls.

### 4c. Album grid (`js/main.js` renders from releases.json)
- Bandcamp-style responsive grid of release cards (cover + title + year + price label).
- Price label: `nyp-floor` → "$5 or more"; `nyp` → "name your price"; `fixed` → "$5"; `free` → "free".
- Click a card → expand/modal/details showing: cover, track list (each track: number, title, duration,
  and a ▶ that loads that release station in the player at that track), release notes/credits, and a
  **Buy / Download** button that invokes the store (see §5). Also a small "▶ Play release" that selects
  the release's station.
- Keep markup semantic; grid must reflow cleanly to 1 column on mobile.

### 4d. Connect section (bottom of page)
- Short bio (from `artist.bio`), an **email-list signup** (styled section/button linking to
  `MR_CONFIG.emailFormUrl` — an external form link; do NOT embed a form iframe), social links
  (`MR_CONFIG.socials`), a **Merch** button (→ `MR_CONFIG.merchUrl`), and a Bandcamp link.
- Contact email `MR_CONFIG.contactEmail`.

---

## 5. Store — `api/*.js` (Vercel Node functions) + `js/store.js`

Digital only. No physical/vinyl anywhere. Buyer chooses **WAV or MP3** at download (like Bandcamp).
Full-track streaming is free (§4b); purchase gates the *download* only.

### Endpoints (paths from `MR_CONFIG.api`)
1. **`POST /api/create-checkout`**
   - body: `{ releaseId, amount, format }` (`format` = "wav"|"mp3"; `amount` in USD number)
   - Validate `releaseId` against releases.json; enforce price model:
     - `nyp-floor`/`fixed`: `amount` >= `priceFloor` (reject below).
     - `nyp`: `amount` >= 0. If `amount === 0` → treat as free path.
     - `free`: always free path.
   - Paid path → create a Stripe Checkout Session (mode: payment, one line item, `success_url` back to
     `/download.html?session_id={CHECKOUT_SESSION_ID}` — or a success section on index; document choice),
     return `{ url }`.
   - Free path → issue a short-lived signed **download token** (HMAC of releaseId+format+exp, secret in
     env) and return `{ free:true, token }`. No Stripe.
2. **`GET /api/verify-download?session_id=...`** (paid) **or** `?token=...` (free)
   - Verify the Stripe session is paid (or verify the HMAC token + expiry). On success, return signed,
     short-expiry (e.g. 10 min) R2 URLs: `{ ok:true, files:[{label,url}], bundleUrl }` for the chosen
     format. Never return URLs without a valid paid session / valid token.
3. **`GET /api/stream-url?key=...`**
   - `key` MUST match a known `streamKey` from releases.json/mixes (validate against an allowlist derived
     from the data — do NOT sign arbitrary keys). Return `{ url }` = signed short-expiry R2 URL.

### Shared helpers `api/_lib/`
- `_lib/data.js` — load releases.json, expose `getRelease(id)`, `allStreamKeys()`.
- `_lib/r2.js` — R2 S3-compatible client; `signGet(key, expires)`. Uses env creds.
- `_lib/stripe.js` — Stripe client from env.
- `_lib/token.js` — HMAC sign/verify for free-download + streaming tokens.

### MOCK mode
- When env creds are absent OR `MR_CONFIG.mock` is true, `js/store.js` must run a **client-side mock**:
  simulate the buy flow (show the name-your-price / format UI, a fake "processing", then a success panel
  offering a disabled/placeholder "download" clearly labeled "demo — real files delivered after upload").
  Do NOT call the real endpoints in mock. This makes the whole purchase UX clickable with no accounts.
- The real `api/*.js` functions should also **degrade gracefully** if env vars are missing (return a
  clear JSON error), so a partial deploy doesn't 500.

### `js/store.js` buy flow (UI)
- Buy button → panel: for `nyp`/`nyp-floor` show an amount input (pre-filled with floor, enforce min);
  for `fixed` show the price; for `nyp`/`free` allow $0 → "Download for free". Format toggle WAV/MP3.
- Confirm → (mock: simulate; real: POST create-checkout → redirect to Stripe or handle free token) →
  success → show download links from verify-download (real) or placeholder (mock).

---

## 6. Press & Videos — `press.html` + `js/press.js` (DATA-DRIVEN)
**Easy-update principle:** the page must render from `data/press.json` — adding a new article/video =
add one JSON object, never touch HTML. `data/press.json` is ALREADY WRITTEN (read it, don't restructure).
- `press.html`: shared shell (§1), `<main class="wrap">` with a lede heading + an empty container that
  `js/press.js` fills with **blog-style cards down the page**, one per `data/press.json` item.
- Each card renders from the item's fields: `image` (preview), `title`, `source`, `date`, `summary`,
  `url`, `type` ("article" | "video"), plus a "Read →" / "Watch →" link (label by `type`).
- `press.json` item shape: `{ id, type, title, source, date, summary, url, image }`.
  For video items, `image` may be a YouTube thumbnail URL (allowed exception) — if `image` is empty,
  `js/press.js` falls back to a generated geometric placeholder in the site palette.
- Match site styling exactly (same tokens/classes as §1). Cards responsive: image + text row on desktop,
  stacked on mobile.

---

## 7. EPK — `epk.html` + `js/epk.js` (DATA-DRIVEN)
**Easy-update principle:** the page must render from `data/epk.json` — updating the bio, releases,
support list, tech rider, or links = edit JSON, never touch HTML. `data/epk.json` is ALREADY WRITTEN
(read it; it holds `bio`, `recentReleases[]`, `support[]`, `contact`, `techRider`, and `links[]` with
`{label,url,group}`). `epk.html` = shared shell + empty sections that `js/epk.js` fills from the JSON.
Make it look like a real press kit, not a doc dump: clear section headings, grouped links, generous
spacing. **Keep all links intact** (they come straight from the JSON). The template ships with demo
content in `data/epk.json` (artist "Static Bloom" — Electronic — Your City, ST; contact
hello@example.com; placeholder bio, releases, support acts, tech rider, and example.com links) —
template users replace every field with their own.

---

## 8. Conventions & guardrails
- Vanilla only. No npm frontend deps. Backend deps allowed: `stripe`, `@aws-sdk/client-s3` +
  `@aws-sdk/s3-request-presigner` (R2 is S3-compatible). Put them in package.json.
- Accessibility: semantic HTML, labelled controls, visible focus, alt text, keyboard operable player.
- Performance: no external requests on first paint; defer non-critical JS; images lazy where sensible.
- Comments: explain *where real assets/keys/URLs get swapped in* so the site owner can maintain it easily.
- **File ownership (do not write outside your set):**
  - Home agent → `index.html`, `css/style.css`, `js/player.js`, `js/main.js`,
    `assets/img/covers/*` placeholders, `assets/img/favicon*`.
  - Store agent → `api/**`, `js/store.js`, `README.md` (setup guide), `.env.example` additions.
  - Content agent → `press.html`, `epk.html`, `js/press.js`, `js/epk.js` (reference `css/style.css`
    classes per §1; do NOT edit it; READ `data/press.json` & `data/epk.json`, don't restructure them).
- All three reference this spec's class contract so pages match without touching each other's files.

## 9. Easy-maintenance mandate (applies to everyone)
The site owner must be able to update the site WITHOUT rewriting it and WITHOUT an admin UI:
- **New release** → add an object to `data/releases.json` + upload its files to R2. Nothing else.
- **New press/video** → add an object to `data/press.json`.
- **EPK change** → edit `data/epk.json`.
- Everything renders from these JSON files at runtime. No hardcoded catalog/press/EPK content in HTML.
- The store agent's `README.md` must include short "How to add a release / press item / EPK edit" and
  "How to upload files to R2" sections so this is self-serve.
</content>
