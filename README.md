# Naked Brain

The phone app for the people working on the floor of a FarmBox: the day's tasks, checklists and SOPs, scouting
photos, harvest, voice notes. It works offline and syncs when the phone has a signal.

**Live: https://brain.nkd.farm/** · User guide: [`guide.html`](guide.html)

On a phone, open the address and use *Add to Home Screen* (iPhone) or *Install app* (Android/Chrome).

Naked Brain is one of the two apps of the **FarmBox Operations Platform**. The other one is **Naked Heart**, the
desktop console for managers (https://heart.nkd.farm/). Both apps share one database on Supabase. The database,
its rules and the decision log are in the private repository `Nkdfarm/FarmBox-Platform`.

## What this repository is

Static files with no build step:

| File | What |
|---|---|
| `index.html` | The whole app: markup, styles (design system "Naked Farm UI v1") and script |
| `sw.js` | Service worker: offline cache |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png`, `splash/` | Install as an app |
| `version.json` | The version a phone checks to offer "Update now" |
| `skins/` | Colour themes as JSON tokens (Settings › Appearance › Skin) |
| `guide.html` | The user guide |
| `cloudflare-worker.js` | A copy of the Cloudflare Worker that passes calls to Notion and Groq behind the team password |
| `serve.ps1` | Serves the folder on http://localhost:3000 for testing |
| `transcribe.ps1` | Turns a video or audio file into text with Groq Whisper |
| `docs/` | Older working notes |

Libraries are loaded from jsDelivr at exact versions (pdf.js, mammoth, Tesseract.js, jsQR, MediaPipe and others).

## Run it locally

```powershell
.\serve.ps1
```

You can also run `python -m http.server 3000` in this folder and open http://localhost:3000.

## Releasing

GitHub Pages serves the branch **`live`**, not `main`: **a push to `main` publishes nothing.** A release is
made only with the owner's script `scripts/release-brain.ps1` in FarmBox-Platform (the `release-brain` skill).
It bumps the version in the places that move together, adds the row to `VERSION_LOG` in `index.html`, and
moves `live`. Never push `live` by hand.

## History

Until 6 Oct 2026 this was the repository `Kissanga/Ugly200`. Its old address,
https://kissanga.github.io/Ugly200/, is frozen at 0.11.116 and tells people to open https://brain.nkd.farm/.
On the owner's computers the folder is still called `Ugly200`.
