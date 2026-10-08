#!/usr/bin/env node
/**
 * sync-supabase.mjs · 把 shared/supabase-sync.js 内联进接入项目的 HTML
 *
 * 为什么需要它（与 tools/sync-pwa.mjs 完全同因）：
 *   Supabase 接入逻辑要「一处维护、处处一致」，但交付物必须保持单文件、零外部依赖
 *   （除了运行时从 CDN 拉一份 Supabase SDK）。真源放在 shared/，由本脚本同步进标记区。
 *
 * 用法：
 *   node tools/sync-supabase.mjs              写入（就地更新所有已接入文件）
 *   node tools/sync-supabase.mjs --check      只校验，发现不同步以非 0 退出（可用于 CI）
 *   node tools/sync-supabase.mjs ledger/online.html   只处理指定文件（相对 public/）
 *
 * 接入方式：在目标 HTML 里放一对标记，中间内容由本脚本接管。
 *   <!-- SUPABASE:INLINE:START -->
 *   <!-- SUPABASE:INLINE:END -->
 *
 * 与 sync-pwa.mjs 的差别：目标发现方式不同。
 *   sync-pwa 只认 public/<项目>/index.html（每个项目一个入口）；
 *   本脚本扫描 public/<项目>/ 下的全部 .html，凡是带标记的都处理 ——
 *   因为账本与日常集的 Supabase 版是 online.html，与 index.html 并存。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "shared", "supabase-sync.js");
const PUBLIC_DIR = join(ROOT, "public");

const BLOCK =
  /([ \t]*)(<!--\s*SUPABASE:INLINE:START[^>]*?-->)([\s\S]*?)([ \t]*)(<!--\s*SUPABASE:INLINE:END\s*-->)/;

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));

function discoverTargets() {
  if (only.length) return only.map((name) => join(PUBLIC_DIR, name));

  const targets = [];
  for (const name of readdirSync(PUBLIC_DIR)) {
    const dir = join(PUBLIC_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (file.toLowerCase().endsWith(".html")) targets.push(join(dir, file));
    }
  }
  return targets;
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// 比较时忽略换行符差异，避免 Windows/Linux 检出差异把 CI 误判成「未同步」
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

function main() {
  const source = readFileSync(SOURCE, "utf8");

  if (/<\/script/i.test(source)) {
    console.error("✗ shared/supabase-sync.js 里出现了 </script，无法安全内联");
    process.exit(1);
  }

  const targets = discoverTargets();
  if (!targets.length) {
    console.error("✗ 没有找到任何目标文件（public/<项目>/*.html）");
    process.exit(1);
  }

  let changed = 0;
  let pending = 0;
  let missing = 0;
  let joined = 0;

  for (const file of targets) {
    const label = relative(ROOT, file).replace(/\\/g, "/");
    if (!existsSync(file)) {
      console.error(`✗ ${label} 不存在`);
      missing++;
      continue;
    }

    const html = readFileSync(file, "utf8");
    const match = BLOCK.exec(html);
    if (!match) continue; // 未接入，静默跳过
    joined++;

    const eol = detectEol(html);
    const indent = match[1] || "    ";
    // 真源先压成 LF 再按目标换行重排：真源若是 CRLF，直接替换 \n 会生成 \r\r\n
    const indented = normalizeEol(source)
      .split("\n")
      .map((line) => (line ? indent + line : line))
      .join(eol);
    const replacement = [
      indent + match[2],
      indent + "<script>",
      indented,
      indent + "</script>",
      indent + match[5],
    ].join(eol);
    const replaced = html.replace(BLOCK, () => replacement);

    if (normalizeEol(replaced) === normalizeEol(html)) {
      console.log(`· ${label} 已是最新`);
      continue;
    }

    const before = html.length;
    const after = replaced.length;
    if (checkOnly) {
      console.error(`✗ ${label} 与真源不同步（${before} → ${after} 字节）`);
      pending++;
    } else {
      writeFileSync(file, replaced, "utf8");
      console.log(`✓ ${label} 已同步（${before} → ${after} 字节）`);
      changed++;
    }
  }

  if (checkOnly && pending) {
    console.error(`\n共 ${pending} 个文件需要同步，请执行：node tools/sync-supabase.mjs`);
    process.exit(1);
  }

  if (!joined) {
    console.error("✗ 没有任何文件带 SUPABASE:INLINE 标记，检查标记是否写对");
    process.exit(1);
  }

  console.log(
    checkOnly
      ? `\n检查完成：全部同步（真源 ${source.length} 字节，v${readVersion(source)}）`
      : `\n完成：更新 ${changed} 个文件（真源 ${source.length} 字节，v${readVersion(source)}）`
  );

  if (missing) process.exit(1);
}

function readVersion(source) {
  const m = /var VERSION = '([^']+)'/.exec(source);
  return m ? m[1] : "?";
}

main();
