# Windows 右键菜单实现记录

## 1. 功能目标

在 Windows x64 的 NSIS 安装包中加入独立的：

```text
Open with MarkText
```

右键菜单。

支持两种对象：

1. Markdown 文件；
2. 文件夹本身。

明确不支持：

```text
文件夹内部空白处右键
```

也就是说，不注册 `Directory\Background`。

## 2. 与默认文件关联的关系

MarkText 原安装器已经会询问：

> 是否将 Markdown 文件关联到 MarkText？

本定制功能与这一选项**相互独立**。

即使用户在安装时选择“不把 Markdown 默认关联到 MarkText”，仍然注册：

```text
Open with MarkText
```

因此用户可以保留其他 Markdown 默认编辑器，同时在需要时通过右键显式用 MarkText 打开。

## 3. 涉及源码

修改：

```text
packages/desktop/build/windows/installer.nsh
```

electron-builder 配置位于：

```text
packages/desktop/electron-builder.yml
```

其中：

```text
nsis:
  include: windows/installer.nsh
```

因此无需修改 electron-builder 配置即可让自定义 NSIS macro 参与 setup 构建。

## 4. Markdown 文件右键菜单

当前支持：

```text
.md
.markdown
.mmd
.mdown
.mdtxt
.mdtext
.mdx
```

注册位置采用当前用户：

```text
HKCU\Software\Classes\SystemFileAssociations\<extension>\shell\MarkText
```

采用 `SystemFileAssociations` 的目的，是新增明确的 shell verb，而不是通过右键菜单功能改变默认打开程序。

菜单文字：

```text
Open with MarkText
```

图标：

```text
$INSTDIR\marktext.exe
```

执行命令：

```text
"$INSTDIR\marktext.exe" "%1"
```

## 5. 文件夹本身右键菜单

注册位置：

```text
HKCU\Software\Classes\Directory\shell\MarkText
```

命令同样为：

```text
"$INSTDIR\marktext.exe" "%1"
```

这里的 `%1` 是被右键的文件夹路径。

没有创建：

```text
HKCU\Software\Classes\Directory\Background\...
```

因此不会在文件夹内部空白处增加菜单项。

## 6. 安装时行为

在 `customInstall` 中：

1. 保留 upstream 原有的 Markdown 默认文件关联询问；
2. 不论用户对文件关联选择 Yes 还是 No，都会继续执行右键菜单注册；
3. 写入 Markdown 文件的 context-menu shell verbs；
4. 写入文件夹本身的 shell verb；
5. 调用 `SHChangeNotify(SHCNE_ASSOCCHANGED)` 通知 Explorer shell association 已变化。

## 7. 卸载时行为

在 `customUnInstall` 中：

1. 保留原有 MarkText 文件关联清理；
2. 删除各 Markdown 扩展名下的 `shell\MarkText` 项；
3. 删除 `Directory\shell\MarkText`；
4. 不删除 `SystemFileAssociations` 或 `Directory` 的上层公共键；
5. 通知 Explorer shell association 已变化；
6. 保留原有“是否删除用户设置”的询问。

原则是：

> 只删除本功能明确创建的 MarkText 子项，不破坏其他程序的 context menu 注册。

## 8. Windows 11 显示位置

该方案使用标准注册表 shell verb。

在 Windows 11 中，这类传统 shell verb 通常出现在经典右键菜单，也就是：

```text
右键
→ 显示更多选项
→ Open with MarkText
```

是否直接显示在 Windows 11 新版一级右键菜单由 Explorer 的现代上下文菜单机制决定；本实现没有引入 COM/IExplorerCommand shell extension。

这样做的优点是：

- 实现简单
- 不需要额外 DLL/COM 注册
- 安装/卸载清理直接
- 维护成本低
- 不向 Explorer 进程加载自定义 shell extension

## 9. 测试方法

右键菜单只有安装 setup 后才会注册，`pnpm run dev` 无法验证。

构建：

```powershell
cd E:\github\marktext
pnpm run build

cd .\packages\desktop
npx --yes electron-builder@26.0.3 --win nsis --x64 --publish never
```

安装：

```text
dist\marktext-win-x64-0.19.1-setup.exe
```

测试：

- `.md` 文件右键：应看到 `Open with MarkText`
- `.markdown` 等支持扩展名同理
- 文件夹本身右键：应看到 `Open with MarkText`
- 文件夹内部空白处右键：不应出现本功能菜单
- 安装时即使拒绝默认 Markdown 文件关联，右键菜单仍应存在
- 卸载后上述 MarkText 右键项应消失

## 10. 性能与安全边界

该功能只在安装/卸载时写入或删除注册表，不参与 renderer、编辑器、TOC 或标签切换运行路径。

因此它不应影响：

- Markdown 编辑性能
- 文件打开后的渲染性能
- 标签切换性能
- 右侧 TOC 性能

不要为了让菜单进入 Windows 11 新版一级菜单而默认引入原生 shell-extension DLL；如果未来确实需要，应作为独立功能重新评估复杂度、稳定性和 Explorer 进程内代码风险。
