package com.viaco.toonfighting.mcp;

/**
 * MCP 工具目录 —— **由 .cache/scripts/gen-mcp-tools-java.mjs 从
 * server/lib/mcp-tools.cjs 自动生成，不要手改**。
 *
 * <p>唯一事实源在 PC 侧（server/lib/mcp-tools.cjs），两端工具必须同名同参。
 * 改工具定义 → 改那份文件 → 重跑生成脚本 → 两端同步。
 *
 * <p>校验（生成物是否过期）：
 * <pre>node .cache/scripts/gen-mcp-tools-java.mjs --check</pre>
 */
public final class McpTools {

    /** MCP 协议版本。 */
    public static final String PROTOCOL_VERSION = "2024-11-05";

    /** 一个工具的定义。 */
    public static final class Tool {
        public final String name;
        public final String title;
        public final String description;
        public final String inputSchemaJson;

        Tool(String name, String title, String description, String inputSchemaJson) {
            this.name = name;
            this.title = title;
            this.description = description;
            this.inputSchemaJson = inputSchemaJson;
        }
    }

    /** 全部工具（顺序与 PC 侧一致）。 */
    public static final Tool[] ALL = {
        new Tool(
            "list_asset_packs",
            "列出资产集",
            "列出当前可用的资产集（pack）。返回每个资产集的 id、目录名、显示名与它自带的角色数量。",
            "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"
        ),
        new Tool(
            "get_asset_pack",
            "查看资产集详情",
            "查看某个资产集的详情：角色名单、角色元信息（职业/角色类型/关键帧模式）、故事与映射关系。",
            "{\"type\":\"object\",\"properties\":{\"packId\":{\"type\":\"string\",\"description\":\"资产集 id（list_asset_packs 返回的 id）\"}},\"required\":[\"packId\"],\"additionalProperties\":false}"
        ),
        new Tool(
            "select_asset_pack",
            "切换当前资产集",
            "把游戏切换到指定的资产集（挂载该资产集的资源并替换角色名单）。切到不存在的资产集会报错。",
            "{\"type\":\"object\",\"properties\":{\"packId\":{\"type\":\"string\",\"description\":\"资产集 id\"}},\"required\":[\"packId\"],\"additionalProperties\":false}"
        ),
        new Tool(
            "get_current_asset_pack",
            "查看当前资产集",
            "查看游戏当前正在使用的资产集、已挂载的角色名单，以及是否已绑定到某个故事会话。",
            "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"
        ),
        new Tool(
            "list_installed_packs",
            "列出已安装的资产集",
            "列出这台设备上已安装的资产集（独立安装的地图集数据，不在 APK 里）。返回每个资产集的 id、名称与它自带的角色数量。",
            "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"
        ),
        new Tool(
            "install_asset_pack",
            "安装资产集",
            "把一个资产集安装到这台设备上（解压 zip 或复制目录到应用的资产集仓库）。安装后可用 select_asset_pack 切换过去。",
            "{\"type\":\"object\",\"properties\":{\"source\":{\"type\":\"string\",\"description\":\"资产集 zip 或目录的绝对路径\"},\"packId\":{\"type\":\"string\",\"description\":\"资产集 id（可省略 = 用文件/目录名）\"}},\"required\":[\"source\"],\"additionalProperties\":false}"
        ),
        new Tool(
            "uninstall_asset_pack",
            "卸载资产集",
            "从这台设备上卸载一个资产集（删除它的文件与登记信息）。",
            "{\"type\":\"object\",\"properties\":{\"packId\":{\"type\":\"string\",\"description\":\"资产集 id\"}},\"required\":[\"packId\"],\"additionalProperties\":false}"
        ),
        new Tool(
            "list_story_sessions",
            "列出故事会话",
            "列出后端可用的故事会话（每个会话对应一个故事/世界），含会话 id、标题、worldId。",
            "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"
        ),
        new Tool(
            "get_story_session",
            "查看故事会话详情",
            "查看某个故事会话的角色名单（姓名/角色类型/职业）、故事简介，以及该会话当前绑定的资产集。",
            "{\"type\":\"object\",\"properties\":{\"sessionId\":{\"type\":\"string\",\"description\":\"会话 id\"}},\"required\":[\"sessionId\"],\"additionalProperties\":false}"
        ),
        new Tool(
            "bind_story_session",
            "绑定故事会话",
            "选中一个故事会话作为当前故事，并把指定资产集绑定到该会话（写会话的 tf_fight_bind）。不传 packId 则沿用当前资产集。",
            "{\"type\":\"object\",\"properties\":{\"sessionId\":{\"type\":\"string\",\"description\":\"会话 id\"},\"packId\":{\"type\":\"string\",\"description\":\"要绑定的资产集 id（可省略 = 沿用当前）\"}},\"required\":[\"sessionId\"],\"additionalProperties\":false}"
        ),
        new Tool(
            "get_current_story",
            "查看当前故事",
            "查看游戏当前绑定的故事会话、故事名、角色名单与资产集绑定状态。",
            "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"
        ),
        new Tool(
            "get_config",
            "读取配置",
            "读取 MCP 服务的当前配置：是否启用、监听端口、后端服务地址、登录状态、绑定的资产集与故事。",
            "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}"
        ),
        new Tool(
            "set_config",
            "修改配置",
            "修改 MCP 配置。可改：enabled(启停服务)、port(端口 1~65535)、backendUrl(后端服务地址)、login(账号登录 user/password)。改动会持久化。",
            "{\"type\":\"object\",\"properties\":{\"enabled\":{\"type\":\"boolean\",\"description\":\"是否启用 MCP 服务\"},\"port\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":65535,\"description\":\"MCP 监听端口\"},\"backendUrl\":{\"type\":\"string\",\"description\":\"后端服务地址，例如 http://192.168.1.10:60002/\"},\"login\":{\"type\":\"object\",\"description\":\"账号登录（留空字段表示不改）\",\"properties\":{\"user\":{\"type\":\"string\",\"description\":\"用户名\"},\"password\":{\"type\":\"string\",\"description\":\"密码\"}},\"additionalProperties\":false}},\"additionalProperties\":false}"
        ),
    };

    /** 按名字找工具，找不到返回 null。 */
    public static Tool byName(String name) {
        if (name == null) return null;
        for (Tool t : ALL) {
            if (t.name.equals(name)) return t;
        }
        return null;
    }

    private McpTools() {}
}
