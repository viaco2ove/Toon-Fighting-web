// 直连手机 APK WebView（CDP）的通用探针。
// 用法（详见 SKILL.md）：
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
//   node cdp-probe.mjs "({vw:innerWidth, vh:innerHeight})"
import { chromium } from 'playwright-core';

const expr = process.argv[2] || '({vw:innerWidth, vh:innerHeight, dpr:devicePixelRatio})';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
console.error('页面:', await page.title(), '|', page.url().slice(0, 60));
const result = await page.evaluate(expr);
console.log(JSON.stringify(result, null, 1));
await browser.close();
