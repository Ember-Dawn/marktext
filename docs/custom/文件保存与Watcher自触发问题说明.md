# 文件保存与 Watcher 自触发问题说明

## 1. 文档目的

本文记录 `Ember-Dawn/marktext` 在 MarkText v0.19.1 基线上处理“MarkText 自己保存文件，却被文件 watcher 误判为外部修改”的完整背景、排查过程、踩坑、最终方案与回归测试要求。

这份记录的主要目的不是保留一次性调试流水账，而是让后续维护者或 AI 在再次修改文件保存、外部变更检测、OneDrive/云盘兼容逻辑时，能够直接理解当前设计为什么这样实现，避免重复走已经验证过的错误路线。

当前主要目标平台为 Windows 11 x64。

## 2. 原始问题表现

对一个已经打开的 Markdown 文件进行编辑并按 Ctrl+S 后，MarkText 会间歇性、且有时较频繁地出现：

```text
"<filename>" has been changed on disk. Do you want to reload it?
```

实际文件并没有被用户用其他程序修改；这个提示是 MarkText 自己保存文件后，又被自身 watcher 当成“外部文件变化”触发的。

问题在 OneDrive 目录中尤其容易复现。实际诊断样本来自类似：

```text
E:\OneDrive\...\TRB2027评分角度.md
```

这里的 OneDrive 不是唯一可能触发条件，但同步软件、文件系统 metadata 更新、杀毒/索引程序等都可能让一次物理保存对应多个 filesystem change 事件。

## 3. 相关保存与 watcher 链路

简化后的链路如下：

```text
Ctrl+S
  ↓
renderer: FILE_SAVE()
  ↓
mt::response-file-save
  ↓
main/menu/actions/file.ts
  ↓
writeMarkdownFile(...)
  ↓
磁盘文件发生变化
  ↓
chokidar file watcher
  ↓
filesystem/watcher.ts
  ↓
mt::update-file
  ↓
renderer 认为文件被外部修改
  ↓
changed on disk / Reload 提示
```

正常情况下，MarkText 自己造成的磁盘变化应该被 self-save 机制识别并抑制；真实外部修改则必须继续发送 `mt::update-file`。

因此本问题的关键不是“关闭 watcher”，而是正确区分：

1. MarkText 自己刚刚写出的内容；
2. VS Code、Notepad、云端同步冲突或其他程序真正写入的新内容。

## 4. 旧机制及其薄弱点

旧实现的核心思路是：

> 一次 MarkText 保存，登记一条短时 ignore；随后只忽略下一次符合条件的 file change。

默认时间窗口由以下 watcher 参数派生：

```text
WATCHER_STABILITY_THRESHOLD = 1000 ms
WATCHER_STABILITY_POLL_INTERVAL = 150 ms

旧 ignore duration = 1000 + 150 × 2 = 1300 ms
```

这套机制存在三个主要薄弱点。

### 4.1 Windows 路径使用原始字符串比较

旧逻辑对 pathname 使用直接字符串相等判断。

Windows 下这些字符串可能指向同一个文件：

```text
E:\Documents\a.md
e:\Documents\a.md

E:\Documents\a.md
E:/Documents/a.md
```

因此文件身份判断不能依赖原始 pathname 字符串 `===`。

当前约束是：

- watcher 内对路径进行统一 resolve / normalize；
- Windows 下对规范化路径统一大小写；
- 其他调用路径优先使用项目已有的 `isSamePathSync()` 等路径等价判断。

### 4.2 self-save 登记发生在写入之后

如果先完成 `writeMarkdownFile()`，再告诉 watcher“刚才那次变化是我自己造成的”，理论上存在事件时序竞争。

因此 self-save 状态必须在真正写磁盘之前登记。

如果写入失败，则需要撤销对应 self-save 状态，避免后续真实外部事件被错误抑制。

### 4.3 一次保存只允许忽略一个 event

这是最终通过诊断确认的核心问题。

旧逻辑一旦第一个 watcher event 命中 ignore，就立即删除该 ignore 条目。

也就是说：

