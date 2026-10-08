# cf-static

一个 Cloudflare Worker 承载多个静态项目，通过**通配子域名**自动分发。
`public/` 下的每一个文件夹就是一个项目，新增项目零配置。

## 域名规则

| 访问地址 | 对应内容 |
|---|---|
| `skywitty.win` | 项目索引页（放了 `public/index.html` 则用它） |
| `www.skywitty.win` | 项目索引页 |
| `life.skywitty.win` | `public/life/` |
| `blog.skywitty.win` | `public/blog/` |
| `<任意>.skywitty.win` | `public/<任意>/`，不存在则 404 |
| `cf-static.<账号>.workers.dev/life/` | 兜底入口，按路径访问同名文件夹 |

## 目录结构

```
cf-static/
├─ public/                  ← 静态资源根，每个文件夹 = 一个项目
│  ├─ .assetsignore           排除 public 内的杂项文件（如 .DS_Store）
│  ├─ life/
│  │  ├─ index.html           日常集 · 生活工作台（数据只在本机）
│  │  └─ online.html          日常集 · 云端版（登录后数据按账号存 Supabase）
│  └─ ledger/
│     ├─ index.html           打工人小账本（数据只在本机）
│     └─ online.html          打工人小账本 · 云端版（登录后数据按账号存 Supabase）
├─ shared/
│  ├─ README.md               通用 PWA 模块的接入说明
│  ├─ pwa-install.js          通用「安装为应用」模块（单一真源）
│  └─ supabase-sync.js        持久化 + 登录模块（单一真源）
├─ supabase/
│  └─ schema.sql              建表 + 按用户隔离的 RLS 策略，粘进 Supabase SQL Editor 执行
├─ tools/
│  ├─ sync-pwa.mjs            把 PWA 模块内联进各项目 index.html
│  └─ sync-supabase.mjs       把 Supabase 模块内联进已接入的 HTML
├─ src/
│  ├─ index.js             路由 Worker：按 Host 分发
│  └─ projects.js          配置：主域名 + 项目显示名 + 例外映射
├─ wrangler.jsonc
├─ package.json
└─ .github/workflows/
   └─ deploy.yml          GitHub Actions 自动部署（与 Workers Builds 二选一）
```

---

## 一、首次部署

三种方式任选其一。注意**顺序**：必须先让 Worker 存在，"接入 skywitty.win"那一步才有对象可挂。

### 方式 A：本地 CLI 直传（30 秒，最可靠）

```bash
npx wrangler login    # 浏览器授权，只需一次
npx wrangler deploy
```

终端输出 `https://cf-static.<账号>.workers.dev` 即成功。**不需要 API Token，也不需要
GitHub 授权**，任何 Git 集成故障都绕得过去 —— 遇到 Dashboard 报错时先用这条把站先立起来。

### 方式 B：Workers Builds（Git 自动部署，零密钥）

两个入口，**推荐入口 1** —— 它绕开 `Create application` 里那条"新建仓库"分支，
也就不会遇到「无法创建 Git 仓库」「已存在具有该名称的存储库」这类报错。

**入口 1（推荐）：先有 Worker，再把仓库连上去**

1. 先跑通方式 A，让 `cf-static` 这个 Worker 存在。
2. Dashboard → **Workers & Pages** → 点进 `cf-static` → **Settings** → **Builds** → **Connect**。
3. 选 Git 账号 → **在列表里选中** `skywitty/cf-static`（列表为空见第五节的仓库访问范围）。
4. 按下表配置后保存：

   | 配置项 | 填写值 |
   |---|---|
   | Build command | *（留空，无构建步骤）* |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *（留空，即仓库根目录）* |

**入口 2：从 Create application 导入**

1. Dashboard → **Workers & Pages** → **Create application** →
   在 **Import a repository** 旁点 **Get started**。
2. 授权 Cloudflare GitHub App，仓库范围勾选本仓库即可。
3. **在仓库列表里选中 `skywitty/cf-static`**（有搜索框可筛选）。
   > 不要走"新建仓库"分支，也不要在弹出的表单里输入仓库名 —— 那是让 Cloudflare 去你的
   > GitHub 建一个新仓库，`cf-static` 已被占用，会报「已存在具有该名称的存储库」。
