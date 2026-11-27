// 多视口响应式验证矩阵：遍历视口档位 → 打开选人屏 → 几何探针 + 截图
// 用法：复制到 <项目>/.cache/uitest（playwright-core 所在地）后：
//   node viewport-matrix.mjs [页URL，默认 http://localhost:8100/index.html]
// 产出：每档一行 JSON 探针 + <档位名>.png 截图（落当前目录）
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:8100/index.html';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

// 真机实测档位（一加6 dpr3.5 实测 751×307）——设计新断点前先用 h5-app-debug 实测更新这里
const MATRIX = [
  { name: 'desktop', w: 1280, h: 800, dpr: 1, mobile: false },
  { name: 'ultra-land', w: 751, h: 307, dpr: 3.5, mobile: true },   // 超矮横屏（最容易出问题）
  { name: 'land', w: 732, h: 412, dpr: 3, mobile: true },
  { name: 'port', w: 412, h: 732, dpr: 3, mobile: true },
];

const browser = await chromium.launch({ executablePath: exe, headless: true });
for (const m of MATRIX) {
  const ctx = await browser.newContext({
    viewport: { width: m.w, height: m.h },
    deviceScaleFactor: m.dpr,
    isMobile: m.mobile, hasTouch: m.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  // 打开选人屏（找不到按钮就跳过，探针照跑）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /练\s*习/.test(x.textContent) && x.offsetParent);
    if (b) b.click();
  });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const g = document.getElementById('kgrid');
    const card = document.querySelector('#kgrid .k:not(.void)');
    return {
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
      mqUltra: matchMedia('(max-width:920px) and (max-height:360px)').matches,
      mqLand: matchMedia('(max-width:920px) and (max-height:500px)').matches,
      mqPort: matchMedia('(max-width:560px)').matches,
      cardH: card ? Math.round(card.getBoundingClientRect().height) : null,   // 塌成 11/15 = 行高塌陷 bug
      cardW: card ? Math.round(card.getBoundingClientRect().width) : null,
      gridH: Math.round(g.getBoundingClientRect().height),
      cards: g.querySelectorAll('.k:not(.void)').length,
      rotbtn: !!document.getElementById('rotbtn'),
    };
  });
  console.log(m.name.padEnd(12), JSON.stringify(r));
  await page.screenshot({ path: m.name + '.png' });
  await ctx.close();
}
await browser.close();
console.log('done — 截图已落盘，用 ViewImage 人工过一遍（探针数字对不代表没有叠字/遮挡）');
