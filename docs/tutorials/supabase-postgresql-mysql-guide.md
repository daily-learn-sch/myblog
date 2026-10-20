# Supabase 与 PostgreSQL 入门指南（MySQL 用户版）

> 原为 GPT 生成的学习笔记，经人工校对修订。以一个真实的 Supabase 项目 + DBeaver 为例，面向已经会用 MySQL、第一次接触 PostgreSQL 的读者。

## 1. 你当前看到的对象是什么

在 Supabase Dashboard 的 Database → Tables 页面，`public` schema 中显示 7 个对象（以示例项目为准）：

| 名称 | 类型 | 用途（仅根据名称推测） |
|---|---|---|
| `dictation_practice` | 表 | 听写练习相关数据 |
| `drill_sessions` | 表 | 练习会话 |
| `sentence_dictations` | 表 | 句子听写记录 |
| `shadowing_submissions` | 表 | 跟读提交记录 |
| `monthly_stats` | 视图 | 月度统计查询结果 |
| `top_mistakes` | 视图 | 常见错误统计结果 |
| `weekly_stats` | 视图 | 周统计查询结果 |

前四个是实际存储行数据的表；后三个是视图。视图像一张可查询的虚拟表，本身不存储数据（物化视图除外），每次查询时执行其定义的 SQL。DBeaver 会把表和视图分到不同节点，所以 `Tables` 下只看到 4 张并不代表少了数据：在 `Views` 下还能看到 3 个视图。

Supabase 的图标和页面布局可能随版本调整；以对象名称和 DBeaver 节点类型为准。Supabase Table Editor 里对象名旁边显示的 `32K`、`48K` 这类数字是估算的存储大小，不是行数。

## 2. 在 DBeaver 里找到表和查看数据

左侧连接树按下面路径展开：

```text
postgres（连接）
└─ Databases
   └─ postgres（数据库）
      └─ Schemas
         └─ public（schema）
            ├─ Tables（4 张表）
            └─ Views（3 个视图）
```

- 看表结构：展开 `Tables`，双击表名，查看 Columns / Properties。
- 看表数据：右键表名 → **View Data** → **All Rows**（不同版本菜单文字略有差异）。也可双击后切换到 Data 页签。
- 看视图：展开 `Views`，双击视图或右键查看数据。
- 找不到新对象：右键 `public` 或对应的 `Tables` / `Views` 节点 → **Refresh**。
- 对象类型辨认：Supabase 页面里表格图标代表表、眼睛图标代表视图。

## 3. 先用只读 SQL 熟悉数据库

在 DBeaver 中选中连接后，打开 SQL Editor（工具栏 SQL 按钮或右键连接 → SQL Editor → New SQL Script），确认编辑器右上角的连接是你的 Supabase `postgres`。先运行这些只读语句：

### 查看当前连接和 schema

```sql
SELECT current_database(), current_user, current_schema();
```

`public` 是 schema，不是数据库。可以把 schema 理解为数据库中的命名空间/对象分组。PostgreSQL 的完整对象名常写成 `schema.对象名`：

```sql
SELECT * FROM public.drill_sessions LIMIT 20;
```

### 查看表有哪些列

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'drill_sessions'
ORDER BY ordinal_position;
```

把 `drill_sessions` 改成其他表名即可。

### 查看 public 下的表和视图

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_type, table_name;
```

### 按时间倒序看最近记录

先在 DBeaver 表结构里确认实际时间列叫什么，再替换下面的 `created_at`：

```sql
SELECT *
FROM public.drill_sessions
ORDER BY created_at DESC
LIMIT 20;
```

如果没有 `created_at` 列，请换成真实列名，或先去掉 `ORDER BY`。

### 查看总行数

```sql
SELECT COUNT(*) FROM public.drill_sessions;
```

Supabase 页面可能显示估算行数；`COUNT(*)` 是执行查询得到的精确行数。大表上精确统计需要扫描数据，等待时间会更长。统计视图时，得到的是视图查询返回的行数，而不是它背后源表的总行数。

### 查看视图定义

在 DBeaver 中右键视图 → **Generate SQL** / **View Definition**（菜单因版本而异），或在 Supabase SQL Editor 运行：

```sql
SELECT pg_get_viewdef('public.monthly_stats'::regclass, true);
```

将视图名替换为 `weekly_stats` 或 `top_mistakes` 可查看其他定义。

## 4. MySQL 与 PostgreSQL：常见差异速查

