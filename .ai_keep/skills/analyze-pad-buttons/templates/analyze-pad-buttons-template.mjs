// 分析资产集里每个角色的六个攻击键（引擎键 a/b/c/x/y/z = 手柄 A/B/C/X/Y/Z）
// 哪些真正被接进状态机：def → [Files] cmd= 指令文件 → [Command] 的按键序列
// → 再扫 cns/st 里 command="名字" 的状态引用。只有「被状态引用的指令」按下去才有反应。
// 用法: node analyze-pad-buttons.mjs "{{charsRoot}}" [charId...]
//       {{charsRoot}} 例：workshops/toon-fighting-web/map_design/<资产集目录>/chars
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const only = process.argv.slice(3);
const BUTTONS = ['a', 'b', 'c', 'x', 'y', 'z'];

function readDef(dir) {
  const defs = fs.readdirSync(dir).filter((f) => /\.def$/i.test(f));
  if (!defs.length) return null;
  // 多 def 包：与目录同名的入口 def 优先（其余是变体/附属 def，可能没挂 cmd）
  const base = path.basename(dir).toLowerCase();
  const defFile = defs.find((f) => f.toLowerCase() === base + '.def')
    || defs.find((f) => f.toLowerCase().includes(base))
    || defs[0];
  const text = fs.readFileSync(path.join(dir, defFile), 'latin1');
  const m = /^\s*cmd\s*=\s*(.+?)\s*(?:;.*)?$/im.exec(text);
  return { defFile, cmdFile: m ? m[1].trim() : null };
}

// [Command] 块：name = "xxx" / command = ~30s,~30s,F,x
function parseCommands(text) {
  const out = [];
  const re = /^\s*name\s*=\s*"?([^"\r\n;]+)"?\s*(?:;.*)?$/im;
  const kre = /^\s*command\s*=\s*(.+?)\s*(?:;.*)?$/im;
  const blocks = text.split(/^\s*\[Command\]\s*$/im).slice(1);
  for (const b of blocks) {
    const nm = re.exec(b);
    const km = kre.exec(b);
    if (!nm || !km) continue;
    const name = nm[1].trim().replace(/^"|"$/g, '');
    // 按键 token：去掉方向(F/B/D/U/DF/DB/UF/UB)、~hold、时间;只留 a/b/c/x/y/z/s
    const tokens = km[1].toLowerCase().split(',').map((t) => t.trim().replace(/^~+/, '').replace(/\d+s$/, '').trim());
    const btns = new Set(tokens.filter((t) => BUTTONS.includes(t)));
    out.push({ name, btns });
  }
  return out;
}

function referencedCommandNames(dir) {
  const used = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(cns|st|zss)$/i.test(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /command\s*=\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(text))) used.add(m[1].trim().toLowerCase());
  }
  return used;
}

const dirs = fs.readdirSync(root).filter((d) => {
  const p = path.join(root, d);
  return fs.statSync(p).isDirectory() && (!only.length || only.includes(d));
});
console.log('角色'.padEnd(16), BUTTONS.map((b) => b.toUpperCase().padEnd(4)).join(''), '指令数/被引用');
for (const d of dirs.sort()) {
  const dir = path.join(root, d);
  let def;
  try { def = readDef(dir); } catch { continue; }
  if (!def || !def.cmdFile) { console.log(d.padEnd(16), '(def 没挂 cmd)'); continue; }
  let cmdText;
  try { cmdText = fs.readFileSync(path.join(dir, def.cmdFile), 'utf8'); } catch { console.log(d.padEnd(16), '(cmd 文件读不到: ' + def.cmdFile + ')'); continue; }
  const cmds = parseCommands(cmdText);
  const used = referencedCommandNames(dir);
  const wired = cmds.filter((c) => used.has(c.name.toLowerCase()));
  const flags = BUTTONS.map((b) => (wired.some((c) => c.btns.has(b)) ? ' ✓  ' : ' ·  ')).join('');
  console.log(d.padEnd(16), flags, `${cmds.length}/${wired.length}`);
  if (only.length) {
    for (const c of wired) console.log('    ', c.name.padEnd(20), [...c.btns].join(','));
  }
}
