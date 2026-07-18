---
name: decampify-onboard
description: Onboard your own music into this Decampify site. Imports your catalog, track lists, prices, and cover art from your existing Bandcamp page; pulls in your bio and socials; optionally adopts your Bandcamp styling (fonts/colors); sets up your EPK and press pages; generates your R2 file-upload manifest; and writes a personalized step-by-step launch checklist. Use when a user wants to set up Decampify with their own content, or says "onboard", "import my music", "set up my site", or "run the onboarding".
---

# Decampify Onboarding

You are setting up **this cloned Decampify template** with the user's own content. Work through the
steps in order. **Confirm before overwriting** any content file, keep `js/config.js` `mock: true`
throughout (so the site stays runnable during onboarding), and never fabricate data — if something
can't be found, keep the template placeholder or ask the user.

## Preflight
1. Confirm this is a Decampify repo: `data/releases.json`, `js/config.js`, `css/style.css`, and
   `scripts/generate-manifest.mjs` should exist. If not, stop and tell the user.
2. Briefly explain what you'll do and what you'll need: their **Bandcamp artist URL**, and optionally
   an **EPK link** and **press links**.

## Step 1 — Import the catalog from Bandcamp
1. Ask for the user's **Bandcamp artist page URL** (e.g. `https://youracts.bandcamp.com`).
2. Fetch the artist page and each release/album page. Use WebFetch for the catalog text; if pricing or
   details are thin, also pull the **raw HTML** with `curl` and parse it.
3. For each release, extract: **title**, the URL slug → use as **`id`**, **date/year**, **price model**,
   the **track list** (number, title, duration), and the **cover art URL** (on `bcbits.com`). Also grab
   the **artist name, bio, and location**. Map pricing to the schema's models:
   - "name your price" → `priceModel: "nyp"`, `priceFloor: 0`
   - "$X or more" → `priceModel: "nyp-floor"`, `priceFloor: X`
   - fixed "$X" → `priceModel: "fixed"`, `priceFloor: X`
   - free → `priceModel: "free"`, `priceFloor: 0`
4. **Show the user a summary** (releases + prices + track counts) and confirm before writing.
5. Write `data/releases.json` using the **exact existing schema** (open the current file and match every
   field name). Generate the storage keys with the template's naming convention — the same one
   documented in README "Audio file naming", which the user's files will have to match exactly:

   | Field | Pattern | Example |
   |---|---|---|
   | `art` | `/assets/img/covers/<id>.jpg` | `/assets/img/covers/first-light-ep.jpg` |
   | `streamKey` | `stream/<Album-Dir>/<Artist>-<Title>.mp3` | `stream/First-Light-EP/Static_Bloom-Dawn_Chorus.mp3` |
   | `downloadKeys.wav` | `downloads/<Album-Dir>/<Artist>-<Title>.wav` | `downloads/First-Light-EP/Static_Bloom-Dawn_Chorus.wav` |
   | `downloadKeys.mp3` | same with `.mp3` | |
   | `downloadBundle` | `downloads/<Album-Dir>/<Album-Dir>-WAV.zip` / `-MP3.zip` | `downloads/First-Light-EP/First-Light-EP-WAV.zip` |
   | mix `streamKey` | `stream/mixes/<lowercase-slug>.mp3` | `stream/mixes/summer-2026.mp3` |

   Building `<Album-Dir>` and the filename:
   - **Album directory** — release title, spaces → `-`, keep proper case: `First Light EP` → `First-Light-EP`
   - **Artist / title** — spaces → `_`, keep proper case, joined by `-`: `Dawn Chorus` → `Static_Bloom-Dawn_Chorus`
   - **Keep** letters, digits, `_`, `-`, `&`, `(`, `)`. **Drop** `? ! . : ,` —
     `Are We There? (Reprise)` → `Are_We_There_(Reprise)`, `Afterglow (feat. Nova)` → `Afterglow_(feat_Nova)`
   - **Guest artists** — if a track title reads `Guest Name - Title`, use the guest as the artist for that
     track: `Night Owl - Static Drift` → `Night_Owl-Static_Drift`
   - **DJ mixes keep their lowercase slug** — stream-only, never sold, so the convention doesn't apply
   - If the release title makes an awkward directory (e.g. `Remixes / Rarities (Collected)`),
     propose a clean short form (`Remixes-Collected`) and **confirm it with the user** before writing

   Replace the demo releases entirely. After writing, run `npm run manifest:check` — it validates the keys
   against the convention and will flag anything malformed.

