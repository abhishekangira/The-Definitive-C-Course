# HyperFrames for "The Definitive C Course": research report

**Recommendation in one line:** keep HyperFrames HTML projects in the repo as the editable source. Ship rendered H.264 MP4 files plus a poster, a steps file and WebVTT captions, played in our own accessible React wrapper around a native `<video>`. Use the live `@hyperframes/player` only where an animation really needs live theming or parameters, always with a same-origin runtime.

Everything below is marked either **[VERIFIED]** (I ran it here) or **[DOCS]** (taken from the skills, package READMEs or GitHub docs without running it).

---

## 0. Versions, environment and corrections to the given facts

- **[VERIFIED] Packages:** latest on npm is **hyperframes 0.8.161**, not 0.8.160. It was published 2026‑10‑15, the CLI ships almost every day, and it is pre‑1.0. `@hyperframes/player@0.8.161` and `@hyperframes/core@0.8.161` match. Also used: `gsap@3.15.0` (latest), `@fontsource/jetbrains-mono@5.3.0`, `@fontsource/montserrat@5.3.0`.
- **[VERIFIED] Node and CLI:** Node is v22.22.0; the CLI needs Node ≥ 22. The CLI install is 157 MB of `node_modules` across 122 packages and takes about 8 s.
- **[VERIFIED] Browser:** the CLI pins `chrome-headless-shell` **152.0.7977.30** (the `CHROME_VERSION` constant in the CLI source). I used Playwright's **Chromium 141.0.7390.37** instead, at `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`, by setting `HYPERFRAMES_BROWSER_PATH`. It works: frames are captured with BeginFrame on software GL.
- **[VERIFIED] Network differs from the facts I was given:**
  - From the shell, **`cdn.jsdelivr.net` is reachable** (it returned the real GSAP 3.14.2 file).
  - **`storage.googleapis.com` is reachable** (a HEAD request for the pinned chrome‑headless‑shell zip returned 200).
  - **`fonts.googleapis.com` is reachable**: the compiler fetched Google Fonts on its own.
  - WebFetch could not resolve `gsap.com`, `webflow.com` or `open.windriver.com`.
- **[VERIFIED] Settings for every command in our environment:**
  ```bash
  export HYPERFRAMES_NO_TELEMETRY=1        # CLI sends anonymous telemetry by default
  export HYPERFRAMES_SKIP_SKILLS=1         # otherwise `init` tries to update agent skills from GitHub
  export HYPERFRAMES_NO_UPDATE_CHECK=1
  export HYPERFRAMES_BROWSER_PATH=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
  ```
- **[VERIFIED] The repo was not touched** (`git status` is clean). Some caches were written outside the scratch area: `~/.cache/hyperframes/fonts/` (Google font fetch) and `~/.local/state/hyperframes/previews/*.log`.

---

## 1. What a HyperFrames composition is

### Overall model [DOCS, VERIFIED by building one]

A composition is a plain HTML page whose DOM declares timing with `data-*` attributes. All animation lives on one paused GSAP timeline per composition, registered on `window.__timelines`.

The renderer never plays the page. For each frame it computes `t = frame / fps`, seeks every registered timeline and every media element to `t`, captures the frame with `HeadlessExperimental.beginFrame`, and encodes with FFmpeg.

### Project layout

**[VERIFIED]** This is what `hyperframes init <dir> --non-interactive --example=blank` produces:

```
index.html        # standalone root composition (NO <template>)
hyperframes.json  # registry URL + install paths + media.autoProxy
meta.json         # {id,name,createdAt}
package.json      # scripts pinned to "npx --yes hyperframes@0.8.161 …"
AGENTS.md, CLAUDE.md  # 8.6 KB each, tell agents to use /hyperframes skills
```

These get added as you work:
- `compositions/*.html`: sub-compositions (scenes), each a single `<template>`.
- `assets/`.
- `.hyperframes/`: history, artifacts and locks. Gitignore it, but never delete it wholesale.
- `renders/`.

**Two root forms, which are not interchangeable [DOCS, lint‑enforced]:**
- The standalone `index.html` root sits directly in `<body>`. Wrapping it in `<template>` is the lint error `standalone_composition_wrapped_in_template`.
- A sub-composition puts *everything* inside `<template>`, including its `<style>`, its `<script>` and its root `<div>`. Anything outside the template is dropped.

### Data attributes [DOCS; the ones I used are VERIFIED]

**On the root element:**

