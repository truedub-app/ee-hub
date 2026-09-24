# Editing & Editorial Hub

**One department. One rota. One trusted source.**

An offline-first, installable web app for the Editing & Editorial department. It combines the shift rota, the
work manual (procedures, PDFs, training videos, the segmentation map), the contact directory and the blacklist.
It is hosted on GitHub Pages (`gh-pages` branch), but **all department content is encrypted**. The public site only ever serves
ciphertext, and each device keeps its own encrypted copy that keeps working without a network.

## What’s inside

| Area | Highlights |
| --- | --- |
| **Home** | Greeting and status, your shift today (In-Charge / QC 2), coverage per band with the live band marked NOW, notices, quick actions, recently opened documents |
| **Shift ROTA** | Day / Week / Month, My Schedule / Full Team, section and status filters, sticky grids, headcounts, colour-coded codes, yellow In-Charge and green QC 2 cells, tap to edit, long-press or right-click for quick actions, CSV export, print to PDF |
| **Duty board** | Exactly one In-Charge and one QC 2 per band, and they must be different people. Only staff rostered and present on that band can be chosen, and one person can't hold duties on two bands. A red warning shows for a missing holder and an amber banner for an incomplete day |
| **Excel import** | Understands the department's block layout (`08 till 16 00`, `missing list & QC 2`, `Holiday`, `toil`…, **yellow cells = In-Charge**) and simple tables. Steps: select file → mapping → validation summary → name matching → preview → confirm. Every import is recorded with a rollback snapshot |
| **Work Manual** | Procedure cards with screenshots (extracted from Word guides), scanned PDFs with OCR text (English and Arabic), the segmentation map as live tables, and training videos (speed 0.75×–2×). Full-text search in English and Arabic |
| **Contacts** | Network directory (teams, channels, tap to call or email, copy, share, favourites) and the Editing & Editorial team directory with each person's next 7 days |
| **Blacklist** | The official blacklist image, uploaded by an admin and encrypted with the blacklist key (full-screen viewer with a “viewed by” watermark). Names typed for the image, plus optional detailed entries, power a fuzzy name check (typos, aliases, Arabic). Hidden mode, audit of views and searches, confirmed full or redacted export |
| **Admin** | Import history and rollback, staff editor (eligibility, merging duplicates), shift codes and sections, documents (import PDF / video / procedure card), integrity report, audit log, encrypted `.hub` backup and restore, publish |

## Why a PWA instead of Flutter

The brief asked for “Flutter or a better technology”, and the app is hosted on GitHub, so the web is the main target.
This is **React + TypeScript + Vite as an installable Progressive Web App**:

- **One URL for every device.** It installs from the browser to Android, iPhone/iPad (Share → Add to Home Screen),
  Windows and macOS, with no app store. It can be wrapped later with Capacitor or Tauri if store builds are needed.
- **Right-to-left Arabic, text selection, copy, browser find and screen readers work natively.** In Flutter Web they are weaker.
- **A small, fast shell** (≈3 MB, cached for offline use) instead of a multi-megabyte CanvasKit runtime.
- **Mature local tooling:** pdf.js for PDFs, SheetJS for Excel, WebCrypto for AES-256-GCM, IndexedDB and Cache Storage for offline data.

## Security model

```
setup link / access code ──PBKDF2(600k)──► key slot ──► content keys ─┬─► core data, documents, media
                                                                       └─► blacklist key
device key (default, non-exportable) ─┐
optional PIN ──PBKDF2(310k)───────────┴─► device vault ──► data key ──► everything stored on the device (IndexedDB)
```

- **Published pack (`public/pack/`).** Every file is AES-256-GCM encrypted with an opaque name. Only `manifest.json` is readable,
  and it holds just the salt and the sealed key slots. `npm run pack:verify` proves each code opens only its own
  role, that a wrong code opens nothing, and scans every published file for plaintext.
- **Access:** two links. The **Administrator** link is private (import the rota, upload the blacklist image,
  publish). The **Department** link is shared with everyone and can view everything, including the blacklist.
  Manager (view + edit) and Guest (no blacklist key at all) codes are still supported if you add them to
  `hub-content/secrets.json`.
- **Devices.** Data at rest is always encrypted. By default the Hub opens directly after the one-time access code: the key stays on the
  device and can't be exported by web pages, but anyone using that device can open the Hub. For shared or studio computers,
  turn on **Settings → Security → Require a PIN** (6 digits or a passcode). With a PIN on, wrong attempts are rate-limited,
  the Hub auto-locks after inactivity, and “Forgot PIN” re-opens the vault with the access code.