4. 按下表配置：

   | 配置项 | 填写值 |
   |---|---|
   | Project name | `cf-static` |
   | Production branch | `main` |
   | Build command | *（留空，无构建步骤）* |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *（留空，即仓库根目录）* |
   | API token | 选 **Create new token**（自动生成） |

   > Project name 必须与 `wrangler.jsonc` 里的 `name` 完全一致，否则构建直接失败。

5. **Save and Deploy**，完成后访问 `https://cf-static.<账号>.workers.dev` 验证。

之后任何推送到 `main` 的提交都会自动构建发布；其他分支生成独立 Preview 地址。

#### ⚠️ 构建配置四个字段，其中两个填错必挂

| 配置项 | 必须的填写值 | 填错的后果 |
|---|---|---|
| Build command | **留空** | 本仓库没有构建步骤 |
| Deploy command | `npx wrangler deploy` | — |
| Root directory | **留空** = 仓库根目录 | 填了子目录 → 构建在子目录里跑 `npm ci` → 报找不到 `package-lock.json` |
| 连接的仓库 | **`skywitty/cf-static`** | 连到别的仓库（尤其是 Cloudflare 新建的空仓库）→ 同样报找不到 `package-lock.json` |

**保存后回 Settings → Builds 核对一次"连的是哪个仓库"。** 如果你在上一步「已存在具有该名称的
存储库」之后换了仓库名继续，Cloudflare 很可能建了个**空仓库**并连上了它 —— 那必然构建失败。

> 若报「Cloudflare 目前无法创建 Git 仓库，请重试，或手动创建仓库并从现有仓库部署」，
> 属于**账号级 GitHub 授权问题**（详见第五、六节），与仓库本身无关。改用入口 1 或方式 C。

### 方式 C：GitHub Actions（Git 自动部署，需 API Token）

见第六节。**不依赖 Cloudflare 的 GitHub App 授权**，是方式 B 报错时的标准替代路径。

### 接入 skywitty.win（一次性，约 5 分钟）

> 前置条件：Worker 已存在（方式 A/B/C 任一已跑通）。

**前提**：`skywitty.win` 已作为站点添加到同一个 Cloudflare 账号（nameserver 已指向 Cloudflare）。

**① 添加通配 DNS 记录** — DNS → Records → Add record：

| Type | Name | Target / IPv4 | Proxy |
|---|---|---|---|
| CNAME | `*` | `skywitty.win` | **Proxied（橙色云朵）** |
| A | `@` | `192.0.2.1` | **Proxied（橙色云朵）** |

- 通配记录**必须开启代理**，否则请求不会经过 Cloudflare，Worker 路由不会触发。
- 开启代理后 Target 的值不参与解析，填什么都行；主域名用 `192.0.2.1` 这类占位地址即可，
  Worker 会直接接管，不会真的回源。
- DNS 通配记录**不覆盖主域名本身**（RFC 4592），所以 `@` 那条要单独加。

**② 挂 Worker 路由** — Workers & Pages → `cf-static` → Settings → **Domains & Routes**
→ Add → **Route**，添加两条：

```
*.skywitty.win/*
skywitty.win/*
```

**③ HTTPS**：无需操作。免费版 Universal SSL 自动签发并续期，覆盖主域名与全部一级子域名。

> 不支持 `a.b.skywitty.win` 这类二级子域名 —— 免费证书只覆盖一级，需要付费的
> Advanced Certificate Manager。路由脚本本身也只接受一级子域名。

---

## 二、新增一个项目

真正零配置，只有一步：

```
public/blog/index.html
```

推送后 `https://blog.skywitty.win` 立即可用，同时 `https://skywitty.win/blog/` 也能访问。

想让它出现在项目索引页上（带一个好看的名字），在 `src/projects.js` 加一行：

```js
export const PROJECTS = {
  life: "栖 · 生活工作台",
  blog: "随手记",
};
```

不登记也能正常访问，登记只影响索引页显示。

### 想让某个子域名指向别的文件夹