| Attribute | Rule |
|---|---|
| `data-composition-id` | Required. Must equal the key used in `window.__timelines[...]`. |
| `data-width`, `data-height` | Required. |
| `data-duration` | Render length in seconds. Read once at compile time; scripts and `--variables` cannot change it. |
| `data-fps` | Optional. The default is 30. |
| `data-composition-variables` | Goes on `<html>`. A JSON array of `{id,type,label,default}`. |

**On clips:**
- `data-start` is what makes an element timed. It can also be a clip reference (`"intro + 2"`), but an unresolved reference silently becomes 0.
- `data-duration` is required on `<div>` and on sub-composition hosts.
- `class="clip"` is a convention; lint warns without it.
- `data-track-index` is only a Studio display lane. It does **not** control layering.
- Visibility is the half-open interval `[start, start+duration)`, so the last tween must finish *before* the end.

**On a sub-composition host:**
- `data-composition-src="compositions/x.html"`.
- `data-composition-id`: must equal the inner root's id and the timeline key.
- `data-start`, `data-duration`, `data-width`, `data-height`.
- `data-track-kind="graphics|captions"` (Studio convention).

### GSAP conventions I verified

- One `gsap.timeline({ paused: true })` per composition, registered **after** it is fully built.
- Label the steps with `tl.addLabel("compile", 1.5)` and use position parameters, not `delay`.
- Use `fromTo` with explicit start values. The docs warn that `from()` inside sub-compositions can desync on seek-back.
- Repeats must be finite. `repeat:-1` is only allowed under a finite root `data-duration`.
- Never call `tl.play()`.
- Sub-composition timelines are nested automatically. Do not `master.add()` them.

### Hard rules quoted from the skills [DOCS]

- *"No render-time clocks / unseeded `Math.random` / network / input-state; `repeat: -1` only under a finite root `data-duration`."*
- *"Never tween `display`, `visibility`, or `autoAlpha` on a `.clip` element… lint rejects it (`gsap_animates_clip_element`). Animate a child instead."*
- *"Never pair a CSS initial `transform` with a GSAP tween on the same property… `gsap_css_transform_conflict`."*
- *"Center with flex/`inset`, not CSS `transform: translate(-50%,-50%)`."*
- *"A named CSS `font-family` needs an in-file `@font-face` to a shipped local file, or lint fires `font_family_without_font_face`."*
- *"`window.__timelines["id"]` must match the root `data-composition-id`."*
- On render correctness: *"Never animate `left`, `right`, `top`, `bottom`, `width`, `height`, `margin*`… `letterSpacing` / `wordSpacing` / `fontSize` — and never `roundProps`."* Layout properties snap to whole pixels, so slow motion stutters.
- *"Ambient pulses must attach to the seekable `tl`, never bare `gsap.to()`."*
- *"No iframes for captured content."* Also: no CSS `transition` on animated elements.
- *"Register only after the build completes"* (lint error `gsap_timeline_registered_before_async_build`).
- *"Do not use `<br>` in body text"*; transformed elements must be block-level and sized.
- *"Pre-calculated layout constants — never derive positions from `getBoundingClientRect()` at tween time."*
- *"Do not call `video.play()`…"*, every `<audio>` needs an `id`, never use `crossorigin` on media, and never put a `<video data-start>` inside another `data-start` element.
- Studio convention (`/hyperframes-studio`): *"Every scene is a sub-composition"*. Lint warns with `nested_structure_needs_subcomposition`. Also one caption track, and safe zones: action‑safe 90%, title‑safe 80%.
- Video scale (`/hyperframes-creative`): headlines 64–120 px, body 28–42 px, labels 18–24 px, borders 2–4 px. Contrast must meet WCAG AA, which `check` enforces as an error.

### Gotchas I found by testing [VERIFIED]

1. **The skills say the `__timelines` guard is unnecessary. That is wrong for the player.**
   - In CLI render, check and preview, the runtime creates `window.__timelines` before inline scripts run.
   - In `@hyperframes/player`, the runtime is injected *after* the page loads. Without `window.__timelines = window.__timelines || {};` the page throws `Cannot set properties of undefined (setting 'compile-pipeline')`.
   - **Always add the guard.**
