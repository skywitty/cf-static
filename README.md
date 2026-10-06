# cf-static

`life/` 目录下的静态站点（单文件 PWA「栖 · 生活工作台」），托管在 **Cloudflare Workers Static Assets**，
通过 **Workers Builds** 与 GitHub 仓库直连，实现 `git push` 即自动构建部署。

## 目录结构

```
cf-static/
├─ life/
│  └─ index.html        # 站点唯一入口（CSS/JS/SVG 全内联）
├─ wrangler.jsonc       # Cloudflare 部署配置
├─ package.json         # 提供 wrangler 依赖与脚本
└─ .github/workflows/
   └─ deploy.yml.example  # 备选方案：GitHub Actions 部署（默认未启用）
```

## 部署原理

```
GitHub push (main)  →  Cloudflare Workers Builds  →  npx wrangler deploy  →  全球边缘节点
```

- 不在 `wrangler.jsonc` 里写 `main`，这是一个**纯静态 Worker**，Cloudflare 只负责上传并分发 `life/` 下的文件。
- 静态资源由 Cloudflare 自动做边缘缓存与分层缓存，无需自己配 CDN。
- 未命中静态文件的请求回退到 `index.html`（`not_found_handling: single-page-application`）。

---

## 一、首次部署（Dashboard 操作，约 3 分钟）

前提：代码已推送到 GitHub（本仓库：`https://github.com/skywitty/cf-static`）。

1. 登录 Cloudflare Dashboard，进入 **Workers & Pages**。
2. 点 **Create application** → 在 **Import a repository** 旁点 **Get started**。
3. 首次使用需授权：选择 **Git account**，安装 Cloudflare GitHub App，
   仓库范围勾选本仓库（`skywitty/cf-static`）即可，不必授权全部仓库。
4. 在列表中选择 `skywitty/cf-static`。
5. 配置项目：

   | 配置项 | 填写值 |
   |---|---|
   | Project name | `cf-static` |
   | Production branch | `main` |
   | Build command | *（留空，无构建步骤）* |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *（留空，即仓库根目录）* |
   | API token | 选 **Create new token**（自动生成，无需手工建） |

   > Project name 必须与 `wrangler.jsonc` 里的 `name` 完全一致，否则构建会直接失败。

6. 点 **Save and Deploy**。首次构建完成后，访问 `https://cf-static.<你的账号名>.workers.dev`。
7. 之后任何推送到 `main` 的提交都会自动触发构建并发布；其他分支的推送会生成独立的 Preview URL。

### 绑定自定义域名（可选）

Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**，填入你的域名
（域名需已托管在同一个 Cloudflare 账号下，DNS 记录与证书会自动创建）。

---

## 二、本地开发

```bash
npm install        # 首次执行
npm run dev        # 本地预览 http://localhost:8787
npm run deploy     # 手动部署（需先 npx wrangler login）
```

> Windows 上若报 `@cloudflare/workerd-windows-64 could not be found`，执行
> `npm install @cloudflare/workerd-windows-64 --no-save` 补齐本地二进制即可，不影响云端构建。

---

## 三、备选方案：GitHub Actions 部署

Workers Builds 已经覆盖自动部署，**默认无需启用 Actions**（避免重复部署）。
如果你希望 CI 完全留在 GitHub 侧（例如需要跑测试、Lint 或矩阵构建），按以下步骤切换：

1. 先把 `.github/workflows/deploy.yml.example` 改名为 `deploy.yml`。
2. 在 Cloudflare 创建 API Token：**My Profile** → **API Tokens** → **Create Token** → 自定义模板，
   权限给 `Account / Workers Scripts / Edit`，账户资源选中你的账号。
3. 在 GitHub 仓库 **Settings** → **Secrets and variables** → **Actions** 添加：
   - `CLOUDFLARE_API_TOKEN`：上一步的 Token
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Dashboard 右侧栏可见
4. 回到 Cloudflare Worker → **Settings** → **Builds** → **Disconnect**，停用 Workers Builds，
   避免两条流水线同时部署。

---

## 四、常见问题

| 现象 | 原因与处理 |
|---|---|
| 构建报 `Worker name mismatch` | `wrangler.jsonc` 的 `name` 与 Dashboard 里的 Worker 名不一致 |
| 访问根路径 404 | 检查 `assets.directory` 是否为 `./life`，且 `life/index.html` 已提交 |
| 想改成 `/life/` 前缀访问 | 把 `assets.directory` 改为 `./`，并新增 `.assetsignore` 写入 `README.md`、`.git*`、`node_modules` 等 |
| PWA 无法安装 | 必须通过 HTTPS 访问；`workers.dev` 子域名已自带，自定义域名绑定后同样可用 |

## 五、想加 API / 动态逻辑怎么办

当前是纯静态 Worker。需要时在 `wrangler.jsonc` 增加 `"main": "./src/index.js"`，
即可让 Worker 代码处理 `/api/*`，其余请求仍走 `life/` 静态资源，一次部署同时上线前后端。