```js
export const HOST_ALIASES = {
  "go.skywitty.win": "life",
};
```

### 让项目支持「安装为应用」（PWA）

`shared/pwa-install.js` 是通用模块，各项目只提供配置：manifest、theme-color、
favicon、图标、安装按钮与 iOS 手动指引全都由它生成，**不需要每个项目各写一遍**。

接入只要四步 —— 在 `<head>` 放一对 `<!-- PWA:INLINE:START -->` / `<!-- PWA:INLINE:END -->`
标记、给按钮加 `pwa-install-button` 类名、在脚本末尾调一次 `PWAInstall.init({...})`、
然后执行 `npm run sync:pwa` 把模块内联进去。**详细配置项与踩坑说明见
[`shared/README.md`](shared/README.md)。**

```bash
npm run sync:pwa     # 真源 → 各项目（改完真源必须跑）
npm run check:pwa    # 只校验是否同步；部署工作流也会跑这一步
```

> ⚠️ 项目里内联的那份是**生成物**，别直接改，下次同步会被覆盖。
>
> 另有一个坑值得单独记一笔：manifest 里 `start_url` / `id` / `scope` **必须是绝对地址**。
> 用 `data:` URI 承载 manifest 时相对地址解析必然失败，浏览器会判 `start-url-not-valid`，
> `beforeinstallprompt` 永不触发 —— 看起来「按钮点了没反应」，其实原生安装链路压根没通。
> 模块已自动用 `location.origin + location.pathname` 算好。

---

### 让项目把数据存到 Supabase

每个项目现在有**两个并存的入口**：同一套界面，不同的持久化后端。

| 页面 | 访问地址 | 数据存在哪 |
|---|---|---|
| `public/ledger/index.html` | `ledger.skywitty.win/` | 只在本机（localStorage） |
| `public/ledger/online.html` | `ledger.skywitty.win/online.html` | Supabase；localStorage 退化为离线缓存 |
| `public/life/index.html` | `life.skywitty.win/` | 只在本机 |
| `public/life/online.html` | `life.skywitty.win/online.html` | Supabase；localStorage 退化为离线缓存 |

`online.html` 是独立文件，由 `index.html` 复制后**只替换持久化层**得到 ——
界面、交互、业务计算完全一致，改动集中在 `/* ===== Supabase Database Integration ===== */` 那一段。
登录门禁与账户菜单由共享模块用纯 JS 注入，没有改动页面 HTML，所以两套入口的界面始终同步。

> `index.html` 是**纯本机版**：不登录、不连云，数据只在这台设备的 localStorage 里。
> 想给家人用、要跨设备，就用 `online.html`。

#### 四个步骤接上你自己的 Supabase

**① 开启邮箱密码登录** — 控制台 → **Authentication → Providers → Email**，打开 Enable。
家庭自用强烈建议同时关掉 **Sign In / Up → Confirm email**：否则每个人注册后都要先去邮箱点确认链接才能进，
多一道收邮件的麻烦；关掉之后注册即登录。

**② 建表** — 控制台 → **SQL Editor** → 新建查询 → 粘贴 `supabase/schema.sql` 全文 → Run。
脚本建 9 张表（账本 3 张、日常集 6 张）、索引、**按用户隔离的权限策略**与 Realtime 发布，可重复执行。

**③ 填配置** — 打开两个 `online.html`，把顶部的 `SUPABASE_CONFIG` 换成自己项目的值：

```js
var SUPABASE_CONFIG = {
  url: 'https://xxxxxxxx.supabase.co',   // Settings → API → Project URL
  anonKey: 'sb_publishable_4567...'      // 公开密钥，见下
};
```

`anonKey` 这个字段名是历史遗留，**新旧两种「公开密钥」都能填，等价、都受 RLS 约束**：

| 格式 | 来源 | 说明 |
|---|---|---|
| `sb_publishable_...` | Settings → **API Keys** → Publishable | **推荐**。2025 年后新建的项目默认只有这个 |
| `eyJhbGciOi...`（JWT） | Settings → **API** → `anon` `public` | 旧版，Supabase 计划 **2026 年底废弃**，现在仍可用 |