2. **Fonts.**
   - If you name a font without `@font-face`, the compiler fetches it from Google Fonts at check/render time ("Fetched 11 font face(s) for "Montserrat" from Google Fonts"). Offline with an empty cache it falls back to a bundled copy, so the face used depends on the network.
   - The live player never gets compiler-injected fonts.
   - Lint makes a non-auto-resolved family such as `"Fira Code"` without `@font-face` an **error**.
   - **Rule: ship woff2 files and declare `@font-face` yourself.** I verified that 4 local faces load in both render and player, and that no Google fetch happens.
3. **Paths that climb above the project root are a lint error** (`invalid_parent_traversal_in_asset_path`), so each animation must be a self-contained project. Symlinked `vendor/` and `assets/fonts/` directories pointing outside the project did pass check and render.
4. **Registry blocks are not offline-ready.** `hyperframes add code-highlight` writes a 24 KB block containing `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/…">` and an un-declared `JetBrains Mono`. Rewrite both after installing.
5. **`hyperframes preview` (Studio) edits your source files.** It stamps `data-hf-id="hf-xxxx"` onto elements (recorded in `.hyperframes/hf-ids-stamped.json`). Commit these ids; they are stable edit targets.
6. **Root-level clips are only sized to 100% when they have no computed size.** My first monolithic build rendered top-aligned. Give scene containers `position:absolute; inset:0`.
7. **Sub-composition scripts are scoped.** Two sub-compositions each declaring top-level `const tl` produced byte-identical output in check and render. I still wrap them in an IIFE as cheap insurance.
8. **The static `keyframes` tool cannot read function-valued from-states** (it reports `unresolved: endpointProperties`). Prefer literal values so the tool and Studio editing can see them.
9. **The `@hyperframes/core` package docs are outdated** and contradict lint and the skills. They describe the `tl.set({},{},283)` padding trick, say "higher track renders in front", "same track cannot overlap", and "compositions don't use data-duration". Trust, in order: lint, then the skills, then package docs.

---

## 2. Hands-on build: `compile-pipeline` [VERIFIED]

**What it shows:** an 8 s clip, 1920×1080 at 30 fps. Boxes `main.c → main.o → a.out` appear in sequence, the arrows draw themselves (SVG `strokeDashoffset`), each arrow gets a verb label (`cc -c`, `cc`), `a.out` pulses a finite number of times, and the background grid drifts so the final hold is not static.

**Structure:**
- A thin root `index.html` declares `@font-face`, loads the vendored GSAP and mounts two scenes.
- `compositions/cp-bg.html` is the background.
- `compositions/cp-pipeline.html` is the diagram.
- `index.motion.json` holds the motion assertions.

**Commands and results** (4 vCPU Xeon 2.1 GHz, software GL):

| Command | Result |
|---|---|
| `npx hyperframes init compile-pipeline --non-interactive --example=blank` | 0.8 s |
| `hyperframes lint` | 0.29 s. The monolithic version gave 2× `nested_structure_needs_subcomposition` warnings; after moving scenes into sub-compositions: **0 errors, 0 warnings** |
| `hyperframes check --strict` (with motion sidecar) | ~9.5 s. Runtime 0/0, layout 0 issues over 9 samples, motion 0, **contrast 31/31 AA**, passed |
| `hyperframes render --quality looks -o …mp4` | 17.7 s; **986.5 KB**; `beginframe capture · software gpu · capture 15.9s` (2 auto workers) |
| `--quality delivery` | 18.1 s, 916 KB |
| `--quality draft` | 1.07 MB. Draft is *bigger* than looks. |
| `--crf 30` | **227 KB** (about 1.7 MB per minute). SSIM 0.990 against looks; text is clean, faint grid lines soften slightly |
| `--workers 1` / `--workers 4` | 21.1 s / 12.2 s, **byte-identical** output |
| `--format webm` | 65 s, 486 KB, VP9 with `ALPHA_MODE=1` |
| Render twice | **byte-identical** (`cmp`) |
| Air-gapped render (`unshare -rn` with loopback up) | check passes, render succeeds, **byte-identical to the online render** |
| `ffprobe` | h264 High, yuv420p, 1920×1080, 30/1, 240 frames, 8.000 s, tags `hyperframes_renderer`/`hyperframes_version` (strip with `-map_metadata -1`) |
| `hyperframes snapshot --at 1.0,2.3,3.9,4.7,7.6 --no-end --output dir` | PNGs of about 540 KB each plus a contact sheet. One converted with ffmpeg to an 11 KB poster WebP |
| `hyperframes transcribe captions.json --to vtt -o captions.vtt --preserve-cues` | Writes valid WebVTT from hand-authored cues. No audio or Whisper needed |
| `hyperframes preview --background --port 4567 --json`, `--status`, `--stop` | Studio returns HTTP 200 at `/#project/compile-pipeline` |
| `hyperframes timeline`, `compositions`, `info`, `keyframes .` | All work. `catalog --query` uses the "words" tier over 447 items |

