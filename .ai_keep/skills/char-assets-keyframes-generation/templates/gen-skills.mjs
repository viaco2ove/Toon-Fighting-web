// 泛技能生成（5/6/7 技混合，战斗机制同 v3：melee/proj/dash/retreat）
//   skillCount 来自 personas.json：5/6/7 混合 ——「5 个以上，不能全是 5 个」
//   第 1~5 技：直击(melee)/冲击(proj 穿透)/突进(dash)/撤离(retreat)/风暴(proj 大射程)
//   第 6 技：速弹（proj 非穿透、快弹速、短 CD）；第 7 技：重压（melee 大范围高伤害）
//   全技能属性互不重复；主题名从 personas[name].theme.storm 取（去「风暴」作前缀）
// 跑: node gen-skills.mjs <personas.json> <charsRoot> [--dry]
//     charsRoot = 资产集 chars 目录（内含 <id>/char.json）
import fs from 'node:fs';
import path from 'node:path';

const [personasPath, charsRoot, dryArg] = process.argv.slice(2);
if (!personasPath || !charsRoot) {
  console.error('用法: node gen-skills.mjs <personas.json> <charsRoot> [--dry]');
  process.exit(1);
}
const dry = dryArg === '--dry';
const personas = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
const byId = {}; for (const [name, c] of Object.entries(personas)) byId[c.id] = c;

const ATTR_POOL = ['wood', 'wind', 'water', 'dark', 'light', 'fire', 'poison', 'earth', 'metal', 'thunder'];
const BTN_ORDER = ['y', 'z', 'x', 'c', 'b', 'a'];
const round1 = (v) => Math.round(v * 10) / 10;

function buildSkills(charId, seed) {
  const theme = (byId[charId] && byId[charId].theme) || { storm: '能量风暴', fx: 'wind' };
  const prefix = theme.storm.replace('风暴', '');
  const skillCount = (byId[charId] && byId[charId].skillCount) || 5;
  const used = new Set([theme.fx]);
  const nextAttr = () => {
    for (let i = 0; i < ATTR_POOL.length; i++) {
      const a = ATTR_POOL[(seed * 3 + i * 7 + 1) % ATTR_POOL.length];
      if (!used.has(a)) { used.add(a); return a; }
    }
    return 'normal';
  };
  const rangeM = round1(1.6 + (seed % 8) * 0.1);
  const speed = round1(0.9 + (seed % 5) * 0.15);
  const hits = 2 + (seed % 3);
  const healPct = round1(0.8 + (seed % 9) * 0.1);
  const atkUp = 3 + (seed % 7);
  const durSec = 4 + (seed % 4);
  const dmgPct1 = 8 + (seed % 5);
  const range5 = 4 + (seed % 4);
  const dmgPct5 = 10 + (seed % 5);
  const meleeDmg = 8 + (seed % 5);
  const dashDmg = 4 + (seed % 3);
  const meleeAttr = nextAttr(), projAttr = nextAttr(), dashAttr = nextAttr(), retreatAttr = nextAttr();
  const meleeCmd = BTN_ORDER[seed % BTN_ORDER.length];
  const out = [
    { name: prefix + '直击', desc: `近程攻击：范围${rangeM}米内的对手都扣血，从胸前发出，特效打到哪里就到哪里`,
      cmd: meleeCmd, fx: meleeAttr, cd: 1 + (seed % 2), rarity: 'common',
      atk: { kind: 'melee', rangeM, dmgPct: meleeDmg } },
    { name: prefix + '冲击', desc: `远程攻击：释放${projAttr === 'normal' ? '' : projAttr + '属性'}球体，穿透全场直到出场景边缘才消失，碰到的都扣血`,
      cmd: '~D DF F y', fx: projAttr, cd: 4 + (seed % 3), rarity: 'rare',
      atk: { kind: 'proj', speed, pierce: true, dmgPct: dmgPct1 } },
    { name: prefix + '突进', desc: `冲锋：整个人冲到对手身前，${hits}次连击判定，每击扣${dashDmg}%最大生命`,
      cmd: 'f f', fx: dashAttr, cd: 5 + (seed % 3), rarity: 'rare',
      atk: { kind: 'dash', hits, dmgPct: dashDmg } },
    { name: prefix + '撤离', desc: `撤离：整个人往后撤，回复总量${healPct}%，攻击力+${atkUp}，持续${durSec}秒`,
      cmd: 'b b', fx: retreatAttr, cd: 9 + (seed % 3), rarity: 'epic',
      atk: { kind: 'retreat', healPct, atkUp, durSec } },
    { name: theme.storm, desc: `远程攻击：释放${theme.fx}属性风暴球体，射程${range5}米（${range5}个站位），碰到的都扣血`,
      cmd: '~D DB B x', fx: theme.fx, cd: 6 + (seed % 3), rarity: 'epic',
      atk: { kind: 'proj', speed: round1(speed + 0.2), rangeM: range5, dmgPct: dmgPct5 } },
  ];
  if (skillCount >= 6) {
    const speedAttr = nextAttr();
    out.push({ name: prefix + '速弹', desc: `远程速射：快速射出${speedAttr === 'normal' ? '' : speedAttr + '属性'}弹，射程3米内碰到就扣血，弹速快适合衔接`,
      cmd: 'z', fx: speedAttr, cd: 3, rarity: 'rare',
      atk: { kind: 'proj', speed: round1(1.4 + (seed % 4) * 0.1), rangeM: 3, dmgPct: 6 + (seed % 3) } });
  }
  if (skillCount >= 7) {
    const heavyAttr = nextAttr();
    const range7 = round1(2.6 + (seed % 4) * 0.1), dmg7 = 14 + (seed % 3);
    out.push({ name: prefix + '重压', desc: `近程重击：范围${range7}米内的对手都扣血，一击${dmg7}%最大生命，蓄力长但伤害高`,
      cmd: 'c', fx: heavyAttr, cd: 9, rarity: 'epic',
      atk: { kind: 'melee', rangeM: range7, dmgPct: dmg7 } });
  }
  return out;
}

const report = [];
const dirs = fs.readdirSync(charsRoot).sort().filter((d) => byId[d]);
let n = 0;
for (const d of dirs) {
  const cj = path.join(charsRoot, d, 'char.json');
  if (!fs.existsSync(cj)) { report.push(`${d}: 无 char.json，跳过`); continue; }
  const data = JSON.parse(fs.readFileSync(cj, 'utf8'));
  const skills = buildSkills(d, n++);
  report.push(`${d}(${skills.length}技): ${skills.map((s) => s.name + '[' + s.fx + '/' + s.atk.kind + ']').join(' ')}`);
  if (dry) continue;
  data.genericSkills = skills;
  fs.writeFileSync(cj, JSON.stringify(data, null, 1) + '\n', 'utf8');
}
console.log(report.join('\n'));
console.log(`\n${dry ? '[dry] ' : ''}已处理 ${n} 个角色 → ${charsRoot}/<id>/char.json`);
