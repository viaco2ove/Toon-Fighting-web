// 泛技能属性特效 PC 验证探针模板。
// {{}} 处按资产集替换；需 serve.cjs 在 8105 先起。
// 用法: node {{PROBE_NAME}}.mjs <outDir> <cdpPort>
import { launchEdge, connect, sleep, checker } from './lib/cdp.mjs';
import fs from 'node:fs';

const BASE = 'http://localhost:8105';
// {{THEME_TABLE}}：主验角色与断言参数，按属性各挑一组
//   例：{ char: 'SuWanqingKFM', attr: 'water', color: '#40b8ff', themeGrep: /回溯|急救|病历|手术刀/, variant: null, parts: 9 }
//   暗属性验 v-implo 类名、火属性验 .flash、风属性验 v-streak……至少覆盖三种形态
const CASES = [
  { char: '{{CHAR_MAIN}}', attr: '{{ATTR}}', color: '{{COLOR}}', themeGrep: {{THEME_GREP}}, variant: null, parts: {{PARTS_MIN}} },
  { char: '{{CHAR_VARIANT2}}', attr: '{{ATTR2}}', color: '{{COLOR2}}', themeGrep: {{THEME_GREP2}}, variant: '{{VARIANT2}}', flash: {{FLASH2}} },
  { char: '{{CHAR_ZERO_WIRED}}', attr: '{{ATTR_ZW}}', color: '{{COLOR_ZW}}', themeGrep: {{MOVE_GREP}}, variant: null }, // 零接线→移动兜底技
];

const outDir = process.argv[2] || '.cache/shots-{{PROBE_NAME}}';
const port = Number(process.argv[3] || {{CDP_PORT}});
fs.mkdirSync(outDir, { recursive: true });

const edge = await launchEdge({ cdpPort: port, profileDir: '.cache/edge-{{PROBE_NAME}}-' + port, headless: true, url: 'about:blank' });
await sleep(800);
const s = await connect(port);
const c = checker('{{PROBE_NAME}}');

// 数据链：charMeta 经 /api/assetpacks 到达且 fx=属性（渲染断言失败时先看这里）
const meta = await s.eval(`fetch('api/assetpacks').then(r => r.json()).then(ap =>
  (ap.charMeta || {})['${CASES[0].char}'] && (ap.charMeta || {})['${CASES[0].char}'].genericSkills.map(g => g.name + ':' + g.fx))`);
c.ok(Array.isArray(meta) && meta.every(x => x.endsWith(':' + CASES[0].attr)), 'charMeta 数据链（' + meta.join(',') + '）');

for (const cs of CASES) {
  await s.eval(`location.href = '${BASE}/index.html?auto=1&p1=${cs.char}&p2={{P2_CHAR}}&ai=1'`);
  await sleep(2500);
  let btns = [];
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    btns = await s.eval(`(() => {
      const bs = [...document.querySelectorAll('#skills button[data-sname]')];
      return bs.map(b => ({ name: b.dataset.sname, color: b.style.getPropertyValue('--fxc') }));
    })()`);
    if (btns.length >= 3) break;
  }
  c.ok(btns.length >= 3, cs.char + ' 技能条出钮（' + btns.map(b => b.name).join('/') + '）');
  c.ok(btns.some(b => cs.themeGrep.test(b.name)), cs.char + ' 主题/兜底技能名命中');
  c.ok(btns.every(b => b.color === cs.color), cs.char + ' 按钮属性色 ' + cs.color);

  await s.eval(`[...document.querySelectorAll('#skills button[data-sname]')][0].click()`);
  await sleep(280);
  const fx = await s.eval(`(() => {
    const pop = document.querySelector('.skillpop');
    const sk = document.querySelector('#skfx .sk');
    return {
      popClass: pop ? pop.className : null,
      popColor: pop ? getComputedStyle(pop.querySelector('b')).color : null,
      ring: !!(sk && sk.querySelector('.ring')),
      flash: !!(sk && sk.querySelector('.flash')),
      parts: sk ? sk.querySelectorAll('.p').length : 0,
      variant: sk ? sk.className : null,
      anchor: sk ? { x: Math.round(parseFloat(sk.style.left)), y: Math.round(parseFloat(sk.style.top)) } : null,
    };
  })()`);
  c.ok(new RegExp('fx-' + cs.attr).test(fx.popClass || ''), cs.char + ' 浮字 fx-' + cs.attr);
  c.ok(fx.popColor && cs.color.startsWith('#') &&
    fx.popColor === 'rgb(' + parseInt(cs.color.slice(1, 3), 16) + ', ' + parseInt(cs.color.slice(3, 5), 16) + ', ' + parseInt(cs.color.slice(5, 7), 16) + ')',
    cs.char + ' 浮字 computed color（实际 ' + fx.popColor + '）');
  c.ok(fx.ring && fx.parts >= (cs.parts || 7), cs.char + ' 环+' + fx.parts + ' 粒子');
  if (cs.variant) c.ok(new RegExp(cs.variant).test(fx.variant || ''), cs.char + ' 爆发形态 ' + cs.variant);
  if (cs.flash !== undefined) c.ok(fx.flash === !!cs.flash, cs.char + ' flash 元素=' + fx.flash);
  await s.shot(outDir + '/fx-' + cs.attr + '-' + cs.char + '.png');

  await sleep(1100);
  c.ok(await s.eval(`!document.getElementById('skfx')`), cs.char + ' 爆发层自清');
}

const fails = c.done();
s.close();
try { const { killEdge } = await import('./lib/cdp.mjs'); killEdge(edge, '.cache/edge-{{PROBE_NAME}}-' + port); } catch (e) {}
process.exit(fails ? 1 : 0);
