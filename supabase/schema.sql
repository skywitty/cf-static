-- ============================================================================
-- cf-static · Supabase 建表脚本（账本 + 日常集）
--
-- 用法：Supabase 控制台 → SQL Editor → 新建查询 → 整段粘贴 → Run。
-- 脚本可重复执行（全部使用 if not exists / drop policy if exists）。
--
-- ── 设计要点 ────────────────────────────────────────────────────────────────
-- 1. 主键统一用 text，直接复用前端生成的 id（crypto.randomUUID），
--    这样「本地记录」与「云端行」天然一一对应，不需要额外维护映射表。
-- 2. 「天然唯一」的数据用确定性 id，跨设备重复提交时 upsert 自动收敛：
--      月度总结 → <uid>:summary-<YYYY-MM>，个人设置 → <uid>:settings
--      习惯打卡 → <uid>:habit-<习惯>-<日期>，习惯定义 → <uid>:habitdef-<习惯键>
--    主键是全局唯一的，所以必须带上 uid 前缀，否则两个人的同月记录会撞主键。
--    （随机 id 的流水类数据用 crypto.randomUUID，天然不会撞。）
-- 3. 每张表都带 space 列，默认值是 auth.uid()::text —— 即「当前登录用户」。
--    权限策略据此隔离：每个人只看得到、也只写得进自己的行。
--    隔离发生在数据库端，客户端拿不到别人的数据，不是前端过滤那种假隔离。
--
-- ── 前置条件：先开启邮箱密码登录 ──────────────────────────────────────────────
--   Supabase 控制台 → Authentication → Providers → Email，打开 Enable。
--   家庭自用建议同时关掉 Authentication → Sign In / Up 里的 "Confirm email"，
--   否则每个人注册后都得先去邮箱点确认链接才能进（要收邮件，反而麻烦）。
--   关掉之后注册即登录，配合页面上的登录门禁就是一个账号一份数据。
--
-- ⚠️ 关于 anon key
--   它依然会随页面源码公开，但在这套策略下它只是一把「没有身份就什么也读不到」的钥匙：
--   未登录时 auth.uid() 为 null，所有查询返回空、所有写入被拒。
--   所以公开 anon key 是安全的 —— 真正的门在数据库这一侧。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 一、打工人小账本
-- ---------------------------------------------------------------------------

-- 流水记录：每一笔支出
create table if not exists public.ledger_expenses (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  date        date        not null,
  amount      numeric     not null default 0,
  category    text        not null default '其他',
  note        text        not null default '',
  work_hours  numeric     not null default 0
);
create index if not exists ledger_expenses_date_idx  on public.ledger_expenses (date desc);
create index if not exists ledger_expenses_space_idx on public.ledger_expenses (space);

-- 月度总结：每月收入、固定与弹性支出（结余前端现算，不落库）
create table if not exists public.ledger_summaries (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  month       text        not null,                 -- YYYY-MM
  income      numeric     not null default 0,
  fixed       numeric     not null default 0,
  flexible    numeric     not null default 0
);
create index if not exists ledger_summaries_space_idx on public.ledger_summaries (space);
create unique index if not exists ledger_summaries_space_month_key
  on public.ledger_summaries (space, month);

-- 个人设置：时薪参数与自由基金目标，全局单行（id = 'settings'）
create table if not exists public.ledger_settings (
  id                          text primary key,
  space                       text        not null default auth.uid()::text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  monthly_salary              numeric     not null default 0,
  pay_months                  numeric     not null default 12,
  monthly_work_cost           numeric     not null default 0,
  daily_office_hours          numeric     not null default 8,
  one_way_commute_minutes     numeric     not null default 0,
  weekly_overtime_hours       numeric     not null default 0,
  freedom_target_amount       numeric     not null default 0,
  freedom_target_date         text        not null default '',
  freedom_current_saved       numeric     not null default 0,
  freedom_basic_monthly_cost  numeric     not null default 0,
  freedom_start_month         text        not null default '',
  freedom_reason              text        not null default '',
  theme                       text        not null default 'light'
);
create index if not exists ledger_settings_space_idx on public.ledger_settings (space);

