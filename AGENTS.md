# AGENTS.md

## 仓库定位

这是 `Ember-Dawn/marktext` 的个人定制 fork。当前主要开发分支为 `main`，基线版本为 **MarkText v0.19.1**。

本仓库的目标不是追随 upstream `develop` 的最新代码，而是在 v0.19.1 的稳定、流畅基础上进行少量、可维护的定制。

## AI 开始工作前的阅读顺序

处理本仓库任务时，优先阅读：

1. `docs/custom/项目自定义修改总览.md`
2. 与当前任务直接相关的 `docs/custom/*实现记录.md`
3. 涉及文件保存、外部文件变更或 watcher 时，阅读 `docs/custom/文件保存与Watcher自触发问题说明.md`
4. 涉及 Windows 本地构建、打包或安装包时，再阅读 `docs/custom/Windows_x64本地编译指南.md`

不要仅根据 upstream 最新分支推测本仓库结构；应以当前 `main` 的实际代码为准。

## 当前核心约束

- 当前基线：MarkText `v0.19.1`
- 默认/主要分支：`main`
- 主要目标平台：Windows 11 x64
- 包管理器：pnpm 10+
- Node.js：>= 20.19.0
- 性能优先于非必要重构
- 优先最小范围修改现有源码
- 不应为了新增功能大规模重写 upstream 代码
- 现有左侧 Files / Search / TOC 功能必须保持原样，除非任务明确要求修改
- 自定义右侧 TOC 已实现，后续修改时必须特别注意标签切换与大文档性能
- Windows 安装包已定制 Markdown 文件与文件夹本身的 `Open with MarkText` 右键菜单；不要误删对应 NSIS 注册/卸载逻辑
- 修改文件保存 / watcher 逻辑时，必须明确区分 MarkText 自身保存与真实外部修改；不能通过“保存后若干秒内无条件忽略文件变化”来规避提示
- Windows 文件路径比较不要依赖原始字符串 `===`；应使用项目已有的路径等价判断，或先进行一致的路径规范化
- 不要假设“一次保存只产生一个 filesystem change”；Windows、OneDrive 等环境可能对同一次物理保存产生多个 watcher 事件
- 当前 self-save 抑制以“短时有效的保存内容 fingerprint”为依据；只有磁盘内容仍与 MarkText 刚保存的内容一致时才忽略，内容不同必须继续作为真实外部修改处理
- 修改 watcher 后至少回归测试：普通 Ctrl+S、OneDrive/云盘文件、Save As 同一路径、保存失败，以及 VS Code / Notepad 等外部编辑器修改
- Windows DEV 调试时不要依赖 `Ctrl+Shift+I` 打开 DevTools；当前环境该快捷键不可用。需要观察 renderer 内部状态时，应临时通过 IPC 将诊断信息转发到 main process，并直接输出到运行 `pnpm run dev` 的 PowerShell 终端；问题确认后应删除临时诊断桥接和日志

## 当前主要自定义功能

### 右侧 TOC

已实现独立右侧 TOC，保留原生左侧 TOC，并支持：

- 右上角标题栏按钮切换
- 左右 TOC 同时显示
- 独立宽度
- 左边缘拖拽
- 显示状态与宽度持久化
- 复用原生 TOC 数据与组件
- 关闭时通过条件挂载避免额外 TOC 渲染开销

详细设计见：

`docs/custom/右侧TOC实现记录.md`

### Windows 右键菜单

Windows NSIS 安装包已新增：

- Markdown 文件右键 `Open with MarkText`
- 文件夹本身右键 `Open with MarkText`
- 不注册文件夹空白处菜单
- 与“是否将 Markdown 默认关联到 MarkText”的安装选项相互独立
- 卸载时自动清理本功能创建的注册表项

详细设计见：

`docs/custom/Windows右键菜单实现记录.md`

### 文件保存与 Watcher 自触发修复

已针对 Windows / OneDrive 场景修复 MarkText 自己保存文件后又被 watcher 误判为“外部修改”的问题。

后续维护时应保留两个目标：

- MarkText 自身 Ctrl+S / Save As 引发的重复 watcher 事件不应弹出 Reload 提示；
- VS Code、Notepad、云端同步冲突等导致磁盘内容真正变化时，仍必须保留外部修改检测与 Reload 提示。

详细排查、诊断证据、最终方案和回归测试见：

`docs/custom/文件保存与Watcher自触发问题说明.md`

## 构建约定

Windows x64 安装包默认采用已经实际验证过的“两阶段构建”方式，而不是优先运行 `pnpm run build:win:x64`。

详细命令、原因和故障处理见：

`docs/custom/Windows_x64本地编译指南.md`

## 修改记录要求

新增较重要的定制功能时：

1. 在 `docs/custom/` 下新增对应实现记录；
2. 更新 `docs/custom/项目自定义修改总览.md`；
3. 如果改变构建流程，同步更新 `docs/custom/Windows_x64本地编译指南.md`；
4. 如果改变了 AI 必须首先知道的仓库级规则，再更新本文件。
