#!/usr/bin/env node
/**
 * sync-pwa.mjs · 把 shared/pwa-install.js 内联进各项目的 index.html
 *
 * 为什么需要它：
 *   PWA 能力要「一处维护、处处一致」，但交付物又必须保持单文件、零外部依赖
 *   （资料库页面无法引用外部脚本，静态托管下多一次请求也不划算）。
 *   所以真源放在 shared/，由本脚本把内容同步进各项目 HTML 的标记区之间。
 *
 * 用法：
 *   node tools/sync-pwa.mjs            写入（默认就地更新所有已接入项目）
 *   node tools/sync-pwa.mjs --check    只校验，发现不同步就以非 0 退出（可用于 CI）
 *   node tools/sync-pwa.mjs life       只处理指定项目
 *
 * 项目接入方式：在 <head> 里放一对标记，中间的内容由本脚本接管。
 *   <!-- PWA:INLINE:START -->
 *   <!-- PWA:INLINE:END -->
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "shared", "pwa-install.js");
const PUBLIC_DIR = join(ROOT, "public");

const START = (indent) =>
  `${indent}<!-- PWA:INLINE:START · 由 shared/pwa-install.js 生成，请勿手改；改完执行 node tools/sync-pwa.mjs -->`;
const END = (indent) => `${indent}<!-- PWA:INLINE:END -->`;

const BLOCK = /([ \t]*)(<!--\s*PWA:INLINE:START[^>]*?-->)([\s\S]*?)([ \t]*)(<!--\s*PWA:INLINE:END\s*-->)/;

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));

function discoverTargets() {
  if (only.length) return only.map((name) => join(PUBLIC_DIR, name, "index.html"));
  return readdirSync(PUBLIC_DIR)
    .filter((name) => {
      const p = join(PUBLIC_DIR, name);
      return statSync(p).isDirectory() && existsSync(join(p, "index.html"));
    })
    .map((name) => join(PUBLIC_DIR, name, "index.html"));
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function main() {
  const source = readFileSync(SOURCE, "utf8");

  // 内联进 <script> 的代码里绝不能出现 </script>，否则会提前闭合标签
  if (/<\/script/i.test(source)) {
    console.error("✗ shared/pwa-install.js 里出现了 </script，无法安全内联");
    process.exit(1);
  }

  const targets = discoverTargets();
  if (!targets.length) {
    console.error("✗ 没有找到任何项目（public/<项目>/index.html）");
    process.exit(1);
  }

  let changed = 0;
  let pending = 0;
  let missing = 0;

  for (const file of targets) {
    const label = relative(ROOT, file).replace(/\\/g, "/");
    if (!existsSync(file)) {
      console.error(`✗ ${label} 不存在`);
      missing++;
      continue;
    }

    const html = readFileSync(file, "utf8");
    const match = BLOCK.exec(html);
    if (!match) {
      console.log(`· ${label} 未接入（没有 PWA:INLINE 标记），跳过`);
      continue;
    }

    const eol = detectEol(html);
    const indent = match[1] || "    ";
    const body = [indent, "<script>", source.replace(/\n/g, eol + indent), indent, "</script>"].join(eol);
    const replaced = html.replace(BLOCK, `$1$2${eol}${body}${eol}${indent}$5`);

    if (replaced === html) {
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
    console.error(`\n共 ${pending} 个文件需要同步，请执行：node tools/sync-pwa.mjs`);
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
