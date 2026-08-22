# Windows x64 本地编译指南

## 1. 适用范围

本指南适用于当前 fork：

- 仓库：`Ember-Dawn/marktext`
- 主要分支：`main`
- 基线：MarkText `v0.19.1`
- 目标系统：Windows 11 x64
- 目标产物：Windows x64 NSIS 安装 EXE

当前根项目要求：

```text
Node.js >= 20.19.0
pnpm >= 10
```

仓库声明的 package manager 为：

```text
pnpm@10.33.4
```

## 2. 首次 clone 后安装依赖

进入仓库：

```powershell
cd E:\github\marktext
```

确认环境：

```powershell
node -v
pnpm -v
```

安装依赖：

```powershell
pnpm install
```

日常开发运行：

```powershell
pnpm run dev
```

## 3. 当前首选：两阶段 Windows x64 打包

本 fork 当前**优先使用两阶段构建**，因为完整的项目 Windows 打包脚本曾在 electron-builder 扫描 node modules 阶段长时间卡住。

### 第一阶段：构建 Electron/Vite 应用

在仓库根目录：

```powershell
cd E:\github\marktext
pnpm run build
```

这一步调用项目自身的 desktop build，生成打包所需的应用构建产物。

确认该步骤成功后再进入第二阶段。

### 第二阶段：只生成 Windows x64 NSIS 安装包

```powershell
cd E:\github\marktext\packages\desktop
npx --yes electron-builder@26.0.3 --win nsis --x64 --publish never
```

这里固定使用已经实际验证可完成打包的：

```text
electron-builder 26.0.3
```

只指定：

```text
--win nsis --x64
```

因此目标是 Windows x64 安装 EXE，不额外生成 ARM64、macOS、Linux，也不主动生成 ZIP target。

## 4. 推荐的一整套日常命令

代码修改完成并通过 `pnpm run dev` 测试后：

```powershell
cd E:\github\marktext

pnpm run build

cd .\packages\desktop

npx --yes electron-builder@26.0.3 --win nsis --x64 --publish never
```

## 5. 安装包位置

正常完成后，在仓库根目录：

```text
E:\github\marktext\dist\
```

查找安装包。

当前版本通常类似：

```text
marktext-win-x64-0.19.1-setup.exe
```

实际文件名应以 `dist` 中生成结果为准。

## 6. 为什么不优先使用 `pnpm run build:win:x64`

v0.19.1 的 desktop package 自带：

```text
build:win:x64
```

其逻辑包含：

```text
minify locales
→ electron-rebuild
→ electron-vite build
→ electron-builder --win --x64
```

它仍然是项目的标准入口，但在本机实际使用过程中，较新的 electron-builder 曾长时间停留在类似：

```text
searching for node modules
```

的依赖扫描阶段。

因此本 fork 的本地实践优先采用：

```text
pnpm run build
+
electron-builder@26.0.3 单独打 NSIS x64
```

如果未来项目依赖或 electron-builder 行为发生变化，可以重新测试标准入口；在确认稳定前，不应自动把它改回首选流程。

## 7. 已知不推荐方案

### electron-builder 24.13.3

曾经能够较快完成打包，但生成应用运行后出现依赖缺失，例如：

```text
Error: Cannot find module 'jsonfile/utils'
```

因此不推荐使用。

### `pnpm dlx electron-builder@26.0.3`

在 pnpm 10 环境中曾遇到 exotic dependency / `@electron/node-gyp` 相关限制。

因此当前采用：

```powershell
npx --yes electron-builder@26.0.3 ...
```

而不是 `pnpm dlx`。

## 8. 如果 dist 文件被占用

如果之前安装/运行的 MarkText 正在占用 `dist\win-unpacked` 中的文件，electron-builder 可能出现 `Access is denied`。

先关闭 MarkText，必要时：

```powershell
Get-Process marktext,electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

然后删除旧输出：

```powershell
cd E:\github\marktext
Remove-Item -Recurse -Force .\dist -ErrorAction SilentlyContinue
```

再重新执行两阶段构建。

## 9. 构建前建议检查

建议顺序：

```powershell
git status
pnpm run dev
```

先确认开发版功能正常。

如果源码发生了较大类型改动，也可以额外执行：

```powershell
pnpm run typecheck
```

然后再打包。

## 10. 构建流程简表

```text
clone / 修改源码
      ↓
pnpm install（首次或依赖变化）
      ↓
pnpm run dev
      ↓
功能与性能测试
      ↓
pnpm run build
      ↓
cd packages/desktop
      ↓
npx --yes electron-builder@26.0.3 --win nsis --x64 --publish never
      ↓
dist/marktext-win-x64-0.19.1-setup.exe
```

## 11. 性能相关提醒

打包工具版本本身不应被默认认定为编辑器运行性能差异的原因。

如果最终安装版出现打开文件或切换标签变慢，应优先进行：

- 纯净 v0.19.1 vs 当前定制版
- 右侧 TOC 开 vs 关
- 小文档 vs 大文档
- 左右 TOC 是否同时显示

的 A/B 测试，而不是先更换 electron-builder。
