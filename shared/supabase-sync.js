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
 *   5. 身份层：邮箱密码登录 / 注册 / 退出 / 重置密码，外加一个零依赖的登录门禁与账户菜单
 *
 * ── 它不做什么 ───────────────────────────────────────────────────────
 *   不做业务字段映射、不做合并策略、不做重试编排。
 *   账本与日常集的数据形状完全不同，这部分留在各自页面里，模块只提供通用底座。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────
 *   SupabaseSync.configure({
 *     url: 'https://xxxxxxxx.supabase.co',
 *     anonKey: 'eyJhbGciOi...',
 *     tables: ['ledger_expenses', 'ledger_summaries', 'ledger_settings'],
 *     requireAuth: true            // 未登录一律拒绝读写，避免落到默认空间
 *   });
 *
 *   SupabaseSync.ready().then(function (client) { ... });   // 未配置 / 加载失败时 resolve(null)
 *   SupabaseSync.select('ledger_expenses', { order: 'date' }).then(function (r) {
 *     if (r.error) { ... } else { ... r.data ... }
 *   });
 *   SupabaseSync.onStatus(function (status) { ... });        // { phase, message }
 *
 *   // 身份：先 initAuth() 恢复会话，再按 userId 决定数据空间
 *   SupabaseSync.onAuthChange(function (info) {              // { userId, email, signedIn }
 *     SUPABASE_SPACE = info.userId || 'default';
 *     if (info.signedIn) pullAllRemote();
 *   });
 *   SupabaseSync.initAuth();
 *   SupabaseSync.authGate({ title: '打工人小账本', mount: '.topbar-tools', text: t });
 */
