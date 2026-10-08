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

> `index.html` 是**纯本机版**：不登录、不连云、不显示同步提示，数据只在这台设备的 localStorage 里。
> 想给家人用、要跨设备，就用 `online.html`。

> ⚠️ **同步逻辑只有一份，在 `online.html` 里。别往 `index.html` 里再加第二套。**
> 两个 `index.html` 曾经各自留着一整块**休眠的**同步层（账本是「资料库 SDK」，靠 `REMOTE_ENABLED = false`
> 关着；日常集要 `window.__SMART_PAGE__.database` 才启用）。它们和 `online.html` 走的是**两套后端、
> 两份合并逻辑**，改了一边另一边不会跟着变 —— 已经整体删掉了。纯本机版现在只有 localStorage 一条路径：
> 没有云同步代码，也就没有「改了一处忘了另一处」这回事。

> ⚠️ **两套入口同域，键必须分开；云端版的键还要按账号再分一层 —— 这两点别改回去。**
> `ledger.skywitty.win/` 和 `ledger.skywitty.win/online` 是同一个域名，localStorage 按域名共享。
> 如果两个页面用同一个键，任一方写缓存都会覆盖另一方。所以云端版用的是加 `__cloud` 后缀的独立键。
>
> 在此之上，云端版的键还会带登录用户 id：`<...>__cloud!<uid>`（未登录时是 `...__cloud!anon`）。
> 一个人一份，**换账号等于换个桶读**，谁的缓存都动不到谁 —— 「不串号」由结构保证，
> 而不是靠「退出时把上一位的缓存删掉」这种容易判断错时机的动作
> （`/online` 曾经因为把「刚打开还没登录」误判成「退出」而清掉过数据）。
>
> 副作用：**纯本机版里的数据不会自动出现在云端版里**。要搬过去，
> 用本机版的「导出备份」导出 JSON，再到云端版点「导入数据」导入即可。

#### 四个步骤接上你自己的 Supabase

**① 开启邮箱密码登录** — 控制台 → **Authentication → Providers → Email**，打开 Enable。
家庭自用强烈建议同时关掉 **Sign In / Up → Confirm email**：否则每个人注册后都要先去邮箱点确认链接才能进，
多一道收邮件的麻烦；关掉之后注册即登录。

**② 建表** — 控制台 → **SQL Editor** → 新建查询 → 粘贴 `supabase/schema.sql` 全文 → Run。
脚本建 10 张表（账本 3 张、日常集 7 张）、索引、**按用户隔离的权限策略**与 Realtime 发布，可重复执行。

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
  （`requireAuth`），不会安静地把数据写进默认空间。本机缓存按账号分桶
  （键里带 uid），换账号只是换个桶读，别人的缓存根本不碰；显式退出登录时
  只按 uid 清掉**本人那个桶**，共用一台设备时不留下痕迹，也不会牵连其他账号。
- **新增成员零配置**：让家人在登录页点「注册」就行，不需要你在后台建账号，也不用改代码。

#### 同步语义

- **打开页面**：恢复本机会话 → 按 `space` 拉自己那份全量 → **与本机缓存合并去重** → 回写 localStorage
  → 把「本机新记、云端还没有」的那部分补传到云端。
  **不是**「云端整份覆盖本地」，也不会有「本地多出来的记录只能干看着」这回事。
- **合并规则**（本地每一条逐条判断，支出/记录按 id、月度总结按月份、习惯打卡按「习惯 × 日期」、
  习惯定义按习惯键）：

  | 情形 | 处理 |
  |---|---|
  | ① 本机改过（在待同步集合里）且云端也有 | 内容不一致才以**本地**为准，保留并补传 |
  | ② 云端有、本机没改过 | 以**云端**为准 |
  | ③ 内容完全相同的重复项（同一笔在两台设备各记一次） | 按内容指纹去重，只留云端那一份 |
  | ④ 本机新记、云端没有 | 保留并**补传到云端** |
  | ⑤ 云端没有、也不是本机新记的 | 别的设备删掉了，本地跟着删 |

- **为什么需要一个「待同步集合」**：只凭「本地有、云端没有」分不清两种完全相反的意图 ——
  「我刚离线记的一笔」和「别的设备已经删掉的一笔」。集合里存的是**本机产生、云端还没确认**的行 id，
  持久化在独立键 `<桶>_pending`；**不放进 state** —— 页面读取时会按已知字段重建对象，
  塞在 state 里的标记留不住。①/④ 都以它为准，⑤ 就是它之外的剩余部分。
- **写入**：先落本机，再推云端；推送失败**不丢数据**，出现「重试同步」，同时进待同步集合。
- **跨设备重复提交**：主键是 `<uid>:summary-<月份>`、`<uid>:settings`、`<uid>:habit-<习惯>-<日期>`、
  `<uid>:habitdef-<习惯键>`，都走 upsert，不会写重。这个前缀是必需的 —— 主键全局唯一，
  不带账号前缀两个人的同月记录会撞车。