- **Redaction.** The content pipeline removes credentials (user names, passwords, host addresses) from extracted documents,
  and screenshots can be blurred per image (`blur` in the catalogue). Original Word files are never published.
- **No automatic cloud backup.** Backups are `.hub` files encrypted with a passphrase you choose.

> Security still depends on the access codes. Share them the way you would a door code, and rotate them if one leaks (see below).

## Folder layout

```
MBC APPS/                       ← private working folder (never committed)
├── *.xlsx, *.docx, *.pdf, videos 00x/    source material
├── hub-content/
│   ├── catalogue.json          which files become which documents, categories, descriptions, links
│   ├── segmentation.json       the Segmentation Map as structured tables
│   └── secrets.json            access codes + content keys — KEEP PRIVATE, BACK IT UP
├── hub-build/                  cache: extracted guides, OCR text, compressed videos
└── editing-editorial-hub/      ← this repository: app code on main; the built site + encrypted pack on gh-pages
```

## Everyday operations

**Set up a device.** Tap the department setup link (or open the site and type the code), then pick your name. No PIN is needed unless you turn one on.
The first run downloads roughly 25 MB of documents. Videos download when first played, or all at once from Settings → Offline status.

**Install it as an app.** Home shows an *Install the Hub* banner until the Hub is installed. The same button is under Settings → Install app. Chrome and Edge install in one tap. Other browsers get step-by-step help for iPhone/iPad, Android and computers.
On iPhone/iPad a setup link first shows *Add the Hub to your Home Screen*, because the Home Screen app keeps its own data, separate from Safari. That screen shows the code with a Copy button. The code box accepts a pasted setup link or a typed code.

**Monthly rota: the simplest path (administrator, in the app)**
1. Data Management → Import ROTA → select the Excel file → check the summary → Confirm.
2. In-Charge comes from the yellow cells. Fix any warning on the duty board if needed.
3. Data Management → Backup, restore & publish → **Create publish package**.
4. On GitHub, switch to the **gh-pages** branch, open `pack/`, choose **Add file → Upload files** and drag in the
   contents of the zip's `pack` folder (`manifest.json` and the `f` folder). Commit. The site updates within a
   minute or two, and every device picks up the new version the next time it is online.

**Rebuild from the source files (developer machine)**
```bash
npm run pack         # pull the live pack, extract guides, OCR PDFs, compress videos, encrypt → public/pack
npm run pack:verify  # role separation + plaintext scan
npm run deploy       # verify, build and publish the site to the gh-pages branch
```
`npm run pack` first pulls the live pack from `gh-pages`, and the builder merges it (newest record wins), so a rebuild never loses
blacklist entries, duty assignments or documents added in the app. To add a document, add it to
`hub-content/catalogue.json`. To add a rota, append its file name to `rota`. If the rota uses a short spelling for
someone, map it in `staffNames` (for example `"Sam": "Samantha"`); the short spelling is kept as an alias for future imports.

**Blacklist image.** An administrator opens Blacklist → Upload image, then types the names shown on it (Edit names) so
they can be searched, and publishes. The image is encrypted, so only people with a Hub link can see it.

**Access codes and setup links:** `npm run pack:codes` prints each role's code and a **setup link**
(`https://truedub-app.github.io/ee-hub/#setup=CODE`). Opening the link sets up a device without typing. The code sits after the `#`,
which browsers never send to the server, and the app removes it from the address bar immediately. Treat a link like
the code itself: anyone who has it gets that role's access.

**Rotate access codes.** Edit the codes in `hub-content/secrets.json`, run `npm run pack`, then `npm run deploy`. Old codes stop working for
new set-ups, and existing devices keep working. To also cut off devices that already have access, replace
`keys.core` and `keys.restricted` as well. Every device then has to be set up again with a new code.

**Move data without the internet.** Data Management → Export backup (`.hub` + passphrase) → carry it by USB, AirDrop or
Nearby Share → Import backup on the other device (merge or restore).

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (rota import, duty rules, crypto, merge, blacklist matching, contacts)
npm run build        # production build → dist/ (includes public/pack)
npm run deploy       # publish dist to the gh-pages branch
```

The Windows content pipeline uses Python 3 (`pip install pymupdf python-docx pillow`), ffmpeg and the built-in
Windows OCR engine (Arabic + English language packs).

## Known limits

- Each device holds its own copy. Publishing is how every device converges on the same data.
- OCR text for scanned PDFs is good, but check exact wording against the page image, which is always shown.
- iOS keeps offline data for installed (home-screen) apps. In a plain Safari tab it may be cleared after weeks without use.