两者只是格式差异，权限完全相同：未登录时映射到 `anon` 角色、登录后映射到 `authenticated` 角色 ——
本项目的策略只对 `authenticated` 开放，所以签名登录之后的行为一模一样。

⚠️ 同页面上那把 `sb_secret_...` / `service_role` 是**机密密钥**，带 `BYPASSRLS`，绕过所有策略、可读写全库。
它只能待在你自己的服务器上，**任何情况下都不要填进这个页面**。

**④ 部署** — 推 `main` 即可。没填配置时页面**不会假装配对成功**，
也不会弹出登录框 —— 它安静地走回本机模式，并在顶部提示「还没配置 Supabase」。

#### 一个账号一份数据（家庭成员互不可见）

配好之后打开 `online.html` 会先看到登录页；注册或登录后，数据按账号隔离存放。

- **隔离在数据库那侧，不是前端过滤**：每张表都带 `space` 列，RLS 策略要求 `space = auth.uid()::text`。
  别人的行**查都查不到**（`using` 拦读），伪造 `space` 也写不进去（`with check` 拦写）。
- **公开密钥泄露也安全**：它只是一把「没有身份就什么也读不到」的钥匙。
  未登录时 `auth.uid()` 为 null，所有查询返回空、所有写入被拒。
- **换人登录不会串号**：登录门禁用不透明层盖住整个页面，且未登录状态下所有云端读写直接失败
  （`requireAuth`），不会安静地把数据写进默认空间。退出登录会清掉本机缓存 ——
  缓存另有一份「属于哪个账号」的记录，账号对不上就整份丢弃，共用一台设备时尤其重要。
- **新增成员零配置**：让家人在登录页点「注册」就行，不需要你在后台建账号，也不用改代码。

#### 同步语义

- **打开页面**：先恢复本机会话 → 按 `space` 拉自己那份全量 → 云端为准覆盖 → 回写 localStorage。
- **写入**：先落本机，再推云端；推送失败**不丢数据**，出现「重试同步」。
- **跨设备重复提交**：主键是 `<uid>:summary-<月份>`、`<uid>:settings`、`<uid>:habit-<习惯>-<日期>`，
  都走 upsert，不会写重。这个前缀是必需的 —— 主键全局唯一，不带账号前缀两个人的同月记录会撞车。
- **实时**：两个页面都订阅了 Supabase Realtime，另一端改动会自动重拉
  （按 `space` 过滤，只看得到自己的行）。通道建不起来也不影响主流程，手动点「重试同步」照样可用。
- **离线**：断网时用本机缓存照常可见可改，联网后点「重试同步」补上。

#### 想把「接登录之前」的存量数据收归自己名下

那时候写进去的行 `space` 全是 `'default'`，在按用户隔离的策略下谁都看不见。
执行 `schema.sql` 第四节那段（默认注释着），把 `<你的用户 id>` 换成
Authentication → Users 里那一行的 UID，再跑一遍即可。

#### 改共享模块之后要同步

```bash
npm run sync:sb      # 真源 → 各 online.html
npm run check:sb     # 只校验；部署工作流也会跑这一步
```

> `shared/supabase-sync.js` 是单一真源：SDK 懒加载（CDN ESM，jsdelivr 为主 / esm.sh 兜底）、
> CRUD 原语、分页取全量、状态广播都在这里。各页面里的内联副本是**生成物**，
> 别直接改，下次同步会被覆盖。

---

## 三、本地开发

```bash
npm install        # 首次执行
npm run dev        # 本地预览 http://localhost:8787
npm run deploy     # 手动部署（需先 npx wrangler login）
```

本地验证域名路由，直接伪造 Host 头即可，一个服务就能测全部域名：

```bash
curl -H "Host: life.skywitty.win" http://localhost:8787/
curl -H "Host: skywitty.win"      http://localhost:8787/
```

> ⚠️ **不要把路由写进 `wrangler.jsonc` 的 `routes`。**
> 一旦配置了 `routes`，`wrangler dev` 会把所有请求的 hostname 强制改写成 zone 域名，
> Host 头被忽略，本地就没法测试按域名分发的逻辑了。路由统一在 Dashboard 里挂。

