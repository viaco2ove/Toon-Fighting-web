package com.viaco.toonfighting;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.viaco.toonfighting.mcp.McpPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册原生 MCP 插件：手机上的 MCP 服务（默认 7073）+ 设置页的 JS 接口
        registerPlugin(McpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}