/*!
 * pwa-install.js · 通用「安装为应用（PWA）」能力
 *
 * 单一真源：shared/pwa-install.js
 * 各项目 HTML 里的内联副本由 `node tools/sync-pwa.mjs` 生成，请勿直接修改副本。
 *
 * ── 两个必须遵守的事实（都是实测出来的）─────────────────────────────
 * 1. manifest 里的 start_url / id / scope 必须是**绝对地址**。
 *    用 data:URI 承载 manifest 时，相对地址会以 data: 为基准解析，必然失败，
 *    浏览器随即判定 start-url-not-valid，beforeinstallprompt 永不触发 —— 原生安装
 *    链路直接断掉，用户点按钮只会看到手动指引。补上绝对地址后安装性问题清零。
 * 2. 不需要 Service Worker。保持单文件交付，不额外产生可缓存资源。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   PWAInstall.init({
 *     name: '打工人小账本',
 *     shortName: '小账本',
 *     description: '…',
 *     iconSvg: '<svg xmlns="…" viewBox="0 0 24 24">…</svg>',  // 完整图标，须自带背景
 *     brandColor: '#16856f',            // mask-icon / 主题色 / 浮层主色
 *     themeColor: { light: '#f8f5ed', dark: '#111b1b' },      // 状态栏配色联动
 *     buttons: '.pwa-install-button',   // 触发安装的按钮
 *     toast: function (msg) { … },      // 可选，不传则用内置轻提示
 *     strings: { … }                    // 可选，覆盖内置中英文案
 *   });
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var GUIDE_ID = 'pwa-install-guide';

  var TEXT = {
    zh: {
      cta: '装到桌面', ctaShort: '装桌面', ready: '安装应用',
      already: '已经是桌面应用了', accepted: '已开始安装…', cancelled: '已取消',
      done: '已添加到桌面，可从主屏幕打开',
      guideTitle: '添加到手机桌面',
      guideDesc: '装成应用后全屏运行、不显示地址栏，可从主屏幕直接打开。',
      ios1: '点底部「分享」按钮（方框向上箭头）',
      ios2: '向下滑动，选择「添加到主屏幕」',
      ios3: '点右上角「添加」',
      android1: '点右上角「⋯」菜单',
      android2: '选择「安装应用」或「添加到主屏幕」',
      android3: '确认后主屏即出现图标',
      ok: '知道了'
    },
    en: {
      cta: 'Install app', ctaShort: 'Install', ready: 'Install app',
      already: 'Already running as an app', accepted: 'Installing…', cancelled: 'Cancelled',
      done: 'Added to home screen',
      guideTitle: 'Add to home screen',
      guideDesc: 'Installed apps run full screen without the address bar and open from your home screen.',
      ios1: 'Tap the Share button (square with an arrow)',
      ios2: 'Scroll down and choose "Add to Home Screen"',
      ios3: 'Tap "Add"',
      android1: 'Open the "⋯" menu',
      android2: 'Choose "Install app" or "Add to Home screen"',
      android3: 'Confirm — the icon appears on your home screen',
      ok: 'Got it'
    }
  };

  var STYLE_ID = 'pwa-install-style';
  var STYLE = [
    '.pwa-guide{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'padding:20px;background:rgba(18,28,27,.44);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}',
    '.pwa-guide[hidden]{display:none}',
    '.pwa-guide-card{width:min(360px,100%);padding:22px 22px 18px;border-radius:18px;font-family:inherit;',
    'background:#fffdf7;color:#2c3331;box-shadow:0 18px 48px rgba(16,30,28,.24);box-sizing:border-box}',
    '.pwa-guide-card h3{margin:0 0 6px;font-size:16px;font-weight:600;line-height:1.4}',
    '.pwa-guide-desc{margin:0 0 14px;font-size:13px;line-height:1.65;color:#6c7c79}',
    '.pwa-guide-steps{margin:0 0 18px;padding-left:19px;font-size:13.5px;line-height:1.95}',
    '.pwa-guide-steps li{margin:0}',
    '.pwa-guide-close{width:100%;padding:11px;border:0;border-radius:12px;font:inherit;font-size:14px;',
    'cursor:pointer;background:#16856f;color:#fff}',
    '.pwa-guided{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483000;',
    'max-width:80vw;padding:9px 16px;border-radius:999px;font-size:13px;line-height:1.5;',
    'background:rgba(18,28,27,.88);color:#f3faf7;opacity:0;transition:opacity .2s ease}',
    '.pwa-guided.is-on{opacity:1}',
    'html[data-theme="dark"] .pwa-guide-card{background:#14201f;color:#e8f2ef}',
    'html[data-theme="dark"] .pwa-guide-desc{color:#9db0ad}',
    'html[data-theme="dark"] .pwa-guide-close{background:var(--pwa-brand,#2aa88b);color:#08201b}',
    '@media (prefers-color-scheme:dark){',
    'html:not([data-theme="light"]) .pwa-guide-card{background:#14201f;color:#e8f2ef}',
    'html:not([data-theme="light"]) .pwa-guide-desc{color:#9db0ad}}',
    '@media (prefers-reduced-motion:reduce){.pwa-guide-card{animation:none}}'
  ].join('');

  var state = { cfg: null, prompt: null, toastEl: null, toastTimer: 0, ready: false };

  /* ───────────── 小工具 ───────────── */

  function b64(text) {
    try { return global.btoa(unescape(encodeURIComponent(text))); } catch (e) { return ''; }
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) { for (var k in attrs) { if (attrs[k] != null) node.setAttribute(k, attrs[k]); } }
    if (text != null) node.textContent = text;
    return node;
  }

  function pickLang(cfg) {
    if (cfg.lang === 'zh' || cfg.lang === 'en') return cfg.lang;
    var tag = (document.documentElement.getAttribute('lang') || global.navigator.language || 'zh');
    return /^en/i.test(tag) ? 'en' : 'zh';
  }

  function strings(cfg) {
    var base = TEXT[pickLang(cfg)] || TEXT.zh;
    var out = {};
    for (var k in base) out[k] = base[k];
    if (cfg.strings) { for (var j in cfg.strings) out[j] = cfg.strings[j]; }
    return out;
  }

  function isStandalone() {
    try {
      var byMedia = global.matchMedia && global.matchMedia('(display-mode: standalone)').matches;
      return Boolean(byMedia) || global.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function defaultIconSvg(color) {
    var c = color || '#16856f';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<rect width="24" height="24" rx="5" fill="' + c + '"/>' +
      '<g fill="none" stroke="#fffdf7" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="6.3"/>' +
      '<path d="M12 8.4v1.2M12 14.4v1.2M10.3 10.3h2.3a1.35 1.35 0 0 1 0 2.7h-1.2a1.35 1.35 0 0 0 0 2.7h2.3"/>' +
      '</g></svg>';
  }

  /* 给一个 SVG 补上显式宽高，供 canvas / 图片使用 */
  function sizedSvg(svg, size) {
    if (/<svg[^>]*\swidth=/.test(svg)) return svg;
    return svg.replace(/<svg/, '<svg width="' + size + '" height="' + size + '"');
  }

  /* 把 SVG 栅格化成 PNG（供 iOS 的 apple-touch-icon 用；失败就静默放弃） */
  function rasterize(svg, size, done) {
    var img;
    try { img = new Image(); } catch (e) { done(null); return; }
    img.onload = function () {
      try {
        var cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        done(cv.toDataURL('image/png'));
      } catch (e) { done(null); }
    };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sizedSvg(svg, size));
  }

  /* ───────────── head 注入 ───────────── */

  function ensureMeta(attr, key, content) {
    var node = document.head.querySelector('meta[' + attr + '="' + key + '"]');
    if (!node) { node = el('meta'); node.setAttribute(attr, key); document.head.appendChild(node); }
    node.setAttribute('content', content);
    return node;
  }

  function ensureLink(rel, href, extra) {
    var node = document.head.querySelector('link[rel="' + rel + '"]');
    if (!node) { node = el('link', { rel: rel }); document.head.appendChild(node); }
    if (href) node.setAttribute('href', href);
    if (extra) { for (var k in extra) node.setAttribute(k, extra[k]); }
    return node;
  }

  function buildManifest(cfg, icon) {
    var start = global.location.origin + global.location.pathname;
    var scope = cfg.scope || (global.location.origin + '/');
    var manifest = {
      name: cfg.name,
      short_name: cfg.shortName || cfg.name,
      description: cfg.description || '',
      lang: pickLang(cfg),
      display: 'standalone',
      orientation: cfg.orientation || 'portrait',
      background_color: cfg.backgroundColor || (cfg.themeColor && cfg.themeColor.light) || '#ffffff',
      theme_color: cfg.brandColor || '#16856f',
      // 这三个必须是绝对地址，否则浏览器判定 start-url-not-valid
      start_url: start,
      id: start,
      scope: scope,
      icons: [{ src: icon.href, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
    };
    if (icon.apple) {
      manifest.icons.push({ src: icon.apple, sizes: '180x180', type: 'image/png', purpose: 'any' });
    }
    return 'data:application/manifest+json;base64,' + b64(JSON.stringify(manifest));
  }

  function ensureHead(cfg) {
    var svg = cfg.iconSvg || defaultIconSvg(cfg.brandColor);
    var icon = {
      href: 'data:image/svg+xml;base64,' + b64(svg),
      apple: cfg.appleIcon || ''
    };

    var manifestLink = document.head.querySelector('link[rel="manifest"]');
    if (!manifestLink) { manifestLink = el('link', { rel: 'manifest' }); document.head.appendChild(manifestLink); }
    manifestLink.setAttribute('href', buildManifest(cfg, icon));

    ensureMeta('name', 'application-name', cfg.name);
    ensureMeta('name', 'mobile-web-app-capable', 'yes');
    ensureMeta('name', 'apple-mobile-web-app-capable', 'yes');
    ensureMeta('name', 'apple-mobile-web-app-title', cfg.shortName || cfg.name);
    ensureMeta('name', 'apple-mobile-web-app-status-bar-style', cfg.statusBarStyle || 'default');
    ensureMeta('name', 'theme-color', themeColorFor(cfg));

    ensureLink('icon', icon.href, { type: 'image/svg+xml' });
    ensureLink('mask-icon', icon.href, { color: cfg.brandColor || '#16856f' });

    var appleLink = document.head.querySelector('link[rel="apple-touch-icon"]');
    if (cfg.appleIcon) {
      ensureLink('apple-touch-icon', cfg.appleIcon);
    } else if (!appleLink) {
      // 没有预烘 PNG：先挂 SVG 占位，随后异步栅格化成 180x180 PNG 替换
      ensureLink('apple-touch-icon', icon.href);
      rasterize(svg, 180, function (png) {
        if (png) ensureLink('apple-touch-icon', png);
      });
    }
    return icon;
  }

  /* ───────────── 主题色联动 ───────────── */

  function currentTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    try {
      if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (e) { /* 忽略 */ }
    return 'light';
  }

  function themeColorFor(cfg) {
    var pair = cfg.themeColor;
    if (!pair) return cfg.brandColor || '#16856f';
    if (typeof pair === 'string') return pair;
    return pair[currentTheme()] || pair.light || '#ffffff';
  }

  function syncThemeColor(cfg) {
    var meta = document.head.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColorFor(cfg));
  }

  function watchTheme(cfg) {
    syncThemeColor(cfg);
    if (!global.MutationObserver) return;
    var observer = new MutationObserver(function () { syncThemeColor(cfg); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    try {
      if (global.matchMedia) {
        var mq = global.matchMedia('(prefers-color-scheme: dark)');
        if (mq.addEventListener) mq.addEventListener('change', function () { syncThemeColor(cfg); });
        else if (mq.addListener) mq.addListener(function () { syncThemeColor(cfg); });
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ───────────── 轻提示（可被 cfg.toast 覆盖） ───────────── */

  function fallbackToast(message) {
    if (!state.toastEl) {
      state.toastEl = el('div', { class: 'pwa-guided', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(state.toastEl);
    }
    state.toastEl.textContent = message;
    state.toastEl.classList.add('is-on');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { state.toastEl.classList.remove('is-on'); }, 2200);
  }

  function toast(message) {
    try {
      if (typeof state.cfg.toast === 'function') state.cfg.toast(message);
      else fallbackToast(message);
    } catch (e) { /* 提示失败不影响主流程 */ }
  }

  /* ───────────── 手动指引浮层 ───────────── */

  function guideNode() {
    var node = document.getElementById(GUIDE_ID);
    if (node) return node;

    node = el('div', { class: 'pwa-guide', id: GUIDE_ID, hidden: 'hidden', role: 'dialog', 'aria-modal': 'true' });
    var card = el('div', { class: 'pwa-guide-card' });
    card.appendChild(el('h3', { id: GUIDE_ID + '-title' }));
    card.appendChild(el('p', { class: 'pwa-guide-desc', id: GUIDE_ID + '-desc' }));
    card.appendChild(el('ol', { class: 'pwa-guide-steps', id: GUIDE_ID + '-steps' }));
    card.appendChild(el('button', { class: 'pwa-guide-close', type: 'button', id: GUIDE_ID + '-ok' }));
    node.appendChild(card);

    node.addEventListener('click', function (event) {
      if (event.target === node) node.hidden = true;
    });
    return node;
  }

  function openGuide() {
    var cfg = state.cfg;
    var text = strings(cfg);
    var node = guideNode();

    node.querySelector('#' + GUIDE_ID + '-title').textContent = text.guideTitle;
    node.querySelector('#' + GUIDE_ID + '-desc').textContent = text.guideDesc;

    var ua = global.navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1);
    var steps = isIOS ? [text.ios1, text.ios2, text.ios3] : [text.android1, text.android2, text.android3];

    var list = node.querySelector('#' + GUIDE_ID + '-steps');
    list.textContent = '';
    steps.forEach(function (step) { list.appendChild(el('li', null, step)); });

    var ok = node.querySelector('#' + GUIDE_ID + '-ok');
    ok.textContent = text.ok;
    ok.onclick = function () { node.hidden = true; };

    if (!node.parentNode) document.body.appendChild(node);
    node.hidden = false;
  }

  /* ───────────── 按钮状态 ───────────── */

  function labelNodes() {
    var cfg = state.cfg;
    return Array.prototype.slice.call(document.querySelectorAll(cfg.buttons));
  }

  function setLabel(promptReady) {
    var text = strings(state.cfg);
    labelNodes().forEach(function (button) {
      button.setAttribute('data-pwa-ready', promptReady ? 'true' : 'false');
      var slot = button.querySelector('[data-pwa-label]') || button.querySelector('span');
      var label = promptReady
        ? text.ready
        : (button.getAttribute('data-pwa-short') != null ? text.ctaShort : text.cta);
      if (slot) slot.textContent = label;
      else button.textContent = label;
    });
  }

  function hideEntry() {
    labelNodes().forEach(function (button) {
      button.hidden = true;
      // 项目里的 .btn / .ghost 之类会设 display，优先级高于 UA 的 [hidden]，得显式压掉
      button.style.display = 'none';
    });
  }

  /* ───────────── 事件与启动 ───────────── */

  function bindGlobalEvents() {
    global.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      state.prompt = event;
      setLabel(true);
    });
    global.addEventListener('appinstalled', function () {
      state.prompt = null;
      setLabel(false);
      toast(strings(state.cfg).done);
      hideEntry();
    });
  }

  function bootUI() {
    var cfg = state.cfg;
    var text = strings(cfg);

    labelNodes().forEach(function (button) {
      button.addEventListener('click', function () {
        if (isStandalone()) { toast(text.already); return; }
        var prompt = state.prompt;
        if (!prompt) { openGuide(); return; }   // 无安装事件（iOS Safari 等）→ 手动指引
        prompt.prompt();
        var finish = function (choice) {
          state.prompt = null;
          setLabel(false);
          toast(choice && choice.outcome === 'accepted' ? text.accepted : text.cancelled);
        };
        try {
          Promise.resolve(prompt.userChoice).then(finish, function () { finish(null); });
        } catch (e) { finish(null); }
      });
    });

    setLabel(false);
    if (isStandalone()) hideEntry();
  }

  function init(cfg) {
    cfg = cfg || {};
    if (!cfg.name) throw new Error('PWAInstall.init: 缺少 name');
    state.cfg = cfg;

    if (!document.getElementById(STYLE_ID)) {
      var style = el('style', { id: STYLE_ID });
      style.textContent = STYLE;
      (document.head || document.documentElement).appendChild(style);
    }

    // head 部分要尽早：manifest 必须在文档解析早期就位
    ensureHead(cfg);
    watchTheme(cfg);
    bindGlobalEvents();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootUI);
    } else {
      bootUI();
    }
    state.ready = true;
    return api;
  }

  var api = {
    version: VERSION,
    init: init,
    isStandalone: isStandalone,
    openGuide: openGuide,
    setLabel: setLabel
  };

  global.PWAInstall = api;
})(window);