- **实时**：两个页面都订阅了 Supabase Realtime，另一端改动会自动重拉
  （按 `space` 过滤，只看得到自己的行）。自己刚写入的 1.5 秒内不再响应事件，
  避免「补传 → 拉取 → 再补传」空转。通道建不起来也不影响主流程，手动点「重试同步」照样可用。
- **离线**：断网时用本机缓存照常可见可改；期间记的内容会进待同步集合，
  下次打开页面或点「重试同步」自动补上。

#### 自定义习惯也会跟着账号走

早先只有**打卡记录**入库（`life_habits`），习惯**定义**留在本机 —— 后果是自定义习惯在另一台设备上
根本不存在，记录也就无处可落。现在习惯定义单独放 `life_habit_defs`，一个人一套。

- **内置习惯与自定义习惯分开处理**。内置五项（喝水/睡觉/运动/看书/冥想）的**定义来自代码**，
  线上那张表对它们只承担一件事：记「这个人有没有把它删掉」。所以定义字段以代码为准，
  万一哪天改了文案，同步逻辑不会因为「线上还是旧名字」而误判成「需要补传」。
- **删除 ≠ 删行，而是「隐藏」**。删掉一个习惯时写的是一行 `hidden = true`，而不是把行删掉。
  这条规则是为了消除歧义：只在「行没了」的情况下，分不清是**从没同步过**还是**被谁删了**；
  改成写 `hidden` 之后，行在不在本身不表达任何意思，`hidden` 才表达。
  本机的隐藏清单是 `state.settings.hiddenHabitKeys`，跟着一起双向同步。
- **隐藏一个内置习惯**也一样：写 `<uid>:habitdef-<习惯键>` 的 `hidden = true`，
  别的设备读到就把它从列表里移掉并记进隐藏清单，不会又被「本地缺这个内置习惯」的兜底逻辑补回来。
- **自定义习惯的定义以线上为准**：改名、改目标、改单位在别的设备上能生效；
  内置习惯这些字段来自代码，不看线上。

#### 首次登录：本机版的数据会问你要不要带上来

`index.html`（本机版）与 `online.html` 用的是两个存储键，登录后本机版以前记的账不会自己出现。
所以云端**读取成功后**页面会弹一层确认：这台设备上还留着 N 笔支出 / M 个月度总结，
要不要合并进当前账号？（云端连不上就先不问，免得两头都没落地。）

- **云端为准**：只补传云端还没有的记录（支出按内容指纹比对、月度总结按月份比对），
  不覆盖云端已有的行 —— 免得把别的设备上更新的记录回退成旧值。
- **不动源数据**：本机版那份留在原地，随时能退回单机继续用。
- **只问一次**：选「合并到云端」或「先不用」都会记在 `<桶>_mergelocal` 里，之后不再打扰。
  想重新合并，删掉这条标记（或直接用「导入 JSON」）即可。
- **日常集同理**，来源键是 `richangji-state-v1`，旧版「栖 · 生活工作台」的 `wb_life_data` 也在候选里。
  自定义习惯会连定义一起带上去（写 `life_habit_defs`），不然记录搬过去了、习惯在另一台设备上却没有。

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

**本机缓存是怎么跟账号对应的？为什么不用「退出时清空」那一套？**
缓存的键里直接带着登录用户 id：`<...>__cloud!<uid>`，一个人一份。
这样「换账号不串号」是结构上成立的 —— 切人只是换个桶读写，不会去碰别人的数据。
早先的做法是「大家共用一个键，另存一个 `_owner` 记归属，对不上就整份删掉」，
问题在于「删」这个动作要判断时机：`/online` 曾经把「页面刚打开、本来就没登录」
误判成「退出登录」，于是每访问一次就清一次缓存，把纯本机版的数据也一起带走了。
改用分桶后这类判断不再需要，也就不会再有这种事故。
显式**退出登录**时仍会清掉本人那个桶（共用设备的隐私考虑），但它按 uid 精确删除，
既动不到其他账号，也动不到 `index.html` 那份。

**为什么同步是「合并去重 + 补传」，而不是「云端为准覆盖本机」？**
覆盖那套有个说不通的推论：本机多出来的记录永远上不去，只能一直躺在这台设备上 ——
断网时记的账、写入失败的那几笔，都会卡死在这里。而「本机有、云端没有」本身又是**歧义**的：
既可能是「我刚记的」，也可能是「别的设备已经删掉的」。
于是引入一个**待同步集合**（`<桶>_pending`，只存「本机产生、云端还没确认」的行 id）把歧义消掉：
在集合里就是「我刚记的」，补传上去；不在集合里就是「别人删的」，跟着删。
「打开页面」因此变成一次并集去重：两边都以云端为准（本机改过的除外），
内容重复的（同一笔在两台设备各记一次）按指纹只留一份，本机独有且待同步的补传上去。

