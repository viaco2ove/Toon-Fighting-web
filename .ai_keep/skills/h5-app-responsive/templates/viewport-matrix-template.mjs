// 多视口响应式验证矩阵模板 —— 换个界面验证时改 {{目标}} 两处即可
// 依赖：<项目>/.cache/uitest 的 playwright-core + %LOCALAPPDATA%/ms-playwright 的 chromium
// 用法：复制到 .cache/uitest 后 node viewport-matrix.mjs [页URL]
import { chromium } from 'playwright-core';

const url = process.argv[2] || '{{页URL，默认 http://localhost:8100/index.html}}';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

// 档位务必来自 h5-app-debug 的真机实测（innerWidth/innerHeight/devicePixelRatio），不要拍脑袋
const MATRIX = [
  { name: '{{desktop}}', w: 1280, h: 800, dpr: 1, mobile: false },
  { name: '{{超矮横屏 ultra-land}}', w: 751, h: 307, dpr: 3.5, mobile: true },
  { name: '{{普通横屏 land}}', w: 732, h: 412, dpr: 3, mobile: true },
  { name: '{{竖屏 port}}', w: 412, h: 732, dpr: 3, mobile: true },
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
  // {{目标界面入口}}：找到入口按钮并 click（选不到就跳过，探针照跑）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /{{入口按钮文案，如 练\s*习}}/.test(x.textContent) && x.offsetParent);
    if (b) b.click();
  });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    // {{目标元素探针}}：断点命中 + 关键元素 rect（rect 高度异常小 = 塌陷/遮挡）
    return {
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
      // matchMedia('{{新断点条件}}').matches,
      // {{关键元素}}: Math.round(document.querySelector('{{选择器}}')?.getBoundingClientRect().height ?? -1),
    };
  });
  console.log(m.name.padEnd(12), JSON.stringify(r));
  await page.screenshot({ path: m.name + '.png' });
  await ctx.close();
}
await browser.close();
console.log('done — 截图落盘后用 ViewImage 人工过一遍');
