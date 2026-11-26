// MCP 工具定义 —— **PC(Node) 与 Android(原生) 两端共用的唯一事实源**。
//
// 为什么单独抽一份：
//   MCP 跑在手机里（原生服务），但 PC 上的 serve.cjs 也想提供同构能力。
//   两套实现若各写一份工具列表，迟早会漂移（名字、参数、返回结构不一致）。
//   所以：工具的**名字 / 参数 / 描述 / 返回结构**定义在这里（纯数据），
//   两端各自只写「怎么执行」。
//
// 这份文件必须是 **纯数据 + 无依赖**（不 require 任何东西），
// 因为 Android 端要把它转成 Java 常量/资源，不能有 Node 依赖。
//
// 传输：MCP 的 JSON-RPC 2.0 over HTTP（POST，JSON-RPC 消息体）。
//   - POST /mcp            → JSON-RPC 单条请求
//   - POST /mcp            → JSON-RPC 批量（数组）
//   - GET  /mcp            → SSE 流（本实现不推事件，返回 405）
//   - DELETE /mcp/session  → 结束会话（本实现无状态，返回 204）

'use strict';

// ---------------------------------------------------------------- 工具目录
// 每个工具：{ name, title, description, inputSchema }
// inputSchema 用 JSON Schema（draft-07 子集），与 MCP 规范一致。
const TOOLS = [
  // ---------------- 资产集 ----------------
  {
    name: 'list_asset_packs',
    title: '列出资产集',
    description: '列出当前可用的资产集（pack）。返回每个资产集的 id、目录名、显示名与它自带的角色数量。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_asset_pack',
    title: '查看资产集详情',
    description: '查看某个资产集的详情：角色名单、角色元信息（职业/角色类型/关键帧模式）、故事与映射关系。',
    inputSchema: {
      type: 'object',
      properties: {
        packId: { type: 'string', description: '资产集 id（list_asset_packs 返回的 id）' },
      },
      required: ['packId'],
      additionalProperties: false,
    },
  },
  {
    name: 'select_asset_pack',
    title: '切换当前资产集',
    description: '把游戏切换到指定的资产集（挂载该资产集的资源并替换角色名单）。切到不存在的资产集会报错。',
    inputSchema: {
      type: 'object',
      properties: {
        packId: { type: 'string', description: '资产集 id' },
      },
      required: ['packId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_current_asset_pack',
    title: '查看当前资产集',
    description: '查看游戏当前正在使用的资产集、已挂载的角色名单，以及是否已绑定到某个故事会话。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_installed_packs',
    title: '列出已安装的资产集',
    description: '列出这台设备上已安装的资产集（独立安装的地图集数据，不在 APK 里）。返回每个资产集的 id、名称与它自带的角色数量。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'install_asset_pack',
    title: '安装资产集',
    description: '把一个资产集安装到这台设备上（解压 zip 或复制目录到应用的资产集仓库）。安装后可用 select_asset_pack 切换过去。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '资产集 zip 或目录的绝对路径' },
        packId: { type: 'string', description: '资产集 id（可省略 = 用文件/目录名）' },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'uninstall_asset_pack',
    title: '卸载资产集',
    description: '从这台设备上卸载一个资产集（删除它的文件与登记信息）。',
    inputSchema: {
      type: 'object',
      properties: {
        packId: { type: 'string', description: '资产集 id' },
      },
      required: ['packId'],
      additionalProperties: false,
    },
  },

  // ---------------- 故事绑定 ----------------
  {
    name: 'list_story_sessions',
    title: '列出故事会话',
    description: '列出后端可用的故事会话（每个会话对应一个故事/世界），含会话 id、标题、worldId。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_story_session',
    title: '查看故事会话详情',
    description: '查看某个故事会话的角色名单（姓名/角色类型/职业）、故事简介，以及该会话当前绑定的资产集。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 id' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'bind_story_session',
    title: '绑定故事会话',
    description: '选中一个故事会话作为当前故事，并把指定资产集绑定到该会话（写会话的 tf_fight_bind）。不传 packId 则沿用当前资产集。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 id' },
        packId: { type: 'string', description: '要绑定的资产集 id（可省略 = 沿用当前）' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_current_story',
    title: '查看当前故事',
    description: '查看游戏当前绑定的故事会话、故事名、角色名单与资产集绑定状态。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  // ---------------- 配置管理 ----------------
  {
    name: 'get_config',
    title: '读取配置',
    description: '读取 MCP 服务的当前配置：是否启用、监听端口、后端服务地址、登录状态、绑定的资产集与故事。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'set_config',
    title: '修改配置',
    description: '修改 MCP 配置。可改：enabled(启停服务)、port(端口 1~65535)、backendUrl(后端服务地址)、login(账号登录 user/password)。改动会持久化。',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: '是否启用 MCP 服务' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: 'MCP 监听端口' },
        backendUrl: { type: 'string', description: '后端服务地址，例如 http://192.168.1.10:60002/' },
        login: {
          type: 'object',
          description: '账号登录（留空字段表示不改）',
          properties: {
            user: { type: 'string', description: '用户名' },
            password: { type: 'string', description: '密码' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------- 提示词目录
const PROMPTS = [
  {
    name: 'asset_pack_overview',
    description: '生成当前资产集与故事绑定的概览提示词',
    arguments: [],
  },
];

// ---------------------------------------------------------------- 错误码
const ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  // MCP 规范：工具执行失败用 -32000 段
  toolError: -32000,
};

// 协议版本（MCP 2024-11-05 起有 revisions，这里用较通用的版本号）
const PROTOCOL_VERSION = '2024-11-05';

module.exports = { TOOLS, PROMPTS, ERRORS, PROTOCOL_VERSION };
