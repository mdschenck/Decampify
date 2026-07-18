#!/usr/bin/env node
/*
 * generate-manifest.mjs — builds R2-FILE-MANIFEST.md from data/releases.json.
 *
 * Reads every streamKey / downloadKeys / downloadBundle / mix streamKey in the
 * catalog and writes a checkbox upload checklist so nothing is missed when
 * uploading audio to the R2 bucket. No dependencies.
 *
 * Run:  npm run manifest      (or: node scripts/generate-manifest.mjs)
 * Re-run any time data/releases.json changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(root, "data", "releases.json");
const outPath = join(root, "R2-FILE-MANIFEST.md");

const data = JSON.parse(readFileSync(dataPath, "utf8"));
const releases = data.releases || [];
const mixes = data.mixes || [];

let streamCount = 0, wavCount = 0, mp3Count = 0, bundleCount = 0, mixCount = 0;
const lines = [];

lines.push("# R2 Upload Manifest");
lines.push("");
lines.push("> Generated from `data/releases.json` by `npm run manifest` — do not edit by hand;");
lines.push("> re-run the script after any catalog change. Upload each file to your R2 bucket at");
lines.push("> **exactly** the key shown (case-sensitive), then tick it off.");
lines.push("");

for (const rel of releases) {
  lines.push(`## Release: ${rel.title} (\`${rel.id}\`)`);
  lines.push("");
  lines.push("### Streaming MP3s (free player — 192 kbps CBR, 44.1 kHz, full length)");
  for (const t of rel.tracks || []) {
    lines.push(`- [ ] \`${t.streamKey}\``);
    streamCount++;
  }
  lines.push("");
  lines.push("### Download WAVs (sold — full-quality masters)");
  for (const t of rel.tracks || []) {
    lines.push(`- [ ] \`${t.downloadKeys.wav}\``);
    wavCount++;
  }
  lines.push("");
  lines.push("### Download MP3s (sold — 320 kbps CBR)");
  for (const t of rel.tracks || []) {
    lines.push(`- [ ] \`${t.downloadKeys.mp3}\``);
    mp3Count++;
  }
  if (rel.downloadBundle) {
    lines.push("");
    lines.push("### Bundle zips (whole release, per format)");
    for (const fmt of ["wav", "mp3"]) {
      if (rel.downloadBundle[fmt]) {
        lines.push(`- [ ] \`${rel.downloadBundle[fmt]}\``);
        bundleCount++;
      }
    }
  }
  lines.push("");
}

if (mixes.length) {
  lines.push("## Mixes (streaming only)");
  lines.push("");
  for (const mix of mixes) {
    lines.push(`- [ ] \`${mix.streamKey}\`  — ${mix.title}`);
    mixCount++;
  }
  lines.push("");
}

const total = streamCount + wavCount + mp3Count + bundleCount + mixCount;
lines.push("---");
lines.push("");
lines.push(`**Total: ${total} files** — ${streamCount} track streams + ${mixCount} mix streams + ` +
  `${wavCount} WAV + ${mp3Count} MP3 + ${bundleCount} bundle zips.`);
lines.push("");

writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath} (${total} files listed).`);