**Motion sidecar.** It caught a deliberately wrong assertion: `motion_appears_late: appears at 4.8s but should be visible by 3s`. Selectors inside sub-compositions work. A class matching several elements is reported as `motion_selector_ambiguous`.

**Lint probe.** Deliberate violations were all caught as errors: `Math.random()` (`non_deterministic_code`), a tween of `visibility` on `.clip`, and an undeclared font.

**Theming.** I moved all colours into `data-composition-variables` with type `color`, used as `var(--bg)` etc., and rendered `--strict-variables --variables '{"bg":"#f7f5f0",…}'`. That produced correct light and dark MP4s from one source.

### Sub-composition pattern that passed lint and check (abridged)

```html
<!-- index.html (root) -->
<script src="vendor/gsap.min.js"></script>
<style>
  @font-face{font-family:"JetBrains Mono";font-weight:700;src:url("assets/fonts/jetbrains-mono-latin-700-normal.woff2") format("woff2")}
  html,body{width:1920px;height:1080px;overflow:hidden;background:#0d1117}
  #root{position:relative;width:100%;height:100%;overflow:hidden}
  #root > div[data-composition-src]{position:absolute;inset:0}
</style>
<div id="root" data-composition-id="compile-pipeline" data-start="0" data-duration="8" data-width="1920" data-height="1080">
  <div id="el-pipeline" data-composition-id="cp-pipeline" data-composition-src="compositions/cp-pipeline.html"
       data-track-kind="graphics" data-start="0" data-duration="8" data-track-index="1" data-width="1920" data-height="1080"></div>
</div>
<script>
  window.__timelines = window.__timelines || {};            // REQUIRED for @hyperframes/player
  window.__timelines["compile-pipeline"] = gsap.timeline({ paused: true });
</script>
```

```html
<!-- compositions/cp-pipeline.html -->
<template id="cp-pipeline-template">
  <style> #root{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center} /* … prefixed .cp-* classes */ </style>
  <div id="root" data-composition-id="cp-pipeline" data-width="1920" data-height="1080" data-duration="8"
       data-steps='{"source":0.3,"compile":1.5,"object":2.3,"link":3.9,"exe":4.7}'> … </div>
  <script>
    (function () {
      const S = { source: 0.3, compile: 1.5, object: 2.3, link: 3.9, exe: 4.7 };
      const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
      document.querySelectorAll(".cp-link path").forEach(p => {           // measure once at setup
        const len = Math.ceil(p.getTotalLength() * 1.05); p.style.strokeDasharray = len; p.dataset.len = len; });
      tl.addLabel("source", S.source);
      tl.fromTo("#cp-src", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.7 }, "source");
      tl.addLabel("compile", S.compile);
      tl.fromTo("#cp-l-compile path", { strokeDashoffset: (i, el) => +el.dataset.len }, { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }, "compile");
      // … object / link / exe …
      tl.fromTo("#cp-exe .cp-box", { scale: 1 }, { scale: 1.06, duration: 0.45, ease: "sine.inOut", yoyo: true, repeat: 3 }, "exe+=0.9");
      window.__timelines = window.__timelines || {};
      window.__timelines["cp-pipeline"] = tl;
    })();
  </script>
</template>
```

### Player embed tests in headless Chromium 141 (Playwright 1.56.1, local static server) [VERIFIED]

