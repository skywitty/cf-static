# cf-static

一个 Cloudflare Worker 承载多个静态项目，按域名自动分发。
`public/` 下的每一个文件夹就是一个项目，可用 `/<文件夹名>/` 路径访问，也可以各自绑定独立域名。

## 目录结构

```
cf-static/
├─ public/                  ← 静态资源根，每个文件夹 = 一个项目
│  ├─ .assetsignore           排除 public 内的杂项文件（如 .DS_Store）
│  └─ life/
│     └─ index.html           栖 · 生活工作台
├─ src/
│  ├─ index.js             路由 Worker：按 Host / 路径分发
│  └─ projects.js          项目注册表（唯一配置入口）
├─ wrangler.jsonc
├─ package.json
└─ .github/workflows/
   └─ deploy.yml.example   备选方案：GitHub Actions 部署（默认未启用）
```

## 请求是怎么分发的

```
life.example.com/notes/style.css
        │
        ├─ Host 命中已登记域名 ──► 路径改写为 /life/notes/style.css ──► 静态资源层
        │
cf-static.<账号>.workers.dev/blog/
        │
        └─ Host 未登记 ──► /blog/xxx 由静态资源层直接命中（项目名前缀即路径）
```

- **命中静态文件**：由 Cloudflare 直接返回，不进 Worker，不消耗计算额度。
- **未命中**：交给 `src/index.js`，按 Host 判断归属项目，改写路径后取资源；仍未命中则返回 404 页。
- 根路径 `/` 返回一个自动生成的项目索引页。
- 只接受 `GET` / `HEAD`，其他方法返回 405。

---

## 一、首次部署（Dashboard 操作，约 3 分钟）

前提：代码已推送到 GitHub（本仓库：`https://github.com/skywitty/cf-static`）。

1. 登录 Cloudflare Dashboard，进入 **Workers & Pages**。
2. 点 **Create application** → 在 **Import a repository** 旁点 **Get started**。
3. 授权 Cloudflare GitHub App，仓库范围勾选本仓库即可，不必授权全部仓库。
4. 选择 `skywitty/cf-static`，按下表配置：

   | 配置项 | 填写值 |
   |---|---|
   | Project name | `cf-static` |
   | Production branch | `main` |
   | Build command | *（留空，无构建步骤）* |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *（留空，即仓库根目录）* |
   | API token | 选 **Create new token**（自动生成，无需手工建） |

   > Project name 必须与 `wrangler.jsonc` 里的 `name` 完全一致，否则构建直接失败。

5. 点 **Save and Deploy**，完成后访问 `https://cf-static.<你的账号名>.workers.dev`。
6. 之后任何推送到 `main` 的提交都会自动构建发布；其他分支会生成独立 Preview 地址。

---

## 二、新增一个项目

### 只走路径访问（零配置）

在 `public/` 下新建文件夹并放入入口文件：

```
public/blog/index.html
```

推送后即可访问 `https://<你的域名>/blog/`。

### 需要独立域名

1. 在 `src/projects.js` 注册一行（`title` 用于项目索引页显示）：

   ```js
   export const PROJECTS = {
     life: { title: "栖 · 生活工作台", domains: [] },
     blog: { title: "随手记", domains: ["blog.example.com"] },
   };
   ```

2. 到 Cloudflare：选中 **cf-static** 这个 Worker → **Settings** → **Domains & Routes** → **Add** →
   **Custom domain**，填入 `blog.example.com`。
   一个 Worker 可以挂任意多个自定义域名，路由脚本靠 Host 头把它们区分开。

3. 推送后 `blog.example.com` 就会指向 `public/blog/`，绑定的域名也会显示在索引页上。

> 域名必须托管在同一个 Cloudflare 账号下。DNS 记录与证书会自动创建，通常几分钟内生效。

---

## 三、本地开发

```bash
npm install        # 首次执行
npm run dev        # 本地预览 http://localhost:8787
npm run deploy     # 手动部署（需先 npx wrangler login）
```

本地验证域名路由时，直接伪造 Host 头即可：

```bash
curl -H "Host: blog.example.com" http://localhost:8787/
```

> Windows 上若报 `@cloudflare/workerd-windows-64 could not be found`，执行
> `npm install @cloudflare/workerd-windows-64 --no-save` 补齐本地二进制，不影响云端构建。

---

## 四、几个关键设计取舍

**为什么静态根是 `public/` 而不是仓库根目录？**
`wrangler dev` 会监听静态根目录下的所有文件变动来做热重载，但它**不读取 `.assetsignore`**。
若把仓库根目录设为静态根，`.wrangler/state` 下 sqlite 的写入会不断触发重建，形成死循环，
`npm run dev` 完全不可用。收拢到独立子目录后，基础设施文件天然隔离，也顺带保证
`README.md`、`src/`、`package.json` 等不会被误上传（已验证均返回 404）。

**为什么不设置 `not_found_handling`？**
一旦设为 `404-page` 或 `single-page-application`，未命中的请求会被 Cloudflare 直接短路、不进 Worker，
按域名分发的逻辑就失效了。保持默认 `none`，未命中请求才会落到 `src/index.js`。

**为什么启用 `main` 而不是纯静态？**
纯静态 Worker 只能按路径分发，无法识别 Host 头，也就无法让每个项目拥有独立域名。
用路由脚本换来的是：一次部署覆盖全部项目，域名数量不受限。

**代价**：未命中的请求会消耗一次 Worker 调用；命中静态资源的请求仍是纯静态返回，不计费。

---

## 五、常见问题

| 现象 | 原因与处理 |
|---|---|
| 构建报 `Worker name mismatch` | `wrangler.jsonc` 的 `name` 与 Dashboard 里的 Worker 名不一致 |
| 新项目 404 | 确认入口文件是 `public/<项目名>/index.html`，且已推送 |
| 自定义域名访问仍是索引页 | 域名没写进 `src/projects.js` 的 `domains`，或尚未在 Worker 上添加 Custom domain |
| 本地 dev 反复重启 | 静态根被设成了仓库根目录，改回 `./public` |
| PWA 无法安装 | 必须通过 HTTPS 访问；`workers.dev` 子域名自带，自定义域名绑定后同样可用 |

## 六、备选方案：GitHub Actions 部署

Workers Builds 已覆盖自动部署，**默认无需启用 Actions**（避免重复部署）。
若希望 CI 完全留在 GitHub 侧（要跑测试、Lint 等），把 `.github/workflows/deploy.yml.example`
改名为 `deploy.yml`，配好 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 两个 Secret，
再到 Worker → **Settings** → **Builds** → **Disconnect** 停用 Workers Builds 即可。