```text
一次 Ctrl+S
→ change #1 命中 ignore
→ ignore 被删除
→ change #2 到来
→ 没有 ignore
→ 被当作外部修改
→ Reload 提示
```

这在普通本地文件上可能不明显，但在 OneDrive 等环境中非常容易暴露。

## 5. 第一轮修复及为什么仍然不够

第一轮修复做了三件合理但不足以彻底解决问题的事情：

1. Windows pathname 统一规范化后再比较；
2. self-save ignore 改为写磁盘之前登记；
3. 保存失败时撤销刚登记的 ignore；
4. Save As 到当前同一路径时改用路径等价判断。

这些修改解决了“路径匹配失败”和“登记过晚”的问题，但仍然保留了：

> 一次保存只消费一个 change event

这个旧假设。

DEV 实测随后证明，问题仍会偶发或频繁出现。

## 6. 诊断版与根因证据

为了避免继续靠猜测修改，曾加入仅用于 DEV 的临时诊断日志，统一使用：

```text
[MT-WATCH-DIAG]
```

主要观察：

- `WATCH_CREATED`
- `SAVE_BEGIN`
- `IGNORE_REGISTERED`
- `SAVE_SUCCESS`
- `FILE_EVENT`
- `IGNORE_MATCH`
- `IGNORE_MISS`

实际复现中，单个文件只有一个 watcher：

```text
WATCH_CREATED
watcherId: mt-0
duplicateWatcherIds: []
```

因此本次样本中可以排除“重复 file watcher 导致一份 ignore 被两个 watcher 竞争消费”。

随后一次保存得到的关键顺序为：

```text
SAVE_BEGIN
IGNORE_REGISTERED
SAVE_SUCCESS

FILE_EVENT
IGNORE_MATCH
ageMs ≈ 1080~1090
duration = 1300

FILE_EVENT
IGNORE_MISS
pendingIgnoreCount = 0
```

第二轮保存再次得到同样顺序。

这直接证明：

> 同一次 MarkText Ctrl+S 确实能够产生至少两个 file change，而旧 self-save ignore 在第一个 event 后已经被消费。

因此最终根因被确认，不再需要继续调大 timeout 或猜测重复 watcher。

诊断完成后，临时 `[MT-WATCH-DIAG]` 日志不属于最终功能，最终实现中应保持移除状态，避免污染日常 DEV 终端。

## 7. 为什么不能简单延长 timeout

一个看似简单的处理方式是：

```text
MarkText 保存后 3 秒 / 5 秒内，所有 file change 都忽略
```

这不安全。

例如：

```text
0.0 s  MarkText 保存 ABC
0.8 s  VS Code 真正把文件改成 XYZ
```

如果仅根据“距离 MarkText 保存过去多久”来判断，那么 `XYZ` 也可能被错误吞掉。

这会破坏 MarkText 的真实外部文件变更保护，严重时可能导致用户不知道磁盘版本已经变化。

因此当前设计明确禁止：

> 在固定时间窗口内无条件忽略同一路径的所有变化。

时间窗口只能用于限制 self-save 状态的生命周期，不能替代内容身份判断。

## 8. 最终方案：短时 self-save fingerprint

最终方案把语义从：

```text
self-save = 忽略下一个 event
```

改为：

```text
self-save = 在短时间内，忽略所有“磁盘内容仍然等于 MarkText 刚保存内容”的 event
```

### 8.1 保存时登记内容 fingerprint

在真正调用 `writeMarkdownFile()` 前，主进程把以下信息交给 watcher：

```text
windowId
pathname
markdown
```

watcher：

1. 对 pathname 进行统一规范化；
2. 对 Markdown UTF-8 内容计算 SHA-256；
3. 保存一条短时 `SelfSaveEntry`。

当前实现的 self-save 有效期为：

```text
SELF_SAVE_VALIDITY_MS = 10000
```

即 10 秒。

这 10 秒并不表示“10 秒内所有变化都忽略”。

### 8.2 watcher 收到 change 时按内容判断

file watcher 收到 `change` 后，本来就需要通过 `loadMarkdownFile()` 加载当前 Markdown。

因此最终实现直接利用已经读到的 `data.markdown` 计算 fingerprint，不额外再读取一次文件。