## Step 2 — Download the cover art
For each release, download its Bandcamp cover into `assets/img/covers/<id>.jpg`. Bandcamp art URLs end in
a size code like `_16.jpg` or `_2.jpg`; **replace the suffix with `_10`** for a large (~1200px) version,
e.g. `https://f4.bcbits.com/img/a1234567890_10.jpg`. It's the user's own art, so downloading is fine. Then
confirm the `art` paths in `releases.json` point at these files, and delete the demo placeholder covers.

## Step 3 — Bio + socials → config + EPK
From the artist page (and its links), collect the **bio** and any **social/profile links** (Instagram,
SoundCloud, YouTube, Spotify, TikTok, X, etc.) plus the Bandcamp URL.
- Update `js/config.js`: set `bandcampUrl`, the matching `socials` keys (remove any social key you have no
  link for), `contactEmail` if found. **Leave `mock: true`.**
- Put the bio + artist name/genre/location into `data/epk.json` (and `data/releases.json`'s `artist` block).

## Step 4 — Adopt their Bandcamp styling (optional)
1. Pull the **raw HTML** of the Bandcamp page with `curl` (WebFetch's markdown drops the CSS). Look for the
   page's **custom design** colors/fonts — Bandcamp stores them in the page's custom-design data (e.g. a
   `custom_design_rules` object in the page JSON, or an inline `#custom-design-rules-style` / custom color
   variables: background, text, link/secondary-link, secondary background).
2. **If custom colors/fonts are found**, map them onto the `:root` tokens in `css/style.css`:
   background → `--bg`, text → `--text`, link/accent → `--accent`, a slightly-off background → `--bg-elev`
   / `--bg-elev-2`, borders → `--line`; map the page's font family to `--font-display` and `--font-body`.
   Adjust `--text-dim` and `--line` for legibility. Keep `--success` (the buy button green) unless it
   clashes badly. **Sanity-check text/background contrast** after applying.
3. **If the page uses Bandcamp's default styling** (very common — there's nothing custom to read), tell the
   user so and **keep the template's default light theme**. Offer to let them pick a few colors manually.

## Step 5 — DJ mixes, EPK, and Press (ask the user)
These aren't on Bandcamp, so ask about each. **Whenever you remove a page, also remove its nav link** from
the header on every remaining page so the navigation stays consistent.

**DJ mixes** — "Do you have any DJ mixes to feature?" If yes, add entries to `releases.json` `mixes[]`
(`id`, `title`, `date`, `art: /assets/img/covers/<id>.svg`, `streamKey: stream/mixes/<id>.mp3`). If no,
remove the demo mix.

**EPK** — "Do you have an EPK link you'd like to import?" Offer three choices:
1. **Provide a link** → fetch it and parse the bio, recent releases, support, contact/rider, and links
   into `data/epk.json`.
2. **Blank template** → keep `epk.html` + `data/epk.json` with cleared/placeholder fields to fill later.
3. **Remove the EPK entirely** → delete `epk.html` and `js/epk.js`, remove the EPK nav link from the header
   on the other pages, and remove `data/epk.json`.

**Press** — "Do you have any press links (interviews, features, video) you'd like to feature?" Offer:
1. **Paste a table/list** of links → parse each.
2. **Add up to 5 links, one at a time.**
3. **Blank press template** → keep the page with placeholder cards for them to fill later.
4. **Remove the press page entirely** → many users have no press or don't want to feature it, so offer this
   plainly as a simplifying option. Delete `press.html` and `js/press.js`, remove the Press nav link from
   the header on the other pages, and remove `data/press.json`.
For provided links, fetch each page for a title, source, and short summary; use a preview image if one's
available, otherwise leave `image: ""` (the page auto-generates a placeholder). Write into `data/press.json`
(`{ id, type: "article"|"video", title, source, date, summary, url, image }`).

## Step 6 — Generate the file-upload manifest
Run `npm run manifest` (which runs `scripts/generate-manifest.mjs`) to regenerate **`R2-FILE-MANIFEST.md`**
from the updated `releases.json`. This is the user's checklist of every audio file to upload to R2.

## Step 6b — Offer to check and fix the staged filenames

**Why this matters — explain it to the user in one line:** a filename that doesn't match `releases.json`
produces a valid signed URL for an object that isn't there, so the track fails with a bare
*"track unavailable"* and nothing in the logs. Catching it now is much cheaper than debugging it live.

1. Ask whether they've already staged their audio (default `_uploads/`, or wherever they keep it).
   If they haven't encoded anything yet, skip this step and mention they can run it later.
2. Run **`npm run manifest:check`**. It reports:
   - **MISSING** — catalog keys with no staged file
   - **ORPHAN** — staged files matching no catalog key, each with a suggested rename
   - **CONVENTION** — keys departing from the documented naming convention
3. Interpret the result for them rather than pasting raw output:
   - **All matched** → say so plainly; they're ready to upload.
   - **Only MISSING** → those tracks aren't encoded yet. List them; nothing to rename.
   - **ORPHAN + MISSING in matching numbers** → almost always misnamed files, not absent ones. This is
     the case worth fixing, so go to step 4.
4. **Offer to rename the staged files.** Build the mapping from the script's suggestions, then:
   - Show the **complete proposed rename table** (`old name  ->  new name`), grouped by folder.
   - Flag any orphan the script could **not** confidently pair, and ask the user which track it is —
     never guess a pairing the script rejected.
   - **Get explicit confirmation before renaming anything.** These are the user's master audio files.
   - Rename only inside the staging folder. **Never** rename to a path that already exists, and never
     touch `data/releases.json` to make it fit the files — the catalog is the source of truth, since it
     is what the deployed site will ask R2 for.
5. Re-run `npm run manifest:check` afterwards to confirm it comes back clean.

**If the user is deliberately using a different naming convention**, that's fine — say so, and make the
catalog match their files rather than the reverse: edit the keys in `data/releases.json`, re-run
`npm run manifest`, and re-check. The convention warnings are advisory; the MISSING/ORPHAN mismatch is not.

## Step 7 — Write a personalized launch checklist
Create **`LAUNCH-CHECKLIST.md`** covering the **full path from this cloned template to a live site.** Keep
the GitHub/Vercel/account items brief (they're standard, well-documented, and not Decampify-specific — point
to the official docs), and give the app-specific steps in full. List them in order so it's unmistakable that
the site is NOT live until it's pushed to GitHub and deployed on Vercel:

1. **Put the code on GitHub** — create a new GitHub repository and push this project to it. Vercel deploys
   from GitHub, so this is required even though it's quick. (See GitHub's "create a repository" docs.)
