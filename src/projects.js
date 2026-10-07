/**
 * 项目路由配置 —— 唯一的配置入口。
 *
 * ── 主域名 ──────────────────────────────────────────────
 * 一级子域名自动映射到同名项目文件夹，新增项目零配置：
 *
 *     skywitty.win        →  项目索引页
 *     www.skywitty.win    →  项目索引页
 *     life.skywitty.win   →  public/life/
 *     blog.skywitty.win   →  public/blog/
 *     <任意>.skywitty.win →  public/<任意>/
 *
 * 免费版 Universal SSL 覆盖主域名与其一级子域名，HTTPS 无需额外配置；
 * 不支持 a.b.skywitty.win 这类二级子域名（需付费 ACM）。
 *
 * ── 项目显示名（可选）────────────────────────────────────
 * 不登记也能正常访问，登记只是为了在索引页显示一个好看的名字。
 *
 * ── 例外映射 ────────────────────────────────────────────
 * 某个主机名需要指向非同名文件夹时，在 HOST_ALIASES 里覆盖。
 */

export const BASE_DOMAINS = ["skywitty.win"];

export const PROJECTS = {
  life: "栖 · 生活工作台",
  ledger: "打工人小账本",
};

export const HOST_ALIASES = {
  // "www.skywitty.win": "life",
};
