# 通用「安装为应用」（PWA）模块

`pwa-install.js` 是**单一真源**。各项目 `index.html` 里的那份是**内联副本**，
由 `tools/sync-pwa.mjs` 生成 —— 不要直接改项目里的副本，改了会在下次同步时被覆盖
（CI 也会用 `--check` 拦下不一致的提交）。

## 为什么是「内联」而不是「引用」

本仓库的项目由通配子域名分发（`life.skywitty.win` → `public/life/`），路由会把请求路径
拼上项目前缀，所以 `/shared/pwa-install.js` 在 `ledger.skywitty.win` 下会变成
`/ledger/shared/pwa-install.js`，跨项目共享脚本没法用相对路径引用。

同时两个约束都要求内联：交付物是**单文件、零外部依赖**；资料库那边导入的页面
（`workbuddy.cn` 域）也无法引用本仓库的文件。

于是采用「真源在 `shared/`，同步进各项目」的方式：逻辑只有一份，交付仍是单文件，
离线可用，且资料库页面也能用同一套代码。

## 给新项目接入（4 步）

**① 在 `<head>` 里放一对标记**（中间留空即可，内容由同步器填）：

```html
<!-- PWA:INLINE:START -->
<!-- PWA:INLINE:END -->
```

**② 在会触发安装的按钮上加类名、给文案节点打标**：

```html
<button class="ghost pwa-install-button" type="button">
  <svg class="app-icon" viewBox="0 0 24 24"><use href="#icon-install"></use></svg>
  <span data-pwa-label>装到桌面</span>
</button>
```

- 文字比按钮窄时（如移动端），给按钮加 `data-pwa-short`，空闲态会显示短文案。
- 按钮放几个都行，模块按选择器全绑。

**③ 在脚本末尾调用 init**（`lang`、`toast` 不传也能用，会自动判断/用内置轻提示）：

```js
PWAInstall.init({
  name: '项目全名',
  shortName: '短名',
  description: '一句话描述',
  iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…完整图标…</svg>',
  brandColor: '#16856f',
  backgroundColor: '#f8f5ed',
  themeColor: { light: '#f8f5ed', dark: '#111b1b' },
  buttons: '.pwa-install-button',
  toast: showToast
});
```

**④ 同步**：

```bash
npm run sync:pwa        # 写入
npm run check:pwa       # 只校验（CI 用，不一致时非 0 退出）
node tools/sync-pwa.mjs life    # 只处理某个项目
```

图标 `iconSvg` 要**自带背景**（比如绿底 + 奶白描边），因为主屏上的图标没有页面给它垫底色。
可以直接从页面的 sprite 里抠：`<symbol>` 的内容用 `<svg viewBox="…">` 包一层，
再把 `fill="currentColor"` 换成具体颜色即可。

## 配置项

| 键 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 应用全名，写入 manifest 与 `application-name` |
| `shortName` | | 主屏显示名，缺省用 `name` |
| `description` | | manifest 描述 |
| `iconSvg` | | 完整图标 SVG 字符串；不传则用内置的钱币图标（取 `brandColor`） |
| `appleIcon` | | iOS 主屏图标的 PNG data URI；不传则用页面已有的 `apple-touch-icon`，都没有就运行时栅格化 |
| `brandColor` | | `mask-icon` 颜色、manifest `theme_color`、浮层主色 |
| `backgroundColor` | | manifest `background_color`（应用启动瞬间的底色） |
| `themeColor` | | `{ light, dark }`，状态栏配色；会跟随 `data-theme` 与系统深色模式自动切换 |
| `buttons` | | 触发按钮的选择器，默认 `.pwa-install-button` |
| `scope` | | manifest `scope`，默认 `location.origin + '/'` |
| `orientation` | | 默认 `portrait` |
| `lang` | | `'zh'` / `'en'`；不传则按 `<html lang>` 与浏览器语言判断 |
| `strings` | | 覆盖内置文案（键见 `shared/pwa-install.js` 里的 `TEXT`） |
| `toast` | | 提示回调，签名 `(message) => void`；不传则用内置轻提示 |

## 两个必须知道的事实

**1. `start_url` / `id` / `scope` 必须是绝对地址。**
manifest 用 `data:` URI 承载时，相对地址会以 `data:` 为基准解析，必然失败 ——
浏览器随即判定 `start-url-not-valid`，**`beforeinstallprompt` 永远不触发**，
原生安装链路直接断掉（用户点按钮只会看到手动指引）。
模块已用 `location.origin + location.pathname` 自动算好，不要改成相对路径。

> 这不是理论推测：本仓库的 `life` 和 `ledger` 改造前都栽在这里，
> 用 `Page.getInstallabilityErrors` 能看到 `start-url-not-valid`，补上绝对地址后清零。

**2. 不需要 Service Worker。**
实测没有 SW 也能满足 Chromium 的可安装条件，因此不额外产生需要缓存的文件，
「单文件交付」得以保持。

## 验证方法

`beforeinstallprompt` 只在 secure context 且满足可安装条件时才触发，光看页面逻辑测不出来。
用 Edge 的 DevTools Protocol 可以直接问浏览器：

```js
await send("Page.getInstallabilityErrors");  // [] 表示可安装
await send("Page.getAppManifest");           // 确认 start_url 等解析结果
```

页面必须通过 HTTPS 或 `127.0.0.1` 打开（`file://` 不算 secure context）。
