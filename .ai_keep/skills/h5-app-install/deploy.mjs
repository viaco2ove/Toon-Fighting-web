// 一键把站点打包成 APK 并更新部署到手机（Capacitor 7 工程）。
//
// 流水线（顺序不能变，漏任何一步手机就会跑到旧版）：
//   ① node sync.mjs                 仓库根 → android_h5/www/
//   ② npx cap sync android          www/ → android/app/src/main/assets/public/  ★漏了=旧UI
//   ③ gradlew.bat assembleDebug     需 JDK 21（PATH 的 java 1.8 编不过 AGP 8.7.2）
//   ④ adb install -r -t <apk>
//   ⑤ am force-stop + am start      重启到新版
//   ⑥ adb forward + GET /health     验收（MCP 健康检查）
//
// 用法:
//   node .zcode/skills/h5-app-install/deploy.mjs [--skip-build] [--skip-launch] [--skip-test] [--device <serial>]
//
// 详见同目录 SKILL.md（含踩坑记录）。
'use strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------- 参数 ----------
const args = process.argv.slice(2);
const opt = {
  build: !args.includes('--skip-build'),
  launch: !args.includes('--skip-launch'),
  test: !args.includes('--skip-test'),
  device: (args[args.indexOf('--device') + 1] || ''),
};
if (args.includes('--help') || args.includes('-h')) {
  console.log('用法: node deploy.mjs [--skip-build] [--skip-launch] [--skip-test] [--device <serial>]');
  process.exit(0);
}

// ---------- 路径与环境 ----------
const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = <根>/.zcode/skills/h5-app-install → 上跳 3 级到项目根
const ROOT = path.resolve(HERE, '..', '..', '..');
const H5 = path.join(ROOT, 'android_h5');
const ANDROID = path.join(H5, 'android');
const APK = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const PKG = 'com.viaco.toonfighting';
const FWD_HOST = 17073;   // 经 adb forward 的本地口（别用 7073，避免与本机服务冲突）
const MCP_PORT = 7073;

// JDK 21：PATH 里的 java 1.8 编不过 AGP 8.7.2
const JAVA_HOME = process.env.JAVA_H5_JDK
  || 'D:\\Users\\viaco\\.jdks\\jdk-21.0.10+7';
const javaBin = path.join(JAVA_HOME, 'bin', 'java.exe');
if (!fs.existsSync(javaBin)) {
  fail('找不到 JDK 21：' + JAVA_HOME + '\n  装 JDK 21 后可用环境变量 JAVA_H5_JDK 指定。');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error('\n✗ 部署中止：' + msg);
  process.exit(1);
}

function run(cmd, cmdArgs, cwd, label, { shell = process.platform === 'win32' } = {}) {
  const t0 = Date.now();
  console.log('· ' + (label || cmd) + ' …');
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, JAVA_HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell,
    windowsHide: true,
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status !== 0 || r.error) {
    if (r.error) console.error('spawn error: ' + (r.error.stack || r.error));
    console.error(out.split('\n').slice(-25).join('\n'));
    fail((label || cmd) + ' 退出码 ' + r.status);
  }
  console.log('  ✓ ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  return out;
}

function adb(cmdArgs, { allowFail = false } = {}) {
  const a = opt.device ? ['-s', opt.device, ...cmdArgs] : cmdArgs;
  const r = spawnSync('adb', a, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) {
    fail('adb ' + cmdArgs.join(' ') + ' 失败：' + ((r.stderr || r.stdout || '').trim().slice(0, 300)));
  }
  return ((r.stdout || '') + '') .trim();
}

