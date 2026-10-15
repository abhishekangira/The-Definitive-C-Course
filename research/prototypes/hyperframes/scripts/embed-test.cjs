// Headless Chromium test of <hyperframes-player> embeds.
// Usage: node embed-test.cjs <outDir> <offline:0|1>
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const path = require("path");

const outDir = process.argv[2];
const offline = process.argv[3] === "1";
const BASE = "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 2400 } });
  const external = [];
  const failed = [];
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:") && !u.startsWith("about:")) {
      external.push(u);
      if (offline) return route.abort();
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on("requestfailed", (r) => failed.push(r.url() + " " + (r.failure() && r.failure().errorText)));
  const consoleMsgs = [];
  page.on("console", (m) => consoleMsgs.push(m.type() + ": " + m.text()));
  page.on("pageerror", (e) => consoleMsgs.push("pageerror: " + e.message));

  const t0 = Date.now();
  await page.goto(BASE + "/embed.html");
  // Wait up to 20 s for ready/error events on all three players.
  await page.waitForFunction(
    () => ["pA", "pB", "pC", "pD"].every((id) => window.__events.some((e) => e.id === id && (e.ev === "ready" || e.ev === "error"))),
    null,
    { timeout: 20000 },
  ).catch(() => {});
  const readyMs = Date.now() - t0;
  const events = await page.evaluate(() => window.__events);

  const state = await page.evaluate(() =>
    ["pA", "pB", "pC", "pD"].map((id) => {
      const p = document.getElementById(id);
      return { id, ready: p.ready, duration: p.duration, w: p.compositionWidth, h: p.compositionHeight };
    }),
  );

  // Seek each ready player to a "pause and predict" step and screenshot it.
  for (const [t, tag] of [[2.0, "t2.0"], [5.8, "t5.8"]]) {
    await page.evaluate((t) => {
      for (const id of ["pA", "pB", "pC", "pD"]) {
        const p = document.getElementById(id);
        if (p.ready) { p.pause(); p.seek(t); }
      }
    }, t);
    await page.waitForTimeout(800);
    for (const id of ["pA", "pB", "pC", "pD"]) {
      await page.locator("#" + id).screenshot({ path: path.join(outDir, `${offline ? "offline" : "online"}-${id}-${tag}.png`) });
    }
  }
  const times = await page.evaluate(() => ["pA", "pB", "pC", "pD"].map((id) => document.getElementById(id).currentTime));

  // Inspect shadow DOM controls for accessibility affordances.
  const controls = await page.evaluate(() => {
    const p = document.getElementById("pB");
    const root = p.shadowRoot;
    if (!root) return "no open shadowRoot";
    const els = [...root.querySelectorAll("button, input, [role], [tabindex], [aria-label]")];
    return els.slice(0, 30).map((e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.getAttribute("type"),
      role: e.getAttribute("role"),
      aria: e.getAttribute("aria-label"),
      tabindex: e.getAttribute("tabindex"),
      cls: e.className && String(e.className).slice(0, 40),
    }));
  });

  const controlsHtml = await page.evaluate(() => {
    const root = document.getElementById("pB").shadowRoot;
    const c = root && root.querySelector(".hfp-controls, [class*=controls]");
    return c ? c.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").slice(0, 3000) : "none";
  });
  console.error(controlsHtml);
  // Keyboard: focus player B and press Space / ArrowRight, read state.
  await page.evaluate(() => { const p = document.getElementById("pB"); p.seek(1.0); });
  await page.locator("#pB").focus().catch(() => {});
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  const afterSpace = await page.evaluate(() => { const p = document.getElementById("pB"); return { paused: p.paused, t: p.currentTime }; });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const afterArrow = await page.evaluate(() => { const p = document.getElementById("pB"); return { paused: p.paused, t: p.currentTime }; });

  // Iframe internals for player B (same-origin sandbox).
  const inner = await page.evaluate(() => {
    const p = document.getElementById("pB");
    const f = p.iframeElement;
    try {
      const w = f.contentWindow;
      const d = f.contentDocument;
      return {
        sandbox: f.getAttribute("sandbox"),
        timelines: Object.keys(w.__timelines || {}),
        hasPlayerBridge: typeof w.__player,
        fontsStatus: d.fonts.status,
        fontFaces: [...d.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight),
        subcompMounted: !!d.querySelector("#cp-kicker"),
        scripts: [...d.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
      };
    } catch (e) { return "error: " + e.message; }
  });

  console.log(JSON.stringify({ offline, readyMs, events, state, times, focused, afterSpace, afterArrow, controls, inner, external: [...new Set(external)], failed, console: consoleMsgs.slice(0, 40) }, null, 2));
  await browser.close();
})();