(function (global) {
  'use strict';

  var VERSION = '1.2.0';

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
   *
   * requireAuth: true 时，未登录的 CRUD 调用会被直接拒绝，
   * 避免「忘了登录却把数据写进默认空间」这种静默串号。
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
      requireAuth: Boolean(cfg.requireAuth),
      sdkUrls: Array.isArray(cfg.sdkUrls) && cfg.sdkUrls.length ? cfg.sdkUrls.slice() : SDK_URLS
    };

    // 配置变了，之前建立的客户端作废；身份也要重新判定一次
    state.client = null;
    state.loading = null;
    state.error = null;
    auth.resolved = false;

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

  /* 只保证客户端可用，不看登录态 —— 登录/注册这类调用要靠它 */
  function rawClient() {
    if (!isConfigured()) {
      return Promise.reject(normalizeError(null, 'Supabase 尚未配置'));
    }
    return ready().then(function (client) {
      if (!client) throw (state.error || normalizeError(null, 'Supabase 未就绪'));
      return client;
    });
  }

  /* 业务读写走这个：requireAuth 打开时，未登录一律拒绝，绝不写到默认空间去 */
  function requireClient() {
    return rawClient().then(function (client) {
      if (state.config && state.config.requireAuth && !auth.user) {
        throw normalizeError(null, '需要先登录才能读写云端数据');
      }
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

  /**
   * 批量 upsert —— 用于「把一段存量数据并进云端」这类一次多条的场景。
   * 与 insertMany 的差别：遇到已存在的主键是覆盖而不是报错，所以
   * 「另一台设备/另一个会话刚好也写过同一行」不会让整批失败。
   * 分片串行发送：单次请求体别太大，也不要一次并发几十个请求把连接打满。
   * 返回 { data, error }，任一批失败即停止，已成功的部分保留。
   */
  function upsertMany(table, rows, chunkSize) {
    var list = (Array.isArray(rows) ? rows : []).filter(Boolean);
    if (!list.length) return Promise.resolve({ data: [], error: null });
    var size = chunkSize > 0 ? chunkSize : 200;
    var groups = [];
    for (var i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));

    return groups.reduce(function (chain, group) {
      return chain.then(function (acc) {
        if (acc.error) return acc;                     // 前一批已失败，后面的不再发
        return run(function (client) {
          return client.from(table).upsert(group, { onConflict: 'id' }).select();
        }).then(function (res) {
          if (res && res.error) return { data: acc.data, error: res.error };
          return { data: acc.data.concat((res && res.data) || []), error: null };
        });
      });
    }, Promise.resolve({ data: [], error: null }));
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

  /* ================= 身份：Supabase Auth =================
     目的：同一套部署给多位家庭成员用，各人数据互不可见。
     隔离依据是 `space` 列 = auth.uid()::text，由 schema.sql 的 RLS 策略在数据库端强制；
     客户端根本拿不到别人的行 —— 换账号登录即换数据空间，不是「前端过滤」那种假隔离。 */

  var auth = {
    session: null,
    user: null,
    listeners: [],
    recoveryListeners: [],
    watching: false,
    /* initAuth() 读完本机会话前为 false。门禁靠它区分
       「回放出来的空状态」和「确定没登录」，避免已登录用户刷新时闪一下登录框。 */
    resolved: false
  };

  function cleanEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
  }

  function sessionUserId(session) {
    return session && session.user ? String(session.user.id) : '';
  }

  function authSnapshot() {
    return {
      user: auth.user,
      session: auth.session,
      userId: auth.user ? String(auth.user.id) : '',
      email: auth.user && auth.user.email ? String(auth.user.email) : '',
      signedIn: Boolean(auth.user),
      resolved: Boolean(auth.resolved)
    };
  }

  function emitAuth() {
    var snap = authSnapshot();
    auth.listeners.slice().forEach(function (fn) { try { fn(snap); } catch (e) { /* 订阅方自己出错不影响别人 */ } });
  }

  function emitRecovery() {
    auth.recoveryListeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function setSession(session) {
    var before = sessionUserId(auth.session);
    var next = session || null;
    auth.session = next;
    auth.user = next && next.user ? next.user : null;
    // 只在「换了人」时广播：token 每小时自动续期不该触发页面重新拉数据
    if (sessionUserId(next) !== before) emitAuth();
  }

  /** 订阅登录态变化，订阅瞬间会回放一次当前状态，页面不必自己猜初始值 */
  function onAuthChange(fn) {
    if (typeof fn !== 'function') return function () {};
    auth.listeners.push(fn);
    try { fn(authSnapshot()); } catch (e) {}
    return function () {
      auth.listeners = auth.listeners.filter(function (item) { return item !== fn; });
    };
  }

  /** 用户点了「重置密码」邮件里的链接后触发，页面据此弹出「设置新密码」 */
  function onPasswordRecovery(fn) {
    if (typeof fn !== 'function') return function () {};
    auth.recoveryListeners.push(fn);
    return function () {
      auth.recoveryListeners = auth.recoveryListeners.filter(function (item) { return item !== fn; });
    };
  }

  /**
   * 建立会话监听并读取当前会话（含刷新页面后从 localStorage 恢复）。
   * 注意：onAuthStateChange 的回调里绝不能再调 supabase 接口，官方明确提示会死锁，
   * 所以这里只做状态同步，真正的拉数据交给页面的 onAuthChange 监听。
   */
  function initAuth() {
    if (!isConfigured()) return Promise.resolve(null);
    return ready().then(function (client) {
      if (!client || !client.auth) return null;
      if (!auth.watching) {
        auth.watching = true;
        try {
          client.auth.onAuthStateChange(function (event, session) {
            setSession(session);
            if (event === 'PASSWORD_RECOVERY') emitRecovery();
          });
        } catch (e) { /* 监听不可用时，下面的 getSession 仍然能读到会话 */ }
      }
      return client.auth.getSession().then(function (res) {
        setSession(res && !res.error && res.data ? res.data.session : null);
        auth.resolved = true;
        emitAuth();     // 落定信号：即使 uid 没变也要通知一次，订阅方才知道「问过了」
        return auth.session;
      }).catch(function () {
        auth.resolved = true;
        emitAuth();
        return auth.session;
      });
    });
  }

  /* 统一收口：把 supabase-js 的 { data, error } 与各种异常收敛成同一种形状，永不抛 */
  function doAuth(factory) {
    return rawClient()
      .then(function (client) { return factory(client.auth); })
      .then(function (res) {
        if (res && res.error) return { data: null, error: normalizeError(res.error) };
        return { data: res ? res.data : null, error: null };
      })
      .catch(function (err) { return { data: null, error: normalizeError(err) }; });
  }

  function signIn(email, password) {
    if (!looksLikeEmail(email)) return Promise.resolve({ data: null, error: { message: '邮箱格式不正确', code: 'invalid_email', raw: null } });
    return doAuth(function (a) {
      return a.signInWithPassword({ email: cleanEmail(email), password: String(password == null ? '' : password) });
    }).then(function (r) {
      if (!r.error) setSession(r.data && r.data.session ? r.data.session : null);
      return r;
    });
  }

  /** 成功时 data.session 为空表示「项目开启了邮箱确认」，需要用户先去邮箱点确认 */
  function signUp(email, password) {
    if (!looksLikeEmail(email)) return Promise.resolve({ data: null, error: { message: '邮箱格式不正确', code: 'invalid_email', raw: null } });
    return doAuth(function (a) {
      return a.signUp({ email: cleanEmail(email), password: String(password == null ? '' : password) });
    }).then(function (r) {
      if (!r.error) setSession(r.data && r.data.session ? r.data.session : null);
      return r;
    });
  }

  /**
   * 退出登录。
   * 用 scope:'local' 只清本机会话、不撤销其他设备 —— 家庭共用一台设备时，
   * 「这台设备退干净」才是要点，同时不影响本人手机上还登着。
   * 附带好处：断网也能退，不会因为没网退不出去而把上一个人的数据留在屏幕上。
   */
  function signOut() {
    return doAuth(function (a) { return a.signOut({ scope: 'local' }); }).then(function (r) {
      setSession(null);
      return r;
    });
  }

  /** 发送重置密码邮件；链接回到当前页面，由 onPasswordRecovery 接管 */
  function resetPassword(email) {
    if (!looksLikeEmail(email)) return Promise.resolve({ data: null, error: { message: '邮箱格式不正确', code: 'invalid_email', raw: null } });
    return doAuth(function (a) {
      var opts = {};
      var here = redirectTarget();
      if (here) opts.redirectTo = here;
      return a.resetPasswordForEmail(cleanEmail(email), opts);
    });
  }

  /** 重置流程里设置新密码（此时处于 PASSWORD_RECOVERY 会话中） */
  function updatePassword(password) {
    return doAuth(function (a) { return a.updateUser({ password: String(password == null ? '' : password) }); });
  }

  function redirectTarget() {
    try {
      if (typeof location === 'undefined') return '';
      if (!/^https?:$/.test(location.protocol)) return '';   // file:// 下给不出可回跳地址
      return location.origin + location.pathname;
    } catch (e) { return ''; }
  }

  function currentUser() { return auth.user; }
  function currentUserId() { return auth.user ? String(auth.user.id) : ''; }

  /**
   * 同步猜测「本机是否存有会话」，用于首屏决定先显示登录页还是直接进应用，
   * 避免已登录用户每次刷新都闪一下登录框。真实判定仍以 initAuth() 为准。
   * supabase-js 把会话存在 `sb-<项目ref>-auth-token` 这个键上。
   */
  function hasStoredSession() {
    if (!state.config || !state.config.url) return false;
    var storage = null;
    try { storage = global.localStorage; } catch (e) { return false; }
    if (!storage) return false;

    // 首选按 supabase-js 的命名规则算：sb-<项目ref>-auth-token，
    // ref 取项目域名第一段（xxx.supabase.co → xxx）
    var ref = '';
    try { ref = new URL(state.config.url).hostname.split('.')[0]; } catch (e) { ref = ''; }
    try {
      if (ref && storage.getItem('sb-' + ref + '-auth-token')) return true;
      // 兜底：自定义域名等算不出 ref 的情况，扫一遍键名
      for (var i = 0; i < storage.length; i += 1) {
        if (/^sb-.+-auth-token$/.test(storage.key(i) || '')) return true;
      }
    } catch (e) { return false; }
    return false;
  }

  /* 把 supabase 的英文报错翻成人能直接照做的话 */
  var AUTH_ERROR_MAP = [
    [/invalid login credentials/i, '邮箱或密码不对，再试一次。'],
    [/email not confirmed/i, '这个邮箱还没确认，先去邮箱点一下确认链接。'],
    [/user already registered|already been registered/i, '这个邮箱已经注册过了，直接登录即可。'],
    [/password should be at least (\d+)/i, '密码太短了，至少要 6 位。'],
    [/new password should be different/i, '新密码不能和旧密码一样。'],
    [/unable to validate email|invalid format/i, '邮箱格式看起来不对。'],
    [/email rate limit|over_email_send_rate_limit|for security purposes/i, '操作太频繁了，等几分钟再试。'],
    [/signups not allowed/i, '当前站点没有开放注册，请联系管理员开启。'],
    [/user not found/i, '这个邮箱还没注册过。'],
    [/rate limit/i, '请求太频繁了，稍后再试。'],
    [/failed to fetch|network|load failed/i, '网络连不上，检查一下网络再试。'],
    [/需要先登录/i, '登录状态已失效，请重新登录。']
  ];

  function friendlyAuthError(err) {
    var message = normalizeError(err).message || '';
    for (var i = 0; i < AUTH_ERROR_MAP.length; i += 1) {
      if (AUTH_ERROR_MAP[i][0].test(message)) return AUTH_ERROR_MAP[i][1];
    }
    return message || '操作没成功，稍后再试。';
  }

  /* ---------------- 登录门禁 + 账户菜单 ----------------
     纯 JS 注入（样式与 DOM 都在这里生成），页面不用改 HTML、也不用加外部依赖：
     未登录时盖一层不透明登录页；已登录时在顶栏挂一个账户胶囊，点开可退出。
     颜色优先复用宿主页面的 CSS 变量，再按 html[data-theme="dark"] / 系统暗色兜底。 */

  var GATE_STYLE_ID = 'sbs-auth-style';
  var GATE_CSS = [
    '.sbs-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;',
    'background:var(--paper,#f8f5ed);color:var(--ink,#29251f);-webkit-font-smoothing:antialiased;',
    'font:15px/1.55 Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.sbs-gate[hidden]{display:none}',
    '.sbs-card{width:min(392px,100%);padding:30px 28px 26px;border:1px solid var(--line,#ded5c8);border-radius:22px;',
    'background:var(--surface,var(--card,#fffdfa));box-shadow:0 22px 60px rgba(40,32,24,.13)}',
    '.sbs-mark{width:46px;height:46px;display:grid;place-items:center;margin-bottom:16px;border-radius:14px;',
    'background:var(--sbs-brand,#16856f);color:#fff;font:700 20px/1 "Songti SC",serif}',
    '.sbs-title{margin:0;font:700 21px/1.35 "Songti SC",serif;letter-spacing:.01em}',
    '.sbs-sub{margin:8px 0 22px;color:var(--muted,#746d63);font-size:12px;line-height:1.7}',
    '.sbs-field{display:block;margin-bottom:13px}',
    '.sbs-field>span{display:block;margin-bottom:6px;color:var(--muted,#746d63);font-size:11px;font-weight:700;letter-spacing:.06em}',
    '.sbs-field input{width:100%;height:48px;padding:0 14px;border:1px solid var(--line,#ded5c8);border-radius:13px;',
    'background:var(--sbs-field,#faf7f2);color:inherit;font-size:15px;-webkit-appearance:none;appearance:none}',
    '.sbs-field input:focus{outline:none;border-color:var(--sbs-brand,#16856f);box-shadow:0 0 0 3px var(--sbs-ring,rgba(22,133,111,.16))}',
    '.sbs-primary{width:100%;min-height:48px;margin-top:8px;border:0;border-radius:13px;background:var(--sbs-brand,#16856f);',
    'color:#fff;font-size:14px;font-weight:700;letter-spacing:.02em;box-shadow:0 10px 24px rgba(40,32,24,.12)}',
    '.sbs-primary[disabled]{opacity:.55;box-shadow:none;cursor:default}',
    '.sbs-links{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:16px}',
    '.sbs-link{padding:0;border:0;background:none;color:var(--sbs-brand,#16856f);font-size:12px;text-decoration:underline;',
    'text-underline-offset:3px;text-decoration-thickness:1px}',
    '.sbs-msg{margin:14px 0 0;padding:10px 12px;border-radius:11px;font-size:12px;line-height:1.6}',
    '.sbs-msg[hidden]{display:none}',
    '.sbs-msg.err{background:var(--danger-pale,#ffe7e1);color:var(--danger,#b44d43)}',
    '.sbs-msg.ok{background:var(--positive-pale,#dfe4df);color:var(--positive,#477358)}',
    '.sbs-note{margin:18px 0 0;padding-top:15px;border-top:1px solid var(--line,#ded5c8);color:var(--muted,#746d63);font-size:11px;line-height:1.75}',
    '.sbs-account{display:inline-flex;flex:none;position:relative}',
    '.sbs-chip{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:0 12px;border:1px solid var(--line,#ded5c8);',
    'border-radius:12px;background:var(--surface,var(--card,#fffdfa));color:var(--muted,#746d63);font-size:12px}',
    '.sbs-chip i{width:24px;height:24px;flex:none;display:grid;place-items:center;border-radius:8px;',
    'background:var(--sbs-brand,#16856f);color:#fff;font-style:normal;font-size:11px;font-weight:700}',
    '.sbs-chip b{max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--ink,#29251f)}',
    '.sbs-menu{position:fixed;z-index:2147483001;min-width:212px;padding:8px;border:1px solid var(--line,#ded5c8);border-radius:14px;',
    'background:var(--surface,var(--card,#fffdfa));box-shadow:0 18px 44px rgba(40,32,24,.18)}',
    '.sbs-menu[hidden]{display:none}',
    '.sbs-menu p{margin:6px 8px 10px;color:var(--muted,#746d63);font-size:11px;line-height:1.55;word-break:break-all}',
    '.sbs-menu button{width:100%;min-height:42px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;font-size:13px}',
    '.sbs-menu button:hover{background:var(--sbs-field,#f2ece2)}',
    '.sbs-menu button.danger{color:var(--danger,#b44d43)}',
    // 窄屏顶栏空间紧张，账户胶囊只留头像，邮箱交给点开后的菜单
    '@media (max-width:600px){.sbs-chip{padding:0 7px}.sbs-chip b{display:none}}',
    'html[data-theme="dark"] .sbs-gate{background:#0f1716;color:#e6f0ed}',
    'html[data-theme="dark"] .sbs-card,html[data-theme="dark"] .sbs-chip,html[data-theme="dark"] .sbs-menu{background:#16211f;border-color:#2b3b38}',
    'html[data-theme="dark"] .sbs-field input{background:#111b19;border-color:#2b3b38;color:#e6f0ed}',
    'html[data-theme="dark"] .sbs-sub,html[data-theme="dark"] .sbs-field>span,html[data-theme="dark"] .sbs-note,html[data-theme="dark"] .sbs-menu p{color:#9db0ad}',
    'html[data-theme="dark"] .sbs-chip b{color:#e6f0ed}',
    'html[data-theme="dark"] .sbs-menu button:hover{background:#1d2a27}',
    'html[data-theme="dark"] .sbs-msg.err{background:#3a2320;color:#f0a9a1}',
    'html[data-theme="dark"] .sbs-msg.ok{background:#16302a;color:#8fd8c3}',
    '@media (prefers-color-scheme:dark){',
    'html:not([data-theme="light"]) .sbs-gate{background:#0f1716;color:#e6f0ed}',
    'html:not([data-theme="light"]) .sbs-card,html:not([data-theme="light"]) .sbs-chip,html:not([data-theme="light"]) .sbs-menu{background:#16211f;border-color:#2b3b38}',
    'html:not([data-theme="light"]) .sbs-field input{background:#111b19;border-color:#2b3b38;color:#e6f0ed}',
    'html:not([data-theme="light"]) .sbs-sub,html:not([data-theme="light"]) .sbs-field>span,html:not([data-theme="light"]) .sbs-note{color:#9db0ad}',
    'html:not([data-theme="light"]) .sbs-chip b{color:#e6f0ed}',
    '}'
  ].join('');

  function injectGateStyle() {
    if (document.getElementById(GATE_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = GATE_STYLE_ID;
    style.textContent = GATE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function findMount(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    return target.nodeType === 1 ? target : null;
  }

  /**
   * 挂载登录门禁。
   * options:
   *   brand    品牌色（默认取宿主 --brand / --plum）
   *   mark     图标里的字，例如「账」
   *   title    应用名
   *   mount    账户胶囊放哪（选择器或元素）；不给就悬浮在右上角
   *   text     取文案的函数 key => string
   *   note     卡片底部的补充说明
   */
  function authGate(options) {
    options = options || {};
    injectGateStyle();

    var text = options.text;
    function L(key, fallback) {
      var value = '';
      if (typeof text === 'function') {
        try { value = text(key) || ''; } catch (e) { value = ''; }
      } else if (text && typeof text === 'object') {
        value = text[key] || '';
      }
      // 有些页面的 i18n 缺键时会原样回显 key，那种情况按「没翻译」处理，走兜底文案
      if (value && value !== key && value !== 'auth.' + key) return String(value);
      return fallback || key;
    }

    var brand = options.brand || '';
    var mode = 'signin';
    var busy = false;

    if (brand) {
      document.documentElement.style.setProperty('--sbs-brand', brand);
      document.documentElement.style.setProperty('--sbs-ring', brand + '29');
    }

    /* ── 登录卡片 ── */
    var overlay = el('div', 'sbs-gate');
    // 本机存着会话就先不显示门禁，等 initAuth 确认后再说；
    // 没有会话则立刻挡住页面，别让未登录的人瞥见界面
    overlay.hidden = hasStoredSession();
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', options.title || 'Sign in');

    var card = el('div', 'sbs-card');
    var mark = el('div', 'sbs-mark', options.mark || '·');
    var title = el('h1', 'sbs-title', options.title || '');
    var sub = el('p', 'sbs-sub', '');
    var form = el('form');
    form.setAttribute('novalidate', 'novalidate');

    var emailField = el('label', 'sbs-field');
    var emailLabel = el('span', null, L('email', '邮箱'));
    var emailInput = el('input');
    emailInput.type = 'email';
    emailInput.autocomplete = 'username';
    emailInput.inputMode = 'email';
    emailInput.placeholder = 'you@example.com';
    emailField.appendChild(emailLabel);
    emailField.appendChild(emailInput);

    var pwdField = el('label', 'sbs-field');
    var pwdLabel = el('span', null, L('password', '密码'));
    var pwdInput = el('input');
    pwdInput.type = 'password';
    pwdInput.autocomplete = 'current-password';
    pwdField.appendChild(pwdLabel);
    pwdField.appendChild(pwdInput);

    var submit = el('button', 'sbs-primary', L('signIn', '登录'));
    submit.type = 'submit';

    form.appendChild(emailField);
    form.appendChild(pwdField);
    form.appendChild(submit);

    var msg = el('p', 'sbs-msg');
    msg.hidden = true;

    var links = el('div', 'sbs-links');
    var swapLink = el('button', 'sbs-link', '');
    swapLink.type = 'button';
    var forgotLink = el('button', 'sbs-link', L('forgot', '忘记密码'));
    forgotLink.type = 'button';
    links.appendChild(swapLink);
    links.appendChild(forgotLink);

    var note = el('p', 'sbs-note', options.note || '');

    card.appendChild(mark);
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(form);
    card.appendChild(msg);
    card.appendChild(links);
    if (options.note) card.appendChild(note);
    overlay.appendChild(card);

    /* ── 顶栏账户胶囊 ── */
    var account = el('div', 'sbs-account');
    account.hidden = true;
    var chip = el('button', 'sbs-chip');
    chip.type = 'button';
    var chipMark = el('i', null, '');
    var chipText = el('b', null, '');
    chip.appendChild(chipMark);
    chip.appendChild(chipText);
    account.appendChild(chip);

    var menu = el('div', 'sbs-menu');
    menu.hidden = true;
    var menuEmail = el('p', null, '');
    var signOutBtn = el('button', 'danger', L('signOut', '退出登录'));
    signOutBtn.type = 'button';
    menu.appendChild(menuEmail);
    menu.appendChild(signOutBtn);

    var host = document.body || document.documentElement;
    host.appendChild(overlay);
    host.appendChild(menu);

    var mountPoint = findMount(options.mount);
    if (mountPoint) mountPoint.insertBefore(account, mountPoint.firstChild);
    else {
      account.style.position = 'fixed';
      account.style.top = 'calc(10px + env(safe-area-inset-top))';
      account.style.right = '12px';
      account.style.zIndex = '2147482990';
      host.appendChild(account);
    }

    /* ── 交互 ── */
    function setBusy(next) {
      busy = next;
      submit.disabled = next;
      submit.textContent = next ? L('working', '处理中…') : actionLabel();
    }

    function actionLabel() {
      if (mode === 'signup') return L('signUp', '注册');
      if (mode === 'reset') return L('sendReset', '发送重置邮件');
      if (mode === 'recovery') return L('setPassword', '保存新密码');
      return L('signIn', '登录');
    }

    function clearMsg() { msg.hidden = true; msg.textContent = ''; msg.className = 'sbs-msg'; }
    function showMsg(kind, content) { msg.className = 'sbs-msg ' + kind; msg.textContent = content; msg.hidden = false; }

    function renderMode() {
      if (mode === 'signup') {
        title.textContent = L('signUpTitle', '创建账号');
        sub.textContent = L('signUpIntro', '');
        pwdField.hidden = false;
        pwdLabel.textContent = L('password', '密码');
        pwdInput.autocomplete = 'new-password';
        emailField.hidden = false;
        swapLink.textContent = L('toSignIn', '已有账号？去登录');
        forgotLink.hidden = true;
      } else if (mode === 'reset') {
        title.textContent = L('resetTitle', '重置密码');
        sub.textContent = L('resetIntro', '');
        emailField.hidden = false;
        pwdField.hidden = true;
        swapLink.textContent = L('toSignIn', '已有账号？去登录');
        forgotLink.hidden = true;
      } else if (mode === 'recovery') {
        title.textContent = L('recoveryTitle', '设置新密码');
        sub.textContent = L('recoveryIntro', '');
        emailField.hidden = true;
        pwdField.hidden = false;
        pwdLabel.textContent = L('newPassword', '新密码');
        pwdInput.autocomplete = 'new-password';
        swapLink.textContent = L('toSignIn', '已有账号？去登录');
        forgotLink.hidden = true;
      } else {
        title.textContent = options.title || '';
        sub.textContent = L('signInIntro', '');
        emailField.hidden = false;
        pwdField.hidden = false;
        pwdLabel.textContent = L('password', '密码');
        pwdInput.autocomplete = 'current-password';
        swapLink.textContent = L('toSignUp', '还没有账号？注册');
        forgotLink.hidden = false;
      }
      setBusy(false);
    }

    function switchMode(next) {
      mode = next;
      clearMsg();
      pwdInput.value = '';
      renderMode();
      if (next === 'recovery' || next === 'signin') { try { pwdInput.focus(); } catch (e) {} }
      else { try { emailInput.focus(); } catch (e) {} }
    }

    function submitForm() {
      if (busy) return;
      var email = cleanEmail(emailInput.value);
      var password = pwdInput.value;

      if (mode !== 'recovery' && !email) { showMsg('err', L('errEmailRequired', '')); return; }
      if (mode !== 'recovery' && mode !== 'signup' && mode !== 'signin' && !looksLikeEmail(email)) { showMsg('err', L('errEmailInvalid', '')); return; }
      if (mode === 'reset' && !looksLikeEmail(email)) { showMsg('err', L('errEmailInvalid', '')); return; }
      if (mode !== 'reset' && String(password).length < 6) { showMsg('err', L('errPasswordShort', '')); return; }

      setBusy(true);
      clearMsg();

      var task;
      if (mode === 'signup') task = signUp(email, password);
      else if (mode === 'reset') task = resetPassword(email);
      else if (mode === 'recovery') task = updatePassword(password);
      else task = signIn(email, password);

      task.then(function (r) {
        setBusy(false);
        if (r.error) { showMsg('err', friendlyAuthError(r.error)); return; }
        if (mode === 'signup') {
          if (r.data && r.data.session) return;           // 已直接登录，onAuthChange 会接管
          switchMode('signin');
          showMsg('ok', L('okSignUpConfirm', ''));
          return;
        }
        if (mode === 'reset') { showMsg('ok', L('okResetSent', '')); return; }
        if (mode === 'recovery') { switchMode('signin'); showMsg('ok', L('okPasswordUpdated', '')); return; }
        // 登录成功：onAuthChange 会把门禁收起来
      }).catch(function (err) {
        setBusy(false);
        showMsg('err', friendlyAuthError(err));
      });
    }

    form.addEventListener('submit', function (event) { event.preventDefault(); submitForm(); });
    swapLink.addEventListener('click', function () {
      switchMode(mode === 'signin' ? 'signup' : 'signin');
    });
    forgotLink.addEventListener('click', function () { switchMode('reset'); });

    function closeMenu() { menu.hidden = true; }

    chip.addEventListener('click', function (event) {
      event.stopPropagation();
      if (!menu.hidden) { closeMenu(); return; }
      var rect = chip.getBoundingClientRect();
      menu.style.right = Math.max(8, (window.innerWidth - rect.right)) + 'px';
      menu.style.top = (rect.bottom + 8) + 'px';
      menu.hidden = false;
    });

    signOutBtn.addEventListener('click', function () {
      closeMenu();
      signOutBtn.disabled = true;
      signOut().then(function (r) {
        signOutBtn.disabled = false;
        if (r.error) showMsg('err', friendlyAuthError(r.error));
      });
    });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenu(); });

    /* ── 状态同步 ── */
    function refresh() {
      var snap = authSnapshot();
      var signed = snap.signedIn;
      if (signed) {
        chipMark.textContent = (snap.email || '?').slice(0, 1).toUpperCase();
        chipText.textContent = snap.email || '';
        menuEmail.textContent = snap.email || '';
      }
      account.hidden = !signed;
      if (!signed) closeMenu();
      if (mode === 'recovery') {
        overlay.hidden = false;
      } else if (snap.resolved) {
        overlay.hidden = signed;
      }
      // snap.resolved 之前保持构造时的初始判断（本机有会话就先不显示），
      // 否则已登录用户每次刷新都会先闪一下登录框
      if (signed && mode !== 'recovery') { pwdInput.value = ''; clearMsg(); }
    }

    onAuthChange(refresh);
    onPasswordRecovery(function () { switchMode('recovery'); overlay.hidden = false; });
    renderMode();
    refresh();

    return {
      /** 让宿主在语言切换后刷新文案 */
      relabel: function () { renderMode(); refresh(); },
      open: function () { overlay.hidden = false; },
      element: overlay
    };
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
    upsertMany: upsertMany,
    remove: remove,
    onStatus: onStatus,
    describe: describe,
    normalizeError: normalizeError,

    /* 身份 */
    initAuth: initAuth,
    onAuthChange: onAuthChange,
    onPasswordRecovery: onPasswordRecovery,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    user: currentUser,
    userId: currentUserId,
    hasStoredSession: hasStoredSession,
    friendlyAuthError: friendlyAuthError,
    authGate: authGate,

    /** 只读快照，便于调试时在控制台查看 */
    status: function () {
      return {
        phase: state.status.phase,
        message: state.status.message,
        configured: isConfigured(),
        requiresAuth: Boolean(state.config && state.config.requireAuth),
        hasClient: Boolean(state.client),
        signedIn: Boolean(auth.user),
        userId: currentUserId(),
        error: state.error
      };
    }
  };

  global.SupabaseSync = api;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : this);