async function waitDevice() {
  // 最多等 90s —— USB 偶发掉线（deploy.mjs 不处理 MSYS 路径转换，spawn 直调无此问题）
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const out = adb(['devices'], { allowFail: true });
    const lines = out.split('\n').slice(1).filter((l) => /\tdevice$/.test(l.trim()));
    if (lines.length === 1) return lines[0].split('\t')[0];
    if (lines.length > 1 && !opt.device) {
      fail('连了多台设备，用 --device <serial> 指定：\n' + lines.join('\n'));
    }
    if (lines.length === 1) return lines[0].split('\t')[0];
    process.stdout.write('  等待设备…\n');
    await sleep(4000);
  }
  fail('90s 内没有可用设备（adb devices 为空）。检查 USB / 授权弹窗。');
}

// ---------- 主流程 ----------
(async () => {
  const t0 = Date.now();
  const serial = await waitDevice();
  console.log('== 部署 Toon-Fighting 到 ' + serial + ' ==\n');

  if (opt.build) {
    // ① sync.mjs：仓库根 → www/（node 直跑，不经 shell —— .mjs 与 cmd 的
    //    文件关联在部分机器上会把参数吞掉导致 status null）
    run(process.execPath, ['sync.mjs'], H5, '① sync.mjs（仓库根 → www/）', { shell: false });
    // ② cap sync：www/ → assets/public/（★ 漏了 = 手机旧 UI，历史踩过）
    run('npx.cmd', ['cap', 'sync', 'android'], H5, '② cap sync（www → assets/public）★');
    // ③ gradle assembleDebug
    run('gradlew.bat', ['assembleDebug'], ANDROID, '③ gradlew assembleDebug（JDK 21）');
    if (!fs.existsSync(APK)) fail('APK 没生成：' + APK);
  } else {
    if (!fs.existsSync(APK)) fail('--skip-build 但 APK 不存在：' + APK);
    console.log('· 跳过构建，用现有 APK：' + APK);
  }

  // ④ 安装（Failure [-99] 偶发，-t 重试一次）
  console.log('· ④ adb install …');
  let out = adb(['install', '-r', '-t', APK], { allowFail: true });
  if (!/Success/.test(out)) {
    console.log('  首次安装失败（' + out.slice(0, 80) + '），重试一次…');
    await sleep(2000);
    out = adb(['install', '-r', '-t', APK]);
  }
  console.log('  ✓ ' + out.slice(0, 40));

  // ⑤ 重启到新版
  if (opt.launch) {
    adb(['shell', 'am', 'force-stop', PKG], { allowFail: true });
    await sleep(1200);
    adb(['shell', 'am', 'start', '-n', PKG + '/.MainActivity'], { allowFail: true });
    console.log('· ⑤ 已启动 app（引擎加载 wasm 需几秒）');
    await sleep(8000);
  }

  // ⑥ MCP 健康检查（纯原生，不依赖 webview ready）
  if (opt.test) {
    adb(['forward', 'tcp:' + FWD_HOST, 'tcp:' + MCP_PORT], { allowFail: true });
    let health = null;
    for (let i = 0; i < 10; i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + FWD_HOST + '/health', { signal: AbortSignal.timeout(5000) });
        health = await r.json();
        if (health && health.ok) break;
      } catch { /* app 还没起来，重试 */ }
      await sleep(1500);
    }
    if (health && health.ok) {
      console.log('· ⑥ MCP 健康检查 ✓  端口 ' + health.port + ' · 工具 ' + health.tools + ' 个 · 已装资产集 ' + health.packs);
    } else {
      console.log('· ⑥ MCP 健康检查 ✗（/health 不可达）—— app 可能没起或端口被改，先看设置 → MCP 服务');
      process.exitCode = 2;
    }
  }

  console.log('\n== 部署完成，总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's ==');
  console.log('MCP 地址（同一 WiFi 下的 agent 用）：http://<手机IP>:' + MCP_PORT + '/mcp');
  console.log('调试通道：adb forward tcp:' + FWD_HOST + ' tcp:' + MCP_PORT + ' → http://127.0.0.1:' + FWD_HOST + '/mcp');
})().catch((e) => fail(e && e.stack || String(e)));