> **锁文件已补全平台条目**（92 条，含全部 `@cloudflare/workerd-*` 与 `@esbuild/*`）。
> 原来的锁文件是在华为云镜像下生成的：npm 装不上可选依赖时会**静默删掉对应的锁条目**，
> 于是 Windows 本地 `npm run dev` 报找不到 workerd，云端 Linux 构建也会装出缺 workerd
> 二进制的 wrangler。现已改用官方源、在干净目录（不带 `node_modules`）里重新解析补齐。
>
> 若本地仍报 `@cloudflare/workerd-windows-64 could not be found`，先删掉 `node_modules`
> 重跑 `npm install`（锁文件里已有该包）。万不得已可手工铺二进制：
>
> ```bash
> npm pack @cloudflare/workerd-windows-64@1.20261001.1
> tar -xzf cloudflare-workerd-windows-64-1.20261001.1.tgz
> mkdir -p node_modules/@cloudflare/workerd-windows-64/bin
> cp package/package.json node_modules/@cloudflare/workerd-windows-64/
> cp package/bin/workerd.exe node_modules/@cloudflare/workerd-windows-64/bin/
> ```

---

## 四、几个关键设计取舍

**为什么静态根是 `public/` 而不是仓库根目录？**
`wrangler dev` 会监听静态根目录下的所有文件变动做热重载，但它**不读取 `.assetsignore`**。
若把仓库根目录设为静态根，`.wrangler/state` 下 sqlite 的写入会不断触发重建，形成无限重启循环，
`npm run dev` 完全不可用。收拢到独立子目录后，基础设施文件天然隔离，也顺带保证
`README.md`、`src/`、`package.json` 不会被误上传。

**为什么要开 `run_worker_first`？**
默认情况下静态资源优先于 Worker，这会让 `public/` 根目录的文件「盖住」子域名下的同名路径 ——
比如日后加了 `public/index.html`，`life.skywitty.win/` 就会错误地返回它而不是 `public/life/index.html`。
开启后 Worker 先执行、自己决定去向，行为可预测。
代价是每个请求消耗一次 Worker 调用（免费额度 10 万次/天），个人站点余量充足。

**为什么不设置 `not_found_handling`？**
一旦设为 `404-page` 或 `single-page-application`，未命中的请求会被 Cloudflare 直接短路、不进 Worker，
按域名分发的逻辑就失效了。保持默认 `none`，未命中请求才会落到 `src/index.js`。

**为什么用路由脚本而不是纯静态 Worker？**
纯静态 Worker 只能按路径分发，读不到 Host 头，也就无法实现子域名。
换成路由脚本后，加项目只需加文件夹，域名数量不受限。

**为什么隔离做在数据库端，而不是前端按账号过滤？**
前端过滤只是「界面上不显示」，抓包照样拿得到全量数据，等于没隔离。
这里每张表都有 `space` 列，RLS 策略要求 `space = auth.uid()::text`：
读被 `using` 拦住（别人的行根本查不到），写被 `with check` 拦住（伪造 `space` 也存不进去）。
前端因此**不需要、也无法**做隔离判断，只需老老实实带上自己的 uid。

**为什么登录门禁放在共享模块里，而不是写进页面 HTML？**
两个页面由各自的 `index.html` 复制而来，一旦往 HTML 里加登录界面，
以后改 `index.html` 就得手工同步两处，迟早走歪。
共享模块用纯 JS 注入样式和 DOM（`SupabaseSync.authGate()`），页面 HTML 一行没动，
门禁样式还能自动跟随页面主题（宿主 CSS 变量 + `html[data-theme="dark"]`）。

**为什么确定性主键要带 uid 前缀？**
月度总结用 `summary-<月份>`、个人设置用 `settings`、习惯打卡用 `habit-<习惯>-<日期>`，
这些 id 是「天生唯一」的，本意是让 upsert 收敛。但主键是全局唯一的 ——
两个家庭成员在同一个月各存一次总结，就会撞主键。
加上 `<uid>:` 前缀后既保留 upsert 收敛特性，又天然按账号分开。

