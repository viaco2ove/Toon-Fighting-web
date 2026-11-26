# MCP设计
实现mcp 安装资产集和绑定故事的能力。默认mcp 端口是7073。 
mcp 还可以 设置后端url, 账号登录等。
系统设置了可以关闭 mcp 服务。修改mcp 端口。
配置文件：.env 用于给 ai 知道去哪里调用mcp等
关键配置：
android_app_ip=10.10.2.195
android_app_mcp=7073

## 例子
for ai: 用mcp 给手机app 安装资产集和绑定故事,设置后端url, 并且进行账号登录。