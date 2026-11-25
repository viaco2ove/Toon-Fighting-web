# 白模包入库与验证核对清单

> 逐项打勾，全部通过才算完成。任何一项不过 → 回到 SKILL.md 对应 Step。

## 1. 源包核实（Step 1）

- [ ] `python ff-studio/sff.py <src>.sff info` 输出精灵数/组数，确认为 **SFF v1**（verhi=1）
- [ ] def `[Files]` 引用的每个文件都在源包目录里
- [ ] 记下 `stcommon` 指向（包内文件 or `common1.cns` → 引擎 fallback `data/common1.cns.zss`）
- [ ] 记下各 cns 的 Statedef 编号，确认无跨文件冲突
- [ ] 确认源包 AI 形态：有无 `var(59) = 1` AI Start 段（决定是否跑 patch-char-ai.mjs）

## 2. ps 字节实测（Step 2，不许跳过）

- [ ] `python whitemold.py probe <src.sff>` 输出 ps 直方图
- [ ] `ps==0 且块尾-769=0x0C` 的数量 == ps==0 总数（规则成立）
- [ ] 记录 `ps!=0 假阳性` 数量（这些块尾恰是 0x0C 的 RLE 数据，**绝不能按块尾盲改**）

## 3. 转换与结构验证（Step 3-4）

- [ ] `pack` 产物落盘：def / st×N / air / cmd / sff / snd / act×N 全齐
- [ ] 逐精灵对比脚本：**像素有差异的精灵数 = 0**
- [ ] 精灵数 / 组数 / 组键 / 组帧数与源完全一致
- [ ] def 里 `cns=` 与 `st=` 的文件都存在（含 `stcommon=common1.cns` 时的 fallback 说明写进 README）

## 4. 渲染核对（Step 5）

- [ ] PIL 渲染代表帧（0,0 / 20,0 / 300,0…）：肉眼确认灰白人台、明暗层次保留
- [ ] 项目解码器饱和度统计：白模帧 **灰占比 = 1.000**；彩色对照角色 < 0.3
- [ ] 若出现彩色残留 → 检查是否漏改 sff 内嵌调色板或某套 act（机制见 SKILL.md Notes 2）

## 5. 入库（Step 6）

- [ ] 引擎侧旧包（如有）已备份到 `.cache/<id>-vXX-backup/`
- [ ] 资产集 `map_design/<故事>/chars/<id>/` 与引擎 `ikemen-fs/file/chars/<id>/` 内容一致
- [ ] 引擎侧已有的 `avatar/` 素材保留未动
- [ ] `select.def` 两侧都注册了 `<id>/<id>.def`，且**两侧文件逐字节一致**
- [ ] `node .cache/scripts/rebuild-manifest.mjs`（stamp 递增）
- [ ] `node .cache/scripts/sync-pack-manifest.mjs` 后「大小不一致」条目 = 0
      （不一致的以引擎侧为准拷回资产集）
- [ ] README.md 写明：底座来源与原作者、授权口径（仅私有侧载）、白模化改了什么、
      AI 说明、下一轮路线；原作者说明保留为 README-upstream.txt
- [ ] 若源包有 `var(59)=1` AI 段 → 跑 `node .cache/scripts/patch-char-ai.mjs`

## 6. 引擎实测（Step 7）

- [ ] `?auto=1&p1=<id>&p2=<彩色对照>&ai=4` 起帧 > 200
- [ ] console 无 `missing sprite`、无 cns 编译错误（引擎的
      "Executable not implemented for js" 是无害噪音）
- [ ] facebar / HUD 出现该角色 id
- [ ] 全程无 JS 异常
- [ ] 对局截图目检：灰白人台形态正常、与彩色对照同框对比明显
- [ ] （该包后续要绑故事角色时）mapping.json charPool / roster.json profession 同步
