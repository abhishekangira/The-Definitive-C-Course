const { chromium } = require("/opt/node-tools/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 1200 } });
  await p.goto("http://127.0.0.1:8765/video.html");
  await p.waitForFunction(() => document.getElementById("v").readyState >= 2 && document.getElementById("pD").ready, null, { timeout: 15000 });
  await p.evaluate(() => new Promise((r) => { const v = document.getElementById("v"); v.addEventListener("seeked", r, { once: true }); v.currentTime = 5.8; }));
  await p.evaluate(() => document.getElementById("pD").seek(5.8));
  await p.waitForTimeout(1500);
  await p.locator("#v").screenshot({ path: process.argv[2] + "/native-video-5.8.png" });
  await p.locator("#pD").screenshot({ path: process.argv[2] + "/player-video-5.8.png" });
  // Try play-then-pause path in the player
  await p.evaluate(() => { const x = document.getElementById("pD"); x.muted = true; x.play(); });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById("pD").pause());
  await p.waitForTimeout(300);
  console.log(await p.evaluate(() => ({ t: document.getElementById("pD").currentTime, vt: document.getElementById("v").currentTime })));
  await p.locator("#pD").screenshot({ path: process.argv[2] + "/player-video-afterplay.png" });
  await b.close();
})();