判断逻辑：

```text
找到相同 windowId + pathname 的未过期 self-save 记录
  ↓
当前磁盘 Markdown fingerprint == 刚保存 fingerprint
  ↓
是同一次 self-save / 云盘重复事件
  ↓
忽略
```

而且该 self-save 记录不会在第一个匹配 event 后删除，而是保留到过期，因此：

```text
change #1 → 内容相同 → 忽略
change #2 → 内容相同 → 继续忽略
change #3 → 内容相同 → 继续忽略
```

这正好覆盖 OneDrive 等环境中同一次物理保存引出的重复事件。

### 8.3 内容一旦不同，立即恢复外部修改语义

如果在 self-save 有效期内 watcher 读到：

```text
当前磁盘 fingerprint != MarkText 刚保存 fingerprint
```

则说明磁盘内容已经不再是 MarkText 那次保存的内容。

此时必须：

1. 删除对应 self-save 标记；
2. 不抑制当前 change；
3. 继续发送 `mt::update-file`；
4. 保留原来的 changed on disk / Reload 行为。

因此即使：

```text
0.0 s  MarkText 保存 ABC
1.1 s  OneDrive event → ABC → 忽略
1.4 s  OneDrive event → ABC → 忽略
2.0 s  VS Code 改成 XYZ → XYZ != ABC
```

最后一次仍然会被正确识别为真实外部修改。

## 9. 为什么使用 SHA-256，而不是只看 mtime / size

可选的轻量方案包括：

```text
mtimeMs
size
mtimeMs + size
```

但本问题实际发生在 OneDrive 场景。

云盘、同步程序或文件系统可能再次触碰 metadata，而不同内容也可能碰巧保持相同 size。

因此当前实现选择：

```text
SHA-256(markdown UTF-8 content)
```

优点是判断语义直接：

> 内容完全相同，才认为仍然代表 MarkText 刚保存的版本。

而且 watcher 本来就要读取 Markdown 内容，所以 fingerprint 计算不需要额外增加一次完整磁盘读取。

## 10. 保存失败与 Save As

### 10.1 保存失败

self-save 状态在写入前登记，是为了避免事件竞争。

因此如果 `writeMarkdownFile()` 失败，必须通过对应失败事件撤销：

```text
windowId + pathname + markdown fingerprint
```

这样失败的保存不会留下错误 suppress 状态。

### 10.2 Save As 到当前同一路径

Save As 不能依赖：

```text
pathname === filePath
```

Windows 路径可能存在大小写、分隔符等表现差异。

当前做法是使用项目已有的路径等价判断来确定：

```text
savingExistingPath
```

如果 Save As 实际仍然保存到当前文件，就走与普通保存相同的 self-save fingerprint 逻辑。

如果保存到了新路径，则继续走原来的文件路径切换和 watcher 更新流程。

## 11. 涉及源码

当前最终方案主要涉及：

### `packages/desktop/src/main/filesystem/watcher.ts`

职责：

- Windows watcher pathname 规范化；
- SHA-256 Markdown fingerprint；
- 保存 `SelfSaveEntry`；
- 短时保留 self-save 状态；
- 多次相同内容 change 均可抑制；
- 内容不同立即恢复真实外部修改；
- window 关闭时清理对应 self-save 状态。

### `packages/desktop/src/main/app/windowManager.ts`

职责：

- 接收保存开始 / 保存失败的进程内事件；
- 调用 watcher 的 `rememberSelfSave(...)`；
- 保存失败时调用 `cancelSelfSave(...)`。

### `packages/desktop/src/main/menu/actions/file.ts`

职责：

- 在普通保存写盘前登记 self-save 内容；
- 写盘失败时撤销对应内容；
- Save As 同一路径使用相同机制；
- Windows 下同一路径判断使用路径等价逻辑。

## 12. 已排除或不应优先怀疑的方向

### 12.1 重复 watcher

诊断样本明确得到：

```text
duplicateWatcherIds: []
```

因此该次真实复现不是由重复 file watcher 导致。

未来如果出现不同症状，仍可以重新检查 watcher 数量，但不应把它当作本问题的既定根因。