| 场景 | MySQL 常见写法 | PostgreSQL 常见写法 |
|---|---|---|
| 限制返回行数 | `LIMIT 20` | `LIMIT 20`（相同） |
| 标识符引用 | 反引号：`` `order` `` | 双引号：`"Order"`；普通小写名称通常不用引号 |
| 字符串 | 单引号：`'hello'` | 单引号：`'hello'`（相同） |
| 自增主键 | `AUTO_INCREMENT` | `GENERATED ... AS IDENTITY`（新建表推荐）或旧表常见 `SERIAL` |
| 布尔值 | 常用 `1/0` 或 `TRUE/FALSE` | 原生 `TRUE/FALSE` |
| 忽略冲突插入 | `INSERT IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| 冲突时更新 | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT (...) DO UPDATE SET ...` |
| 返回新增/修改行 | 依赖连接器或额外查询 | 可用 `INSERT/UPDATE/DELETE ... RETURNING ...` |
| 不区分大小写匹配 | 常见 collation 控制 | 可用 `ILIKE`，例如 `name ILIKE '%abc%'` |
| JSON | `JSON` / `JSON_TABLE` 等 | `json` / `jsonb`；`jsonb` 常用于高效查询和索引 |

注意：不同数据库版本和连接器支持的细节可能不同。迁移 SQL 时应在测试环境验证，不要只做机械替换。

### 引号与大小写：最容易踩坑的点

PostgreSQL 不加双引号的标识符会折叠为小写。因此建议表名、列名用小写加下划线，例如 `created_at`。如果创建时特意写了带大写字母的双引号名称（如 `"UserName"`），以后每次引用都要保持双引号和大小写。字符串仍然用单引号：`WHERE status = 'done'`。

### Upsert 示例

PostgreSQL：

```sql
INSERT INTO public.example (id, value)
VALUES (1, 'new')
ON CONFLICT (id)
DO UPDATE SET value = EXCLUDED.value;
```

这会在 `id` 唯一约束冲突时更新 `value`。只读学习阶段不要直接对真实业务表执行写入语句。

## 5. Supabase 额外要理解的部分

Supabase 不只是一个数据库网页界面。它以 PostgreSQL 为核心，同时围绕数据库提供 Auth、Storage、Realtime 和 API 等服务。表和视图仍然是 PostgreSQL 对象，DBeaver 通过 PostgreSQL 驱动连接数据库。

- **schema**：对象分组。常用的业务 schema 是 `public`；系统或 Supabase 扩展也可能出现在其他 schema。
- **表（table）**：保存行和列。
- **视图（view）**：用 SQL 定义的查询结果；读取视图有时会受底层表权限影响。
- **RLS（Row Level Security，行级安全）**：PostgreSQL 的行级访问策略。应用通过 Supabase API 读写数据时，RLS 和策略非常重要；不要为了"能看到数据"就随意关闭 RLS 或公开密钥。DBeaver 使用的数据库账号权限与应用用户的访问路径不同，测试结果也可能不同。
- **连接池（pooler）**：Supabase 可提供连接池地址。用 DBeaver 这类交互式客户端连 Supabase 时，通常用 session pooler（会话模式）。不要把密码粘贴到公开文档、代码仓库或聊天里。
- **生产环境谨慎操作**：查看数据通常用 `SELECT`。`UPDATE`、`DELETE`、`DROP`、`TRUNCATE` 会改动或删除数据，执行前先确认连接、条件和备份。

## 6. 建议的 MySQL 转 PostgreSQL 学习顺序

1. 先用 DBeaver 查看 `public` 下的表结构和几行样例数据。
2. 熟悉 `schema.table` 命名、`information_schema`、主键/外键和视图。
3. 掌握 `LIMIT`、`ILIKE`、`RETURNING`、`ON CONFLICT` 等常用差异。
4. 再学习 PostgreSQL 的 `jsonb`、数组、CTE（`WITH`）、窗口函数和 `EXPLAIN`。
5. 接应用前理解 Supabase 的 RLS、角色与 API 权限；不要把数据库密码或 service role secret 放进前端。

## 官方资料

- [Supabase 数据库概览](https://supabase.com/docs/guides/database/overview)：Supabase 项目使用完整的 PostgreSQL 数据库，并介绍 Table Editor、SQL Editor、RLS 等入口。
- [Supabase 数据库连接](https://supabase.com/docs/guides/database/connecting-to-postgres)：连接串、直连和连接池模式说明。
- [Supabase 架构](https://supabase.com/docs/guides/getting-started/architecture)：说明 PostgreSQL 是 Supabase 的核心数据库。
- [PostgreSQL 官方文档](https://www.postgresql.org/docs/current/)：PostgreSQL 语法和功能参考。
