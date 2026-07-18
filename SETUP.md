# Decampify — Setup Guide (going live)

The template runs out of the box in **mock mode** (see README.md). This guide is the full,
non-technical walkthrough for turning on the real store: Stripe payments, Cloudflare R2 audio
hosting, deployment, and theming. Work through it top to bottom.

---

## 1. Link your Stripe account (payments)

Stripe handles the checkout page and the money. This site only needs your **secret key** — it uses
Stripe Checkout (a hosted page), so no card details ever touch this site.

**Step by step:**
1. **Create the account** at [dashboard.stripe.com/register](https://dashboard.stripe.com/register).
   Verify your email. New accounts land in **Test mode** (toggle at the top of the dashboard) — you can
   build and test the entire store in test mode **without** finishing account activation.
2. **Turn on two-factor auth** when prompted (authenticator app or SMS). Stripe requires it; setting it
   up during signup avoids login/authentication headaches later.
3. **Get your secret key:** Dashboard → **Developers → API keys**. You'll see two keys:
   - *Publishable key* (`pk_…`) — **not needed** by this site.
   - **Secret key** (`sk_test_…` in test mode) — click **Reveal**, copy it. This is the value for the
     `STRIPE_SECRET_KEY` env var. Keep it secret — treat it like a password.
4. **Test a purchase** with Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
5. **Go live (real payments):** complete **Activate your account** (business or individual details + a
   bank account for payouts + tax info). Then switch **Test mode off**, go back to Developers → API keys,
   and copy the **live** secret key (`sk_live_…`) into `STRIPE_SECRET_KEY` in your Vercel production
   environment. Same env var — no code change. (Keep using the test key locally.)
6. **Webhook — not required.** This site verifies each purchase by reading the Checkout Session directly
   in `/api/verify-download`, so you don't need to configure a Stripe webhook. (`STRIPE_WEBHOOK_SECRET`
   in `.env.example` is optional/future-proofing.)

**Payment methods — nothing to configure.** This site uses Stripe Checkout *without* hard-coding payment
types, so Stripe automatically shows the right methods (cards by default, plus Apple Pay / Google Pay /
Link if you enable them) — this is its **managed / dynamic payment methods**. Leave that setting on its
default; there's nothing to set up. Stripe Checkout even handles the Apple/Google Pay domain verification
for you. And to be clear: you **never need the publishable key** (`pk_…`) — this integration only ever uses
the **secret** key, server-side.

**Authentication troubleshooting** (if you're stuck logging in or the key won't work):
- Make sure you copied the **Secret** key (`sk_…`), not the publishable key, and from the **correct mode**
  — test and live have *different* keys, and the top-of-dashboard toggle changes which ones are shown.
- Check for stray spaces/newlines when pasting the key into `.env` or Vercel.
- Locked out of login? Use Stripe's **account recovery** link and make sure your 2FA device/authenticator
  is set up. You do **not** need a fully activated account to grab test keys and build.

## 2. Link your Cloudflare R2 account (file hosting)

R2 is the private bucket that stores all your audio; the site's API hands out short-lived signed URLs so
files are only reachable after a valid purchase or free-download token.