### 12.2 右侧 TOC

问题链路集中在：

```text
renderer save
→ main save handler
→ filesystem write
→ watcher
→ mt::update-file
```

与右侧 TOC 的组件渲染和状态管理没有直接关系。

### 12.3 单纯 timeout 太短

第一个事件通常已经在保存约 1.08~1.09 秒后出现，接近旧 1.3 秒窗口尾部。

但即使延长窗口，如果仍然“第一个 event 立刻删除 ignore”，第二个 event 仍有机会漏出。

更重要的是，无条件延长抑制时间会增加吞掉真实外部修改的风险。

### 12.4 终端中的中文路径乱码

诊断时 PowerShell 输出中的中文 pathname 曾显示乱码，但规范化前后的 pathname 仍能成功命中同一文件。

因此这属于终端显示/编码层面的问题，不是本次 watcher 误判的根因。

## 13. 回归测试要求

以后只要修改以下任一部分：

- Ctrl+S
- Auto Save
- Save As
- `writeMarkdownFile`
- `windowManager`
- filesystem watcher
- external file reload

至少执行以下回归测试。

### 13.1 普通 Ctrl+S

1. 打开已有 Markdown；
2. 修改内容；
3. Ctrl+S；
4. 连续修改并保存多次；
5. 确认不会因为 MarkText 自己保存而出现 Reload 提示。

### 13.2 OneDrive / 云盘文件

1. 打开 OneDrive 同步目录中的 Markdown；
2. 连续修改和 Ctrl+S；
3. 保存后等待数秒；
4. 确认云盘产生的重复相同内容事件不会触发 Reload。

### 13.3 真正的外部修改

1. MarkText 打开 Markdown；
2. 用 VS Code / Notepad 修改并保存同一文件；
3. 确认 MarkText 仍然能够检测 changed on disk；
4. 确认外部内容不会被 self-save 状态误吞。

这是最重要的安全回归测试。

### 13.4 Save As 到相同路径

确认：

- Windows 路径表现差异不会误判为新文件；
- 同一路径保存不会触发自 Reload。

### 13.5 Save As 到新路径

确认：

- tab pathname 正确更新；
- 旧 watcher 解除；
- 新 watcher 正确建立；
- 后续普通保存正常。

### 13.6 保存失败

通过只读文件、权限异常或其他安全测试方式模拟保存失败时，确认：

- 显示正常保存失败提示；
- 不留下会抑制后续真实外部修改的 self-save 状态。

## 14. 后续维护原则

后续维护这一链路时，优先遵守以下规则：

1. 不要关闭外部文件 watcher 来解决 self-save 问题；
2. 不要使用“保存后 N 秒全部忽略”的粗粒度策略；
3. 不要假设一次保存只产生一次 watcher event；
4. Windows 路径身份判断不要直接依赖原始字符串；
5. self-save 判定应尽量基于“磁盘内容是否仍等于刚保存内容”；
6. 保存前登记 self-save 时，必须设计保存失败回滚；
7. OneDrive / Dropbox / Syncthing 等同步目录应视为重要兼容场景；
8. 临时诊断日志在确认问题后应删除，不要长期污染正常 DEV 输出；
9. 修复 self-save 的同时，必须保留真实外部修改的 Reload 保护；
10. 任何 watcher 优化都要兼顾性能，避免为每个事件增加不必要的重复磁盘读取或长期后台任务。

## 15. 当前结论

本问题最终不是“路径大小写”单一问题，也不是“ignore timeout 太短”或“重复 watcher”。

实际根因是：

> Windows / OneDrive 环境中，一次 MarkText 保存可以产生多个 file change；旧实现把 self-save 当作一次性 token，第一个 event 消耗 token 后，后续相同保存的 event 被误认为外部修改。

当前通过“规范化路径 + 写入前登记 + Markdown SHA-256 fingerprint + 短时保留 + 内容不同立即恢复外部修改”的组合方式解决。

该方案已经通过实际 DEV 使用验证：普通 Ctrl+S 不再错误弹出 Reload，同时设计上继续保留真实外部修改检测。
