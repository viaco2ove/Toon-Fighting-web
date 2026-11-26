// 把站点文件同步进 Capacitor 的 webDir（www/），再由 npx cap sync 打进 APK。
// APK 是本地私有安装，不是公开分发，所以 ikemen-fs 全量（含 chars/stages）都打包进去。
// 用法：node sync.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));       // android_h5/
const root = path.resolve(here, '..');                            // 项目根
const www = path.join(here, 'www');

// 站点必需文件（仓库根）。ff-decode.js 是浏览器端 SFF/AIR 解码器（选人屏
// 实体头像/立绘/站立动画的离线兜底），漏掉它手机上就只剩文字占位头像。
const rootFiles = ['index.html', 'vfs.js', 'ff-decode.js', 'wasm_exec.js', 'ikemen.wasm'];
// ikemen-fs 内排除的目录/文件（不需要进 APK 的开发产物）
const vfsExclude = new Set(['.bak']);

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

let n = 0, bytes = 0;
function copy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (vfsExclude.has(name)) continue;
      if (name.endsWith('.bak') || name.includes('.bak.')) continue;
      copy(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
    n++; bytes += st.size;
  }
}

for (const f of rootFiles) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.error('缺少 ' + f + ' —— 在项目根找不到，先补齐再同步'); process.exit(1); }
  copy(src, path.join(www, f));
}
copy(path.join(root, 'ikemen-fs'), path.join(www, 'ikemen-fs'));

console.log(`sync 完成: ${n} 个文件, ${(bytes / 1048576).toFixed(1)} MB → www/`);