-- ---------------------------------------------------------------------------
-- 二、日常集
-- ---------------------------------------------------------------------------

-- 收支
create table if not exists public.life_money (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  date        date        not null,
  flow        text        not null default 'expense',   -- income | expense
  amount      numeric     not null default 0,
  category    text        not null default '其他',
  note        text        not null default ''
);
create index if not exists life_money_date_idx  on public.life_money (date desc);
create index if not exists life_money_space_idx on public.life_money (space);

-- 习惯打卡：一行 = 某习惯某天的一个数值
create table if not exists public.life_habits (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  date        date        not null,
  habit_key   text        not null default '',
  habit_name  text        not null default '',
  value       numeric     not null default 0,
  unit        text        not null default ''
);
create index if not exists life_habits_date_idx  on public.life_habits (date desc);
create index if not exists life_habits_space_idx on public.life_habits (space);

-- 习惯定义：自定义习惯本身（名称/类型/目标/单位/配色）＋内置习惯的隐藏状态
-- 打卡记录仍在 life_habits；这张表只描述「有哪些习惯」，所以自定义习惯才能跨设备。
-- id 用 <uid>:habitdef-<习惯键>，与打卡一样是确定性主键，重复提交靠 upsert 收敛。
-- hidden = true 表示这个习惯被删掉了（内置习惯删不掉，只能标记隐藏）。
create table if not exists public.life_habit_defs (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  habit_key   text        not null default '',
  name        text        not null default '',
  type        text        not null default 'check',   -- check | counter | number
  target      numeric     not null default 1,
  unit        text        not null default '次',
  tone        text        not null default 'sage',
  hidden      boolean     not null default false
);
create index if not exists life_habit_defs_space_idx on public.life_habit_defs (space);

-- 日程 / 待办
create table if not exists public.life_plans (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  date        date        not null,
  title       text        not null default '',
  list        text        not null default '生活',
  status      text        not null default '待完成',      -- 待完成 | 已完成
  priority    text        not null default 'normal',
  note        text        not null default '',
  remind      boolean     not null default false
);
create index if not exists life_plans_date_idx  on public.life_plans (date desc);
create index if not exists life_plans_space_idx on public.life_plans (space);

-- 健身 / 身体记录
create table if not exists public.life_fitness (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  date        date        not null,
  weight      numeric     not null default 0,
  body_fat    numeric,
  calories    numeric     not null default 0,
  duration    numeric     not null default 0,
  note        text        not null default ''
);
create index if not exists life_fitness_date_idx  on public.life_fitness (date desc);
create index if not exists life_fitness_space_idx on public.life_fitness (space);

-- 待买清单
create table if not exists public.life_shopping (
  id           text primary key,
  space        text        not null default auth.uid()::text,
  created_at   timestamptz not null default now(),
  name         text        not null default '',
  quantity     text        not null default '',
  category     text        not null default '其他',
  price        numeric     not null default 0,
  priority     text        not null default 'normal',
  note         text        not null default '',
  bought       boolean     not null default false,
  bought_date  date
);
create index if not exists life_shopping_space_idx on public.life_shopping (space);

-- 书影音收藏
create table if not exists public.life_media (
  id          text primary key,
  space       text        not null default auth.uid()::text,
  created_at  timestamptz not null default now(),
  name        text        not null default '',
  type        text        not null default '电影',        -- 电影 | 剧 | 书 | 番
  status      text        not null default '想看',        -- 想看 | 在看 | 看完 | 弃了
  rating      numeric     not null default 0,
  review      text        not null default '',
  date        date,
  cover       text        not null default ''
);
create index if not exists life_media_space_idx on public.life_media (space);

-- ---------------------------------------------------------------------------
-- 三、权限策略
-- ---------------------------------------------------------------------------