**为什么不能拿 `remoteId` 当「是否已同步」的判据？**
`online.html` 每读一次本机缓存，都会用页面自己的清洗函数按**已知字段**重建对象，
`remoteId` 这类派生字段留不住 —— 只看它的话，刷新之后所有记录都会被当成「本机新增」。
好在行主键就等于前端生成的 id（月度总结、设置、习惯打卡用的是确定性主键），
所以合并匹配一律用 id / 月份 / 习惯×日期，`remoteId` 只作同义词兜底。
删除同理：早先 `if (!item.remoteId) return;` 会让「刷新之后再删」删不掉云端那一行，
下一次拉取又把它带回来 —— 现在取键统一 `remoteId || id`。

**为什么删除习惯写成 `hidden = true`，而不是把那行删掉？**
因为「行不存在」是个**歧义**状态：既可能是「这台设备从没同步过这个习惯」，
也可能是「别的设备把它删了」。前者应该补建，后者应该跟着删 —— 但只看行在不在，判不出来。
所以 `life_habit_defs` 里的行**一旦建立就不再删除**，`hidden` 才表达「删没删」；
自定义习惯从线上拉时看 `hidden` 决定建还是删，内置习惯看 `hidden` 决定显还是藏。
代价是一张表里会留着几条 `hidden = true` 的墓碑行，换来的是这类判断不再需要猜。

**为什么内置习惯和自定义习惯的合并规则不一样？**
内置五项的定义（名字、类型、目标、单位）写在代码里，线上那行对它们只记「有没有被删」。
如果连名字也比，那以后改一次文案，所有设备都会因为「线上还是旧名字」而反复补传。
所以内置习惯的比对只看 `hidden`，自定义习惯才比完整定义。
同理，合并时给 `hidden` 数组里的自定义习惯补传定义，要**沿用线上那一行的字段**而不是凭空构造 ——
本地在把它隐藏的那一刻已经把习惯对象删掉了，凭空构造只会得到空名字，推上去等于把线上的名字抹掉。

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
| 删掉的记录刷新之后又回来了 | 已修复。旧版以 `remoteId` 判断「这一行在云端存在吗」，而它在读缓存时就被清掉了，于是线上那行根本没删成功。现在取键统一 `remoteId \|\| id`（月度总结用月份拼确定性主键），删完立即生效 |
| 断网时记的账，联网后一直没上云 | 已修复。旧版只在写入那一刻尝试推送，打开页面时是「云端覆盖本地」，本机多出来的记录不会补传。现在打开页面会先合并去重、再把本机新增补传上去；期间产生的记录都记在 `<桶>_pending` 里，不会漏 |
| 自定义的习惯在另一台设备上看不到 | 已修复。旧版只有**打卡记录**入库，习惯**定义**留在本机，别的设备上压根没有这个习惯。现在定义单独存 `life_habit_defs`，改名、改目标、改单位都会跟着账号走。**注意**：如果按老版本建过库，需要重新跑一遍 `supabase/schema.sql`，脚本是 `create table if not exists`，重复执行不会动已有数据 |
| 删掉的习惯在另一台设备上又回来了 | 已修复。旧版删除只清本机，云端那行还在，下次拉取就带回来。现在删除写成 `hidden = true`（删行会留下「从没同步过」和「被删了」两种状态分不清的歧义，见第四节），另一台设备读到就跟着隐藏 |
| 打开 `/online` 之后，纯本机版 `/` 的数据不见了 | 两套入口同域，localStorage 按域名共享。云端版曾与 `index.html` 共用同一个键，只要打开 `/online`（未登录）就会把缓存清掉。**已修复**：云端版改用独立的 `__cloud` 键，并进一步按账号分桶（`__cloud!<uid>`），「刚打开还没登录」不再被当成「退出」触发清理。若你怀疑中招，见下方「数据还能找回来吗」 |
| 换了域名之后数据不见了 | localStorage 按**域名**隔离，换域名等于换了一个空存储。旧域名的数据没被删，仍留在原浏览器的原域名下。用 DevTools → Application → Storage 切到旧域名即可读到，或按下方方法从浏览器的 LevelDB 里导出 |

#### 数据还能找回来吗

`localStorage.removeItem()` 只是写入一条删除记录，旧值在浏览器把存储文件合并（compaction）之前
仍留在磁盘上。可以这样捞：

1. 关掉浏览器（避免文件被占用），把
   `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Local Storage\leveldb\`（Chrome 同理）
   **整个目录复制**一份到临时位置 —— 不要在原目录上操作。
2. 用任意 LevelDB 读取器打开副本，键是 `_<域名>\x00\x01<存储键>`，值是 UTF-16 或 Latin-1 编码。
3. 只读即可。**不要**往原目录里写任何东西，写坏会影响浏览器正常数据。

如果数据属于**旧域名**（例如从 WorkBuddy 托管预览换到 `*.skywitty.win`），
它根本没被删，直接去旧域名下取就行，不用做恢复。
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