**为什么退出登录要清掉本机缓存？**
localStorage 不区分账号。一家人共用一台平板时，若不清，
下一位登录者会立刻在自己界面里看到上一位的本地记录，甚至可能被合并进自己的云端数据。
所以缓存另存一个 `_owner` 键记录归属，账号对不上就整份丢弃 —— 云端才是真源。

**为什么 `routes` 放在 Dashboard 而不是 `wrangler.jsonc`？**
一是本地 dev 会因此无法测试 Host 分发（见上）；二是 `routes` 依赖 zone 已添加到账号，
写进配置会让部署与域名状态耦合 —— 域名未就绪时构建会直接失败，把整个自动部署管线拖垮。

---

## 五、常见问题

| 现象 | 原因与处理 |
|---|---|
| Dashboard 报「Cloudflare 目前无法创建 Git 仓库」 | 账号级 GitHub 授权失效（常见 `error 8000121: Your GitHub authorization has expired`），不是仓库的问题。三步处理：① 确认走的是**导入已有仓库**而非新建仓库；② GitHub → Settings → Applications → **Cloudflare Workers and Pages** → Configure → Uninstall，回 Dashboard 重新授权（该 App 为全部 Workers/Pages 项目共用，重装后其他项目可能需重新连接 Builds）；③ 仍不行就用**方式 C**（API Token，不依赖该 App） |
| Dashboard 报「已存在具有该名称的存储库，请选择其他名称」 | 你走进了"新建仓库"分支：Cloudflare 正尝试在你的 GitHub 账号里创建同名仓库，而 `skywitty/cf-static` 已经存在。**不要改名字**（改成 `cf-static-2` 只会建出一个空仓库，白部署一场）。改用方式 B 的**入口 1**，或退回上一步、在仓库**列表**里选中已有仓库 |
| 方式 B 的仓库列表是空的 / 找不到本仓库 | GitHub App 的仓库访问范围没包含它。GitHub → Settings → Applications → **Cloudflare Workers and Pages** → Configure → **Repository access** → 勾上 `skywitty/cf-static`（或改选 All repositories），刷新 Dashboard 重试 |
| 构建失败：`npm ci` … `can only install with an existing package-lock.json`，末尾是 `Failed: error occurred while installing tools or dependencies` | 构建在**没有 `package-lock.json` 的目录**里跑了 `npm ci`。本仓库根目录确实有锁文件，所以这是配置问题，按可能性排查：① **Worker 连的不是本仓库**（最常见是被连到 Cloudflare 新建的空仓库）；② **Root directory 填了子目录**，必须留空。见方式 B 下的「构建配置四个字段」表 |
| 构建失败：`Cannot find module '@cloudflare/workerd-linux-64'` | 锁文件缺 Linux 平台条目，`npm ci` 装出的 wrangler 缺二进制。已于 2026-10-06 补全；若从旧提交部署请先合并 `main` |
| Actions 跑完显示「跳过部署」 | 两个 Secret 未配置，按第六节添加后重新运行工作流 |
| Actions 报找不到 workerd / esbuild 二进制 | 别用 `npm ci`，锁文件缺平台条目，见 `deploy.yml` 顶部注释 |
| 构建报 `Worker name mismatch` | `wrangler.jsonc` 的 `name` 与 Dashboard 里的 Worker 名不一致 |
| 子域名打不开 / NXDOMAIN | 通配 DNS 记录没加，或没开代理（必须是橙色云朵） |
| 子域名能解析但返回 404 | 通配 DNS 有了，但 Worker 路由 `*.skywitty.win/*` 没挂 |
| 主域名打不开 | 通配记录不覆盖主域名本身，需单独加 `@` 记录 |
| 子域名返回索引页而不是项目 | 没建对应的 `public/<子域名>/index.html` |
| 新增项目 404 | 入口文件必须是 `public/<项目名>/index.html`，且已推送 |
| 二级子域名报证书错误 | 免费证书只覆盖一级，需要付费 ACM，或改用一级子域名 |
| 本地 dev 反复重启 | 静态根被设成了仓库根目录，改回 `./public` |
| 本地 dev 的 Host 头无效 | 配置里出现了 `routes`，移除后重启 |
| PWA 无法安装（按钮点了没反应） | 三条排查线：① 必须 HTTPS 或 `127.0.0.1`（`file://` 不算 secure context）；② manifest 的 `start_url` 必须是**绝对地址**，否则浏览器判 `start-url-not-valid` 且 `beforeinstallprompt` 不触发（见第二节的踩坑说明）；③ 用 `Page.getInstallabilityErrors` 可以直接问浏览器到底缺什么，返回 `[]` 才算可安装 |
| 部署时报「通用 PWA 模块已同步」失败 | 改了 `shared/pwa-install.js` 但没同步。本地跑 `npm run sync:pwa` 后重新提交 |
| `online.html` 表面完全正常，但没有顶部提示 | 说明 `SUPABASE_CONFIG` 已填好且已登录，这是**想要的状态** |
| `online.html` 顶部提示「还没配置 Supabase」 | 这是正常状态，不是报错。把页面顶部 `SUPABASE_CONFIG` 的 `url` / `anonKey` 填上并刷新即可 |
| `online.html` 一打开就是登录页 | 未登录时的正常表现。点「注册」建账号即可；已注册直接登录。若想完全不登录，把 `SUPABASE_CONFIG` 留空就退回本机模式 |
| 注册后提示「去邮箱点确认链接」 | 项目开着邮箱确认。想省掉这步：控制台 → Authentication → Sign In / Up → 关掉 **Confirm email** |
| 登录报「邮箱或密码不对」 | 密码错了，或邮箱还没确认。确认过的账号仍报错就用登录页的「忘记密码」重置 |
| 登录成功，但界面上没有任何数据 | 正常 —— 新账号就是空的。数据按账号隔离，不会继承同一个库里别人的记录 |
| 换账号登录后想找回旧数据 | 数据还在，只是归属变了。用登录页的「忘记密码」登回原账号即可 |
| 提示「读取失败 / 写入失败，已切到本地模式」 | 按序排查：① `supabase/schema.sql` 是否已执行；② `url` / `anonKey` 是否填对；③ Email Provider 是否已开启；④ 页面里的 `DB_*` 表名与库里是否一致；⑤ 浏览器控制台的 CORS / 401 报错 |
| 部署时报「Supabase 共享模块已同步」失败 | 改了 `shared/supabase-sync.js` 但没同步。本地跑 `npm run sync:sb` 后重新提交 |