alter table public.ledger_expenses  enable row level security;
alter table public.ledger_summaries enable row level security;
alter table public.ledger_settings  enable row level security;
alter table public.life_money       enable row level security;
alter table public.life_habits      enable row level security;
alter table public.life_habit_defs  enable row level security;
alter table public.life_plans       enable row level security;
alter table public.life_fitness     enable row level security;
alter table public.life_shopping    enable row level security;
alter table public.life_media       enable row level security;

-- 按用户隔离：登录者只能读写 space 等于自己 uid 的行。
--   using      —— 决定「能看到哪些行」，所以别人的数据查也查不到；
--   with check —— 决定「能写成什么」，所以伪造 space 也没用。
-- 同时把旧的 anon 全开策略清掉，避免升级后残留一条后门。
do $$
declare
  t text;
  tables text[] := array[
    'ledger_expenses','ledger_summaries','ledger_settings',
    'life_money','life_habits','life_habit_defs','life_plans','life_fitness','life_shopping','life_media'
  ];
begin
  foreach t in array tables loop
    -- 升级路径：老版本建的 anon 全开策略要撤掉
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (space = auth.uid()::text) with check (space = auth.uid()::text)',
      t || '_owner_all', t
    );
    -- 已存在的表：把 space 的默认值补成 auth.uid()，让「不传 space」也落到自己名下
    execute format('alter table public.%I alter column space set default auth.uid()::text', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 四、（可选）把启用登录之前的存量数据划给某个账号
--
-- 如果你在接登录之前已经用 anon 写过数据（space 全是 'default'），
-- 那批数据在按用户隔离的策略下谁都看不见。想收归自己名下就跑下面这段，
-- 把 <你的用户 id> 换成 Authentication → Users 里那一行的 UID 再执行。
--
-- 说明：月度总结 / 个人设置 / 习惯打卡用的是「确定性主键」（summary-2026-10 之类），
--       全局唯一，所以换主人时连主键一起加前缀，避免和别人的同月记录撞车。
--       脚本只动 space='default' 的行，跑第二遍不会重复加前缀。
-- ---------------------------------------------------------------------------
--
-- do $$
-- declare
--   uid text := '<你的用户 id>';
-- begin
--   update public.ledger_expenses  set space = uid                     where space = 'default';
--   update public.ledger_summaries set id = uid || ':' || id, space = uid where space = 'default';
--   update public.ledger_settings  set id = uid || ':' || id, space = uid where space = 'default';
--   update public.life_money       set space = uid                     where space = 'default';
--   update public.life_plans       set space = uid                     where space = 'default';
--   update public.life_fitness     set space = uid                     where space = 'default';
--   update public.life_shopping    set space = uid                     where space = 'default';
--   update public.life_media       set space = uid                     where space = 'default';
--   update public.life_habits      set id = uid || ':' || id, space = uid where space = 'default';
--   update public.life_habit_defs  set id = uid || ':' || id, space = uid where space = 'default';
-- end $$;
--
-- ---------------------------------------------------------------------------
-- 五、Realtime 发布（页面里的自动刷新依赖它）
--
-- 把这几张表加进 supabase_realtime 发布，另一端改动后页面会自动重新拉取。
-- 已在发布里再执行会报 "already member of publication"，可安全忽略；
-- 想彻底幂等就用在下面的判重写法。
-- 注意：Realtime 同样受 RLS 约束，订阅到的只会是自己的行。
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'ledger_expenses','ledger_summaries','ledger_settings',
    'life_money','life_habits','life_habit_defs','life_plans','life_fitness','life_shopping','life_media'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 六、清理（谨慎）
--
-- 只清数据、保留表结构：
--   truncate public.ledger_expenses, public.ledger_summaries, public.ledger_settings,
--            public.life_money, public.life_habits, public.life_habit_defs, public.life_plans,
--            public.life_fitness, public.life_shopping, public.life_media;
--
-- 连表一起删：
--   drop table if exists public.ledger_expenses, public.ledger_summaries, public.ledger_settings,
--                        public.life_money, public.life_habits, public.life_habit_defs,
--                        public.life_plans, public.life_fitness, public.life_shopping, public.life_media;
-- ---------------------------------------------------------------------------
