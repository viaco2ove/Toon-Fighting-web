# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述
## 常用命令
## 不允许修改的文件

- 含有 `@no_modify` 标记的文件
- `review_xxx.md` 文件（用户验证文件）

# 系统环境配置 
务必查看！！！
[system.yml](system/system.yml)


## output-styles
你的行为要符合设置的output-styles

## 处理问题的方式
- 表查询出错的第一件事应该是去看看这个表的结构
- 看到一个报错或者问题应该去看看根源问题是什么。而不是暴力解决
- 看不到日志不要想当然日志没有开debug, 更不要去掉DebugLogUtil.isDebugLogEnabled() 的判断！！！
## 一个非常重点的事情-ai agent
这个项目实际是更多是个ai agent 项目，所以尽量不要写硬编码。
用ai agent 去实现各种功能！！！！

## 任务状态
[]:未开始 [suc]:已检查没有问题, [skip]:暂时跳过, [wait]:待检查,[ing] 实现中或处理中或修复中
[fail]:检查不通过，[check]:正在检测中

## 不允许随意放置测试和临时文档
测试脚本和文档和临时文档
只允许放置在.cache 文件夹下。