---

## 六、方式 C：GitHub Actions 部署

`.github/workflows/deploy.yml` **已启用**，推送到 `main` 即自动部署，用 API Token 认证，
完全绕开 Cloudflare 的 GitHub App 授权 —— Workers Builds 报错时用这条路。

> ⚠️ **与 Workers Builds 二选一**。两条管线同时开着，每次 push 会重复部署同一个 Worker。
> 若你后来修好了方式 B 并完成接线，请先删掉 `deploy.yml`，或在 Worker → **Settings** →
> **Builds** → **Disconnect** 停用 Workers Builds。

### 配置（约 2 分钟）

**① 创建 API Token** — [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
→ **Create Token** → **Create Custom Token**：

| 字段 | 填写值 |
|---|---|
| Name | `cf-static GitHub Actions` |
| Permissions | **Account** / **Workers Scripts** / **Edit** |
| Account Resources | Include → 你的账号 |

创建后**立即复制**（只显示一次）。不需要任何 Zone 权限 —— 路由是在 Dashboard 手工挂的。

**② 取 Account ID** — Cloudflare Dashboard 右侧栏的 **Account ID**（32 位十六进制）。

**③ 写入仓库 Secret** — GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**
→ **New repository secret**，添加两个：

| Name | Secret |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 上一步复制的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | 上一步复制的账号 ID |

**④ 触发** — 推一个提交到 `main`，或到 **Actions** → **Deploy to Cloudflare Workers** →
**Run workflow**。未配 Secret 时工作流会显示黄色警告并跳过部署，不会亮红叉。