| Case | Result |
|---|---|
| A: `<hyperframes-player src="compile-pipeline/index.html" controls>` | Online: ready in about 0.8–1.2 s, but it **injected `https://cdn.jsdelivr.net/npm/@hyperframes/core@0.8.161/dist/hyperframe.runtime.iife.js`**. Offline: `error` event, "HyperFrames runtime failed to load from https://cdn.jsdelivr.net/…" |
| B: same plus `runtime-src="/runtime/hyperframe.runtime.iife.js"` | **Works fully offline.** Duration 8, sub-compositions mounted, 4 local font faces loaded, timelines `compile-pipeline`/`cp-bg`/`cp-pipeline` registered, `seek(2.0)`/`seek(5.8)` frames match the MP4. `runtime-src` is **undocumented** (found in the player source): only same-origin or localhost http(s) URLs are accepted, anything else silently falls back to the CDN. |
| C: `type="video/mp4"` | `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`, because open-source Chromium builds lack H.264. Ordinary Chrome, Edge, Safari and Firefox play H.264. |
| D: `type="video/webm"` | Works |
| Step playback with `range-start="0" range-end="2.3"`, then `play()` | Stops at **2.2667 s** (the frame before the end) and fires `ended`. Setting `rangeStart=2.3; rangeEnd=4.7` and playing stops at 4.6667. This works as pause-and-predict. |
| Live theming | Setting custom properties only on the root does nothing, because the runtime copies the root's variables inline onto each sub-composition root. **Set them on every `[data-composition-id]` element in the iframe** (allowed because it is same-origin); then dark switches to light correctly. |
| Accessibility of the built-in controls | Play, mute and speed are `<button aria-label>`. The volume control is `role=slider tabindex=0` with arrow keys. **The scrubber is a bare `<div class="hfp-scrubber">` with no role, tabindex or ARIA.** The host element cannot be focused, and Space/ArrowRight did nothing. There is **no caption or `<track>` support**. `prefers-reduced-motion` only affects the play-icon animation. |
| Sandbox | The default iframe sandbox is `allow-scripts allow-same-origin` (Chromium warns about it). That is fine for trusted first-party content. `sandbox-origin="opaque"` exists [DOCS] but blocks the DOM access that theming needs. |

**Bundle sizes [VERIFIED]:**

| File | Raw | gzip -9 |
|---|---|---|
| `hyperframes-player.js` (ESM) | 108,796 B | 31,065 B |
| `hyperframe.runtime.iife.js` | 524,335 B | 164,709 B |
| `gsap.min.js` 3.15.0 | 72,927 B | 28,268 B |
| Slideshow build | 37.9 KB | not measured |
| Per-animation source | index 2.9 KB + scene about 6.9 KB | |
| Fonts (shared) | 80.7 KB | |

The player has no JSX typings and does not augment `HTMLElementTagNameMap`; we need our own `IntrinsicElements` declaration.

---

## 3. Embedding options compared

| Criterion | (a) Live composition in `@hyperframes/player` | (b) Rendered MP4/WebM in `<video>` |
|---|---|---|
| JS weight | About 225 KB gzip (runtime 165 + player 31 + GSAP 28), plus one iframe per embed. Can be lazy-loaded. | 0 KB, or only our small wrapper |
| Media weight | About 10 KB per animation plus shared fonts and GSAP | About 1.7 MB/min at CRF 30 (about 7.5 MB/min at the default looks); doubles if light and dark are rendered |
| Captions / transcript | None built in; we would have to draw our own overlay | Native `<track kind="captions/descriptions">` with WebVTT ([VERIFIED] export) plus an HTML transcript |
| Keyboard / screen reader | Scrubber not operable by keyboard; we would build our own controls | Native controls are keyboard-accessible; PiP comes free |
| Reduced motion | We implement it (seek to step ends) | We implement it (poster plus step stills from `snapshot`) |
| Pause at a step | Frame-exact `range-start/end` ([VERIFIED]) and `seek(label time)` | `currentTime` plus `requestVideoFrameCallback`/`timeupdate`; the player's `type="video/mp4"` mode also offers ranges |
| Light/dark | Live, using CSS variables on every composition root ([VERIFIED]) | Two renders via `--variables` ([VERIFIED]); the wrapper switches `src` |
| Crispness | Vector/DOM at any DPR | 1080p raster; fine up to about 960 CSS px at 2× DPR |
| Determinism | Real-time playback, which can stutter on weak devices [DOCS]; also depends on the runtime version at runtime | Frozen artifact, byte-identical renders ([VERIFIED]) |
| Offline / static hosting | Only with a self-hosted runtime via the undocumented `runtime-src`; the default fetches from jsdelivr | Trivial |
| Repo size | Tiny | Large if committed; generate in CI or use Git LFS |
| Editability | Same source | Same source, plus a render step |
| Risk | Pre-1.0 runtime with daily releases, undocumented attribute, required guard, iframe security trade-off | ffmpeg/Chrome needed in CI (about 1.5–2.5 s of wall time per second of video on 4 vCPU) |

### Recommendation: hybrid, with rendered video as the default

