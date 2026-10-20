# 0003: Optional progress sync through Google Drive

Status: Proposed (2026-10-20). Extends PLAN.md §2.5; it does not replace the localStorage store or export and import.

## Context
Progress lives in one browser (`tdcc:v1:progress`). Learners who switch computers, or whose browser clears site data, lose it unless they remember to export a file. The owner asked for progress to save to and load from Google Drive automatically. The site is static on GitHub Pages: there is no server to hold a client secret or a refresh token.

## Decision
- Opt-in, from Settings. The browser token flow of Google Identity Services gets an access token for the `drive.appdata` scope only: one hidden file (`tdcc-progress.json`) in the learner's own Drive app-data folder, which the course cannot see outside of and other apps cannot see at all.
- localStorage stays the source of every read. Drive is a mirror: each sync downloads the Drive copy, merges it with `mergeProgress` (the same merge as an import), applies the result, and uploads it when Drive differs. Changes autosave after a short delay; the Drive copy is pulled on start-up and when the tab becomes visible again.
- The Drive copy's seed wins, so every device ends up with one learner seed. Settings (platform, low-memory mode) stay per browser.
- Reset and "Replace my progress" upload without merging, so they are not undone.
- The OAuth client id is a build-time variable (`VITE_GOOGLE_CLIENT_ID`, from the repository variable `GOOGLE_CLIENT_ID`). Without it the feature is hidden.

## Options considered
- **Export and import only** (the status quo): no network, but it depends on the learner remembering.
- **A backend with refresh tokens:** silent long-lived sync, but it breaks the no-backend architecture and needs hosting and a secret.
- **`drive.file` scope with a visible file:** the learner can see the file, but a second device cannot find it without a Picker step; `drive.appdata` needs no picker.

## Evidence
`src/progress/drive.test.ts` runs `syncOnce` against a fake Drive v3 API: first upload, retrieve and merge, idempotent second sync, replace, an unreadable Drive copy left untouched, a deleted file recreated, an expired token, and a reset during a download.

## Consequences
- The token lasts about an hour and is kept with its expiry in `tdcc:v1:drive`, so autosave survives a reload; after it expires the learner clicks "Sign in again" (a silent refresh would need a popup without a click, which browsers block). Like the tutor key, any script on the page can read it; the scope limits what it can reach.
- The site loads `accounts.google.com/gsi/client` and calls `googleapis.com`, but only after the learner points at a sign-in button or has connected.
- Two devices syncing at the same instant can race (Drive has no compare-and-swap here); the merge is monotone, so the next sync heals it.
- The owner must create the OAuth client in Google Cloud (authorised JavaScript origin `https://abhishekangira.github.io`, Drive API enabled) and set the repository variable. Until the app is verified by Google, the consent screen shows an "unverified app" warning, or only test users can sign in.
