/**
 * 项目注册表 —— 唯一的配置入口。
 *
 * 约定：仓库根目录下的每一个文件夹就是一个项目，
 *      文件夹名即项目名，同时也是路径访问入口 /<文件夹名>/。
 *      因此新增一个「只走路径」的项目，什么都不用改，加文件夹即可。
 *
 * 只有需要「独立域名」的项目，才在这里登记一条：
 *
 *   export const PROJECTS = {
 *     life: { title: "栖 · 生活工作台", domains: ["life.example.com"] },
 *     blog: { title: "随手记",           domains: ["blog.example.com", "www.example.com"] },
 *   };
 *
 * 字段说明
 *   title   —— 项目索引页上显示的名字，不填则回退到文件夹名
 *   domains —— 绑定到该项目的自定义域名（纯主机名，不带协议与路径）
 *              这些域名必须先以 Custom Domain 形式挂到同一个 Worker 上，
 *              路由脚本才能通过 Host 头把它们分辨出来。
 *              留空表示该项目只能通过 /<文件夹名>/ 路径访问。
 */
export const PROJECTS = {
  life: {
    title: "栖 · 生活工作台",
    domains: [],
  },
};