1. **Source of truth:** one HyperFrames project per animation in the repo. It stays editable in Studio, and `check --strict` runs in CI.
2. **What ships:**
   - H.264 MP4 at `--crf 28–30`, 1080p30.
   - Optionally a WebM fallback, for Chromium builds without H.264.
   - `poster.webp`.
   - `steps.json`, read from `data-steps`.
   - `<id>.vtt` and a transcript.
   - Played in our own `<Explainer>` React component over a native `<video>`: step chips, "pause at step N and ask for a prediction", reduced-motion fallback to step stills, captions on by default.
3. **Real native outputs on screen:** when an animation should show real values from the verification pipeline (stack addresses, sizes), feed the pipeline's stored native outputs in at render time with `--variables-file` (the variables mechanism is [VERIFIED]).
4. **Live mode is opt-in only:** `@hyperframes/player` with `runtime-src` pointing at our vendored `hyperframe.runtime.iife.js`, pinned to the same version as the CLI and lazy-loaded. Use it for a dev "live preview" toggle and for the rare animation that must follow the site theme live or be crisp at large sizes. In that mode, hide the player's controls (omit `controls`) and drive it with our own accessible controls through `play()`, `pause()`, `seek()` and `rangeStart`/`rangeEnd`.

Also worth knowing: the `/slideshow` workflow's `fragments` (hold points) do the same step-holding job, but slideshows cannot be rendered to MP4 [DOCS]. `range-start/end` covers our need.

---

## 4. Repo layout, naming and build integration

### Proposed layout

```
animations/
  README.md                      # the authoring rules in section 6, verbatim
  _shared/fonts/*.woff2 + OFL.txt   # single canonical copy (OFL, from @fontsource)
  scripts/sync-shared.mjs        # copy GSAP (from node_modules/gsap/dist) + fonts into each project's vendor/ and assets/fonts/
  scripts/render.mjs             # hash-cached render → public/animations/<id>/
  scripts/extract-steps.mjs      # read data-steps from scenes → steps.json
  u03-compile-link-load/         # one HyperFrames project per animation (self-contained; no ../ paths)
    index.html                   # thin root: @font-face, vendor/gsap.min.js, scene hosts, empty root timeline
    compositions/cll-01-source.html, cll-02-compile.html …   # one <template> per scene
    index.motion.json            # appearsBy per step, before/after ordering, staysInFrame
    captions.json → captions.vtt # cue JSON; VTT exported by CLI or our script
    meta.json  hyperframes.json
    vendor/  assets/fonts/       # synced; gitignored or committed, team's choice
    .hyperframes/  renders/      # gitignored
public/animations/<id>/{<id>.mp4,<id>.webm?,poster.webp,steps.json,<id>.vtt}   # generated
```

**Per-project files from `init`:** delete the generated `AGENTS.md`/`CLAUDE.md` and the per-project `package.json` scripts. Drive everything from the repo root with an exactly pinned `hyperframes` devDependency.

### Naming

| Thing | Convention |
|---|---|
| Animation id and directory | `uNN-kebab-topic`, e.g. `u05-stack-frames-recursion`, `u09-malloc-heap-carving` |
| Root composition id | Same as the directory |
| Scene file, scene id and timeline key | `compositions/<abbr>-NN-<scene>.html` with the same string everywhere, e.g. `sfr-02-push-frame` |
| Element ids and classes inside a scene | Prefixed with `<abbr>-` |
| Step names | Lowercase verbs (`push`, `return`, `split`), matching `tl.addLabel` names and `data-steps` keys |

### Build integration

1. **Every PR, in CI:** `hyperframes lint` and `hyperframes check --strict` for each changed project. This is fast (about 10 s each) and needs Chrome, no ffmpeg encode.
2. **Render step, `npm run anim:render`:**
   - Hash the project directory plus the CLI version plus the browser path and version plus the render flags.
   - Render only animations whose hash changed: `hyperframes render <dir> --crf 30 -o …` and optionally `--variables-file theme-light.json`.
   - Then run `snapshot --at <step ends>` for the stills, and ffmpeg for the WebP poster and step stills.
   - Keep this out of the Vite build itself. CI or deploy runs it before `vite build`; the `public/animations` output is cached. If CI rendering is not wanted, commit the renders with Git LFS.
3. **Pin the browser:** use either `npx hyperframes browser ensure` (pinned 152, downloads from storage.googleapis.com) or a fixed Playwright Chromium. Pixels drift across Chrome versions [DOCS]. `--docker` is the fully reproducible path; Docker is installed here but its daemon is not running.

### Audio, voiceover and captions

