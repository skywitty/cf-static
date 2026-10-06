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
│  └─ life/
│     └─ index.html           栖 · 生活工作台
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
| PWA 无法安装 | 必须通过 HTTPS 访问；`workers.dev` 与自定义域名均已自带 |

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

