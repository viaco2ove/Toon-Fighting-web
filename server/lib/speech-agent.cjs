// 发言 agent：按角色人设 + 故事世界观生成战斗台词。
//
// 架构（设计文档「发言agent」节）：
//   agent 写在当前项目（提示词、编排、输出校验都在这里），
//   后端只提供大模型通道 —— 走 POST /plugin/agentRun { agentName: "plugin-llm" }，
//   宿主那边是「通用插件 LLM 通道」：给 systemPrompt + userPrompt，返回文本。
//   接口出错 / 超时 → 静默跳过，绝不影响战斗。
//
// 提示词组装参考后端 TaskSpeakerAgent 的口径（人设 / 世界观 / 目标 / 输出格式），
// 但按格斗场景改写：台词要短、要像在打架时喊出来的。
'use strict';

// 战斗台词的 system 提示词（角色人格 + 世界观 + 输出约束）
const SPEECH_SYSTEM = [
  '你是文字冒险《{story}》中正在与对手格斗的角色「{name}」。',
  '',
  '# 人设',
  '{persona}',
  '',
  '# 世界观',
  '{world}',
  '',
  '# 说话方式',
  '- 就是这个角色本人在喊话：符合性格与处境，口语化，有情绪。',
  '- 格斗中的短促台词，不是旁白，不是解说，不解释剧情。',
  '- 不要写动作描写、不要写引号、不要任何前缀标签或元说明。',
  '',
  '# 输出',
  '只输出台词本身，一句话，20 字以内。不要 JSON、不要代码围栏、不要多余解释。',
].join('\n');

// 各种场合的 user 提示词
const PROMPTS = {
  intro: {
    ask: '生死斗即将开始。',
    want: '一句符合人设与世界观的开场白',
    limit: 20,
    extra: '可以是战前叫阵、宣战、或一句立flag。',
  },
  random: {
    ask: '战斗正酣。',
    want: '一句随机喊出的战斗台词',
    limit: 16,
    extra: '要像交手时脱口而出的话，不要完整句子。',
  },
  win: {
    ask: '你刚赢下一场生死斗。',
    want: '一句符合人设的庆祝 / 战后感言',
    limit: 24,
    extra: '可以是对胜利的确认、对敌人的评价，或一句决心。',
  },
  lose: {
    ask: '你刚输掉一场生死斗。',
    want: '一句符合人设的不甘 / 复盘',
    limit: 24,
    extra: '要有情绪，但别写成旁白。',
  },
};

// 构造一次发言请求的入参（BFF 用；systemPrompt + userPrompt 交给后端 plugin-llm）
function buildSpeechRequest({ side, kind, role, storyName, worldText, extraContext }) {
  const persona = buildPersona(role);
  const system = SPEECH_SYSTEM
    .replace('{story}', storyName || '（未命名故事）')
    .replace('{name}', (role && role.name) || '战士')
    .replace('{persona}', persona)
    .replace('{world}', worldText || '（未提供世界观，按角色的处境自由发挥）');

  const p = PROMPTS[kind] || PROMPTS.random;
  const who = side === 'p1' ? '我方' : '对手';
  const user = [
    '【角色】' + (role && role.name || '战士') + '（' + who + '）',
    '【职业】' + ((role && role.profession) || '冒险者'),
    '【当前处境】' + p.ask,
    extraContext ? '【补充上下文】\n' + extraContext : '',
    '',
    '请说一句' + p.want + '，' + p.limit + ' 字以内。' + p.extra,
    '只输出台词本身。',
  ].filter(Boolean).join('\n');

  return {
    agentName: 'plugin-llm',
    aiConfigKey: 'storyMiniGameModel',
    input: { systemPrompt: system, userPrompt: user },
  };
}

// 角色人设：名称 / 职业 / 描述 / 性格标签
function buildPersona(role) {
  if (!role) return '一个在末世里活下来的格斗者，寡言，眼神冷。';
  const parts = [];
  parts.push('名字：' + (role.name || '无名'));
  if (role.profession) parts.push('职业：' + role.profession);
  if (role.description) parts.push('设定：' + role.description);
  if (role.roleType === 'player') parts.push('身份：故事主角');
  if (Array.isArray(role.skills) && role.skills.length) {
    parts.push('擅长：' + role.skills.slice(0, 5)
      .map((s) => (typeof s === 'string' ? s : (s && (s.name || s.title)) || ''))
      .filter(Boolean).join('、'));
  }
  return parts.join('\n') || '一个在末世里活下来的格斗者。';
}

// 清理模型输出：剥围栏 / 引号 / 空白，只留台词本身
function cleanLine(text) {
  let t = String(text || '').trim();
  t = t.replace(/^\s*```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '').trim();
  t = t.replace(/^"([\s\S]*)"$/, '$1').trim();
  t = t.replace(/^["'「『](.*)["'」』]$/, '$1').trim();
  // 去掉「角色名：」这类前缀（模型偶尔会带）
  t = t.replace(/^[^：:]{1,12}[：:]\s*/, '').trim();
  // 折叠空白
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

module.exports = { SPEECH_SYSTEM, PROMPTS, buildSpeechRequest, buildPersona, cleanLine };