- **Default: silent with captions.** Write a short WebVTT cue per step (kind `captions`, or `descriptions` for screen readers) plus an HTML step list or transcript beside the video.
- **Do not burn captions into the video.** The caption skills and registry caption components are for burned-in social video; burned-in text cannot be toggled, restyled or read by screen readers.
- **If voiceover is added later:**
  - `hyperframes tts` (local Kokoro; needs `pip install kokoro-onnx soundfile`, not installed here).
  - Then `hyperframes transcribe narration.wav --to vtt` (needs whisper-cpp or Parakeet, not installed).
  - Then `<audio id="vo" …>` at the root.
  - Avoid the HeyGen TTS/BGM path (account, OAuth, API billing).
  - `/hyperframes-audio` covers ducking and mixing.

---

## 5. Licensing

### HyperFrames [VERIFIED]

- Repo `LICENSE` and the `hyperframes` CLI `package.json`: **Apache‑2.0**. The README says "no per-render fees or commercial-use thresholds".
- `@hyperframes/core`, `@hyperframes/player`, `@hyperframes/lint`, `@hyperframes/parsers` and `@hyperframes/studio-server` have **no `license` field** in `package.json` but ship an Apache‑2.0 `LICENSE` file. The player README footer says "MIT" — an inconsistency worth flagging.
- The registry blocks live in the same Apache‑2.0 repo.

### CLI dependency tree [VERIFIED census of 122 packages]

- 77 MIT, 13 BSD‑2, 10 Apache‑2.0, 9 ISC, 3 BSD‑3, 1 Python‑2.0, 1 CC0, 1 0BSD.
- `@img/sharp-libvips` is **LGPL‑3.0‑or‑later**. It is a build-time tool only and never ships to the site.
- Fonts are OFL‑1.1; keep the OFL text next to the woff2 files.

### GSAP

- **[VERIFIED]** The `gsap@3.15.0` npm license field reads "Standard 'no charge' license: https://gsap.com/standard-license". This is proprietary, not OSI open source.
- **[VERIFIED]** The public npm package contains the formerly paid Club plugins: SplitText, MorphSVGPlugin, DrawSVGPlugin, ScrollSmoother, InertiaPlugin, GSDevTools and others. They appeared with **3.13.0, published 2025‑04‑30**, which matches Webflow's "GSAP is now 100% free" announcement.
- **[web search]** Use is free for everyone, commercial use included. The restriction is that GSAP may not be used in visual no-code animation builders that compete with Webflow without written consent, and proprietary notices must not be removed. An archived 2025 copy mentions a Business license when end users are charged.
- I could not fetch gsap.com myself to confirm the current text.
- **Assessment:** compliant for a free educational static site.
  - Keep license headers.
  - Prefer installing GSAP as a devDependency and syncing it into `vendor/`, rather than committing copies.
  - In MP4 mode, GSAP never reaches end users' browsers.
- The HyperFrames skills pin `gsap@3.14.2`; I verified **3.15.0**.

