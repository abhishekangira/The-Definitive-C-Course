const { chromium } = require("/opt/node-tools/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1000, height: 600 } });
  await pg.goto("http://127.0.0.1:8765/range.html");
  await pg.waitForFunction(() => document.getElementById("p").ready, null, { timeout: 15000 });
  await pg.evaluate(() => document.getElementById("p").play());
  await pg.waitForTimeout(3500);
  const r1 = await pg.evaluate(() => ({ t: document.getElementById("p").currentTime, paused: document.getElementById("p").paused, ev: window.__ev.filter(e => e[0] !== "timeupdate") }));
  await pg.screenshot({ path: process.argv[2] + "/range-end.png" });
  // next step: move range to [2.3, 4.7) and play again
  await pg.evaluate(() => { const p = document.getElementById("p"); p.rangeStart = 2.3; p.rangeEnd = 4.7; p.play(); });
  await pg.waitForTimeout(3500);
  const r2 = await pg.evaluate(() => ({ t: document.getElementById("p").currentTime, paused: document.getElementById("p").paused }));
  console.log(JSON.stringify({ r1, r2 }));
  await b.close();
})();