2. **Deploy on Vercel** — import the GitHub repo into Vercel and deploy (no build settings needed). **This is
   what actually puts your site online.** (See Vercel's "import a project" docs.)
3. **Create accounts** — Stripe (payments) and Cloudflare R2 (audio storage), if you don't have them.
   `SETUP.md` covers the specifics that matter for this app.
4. **Encode audio** — streaming MP3s at **192 kbps / 44.1 kHz**, full length; downloads at **320 kbps MP3 +
   WAV**; per-release **.zip bundles** (WAV zip + MP3 zip).
5. **Upload to R2** — create the `stream/`, `stream/mixes/`, and `downloads/` folders, then upload every file
   at the exact keys in **`R2-FILE-MANIFEST.md`**.
6. **Set env vars in Vercel** — Settings → Environment Variables: `STRIPE_SECRET_KEY`, `SITE_URL`,
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `MR_TOKEN_SECRET`
   — then **redeploy** (env-var changes only apply on the next deploy).
7. **Switch from demo to the live store** — set `js/config.js` `mock: false`, then commit and push (Vercel
   redeploys automatically). Until now the site has run the built-in **demo** (`mock: true` = fake audio
   tones + simulated checkout); setting it to **`false`** activates **real streaming from R2 and real Stripe
   checkout**. **Leave it `false` from here on — this is the live setting.**
8. **Test the live store** — on your Vercel URL, play a track (real streaming) and run a **test-mode
   purchase** with Stripe card `4242 4242 4242 4242`. This only works with `mock: false`, which is why you
   flipped it in the previous step.
9. **Connect your domain** — add it in Vercel and set the DNS records at your registrar.

Tell the user: steps 1–3 are standard one-time GitHub/Vercel/account setup (follow the linked official docs);
`SETUP.md` covers the app-specific detail for steps 3–9. Listing 1–2 explicitly is deliberate — so nobody is
left wondering why their site isn't live when they simply haven't deployed it yet.

## Step 8 — Wrap up
Summarize what was imported (N releases, covers, bio/socials, theme decision, EPK/press choices) and tell
the user their next actions are **`LAUNCH-CHECKLIST.md`** and **`R2-FILE-MANIFEST.md`**. Remind them the site
already runs locally in **mock mode** with their content — they can preview it any time before going live
(`npx serve .` → localhost). Make clear that **`mock: true` is only for local preview/demo; the live site
must have `mock: false`** (that switch is step 7 of the launch checklist).

## Guardrails
- Confirm before overwriting content files, and before deleting a page.
- Prefer WebFetch for text; fall back to `curl` raw HTML when you need pricing details or the custom CSS.
- Keep `mock: true` the whole time during onboarding; it only flips to `false` at go-live (checklist step 7).
- Never invent catalog data, prices, or links — leave placeholders or ask.
- Keep the header navigation consistent: if you remove the EPK or Press page, remove its nav link everywhere.