Sources: [Webflow: GSAP becomes free](https://webflow.com/blog/gsap-becomes-free) · [GSAP standard license](https://gsap.com/community/standard-license/) · [Archived 2025 license text](https://open.windriver.com/info/uni-license-list/licenses/gsap-standard-no-charge-2025.html) · [Webflow forum thread](https://discourse.webflow.com/t/webflow-makes-gsap-100-free/319967)

---

## 6. Authoring rules a later session must follow

These are a superset of the skills, adjusted for this repo.

**Project and structure**
1. Every animation is its own HyperFrames project directory under `animations/`. No path may escape the project root (`../` is a lint error). Shared files are synced in.
2. `index.html` is a standalone root with no `<template>`. Its root element is `<div id="root" data-composition-id="<dir-id>" data-start="0" data-duration="<N>" data-width="1920" data-height="1080">`. Set `html,body{width:1920px;height:1080px;overflow:hidden}` and `#root{position:relative;width:100%;height:100%;overflow:hidden}`. The root holds only scene hosts, plus `<audio>` if audio is ever used.
3. Every scene is `compositions/<id>.html`: exactly one `<template>`, with `<style>`, root `<div id="root" data-composition-id="<id>" … data-duration>`, and `<script>` all inside it. Style the scene root through `#root`, never through a class. The host's `data-composition-id`, the inner root id and the `__timelines` key must be identical. Hosts get `position:absolute; inset:0`, `data-start`, `data-duration`, `data-width`, `data-height` and `data-track-kind="graphics"`.

**Timelines and motion**

4. Use one `gsap.timeline({paused:true})` per composition. Build it in an IIFE. Register it last with `window.__timelines = window.__timelines || {}; window.__timelines["<id>"] = tl;` — the guard is mandatory. Never call `play()`, never nest sub-composition timelines, and keep the root timeline empty.
5. Use only `fromTo` with explicit start states and position parameters or labels. Each pedagogical step gets `tl.addLabel("<step>", t)` and a matching key in `data-steps='{"<step>":t,…}'` on the scene root.
6. Animate only transforms (`x`, `y`, `scale`, `rotation`, `xPercent`), `opacity`, colours, CSS variables and SVG `strokeDashoffset`.
   - Never animate `width`, `height`, `top`, `left`, `margin`, `padding`, `fontSize` or `letterSpacing`, and never use `roundProps`.
   - Never put a CSS `transform` on an element GSAP transforms.
   - Never tween `display`, `visibility` or `autoAlpha` on `.clip`.
   - Never use CSS transitions.
7. Determinism:
   - No `Date.now`, `performance.now`, `Math.random` (use an index-derived pseudo-random value if needed), timers, rAF, events, network or iframes.
   - Repeats must be finite.
   - Measure the DOM (`getTotalLength`) only at setup.
   - The root `data-duration` is static.
   - Finish each tween before its clip's end (the window is half-open).
   - Do not front-load: reveal across the whole duration and keep one element alive during holds (`check` fails a 3 s+ static sweep).

**Assets**

8. Fonts: only families shipped as woff2 under `assets/fonts/`, each declared with `@font-face` in `index.html`. Currently JetBrains Mono for code and Montserrat for labels, 400/700. Never rely on compiler font auto-resolution.
9. GSAP comes from `vendor/gsap.min.js` and no CDN is allowed anywhere. After `hyperframes add <block>`, rewrite its jsdelivr script tag and add `@font-face` for any font it names.

**Look and layout**

10. Video scale: text ≥ 24 px (labels 28–32, filenames and code ≥ 48, headlines 56–120), borders 2–4 px. Keep all content inside the title-safe 80% (10% inset). `check` must report full WCAG AA contrast.
11. Colours are CSS custom properties declared in `data-composition-variables` (type `color`) on `<html>`. Light and dark variants are rendered with `--variables-file`.

**Gates**

12. Every animation needs `index.motion.json`, with `appearsBy` for each step plus `before` ordering. Selectors must match exactly one element.
13. Required gates, in order:
    - `hyperframes lint` with 0 errors and 0 warnings.
    - `hyperframes check --strict` passing.
    - `hyperframes snapshot --at <step times>`, then look at the PNGs.
    - Render with `--crf 30`.
    - `ffprobe` duration must equal `data-duration`.
    - Byte-identical re-render if determinism is in doubt.

**Agent workflow in this repo**

14. Set the environment variables from section 0.
15. Do not run the skills' interactive steps in this repo: `usage`, `skills update`, the intent interview / `BRIEF.md`, `auth`, `publish`, `open`, `feedback`, `--file-issue`. They target one-off video creation, need GitHub or HeyGen, or post publicly. Do use the skills' composition, animation and creative rules.
16. Never hand-edit or strip the `data-hf-id` attributes that Studio adds; commit them.
17. Captions are WebVTT sidecars plus an HTML transcript, never burned into the frames.

---

## Files (all in scratch)

**Reference project** (lint and strict check clean, motion sidecar, VTT, renders):
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/work/compile-pipeline/ (`index.html`, `compositions/cp-bg.html`, `compositions/cp-pipeline.html`, `index.motion.json`, `captions.json`, `captions.vtt`)
- Its renders: /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/work/compile-pipeline/renders/ (`final.mp4` at CRF 30, 227 KB; `cp-looks.mp4`; `cp.webm`)

**Variants:**
- Light/dark via variables: /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/work/themed/
- First monolithic version: /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/work/compile-pipeline-mono-v1/

**Embed test site** (`embed.html`, `range.html`, `theme.html`, `video.html`):
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/work/site/

**Test scripts:**
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/scripts/embed-test.cjs
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/scripts/range-test.cjs
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/scripts/theme-test.cjs
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/scripts/lo_up.py

**Screenshots and frames:**
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/work/embed-shots/
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/work/frames/

**Unpacked packages and docs:**
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/pkgs/
- /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/hyperframes/gh/ (GitHub README, LICENSE, `docs/*.mdx`)