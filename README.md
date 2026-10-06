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
   └─ deploy.yml.example   备选方案：GitHub Actions 部署（默认未启用）
```

---

## 一、首次部署

### 1. 部署 Worker（约 3 分钟）

前提：代码已推送到 GitHub（`https://github.com/skywitty/cf-static`）。

1. Cloudflare Dashboard → **Workers & Pages** → **Create application** →
   在 **Import a repository** 旁点 **Get started**。
2. 授权 Cloudflare GitHub App，仓库范围勾选本仓库即可。
3. 选择 `skywitty/cf-static`，按下表配置：

   | 配置项 | 填写值 |
   |---|---|
   | Project name | `cf-static` |
   | Production branch | `main` |
   | Build command | *（留空，无构建步骤）* |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *（留空，即仓库根目录）* |
   | API token | 选 **Create new token**（自动生成） |

   > Project name 必须与 `wrangler.jsonc` 里的 `name` 完全一致，否则构建直接失败。

4. **Save and Deploy**，完成后访问 `https://cf-static.<账号>.workers.dev` 验证。

之后任何推送到 `main` 的提交都会自动构建发布；其他分支生成独立 Preview 地址。

### 2. 接入 skywitty.win（一次性，约 5 分钟）

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

> Windows 上若报 `@cloudflare/workerd-windows-64 could not be found`，执行
> `npm install @cloudflare/workerd-windows-64 --no-save` 补齐本地二进制，不影响云端构建。

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

## 六、备选方案：GitHub Actions 部署

Workers Builds 已覆盖自动部署，**默认无需启用 Actions**（避免重复部署）。
若希望 CI 完全留在 GitHub 侧（要跑测试、Lint 等），把 `.github/workflows/deploy.yml.example`
改名为 `deploy.yml`，配好 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 两个 Secret，
再到 Worker → **Settings** → **Builds** → **Disconnect** 停用 Workers Builds 即可。
