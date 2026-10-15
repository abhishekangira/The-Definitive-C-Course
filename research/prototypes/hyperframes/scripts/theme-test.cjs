const { chromium } = require("/opt/node-tools/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1000, height: 600 } });
  await pg.goto("http://127.0.0.1:8765/theme.html");
  await pg.waitForFunction(() => document.getElementById("p").ready, null, { timeout: 15000 });
  await pg.evaluate(() => document.getElementById("p").seek(6));
  await pg.waitForTimeout(500);
  await pg.locator("#p").screenshot({ path: process.argv[2] + "/live-dark.png" });
  const info = await pg.evaluate(() => {
    const d = document.getElementById("p").iframeElement.contentDocument;
    const root = d.querySelector('[data-composition-id="compile-pipeline"]');
    const before = root.getAttribute("style");
    const light = { bg: "#f7f5f0", panel: "#ffffff", fg: "#1b1f24", muted: "#4b5563", edge: "#c9d1dc", accent: "#b45309" };
    for (const el of d.querySelectorAll("[data-composition-id]")) for (const [k, v] of Object.entries(light)) el.style.setProperty("--" + k, v);
    return { before, after: root.getAttribute("style") };
  });
  await pg.evaluate(() => { const p = document.getElementById("p"); p.seek(5.9); p.seek(6); });
  await pg.waitForTimeout(600);
  const comp = await pg.evaluate(() => {
    const d = document.getElementById("p").iframeElement.contentDocument;
    const box = d.querySelector(".cp-box");
    const cs = d.defaultView.getComputedStyle(box);
    const sub = d.querySelector('[data-composition-id="cp-pipeline"]');
    return { boxBg: cs.backgroundColor, subStyle: sub && sub.getAttribute("style"), iframeVisible: getComputedStyle(document.getElementById("p").iframeElement).visibility, canvases: document.getElementById("p").shadowRoot.querySelectorAll("canvas,img").length };
  });
  console.log(JSON.stringify(comp));
  await pg.locator("#p").screenshot({ path: process.argv[2] + "/live-light.png" });
  console.log(JSON.stringify(info));
  await b.close();
})();
