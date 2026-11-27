// 生成器 THEMES 主题表骨架（配合 .cache/scripts/gen-generic-skills-v2.mjs 的复制改造）。
// 每个 charId 一条：attr=属性特效词汇（游戏端 ATTR_FX 12 词汇内选），
// names=指令模板的主题技能名（key: smash/charge/wave/reflector/dragon/twin），
// singles=单键补位名（a/b/c/x/y/z），moves=零接线角色的移动兜底技名（dash/retreat/jump/guard）。
// 有接线的角色 names/singles 生效；零接线（AI 打法包）只生效 moves。
const THEMES = {
  '{{CHAR_ID}}': {
    attr: '{{ATTR}}',   // 例：light / water / fire / earth / dark …
    names: {
      smash: '{{SMASH_NAME}}',     // 超必杀（双段搓招）
      charge: '{{CHARGE_NAME}}',   // 蓄力（~Ns）
      wave: '{{WAVE_NAME}}',       // 波动（d df f）
      reflector: '{{REFLECT_NAME}}', // 反射（d db b）
      dragon: '{{DRAGON_NAME}}',   // 升龙（f d df）
      twin: '{{TWIN_NAME}}',       // 双键同按
    },
    singles: {
      a: '{{A_NAME}}', b: '{{B_NAME}}', c: '{{C_NAME}}',
      x: '{{X_NAME}}', y: '{{Y_NAME}}', z: '{{Z_NAME}}',
    },
    moves: {
      dash: '{{DASH_NAME}}',     // f f 突进
      retreat: '{{RETREAT_NAME}}', // b b 疾退
      jump: '{{JUMP_NAME}}',     // u f 跳袭
      guard: '{{GUARD_NAME}}',   // d b 蹲防
    },
  },
  // {{MORE_CHARS}}
  // 非故事线引擎角色示例（按角色特质定属性，命名用通用主题即可）：
  // 'K\'': { attr: 'fire', names: {…}, singles: {…}, moves: {…} },
};
const MOVES_FALLBACK = [
  { key: 'dash', cmd: 'f f', cd: 3, defDesc: '向前疾进接近对手（前·前）' },
  { key: 'retreat', cmd: 'b b', cd: 3, defDesc: '向后疾退拉开距离（后·后）' },
  { key: 'jump', cmd: 'u f', cd: 2, defDesc: '向前跳袭抢占空中（上·前）' },
  { key: 'guard', cmd: 'd b', cd: 0, defDesc: '蹲防蓄势稳住防线（下·后按住）' },
];

// 命名自查（写完 THEMES 先跑一遍）：
// 1. 每个角色 4 类都齐了吗？缺 names → 有接线时回落通用名（违和）；缺 moves → 零接线回落「突进」类通用名。
// 2. attr 都在 12 词汇内？属性列 dry run 一眼核对（[normal] 出现在故事角色上 = 主题表漏配）。
// 3. 主题名不要撞技能语义：wave 类名别叫「近身拳」（指令是放飞行道具的）。