**Step by step:**
1. **Open R2 and enable it.** In the Cloudflare dashboard, click **R2 Object Storage** (*not* "Create an
   app" — that's for Workers/Pages). The first time, R2 must be **enabled / subscribed** before you can
   create a bucket — Cloudflare asks you to **add a payment method** even though the **free tier keeps this
   project at $0** (10 GB storage, no egress fees). Add it and enable R2.
2. **Create the bucket.** Once R2 is enabled, the **R2 Overview** page shows a **Create bucket** button
   (usually top-right). Click it, name the bucket (e.g. `my-artist-store` → this becomes `R2_BUCKET`),
   leave **Location: Automatic**, keep it **private** (the default — do **not** enable public access), and
   create it.
   _(Don't see a "Create bucket" button? R2 isn't enabled yet — finish step 1 first.)_
3. **Create S3 API credentials:** R2 → **Manage R2 API Tokens** → **Create API Token**. Give it
   **Object Read** permission (read-only is all the site needs — it only signs GET requests). Save the
   **Access Key ID** and **Secret Access Key** it shows (the secret is shown **once**):
   → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
4. **Account ID + endpoint:** your **Account ID** is on the R2 overview page → `R2_ACCOUNT_ID`. The S3
   endpoint is `https://<account-id>.r2.cloudflarestorage.com` → `R2_ENDPOINT`.
5. **Create the two top-level folders** in your bucket: open the bucket → **Create folder** → make
   **`stream`** and **`downloads`**, and inside `stream` also make a **`mixes`** subfolder (for DJ mixes).
   _(Technically R2 has no real folders — they're just key prefixes — so if you upload with an S3 tool the
   folders are created automatically from the key paths and you can skip this step. Creating them up front
   just keeps the dashboard tidy.)_
6. **Upload your audio** following **section 4** below.

Keep the bucket private forever — the whole download-protection model depends on files being reachable
only through the API's signed URLs.

## 3. Environment variables (local `.env` + Vercel)

The site reads these values from the environment — **locally** from a `.env` file (for `vercel dev`) and
**in production** from Vercel. The names must match exactly (all documented in `.env.example`):

| Variable | What to put |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe **secret** key — `sk_test_…` while testing, `sk_live_…` for real money |
| `SITE_URL` | `http://localhost:3000` locally; in production your real URL (`https://<your-domain>`, or the `…vercel.app` URL until your domain is connected) |
| `R2_ACCOUNT_ID` | from the R2 overview page |
| `R2_ACCESS_KEY_ID` | from your R2 API token |
| `R2_SECRET_ACCESS_KEY` | from your R2 API token (shown once) |
| `R2_BUCKET` | your bucket name |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `MR_TOKEN_SECRET` | any long random string — generate with `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `STRIPE_WEBHOOK_SECRET` | optional / unused — leave blank |

**Locally:** copy `.env.example` → `.env` and fill in the values. `.env` is gitignored — **never commit it.**

**In Vercel (production):**
1. Open your project → **Settings → Environment Variables** (or add them during the first **Add New →
   Project** import — the configure screen has an Environment Variables section).
2. Add each `KEY` and its value. Tip: Vercel lets you **paste a whole `.env` block** (`KEY=value` lines)
   at once instead of entering them one at a time.
3. Choose which environments they apply to — check **Production** (and **Preview** if you use preview deploys).
4. **Save**, then **redeploy** — env-var changes only take effect on the **next deployment**
   (Deployments → ⋯ → **Redeploy**, or push any commit).

## 4. Upload your audio to R2

Everything the site plays or sells lives in **one private R2 bucket**, under two top-level "folders".
The keys are declared per release/mix in `data/releases.json`; **the uploaded object key must match
exactly (case-sensitive).**

### Generate your upload checklist

```
npm run manifest
```

This reads `data/releases.json` and regenerates **`R2-FILE-MANIFEST.md`** — a checkbox list of every
R2 key your catalog needs (stream MP3 per track, mix streams, download WAV + MP3 per track, bundle
zips). Tick items off as you upload so nothing is missed. Re-run it any time the catalog changes.
**Copy the keys from the manifest — don't invent new ones.**

### Naming convention (must match `releases.json` exactly)

```
stream/<Album-Dir>/<Artist_Name>-<Song_Title>.mp3      ← free streaming copies (one per track)
stream/mixes/<mix-id>.mp3                              ← DJ mixes for the Radio stations
downloads/<Album-Dir>/<Artist_Name>-<Song_Title>.wav   ← purchased downloads, WAV
downloads/<Album-Dir>/<Artist_Name>-<Song_Title>.mp3   ← purchased downloads, MP3
downloads/<Album-Dir>/<Album-Dir>-WAV.zip              ← whole-release bundle, WAV
downloads/<Album-Dir>/<Album-Dir>-MP3.zip              ← whole-release bundle, MP3
```

Building the names:
- **`<Album-Dir>`** — the release title with spaces → `-`, proper case kept: `First Light EP` → `First-Light-EP`
- **Artist and title** — spaces → `_`, proper case kept, joined with `-`:
  `Static Bloom` + `Dawn Chorus` → `Static_Bloom-Dawn_Chorus`
- **Keep** letters, digits, `_`, `-`, `&`, `(`, `)`. **Drop** `? ! . : ,` —
  `Are We There? (Reprise)` → `Are_We_There_(Reprise)`, `Afterglow (feat. Nova)` → `Afterglow_(feat_Nova)`
- **Guest artists** — a track titled `Guest Name - Title` uses the guest as that track's artist:
  `Night Owl - Static Drift` → `Night_Owl-Static_Drift`
- **DJ mixes** keep their lowercase `<mix-id>` slug — they're stream-only and never sold, so the
  artist/title convention doesn't apply

Using a different convention is fine — nothing in the code requires this one. What is **not** optional is
that your files, `data/releases.json`, and the objects in your R2 bucket all agree **exactly**.

> ⚠️ **Names must match the manifest exactly — object names *and* release directory names.**
> R2 keys are **case-sensitive** and nothing in the stack does fuzzy matching. `downloads/My-EP/…` and
> `downloads/my-ep/…` are two different locations, and a site asking for `Dawn_Chorus.wav` will never
> find `dawn-chorus.wav`.
>
> Get this wrong and it fails in a way that is genuinely hard to debug: signing a download URL **never
> checks that the object exists**, so a mismatched name still yields a perfectly valid signed URL. The
> browser fetches it, R2 returns 404, and the player just reports *"track unavailable"* — with nothing in
> your logs pointing at the real cause.

### Check your filenames before uploading

```
npm run manifest:check
```

Compares your staging folder against the catalog and reports **MISSING** (a catalog key with no file
staged), **ORPHAN** (a staged file matching no catalog key — nearly always a typo, and it suggests the
likely rename), and any keys that depart from the convention above. Run it until it comes back clean.
The `decampify-onboard` skill can also walk through this and rename the files for you.

### Recommended formats / bitrate

- **Streaming MP3 (free previews):** **192 kbps, 44.1 kHz, stereo, full track length.** CBR is slightly
  safer than VBR for smooth seeking in the player (VBR still plays fine). Drop to 128 kbps if you want
  faster loads. **Keep the stream bitrate below your 320 kbps download** — the free stream shouldn't be a
  perfect substitute for the paid file, and the quality gap gives listeners an incentive to buy. (R2 has no
  bandwidth fees, so this is about quality tiering, not saving data.)
- **Download MP3 (sold):** **320 kbps CBR.**  **Download WAV (sold):** full-quality master (24-bit is fine).
- **Sample rate:** keep the **MP3s at 44.1 kHz** for universal browser compatibility (48 kHz also plays —
  just be consistent). WAVs can stay at their native rate (e.g. 24-bit / 48 kHz).
- **Bundle zips:** zip that release's download-quality files (WAV zip → the WAVs, MP3 zip → the MP3s).

### Two ways to upload

1. **`npm run upload` (recommended)** — stage your files in `_uploads/` mirroring the key paths, then
   `npm run upload:check` (dry run) followed by `npm run upload`. It reads every key straight from
   `data/releases.json`, so what you upload **cannot** drift from what the site asks for — which removes
   the whole category of naming bugs described above. It also handles files over the dashboard's 300 MB
   limit, skips anything already uploaded, and retries on flaky connections. Needs a write-scoped R2
   token in `.env.upload` — see `.env.upload.example`.
2. **Cloudflare dashboard** — R2 → your bucket → **Upload** → drag files. Type the key prefix
   (e.g. `stream/First-Light-EP/`) when uploading to build the folder structure. Capped at **300 MB per
   file**, so whole-release WAV bundles usually can't go this way. Type prefixes carefully — a typo here
   is exactly the silent-404 failure described above.
3. **An S3 tool** pointed at the R2 endpoint (`https://<account-id>.r2.cloudflarestorage.com`) with your
   R2 access key/secret — **rclone**, **Cyberduck**, or the **AWS CLI**
   (`aws s3 cp <folder> s3://<bucket>/downloads/<Album-Dir>/ --recursive --endpoint-url <R2 endpoint>`).

**Security:** `stream/` files back the free player; `downloads/` files are only ever handed out via a
short-lived signed URL after a valid purchase or free-download token. The API **refuses to sign any key
not listed in `releases.json`**, so nothing outside the manifest is reachable by any other method.

## 5. Image specifications

**Album / release covers** — `assets/img/covers/<release-id>.jpg` (or `.svg`)
- **Shape:** square (1:1). Non-square art will be center-cropped by the grid.
- **Dimensions:** 1400×1400 px recommended (min 1000×1000) — covers display at ≤ ~600 px.
- **Format:** JPG (use PNG only for hard-edged / transparent art). sRGB color profile.
- **File size:** aim for under ~400 KB — compress/optimize; at display size heavy compression is invisible.
- **Name:** exactly the release `id` from `releases.json` + the extension, e.g. `first-light-ep.jpg`,
  and set the release's `art` field to `/assets/img/covers/<release-id>.jpg`.
- DJ-mix "station" art uses the same square spec at `assets/img/covers/<mix-id>.jpg`
  (the demo mixes use geometric SVG placeholders — drop in a square JPG the same way to replace one).

**Press / video preview images** — `assets/img/press/<id>.jpg`
- **Shape:** 16:9 landscape (matches the card layout; other ratios get letterboxed/cropped).
- **Dimensions:** 1280×720 px recommended (min 800×450).
- **Format:** JPG, sRGB. **File size:** aim under ~300 KB.
- **Reference:** set the item's `image` field in `data/press.json` to `/assets/img/press/<id>.jpg`.
  Leave `image` empty for an auto-generated geometric placeholder, or use a remote thumbnail URL
  (e.g. a YouTube `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`) for video items.

## 6. Run locally

```
npm i
npx vercel dev     # serves the static site AND the /api functions at localhost:3000
```

With `mock: true` in `js/config.js`, none of the accounts above are even required — the site runs
stand-alone (demo audio tones, simulated checkout).

## 7. Deploy to Vercel + connect a domain

1. Push the repo to GitHub, then **vercel.com → Add New Project → import the repo**. Defaults are
   fine (no build step). Add the environment variables in project settings.
2. **Connect your domain:** Vercel → Project → Settings → Domains → add the domain. Vercel
   shows the records to create; in your registrar's DNS management set:
   - `A` record, host `@`, value `76.76.21.21`
   - `CNAME` record, host `www`, value `cname.vercel-dns.com`
   DNS can take up to an hour; Vercel provisions HTTPS automatically.

## 8. Flip mock off (turn the real store on)

1. Upload audio to R2 (section 4).
2. Set all env vars in Vercel — including the **live** Stripe key and
   `SITE_URL=https://<the-real-domain>` — and redeploy.
3. Edit `js/config.js`: `mock: true` → **`mock: false`**. Commit and push.

That single flag switches the player from demo tones to signed R2 streams and the buy flow from
simulation to real Stripe Checkout.

---

## Theming (one-place re-skin)

Every color and font on the site lives in the `:root` custom-property block at the top of
`css/style.css` — re-skinning is a one-place edit. The default is a **neutral light theme** with a
system sans-serif:

| Token | Default | Used for |
|---|---|---|
| `--bg` | `#f4f4f5` | page background (light gray) |
| `--bg-elev` | `#ffffff` | cards / panels / header |
| `--bg-elev-2` | `#e9e9ec` | raised controls, hover states |
| `--text` | `#1a1a1a` | primary text |
| `--text-dim` | `#5c5c66` | secondary text |
| `--accent` | `#26262b` | links, hover/active borders, focus outlines, primary buttons |
| `--accent-2` | `#26262b` | now-playing cue (dark fill + light text) |
| `--success` | `#2e7d32` | Buy/Download buttons only |
| `--success-hover` | `#1b5e20` | Buy/Download hover |
| `--line` | `#d7d7dc` | borders / dividers |
| `--radius` | `4px` | corner radius |
| `--maxw` | `1080px` | content column width |
| `--gap` | `clamp(12px,2vw,24px)` | spacing unit |
| `--font-display` | system sans-serif stack | headings, nav, buttons, track lists |
| `--font-body` | system sans-serif stack | body copy, bios |

Switching to a **dark theme** is just editing these values (dark backgrounds, light text, a light
accent) — no other CSS changes needed. If you re-theme, also review the small fixed-color details
that pair with the tokens (the `#ffffff` text used on `--accent-2` now-playing fills) and update
`assets/img/logo-horizontal.svg` / `favicon.svg` / cover placeholders so they read on your new
background. The `<meta name="theme-color">` tag in each HTML file should match your new `--bg`.

---

## Everyday maintenance (no admin UI — edit JSON, upload files)

- **Add a release** → add an object to `data/releases.json` (copy an existing release and update
  `id`, `title`, `year`, `date`, `art`, `priceModel` (`nyp-floor` | `nyp` | `fixed` | `free`),
  `priceFloor`, `credits`, `notes`, the `tracks` array, and `downloadBundle`), add cover art at the
  `art` path, run `npm run manifest`, upload the new audio to R2 at exactly the listed keys.
  Grid, player stations, and store all pick it up automatically.
- **Add a press article or video** → add one object to `data/press.json`:
  `{ id, type ("article"|"video"), title, source, date, summary, url, image }`.
- **Edit the EPK** → edit `data/epk.json` — `bio`, `recentReleases[]`, `support[]`, `contact`,
  `techRider`, and `links[]` (`{label, url, group}`).

## Store API reference (for future maintenance)

| Endpoint | In | Out |
|---|---|---|
| `POST /api/create-checkout` | `{releaseId, amount, format}` | paid → `{url}` (Stripe); free/$0 → `{free:true, token}` |
| `GET /api/verify-download` | `?session_id=…` or `?token=…` | `{ok, release, format, files:[{label,url}], bundleUrl}` — signed URLs, ~10 min expiry |
| `GET /api/stream-url` | `?key=<streamKey>` | `{url}` — signed URL, allowlisted keys only |

Price rules are enforced server-side (`nyp-floor`/`fixed` reject below-floor amounts; `nyp` at $0
and `free` skip Stripe entirely). If required env vars are missing, endpoints return a clear JSON
error (HTTP 501) instead of crashing — a partly-configured deploy degrades gracefully.
