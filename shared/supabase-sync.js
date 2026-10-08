/**
 * supabase-sync.js · Supabase 持久化共享模块（真源）
 *
 * 单一真源：shared/supabase-sync.js
 * 各项目 HTML 里的内联副本由 `node tools/sync-supabase.mjs` 生成，请勿直接修改副本。
 *
 * ── 它做什么 ─────────────────────────────────────────────────────────
 *   1. 懒加载 Supabase JS SDK（走 CDN 的 ESM 构建，动态 import），拿到并复用同一个客户端实例
 *   2. 用配置里的 url / anonKey 做可用性校验；没配就明确进入「未配置」状态，绝不假装成功
 *   3. 收敛 CRUD 原语（select / insert / update / remove），统一返回 { data, error }，永不抛异常
 *   4. 对外广播同步状态（未配置 / 连接中 / 已连接 / 连接失败），供页面渲染提示条
 *
 * ── 它不做什么 ───────────────────────────────────────────────────────
 *   不做业务字段映射、不做合并策略、不做重试编排。
 *   账本与日常集的数据形状完全不同，这部分留在各自页面里，模块只提供通用底座。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────
 *   SupabaseSync.configure({
 *     url: 'https://xxxxxxxx.supabase.co',
 *     anonKey: 'eyJhbGciOi...',
 *     tables: ['ledger_expenses', 'ledger_summaries', 'ledger_settings']
 *   });
 *
 *   SupabaseSync.ready().then(function (client) { ... });   // 未配置 / 加载失败时 resolve(null)
 *   SupabaseSync.select('ledger_expenses', { order: 'date' }).then(function (r) {
 *     if (r.error) { ... } else { ... r.data ... }
 *   });
 *   SupabaseSync.onStatus(function (status) { ... });        // { phase, message }
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* SDK 来源：jsdelivr 的 ESM 端点为主，esm.sh 兜底。
     两个都是运行时拉取，因此页面本身仍是单文件、零构建。 */
  var SDK_URLS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
    'https://esm.sh/@supabase/supabase-js@2'
  ];

  /* 状态机的取值，页面据此决定提示条文案与颜色 */
  var PHASE = {
    UNCONFIGURED: 'unconfigured',   // 没填 url / anonKey
    LOADING: 'loading',             // 正在拉 SDK / 建立客户端
    READY: 'ready',                 // 客户端可用
    ERROR: 'error'                  // SDK 拉不下来或初始化失败
  };

  var state = {
    config: null,
    client: null,
    loading: null,
    error: null,
    status: { phase: PHASE.UNCONFIGURED, message: '', at: 0 },
    listeners: []
  };

  /* ---------------- 工具 ---------------- */

  function isHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function normalizeError(err, fallback) {
    if (!err) return { message: fallback || '未知错误', code: '', raw: null };
    if (typeof err === 'string') return { message: err, code: '', raw: err };
    var message = err.message || err.error_description || err.hint || err.details || fallback || '未知错误';
    return { message: String(message), code: String(err.code || err.status || ''), raw: err };
  }

  function emit() {
    var snapshot = { phase: state.status.phase, message: state.status.message, at: state.status.at };
    state.listeners.slice().forEach(function (fn) {
      try { fn(snapshot); } catch (e) { /* 订阅方自己出错，不影响其他人 */ }
    });
  }

  function setStatus(phase, message) {
    state.status = { phase: phase, message: message || '', at: Date.now() };
    emit();
  }

  /* ---------------- 配置 ---------------- */

  /**
   * 记录配置并判定是否具备联网条件。
   * 只做校验并同步返回结果，不在这里发起任何网络请求 —— 加载是 ready() 的事。
   */
  function configure(cfg) {
    cfg = cfg || {};
    var url = isNonEmptyString(cfg.url) ? cfg.url.trim() : '';
    var anonKey = isNonEmptyString(cfg.anonKey) ? cfg.anonKey.trim() : '';
    var problems = [];

    if (!url) problems.push('缺少 Supabase 项目 URL');
    else if (!isHttpUrl(url)) problems.push('项目 URL 不是合法的 http(s) 地址');

    if (!anonKey) problems.push('缺少 anon public key');

    state.config = {
      url: url,
      anonKey: anonKey,
      tables: Array.isArray(cfg.tables) ? cfg.tables.slice() : [],
      options: cfg.options && typeof cfg.options === 'object' ? cfg.options : {},
      sdkUrls: Array.isArray(cfg.sdkUrls) && cfg.sdkUrls.length ? cfg.sdkUrls.slice() : SDK_URLS
    };

    // 配置变了，之前建立的客户端作废
    state.client = null;
    state.loading = null;
    state.error = null;

    if (problems.length) {
      setStatus(PHASE.UNCONFIGURED, problems.join('；'));
      return { configured: false, problems: problems };
    }

    setStatus(PHASE.LOADING, '');
    return { configured: true, problems: [] };
  }

  function isConfigured() {
    return Boolean(state.config && state.config.url && state.config.anonKey);
  }

  /* ---------------- SDK 加载 ---------------- */

  function importSdk(url) {
    // 经典脚本里同样允许动态 import()，因此不需要给 <script> 加 type="module"
    return import(/* webpackIgnore: true */ url);
  }

  function loadSdk(urls) {
    var failures = [];
    function attempt(index) {
      if (index >= urls.length) {
        return Promise.reject(new Error(failures.join(' | ') || '没有可用的 SDK 地址'));
      }
      return importSdk(urls[index]).catch(function (err) {
        failures.push(urls[index] + ' → ' + normalizeError(err).message);
        return attempt(index + 1);
      });
    }
    return attempt(0);
  }

  /**
   * 确保客户端就绪。
   *   - 未配置           → resolve(null)，不发请求
   *   - 已配置，首次调用  → 拉 SDK 并 createClient，后续复用同一个实例
   *   - 加载失败         → resolve(null)，state.error 里带上原因；再次调用会重试
   */
  function ready() {
    if (!isConfigured()) return Promise.resolve(null);
    if (state.client) return Promise.resolve(state.client);
    if (state.loading) return state.loading;

    setStatus(PHASE.LOADING, '');

    state.loading = loadSdk(state.config.sdkUrls)
      .then(function (mod) {
        var createClient = mod && (mod.createClient || (mod.default && mod.default.createClient));
        if (typeof createClient !== 'function') throw new Error('SDK 未导出 createClient');
        var client = createClient(state.config.url, state.config.anonKey, state.config.options);
        state.client = client;
        state.error = null;
        setStatus(PHASE.READY, '');
        return client;
      })
      .catch(function (err) {
        state.loading = null;          // 允许下一次 ready() 重试
        state.error = normalizeError(err, 'Supabase SDK 加载失败');
        setStatus(PHASE.ERROR, state.error.message);
        return null;
      });

    return state.loading;
  }

  /* ---------------- CRUD 原语 ---------------- */

  function requireClient() {
    if (!isConfigured()) {
      return Promise.reject(normalizeError(null, 'Supabase 尚未配置'));
    }
    return ready().then(function (client) {
      if (!client) throw (state.error || normalizeError(null, 'Supabase 未就绪'));
      return client;
    });
  }

  /* 统一出口：把 supabase-js 的 { data, error } 与各种异常都收敛成同一种形状 */
  function run(factory) {
    return requireClient()
      .then(function (client) { return factory(client); })
      .then(function (res) {
        if (res && res.error) return { data: null, error: normalizeError(res.error) };
        return { data: res ? res.data : null, error: null };
      })
      .catch(function (err) {
        return { data: null, error: normalizeError(err) };
      });
  }

  function buildSelect(query, opts) {
    var q = query.select(opts.columns || '*');
    var where = opts.eq || {};
    Object.keys(where).forEach(function (key) {
      if (where[key] === undefined || where[key] === null) return;
      q = q.eq(key, where[key]);
    });
    if (Array.isArray(opts.in) && opts.in.length === 2 && Array.isArray(opts.in[1])) {
      q = q.in(opts.in[0], opts.in[1]);
    }
    // order 可以是一个列名，也可以是列名数组（按序作为排序键，分页时更稳定）
    if (opts.order) {
      var ascending = opts.ascending !== false;
      var columns = Array.isArray(opts.order) ? opts.order : [opts.order];
      columns.forEach(function (column) { q = q.order(column, { ascending: ascending }); });
    }
    if (Array.isArray(opts.range) && opts.range.length === 2) {
      q = q.range(Number(opts.range[0]) || 0, Number(opts.range[1]) || 0);
    }
    if (opts.limit) q = q.limit(opts.limit);
    return q;
  }

  /** 条件查询；opts: { columns, eq, in, order, ascending, range, limit } */
  function select(table, opts) {
    opts = opts || {};
    return run(function (client) { return buildSelect(client.from(table), opts); });
  }

  /**
   * 分页取全量。
   * PostgREST 单次响应有条数上限（默认 1000），日报类数据攒几年就会超，
   * 所以这里用 range 逐页拉，直到某页返回不足一页为止。
   */
  function selectAll(table, opts) {
    opts = opts || {};
    var pageSize = opts.pageSize || 1000;
    var maxPages = opts.maxPages || 50;
    var collected = [];

    function page(index) {
      if (index >= maxPages) return Promise.resolve({ data: collected, error: null });
      var pageOpts = Object.assign({}, opts, { range: [index * pageSize, index * pageSize + pageSize - 1] });
      delete pageOpts.pageSize;
      delete pageOpts.maxPages;
      return select(table, pageOpts).then(function (res) {
        if (res.error) return { data: null, error: res.error };
        var rows = res.data || [];
        collected = collected.concat(rows);
        if (rows.length < pageSize) return { data: collected, error: null };
        return page(index + 1);
      });
    }

    return page(0);
  }

  /** 插入单行并回读整行；id 由调用方提供（用应用自己的 uid） */
  function insert(table, row) {
    return run(function (client) {
      return client.from(table).insert(row).select().maybeSingle();
    });
  }

  /** 批量插入 —— 用于一次性把本地存量数据推上去 */
  function insertMany(table, rows) {
    if (!Array.isArray(rows) || !rows.length) return Promise.resolve({ data: [], error: null });
    return run(function (client) {
      return client.from(table).insert(rows).select();
    });
  }

  /** 以 id 为主键的部分更新 */
  function update(table, id, patch) {
    return run(function (client) {
      return client.from(table).update(patch).eq('id', id).select().maybeSingle();
    });
  }

  /** upsert：id 冲突时覆盖，用于「先本地、后补传」的场景 */
  function upsert(table, row) {
    return run(function (client) {
      return client.from(table).upsert(row, { onConflict: 'id' }).select().maybeSingle();
    });
  }

  /** 按主键删除 */
  function remove(table, id) {
    return run(function (client) {
      return client.from(table).delete().eq('id', id);
    });
  }

  /* ---------------- 对外接口 ---------------- */

  function onStatus(fn) {
    if (typeof fn !== 'function') return function () {};
    state.listeners.push(fn);
    try { fn({ phase: state.status.phase, message: state.status.message, at: state.status.at }); } catch (e) {}
    return function () {
      state.listeners = state.listeners.filter(function (item) { return item !== fn; });
    };
  }

  /** 当前状态的一句话描述，未配置时把「缺什么」说清楚，方便直接贴到页面上 */
  function describe() {
    switch (state.status.phase) {
      case PHASE.READY: return '已连接 Supabase';
      case PHASE.LOADING: return '正在连接 Supabase…';
      case PHASE.ERROR: return 'Supabase 连接失败：' + state.status.message;
      default: return 'Supabase 未配置：' + (state.status.message || '请填写项目 URL 与 anon key');
    }
  }

  var api = {
    VERSION: VERSION,
    PHASE: PHASE,
    configure: configure,
    isConfigured: isConfigured,
    ready: ready,
    select: select,
    selectAll: selectAll,
    insert: insert,
    insertMany: insertMany,
    update: update,
    upsert: upsert,
    remove: remove,
    onStatus: onStatus,
    describe: describe,
    normalizeError: normalizeError,
    /** 只读快照，便于调试时在控制台查看 */
    status: function () {
      return {
        phase: state.status.phase,
        message: state.status.message,
        configured: isConfigured(),
        hasClient: Boolean(state.client),
        error: state.error
      };
    }
  };

  global.SupabaseSync = api;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : this);
