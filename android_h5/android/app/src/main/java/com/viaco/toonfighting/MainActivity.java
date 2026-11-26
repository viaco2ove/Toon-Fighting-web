package com.viaco.toonfighting;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.viaco.toonfighting.mcp.McpPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册原生 MCP 插件：手机上的 MCP 服务（默认 7073）+ 设置页的 JS 接口
        registerPlugin(McpPlugin.class);
        super.onCreate(savedInstanceState);

        // WebView 被 adjustMarginsForEdgeToEdge=force 四周留出的系统栏/挖孔
        // margins 区域，露出的是 window 背景 —— 默认白色，横屏左侧挖孔处
        // 会是一条大白边。统一涂成页面底色，游戏黑边看起来才自然。
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#07080B"));
        try {
            WebView wv = getBridge().getWebView();
            if (wv != null) wv.setBackgroundColor(Color.parseColor("#07080B"));
        } catch (Exception ignored) { }
    }
}