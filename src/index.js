import { BASE_DOMAINS, PROJECTS, HOST_ALIASES } from "./projects.js";

// 内部资产主机名：改写路径后交给 assets 绑定，不对外暴露
const ASSET_HOST = "assets.local";
const ALLOWED_METHODS = new Set(["GET", "HEAD"]);
// 合法的一级子域名标签：小写字母、数字、中划线，首尾不能是中划线
const SUBDOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * 解析主机名归属。
 *   { project, base }       按项目分发，base 用于生成索引页回链
 *   { index: true }         展示项目索引
 *   { passthrough: true }   未接入域名（workers.dev 等），按原路径直通
 */
function resolveHost(hostname) {
  const alias = HOST_ALIASES[hostname];
  if (alias) return { project: alias };

  for (const base of BASE_DOMAINS) {
    if (hostname === base) return { index: true };
    if (!hostname.endsWith(`.${base}`)) continue;

    const label = hostname.slice(0, hostname.length - base.length - 1);
    if (label === "www") return { index: true };
    // 只接受一级子域名：更深层不在免费 Universal SSL 覆盖范围内
    if (!label.includes(".") && SUBDOMAIN_LABEL.test(label)) {
      return { project: label, base };
    }
  }

  return { passthrough: true };
}

export default {
  async fetch(request, env) {
    if (!ALLOWED_METHODS.has(request.method)) {
      return new Response("405 Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" },
      });
    }

    const url = new URL(request.url);
    const route = resolveHost(url.hostname.toLowerCase());

    // 项目子域名：把项目前缀拼回路径，再取资源
    if (route.project) {
      const assetPath =
        url.pathname === "/" ? `/${route.project}/` : `/${route.project}${url.pathname}`;
      const response = await fetchAsset(env, request, assetPath);
      if (response.status === 404) {
        const indexUrl = route.base ? `https://${route.base}/` : "/";
        return notFoundPage(route.project, url.pathname, indexUrl);
      }
      return stripProjectPrefix(response, route.project);
    }

    // 主域名与未接入域名：按原路径取资源，根路径回退到项目索引
    const response = await fetchAsset(env, request, url.pathname);
    if (response.status !== 404) return response;
    if (url.pathname === "/") return indexPage();
    return notFoundPage(null, url.pathname, "/");
  },
};

async function fetchAsset(env, request, pathname) {
  const assetUrl = new URL(request.url);
  assetUrl.protocol = "https:";
  assetUrl.hostname = ASSET_HOST;
  assetUrl.pathname = pathname;

  // redirect: manual —— 让 assets 层的 307/308 直接透出，浏览器地址栏才会跟着归一化，
  // 否则页面相对路径会基于错误的前缀解析。
  return env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    })
  );
}

// assets 层可能在 Location 里带上内部主机名或项目前缀，这里翻译回对外地址
function stripProjectPrefix(response, project) {
  if (response.status < 300 || response.status >= 400) return response;

  const location = response.headers.get("location");
  if (!location) return response;

  let target;
  try {
    target = new URL(location, `https://${ASSET_HOST}`);
  } catch {
    return response;
  }
  if (target.hostname !== ASSET_HOST) return response;

  let next = target.pathname + target.search;
  const prefix = `/${project}`;
  if (next === prefix || next.startsWith(`${prefix}/`)) {
    next = next.slice(prefix.length) || "/";
  }

  const headers = new Headers(response.headers);
  headers.set("location", next);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function indexPage() {
  const entries = Object.entries(PROJECTS);
  const base = BASE_DOMAINS[0];

  const items = entries
    .map(([name, title]) => {
      const meta = base ? `<span class="meta">${esc(`${name}.${base}`)}</span>` : "";
      return `<li><a href="/${esc(name)}/">${esc(title)}</a>${meta}</li>`;
    })
    .join("");

  const body = entries.length
    ? `<h1>项目索引</h1><ul class="list">${items}</ul>`
    : `<h1>项目索引</h1><p class="meta">尚未登记任何项目</p>`;

  return html(body, "项目索引");
}

function notFoundPage(project, pathname, indexUrl) {
  const body = `<h1>404</h1><p>没有找到 <code>${esc(pathname)}</code></p><p><a href="${esc(indexUrl)}">返回项目索引</a></p>`;
  return html(body, project ? `${project} · 未找到` : "未找到", 404);
}

function html(body, title, status = 200) {
  return new Response(
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f1ea; color: #2c2c2a;
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
main { width: min(560px, 88vw); padding: 40px 0; }
h1 { font-size: 20px; font-weight: 500; margin: 0 0 16px; }
p { margin: 0 0 12px; }
a { color: #185fa5; text-decoration: none; }
a:hover { text-decoration: underline; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.list li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 12px 16px; background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; }
.meta { font-size: 12px; color: #888780; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
  background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 6px; padding: 1px 6px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    }
  );
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}
