# 右侧 TOC 实现记录

## 1. 功能目标

在 MarkText v0.19.1 的原生左侧 Sidebar 基础上，增加一个独立的右侧 TOC，同时保持原有 Files / Search / 左侧 TOC 完整可用。

目标布局：

```text
┌──────────────────────────────────────────────────────────────┐
│ filename                                 [TOC] [_] [□] [×] │
├──────────────┬──────────────────────────────┬────────────────┤
│ Left Sidebar │                              │ Right TOC      │
│ Files/Search │       Markdown Editor        │ H1             │
│ / Left TOC   │                              │   H2           │
│              │                              │     H3         │
└──────────────┴──────────────────────────────┴────────────────┘
                                                 ↑ 左边缘拖拽
```

设计原则：

- 不替换左侧 TOC
- 右侧 TOC 是独立附加面板
- 不覆盖编辑器正文，而是正常参与 flex 布局
- 尽量复用 v0.19.1 原生 TOC
- 性能优先，尤其关注文件打开和标签切换
- 尽量保持 upstream 源码最小修改

## 2. v0.19.1 原生结构

主页面：

`packages/desktop/src/renderer/src/pages/app.vue`

原始结构核心为：

```text
.editor-container
├── <side-bar>
└── .editor-middle
    ├── <title-bar>
    └── editor / recent / dialogs...
```

左侧 Sidebar：

`packages/desktop/src/renderer/src/components/sideBar/index.vue`

原生 TOC：

`packages/desktop/src/renderer/src/components/sideBar/toc.vue`

原生 TOC 直接从 editor store 读取 TOC 数据，并由 Element Plus `el-tree` 显示，因此新增右侧 TOC 没有重新解析 Markdown。

## 3. 涉及文件

### 修改

`packages/desktop/src/renderer/src/pages/app.vue`

职责：

- 在原有 `.editor-middle` 之后加入右侧 TOC
- 仅在右侧 TOC 开启时挂载对应组件
- 保持中间编辑区域继续使用 flex 自适应

`packages/desktop/src/renderer/src/components/titleBar/index.vue`

职责：

- 在 Windows 自定义标题栏右侧增加右 TOC 开关
- 按钮位置在窗口控制按钮左侧
- 点击后切换右侧 TOC
- 开启状态提供视觉激活反馈
- 按钮位于 no-drag 可点击区域

### 新增

`packages/desktop/src/renderer/src/components/rightToc/index.vue`

职责：

- 右侧容器
- 复用原生 TOC 组件
- 设置当前宽度
- 处理左边缘拖拽
- 将拖拽结果写入右 TOC store
- 保持与左侧 Sidebar/TOC 相近的主题 DOM 语义

`packages/desktop/src/renderer/src/store/rightToc.ts`

职责：

- 保存右侧 TOC 显示状态
- 保存宽度
- 负责本地持久化
- 与原生 layout store 解耦，减少对 upstream 布局逻辑的侵入

## 4. 右侧 TOC 尺寸

当前约定：

```text
默认宽度：260 px
最小宽度：180 px
最大宽度：500 px
```

拖拽方向：

```text
向左拖动左边缘 → 右侧 TOC 变宽
向右拖动左边缘 → 右侧 TOC 变窄
```

宽度经过上下限约束后持久化。

## 5. 性能优先设计

这是当前实现最重要的设计要求。

### 5.1 关闭时真正卸载

右侧 TOC 关闭时采用条件挂载思路，而不是仅通过 CSS 或 `v-show` 隐藏。

目标行为：

```text
关闭右侧 TOC
→ RightToc 组件不挂载
→ 不存在第二个 Toc 组件
→ 不存在第二棵 el-tree
→ 不保留右侧拖拽相关监听
```

这样在默认关闭状态下，应尽量接近纯净 v0.19.1 的性能基线。

### 5.2 不重新计算 Markdown TOC

右侧面板直接复用：

`packages/desktop/src/renderer/src/components/sideBar/toc.vue`

原生 TOC 本身读取 `editorStore.toc`。

因此设计目标是：

```text
Editor / Muya
      ↓
editorStore.toc
   ↙       ↘
Left TOC   Right TOC
```

而不是右侧再自行解析 Markdown。

### 5.3 拖拽监听只在必要时工作

`mousemove` / `mouseup` 应只在用户实际按下右侧 TOC 左边缘并开始拖动后注册，并在拖拽结束时移除。

不要永久在 document 上运行高频 mousemove 逻辑。

### 5.4 避免把功能强行并入原生 layout store

右侧 TOC 使用独立 store，而不为这一项功能大规模扩充或重构：

`packages/desktop/src/renderer/src/store/layout.ts`

原因：

- 减少与原有 Sidebar 状态的耦合
- 降低未来 upstream 合并时冲突
- 更容易单独禁用、删除或调试
- 降低对现有文件/标签切换路径的影响

## 6. 与左侧 TOC 的关系

左侧 TOC 继续由：

`packages/desktop/src/renderer/src/components/sideBar/index.vue`

按原逻辑控制。

当左侧当前页面不是 TOC 时，原生 `<toc>` 本身不会被挂载。

因此典型状态为：

```text
左侧 Files + 右侧 TOC
→ 只有右侧一棵 TOC tree

左侧 Search + 右侧 TOC
→ 只有右侧一棵 TOC tree

左侧 TOC + 右侧 TOC
→ 两棵 TOC tree 同时存在
```

如果将来出现大文档下“左右 TOC 同时打开”才明显变慢，应优先从第二棵 `el-tree` 的 DOM 和响应式更新成本排查，而不是直接重写 Markdown 解析器。

## 7. Custom CSS / 主题兼容

此前右侧 TOC 初版曾出现过“核心 TOC 样式相同，但右侧外层背景与左侧不一致”的问题。

根因通常是 Custom CSS 使用父级选择器，例如：

```css
.side-bar ...
.side-bar .right-column ...
.side-bar .side-bar-toc ...
```

因此右侧容器应尽量提供与左侧接近的主题宿主语义，使针对 Sidebar/TOC 的已有 Custom CSS 可以自然覆盖右侧。

目标是让左右 TOC 在以下方面保持一致：

- 背景
- 字体
- H1-H6 自定义颜色
- hover
- 缩进
- 行高
- 滚动区域

但不要为了主题一致而复制完整左 Sidebar 功能逻辑。

## 8. 验收方法

修改右侧 TOC 后优先执行：

```powershell
pnpm run dev
```

用同一批 Markdown 文件测试：

1. 右侧 TOC 关闭时连续切换多个标签；
2. 右侧 TOC 开启时连续切换多个标签；
3. 左 Files + 右 TOC；
4. 左 TOC + 右 TOC；
5. 小文档；
6. 标题很多的大文档。

重要验收标准：

> 右侧 TOC 关闭时，不应明显破坏纯净 v0.19.1 已验证过的流畅度。

## 9. 后续修改注意事项

后续维护此功能时，不建议：

- 把右侧 TOC 改为永久挂载后仅隐藏
- 为右 TOC重新解析完整 Markdown
- 增加持续运行的 document 级 mousemove
- 在切换标签时主动重建与 TOC 无关的状态
- 为视觉一致而重写整个 Sidebar
- 在未 profiling 的情况下进行大范围性能重构

若出现性能问题，应先进行开/关右 TOC 的 A/B 测试，再定位瓶颈。
