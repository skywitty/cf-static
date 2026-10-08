-- ============================================================================
-- cf-static · Supabase 建表脚本（账本 + 日常集）
--
-- 用法：Supabase 控制台 → SQL Editor → 新建查询 → 整段粘贴 → Run。
-- 脚本可重复执行（全部使用 if not exists / drop policy if exists）。
--
-- ── 设计要点 ────────────────────────────────────────────────────────────────
-- 1. 主键统一用 text，直接复用前端生成的 id（crypto.randomUUID），
--    这样「本地记录」与「云端行」天然一一对应，不需要额外维护映射表。
-- 2. 账本的两类「天然唯一」数据用确定性 id：
--      月度总结 → summary-<YYYY-MM>，个人设置 → settings
--    于是跨设备重复提交时 upsert 会自动收敛，不会产生两条同月记录。
-- 3. 每张表都带 space 列（默认 'default'）。
--    当前策略下它是一个常量占位；日后启用 Supabase Auth 时，
--    把它写成 auth.uid() 就能一次性拿到按用户隔离，不用改表结构。
--
-- ⚠️ 安全提示（务必读）
--   本脚本默认给 anon 角色开放全部读写权限，好处是「零登录、开箱即用」。
--   代价是：anon key 会随页面公开，任何人拿到它就能读写你的数据。
--   个人自用、数据不敏感时可以接受；一旦要放公开数据，请改用文件末尾的
--   「启用登录后的按用户隔离」那套策略，并在页面里接上 Supabase Auth。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 一、打工人小账本
-- ---------------------------------------------------------------------------

-- 流水记录：每一笔支出
create table if not exists public.ledger_expenses (
  id          text primary key,
  space       text        not null default 'default',
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
  space       text        not null default 'default',
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
  space                       text        not null default 'default',
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
  space       text        not null default 'default',
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
  space       text        not null default 'default',
  created_at  timestamptz not null default now(),
  date        date        not null,
  habit_key   text        not null default '',
  habit_name  text        not null default '',
  value       numeric     not null default 0,
  unit        text        not null default ''
);
create index if not exists life_habits_date_idx  on public.life_habits (date desc);
create index if not exists life_habits_space_idx on public.life_habits (space);

-- 日程 / 待办
create table if not exists public.life_plans (
  id          text primary key,
  space       text        not null default 'default',
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
  space       text        not null default 'default',
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
  space        text        not null default 'default',
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
  space       text        not null default 'default',
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
alter table public.life_plans       enable row level security;
alter table public.life_fitness     enable row level security;
alter table public.life_shopping    enable row level security;
alter table public.life_media       enable row level security;

-- 默认方案：零登录，anon 可读写。
-- 页面只带 anon key，任何人拿到它即可读写 —— 个人自用可以接受，别无脑套用到敏感数据。
do $$
declare
  t text;
  tables text[] := array[
    'ledger_expenses','ledger_summaries','ledger_settings',
    'life_money','life_habits','life_plans','life_fitness','life_shopping','life_media'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_anon_all', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 四、（可选）启用登录后的按用户隔离
--
-- 前提：在 Authentication → Providers 里开启 Email（或任意一种登录方式），
--       并把页面 <script> 里的 space 值改成登录用户的 id。
--
-- 启用步骤：把上面那段 do $$ ... $$ 整体注释掉，改跑下面这段。
-- ---------------------------------------------------------------------------
--
-- do $$
-- declare
--   t text;
--   tables text[] := array[
--     'ledger_expenses','ledger_summaries','ledger_settings',
--     'life_money','life_habits','life_plans','life_fitness','life_shopping','life_media'
--   ];
-- begin
--   foreach t in array tables loop
--     execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
--     execute format(
--       'create policy %I on public.%I for all to authenticated
--          using (space = auth.uid()::text) with check (space = auth.uid()::text)',
--       t || '_owner_all', t
--     );
--   end loop;
-- end $$;
--
-- ---------------------------------------------------------------------------
-- 五、清理（谨慎）
--
-- 只清数据、保留表结构：
--   truncate public.ledger_expenses, public.ledger_summaries, public.ledger_settings,
--            public.life_money, public.life_habits, public.life_plans,
--            public.life_fitness, public.life_shopping, public.life_media;
--
-- 连表一起删：
--   drop table if exists public.ledger_expenses, public.ledger_summaries, public.ledger_settings,
--                        public.life_money, public.life_habits, public.life_plans,
--                        public.life_fitness, public.life_shopping, public.life_media;
-- ---------------------------------------------------------------------------
