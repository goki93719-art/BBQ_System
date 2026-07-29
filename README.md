# Edison 爱吃烧烤

基于 Next.js / React / Turso libSQL 的单门店烧烤点餐演示系统。一个响应式页面提供“顾客点餐”和“门店管理”双模式，可直接部署到 Vercel，业务数据持久化在 Turso。

## 功能

- 顾客：账号加固定验证码登录（测试码 `9999`，新账号自动创建）、菜单搜索/浏览、全品类规格弹窗、烧烤辣度、啤酒容量阶梯价、月售、一键重订、搭配弱提示、售罄失效提示、变价确认、幂等下单、撤回、订单记录、个人消费记录。
- 管理：店长/操作员登录、3 秒订单轮询、订单中心当日待处理/已确认/确认金额、确认/拒绝、跨日待确认订单自动拒绝、店长作废、近一年订单倒序分页（10/20/50 条）、商品售罄即时配置、待确认订单售罄联动与金额扣除、品类与商品基础维护、店长专属年/月经营统计与自适应折线趋势、审计日志。
- 数据：24 道种子商品、近 6 个月历史订单与商品明细、订单规格快照、唯一消费台账、状态时间线、审计、固定营业日期/时区口径。

## 本地启动

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

本地开发默认使用项目目录中的 `edison-grill.local.db`，不需要提前创建云数据库。该文件已经加入 `.gitignore`。

如需让本地环境连接部署使用的 Turso 数据库，将 `.env.example` 复制为 `.env.local`，填写：

```dotenv
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-database-token
CRON_SECRET=replace-with-a-random-string-at-least-16-characters
APP_ENV=demo
MOCK_SMS_ENABLED=true
```

首次访问 API 时会自动初始化表结构及可重复执行的演示种子数据。

## 部署到 Vercel

1. 在 Vercel 导入 GitHub 仓库 `goki93719-art/BBQ_System`。
2. **Root Directory** 保持仓库根目录 `.`。只有在导入外层工作区仓库时，才设置为 `webapp`。
3. **Framework Preset** 选择 `Next.js`。
4. Build Command 使用默认值 `npm run build`；**Output Directory 留空**，由 Next.js 自动管理。
5. 在 Vercel Marketplace/Storage 中创建并连接 Turso 数据库，或者手动配置：

   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `CRON_SECRET`（至少 16 位随机字符串，用于保护自动拒单定时任务）
   - `APP_ENV=demo`
   - `MOCK_SMS_ENABLED=true`

6. 重新部署。首次访问任一 API 后，数据库会自动建表并插入演示数据。`vercel.json` 会注册每日 `00:05`（Asia/Shanghai）的过期订单清理任务；顾客端或管理端读取订单时也会执行同一规则作为兜底。

当前固定验证码 `9999` 仅用于测试版。接入真实短信前不要把 `APP_ENV` 设置为 `production`；生产模式会阻止 Mock 验证码配置。

## 演示账号

| 入口 | 账号 | 密码 / 验证码 | 权限 |
|---|---|---|---|
| 顾客 | 任意合法大陆手机号（示例 `13800138000`） | 固定验证码 `9999` | 自动登录或创建账号，点餐、撤回、订单和个人消费 |
| 店长 | `manager` | `Manager123` | 全部管理能力 |
| 操作员 | `operator` | `Operator123` | 接单、拒绝与订单查看 |

Mock 验证码仅用于开发/评审。若运行时显式设置 `APP_ENV=production` 且未将 `MOCK_SMS_ENABLED=false`，服务会拒绝初始化。

## 验证

```bash
npm run build
npm test
npm run lint
npm run db:generate
```

自动化测试覆盖生产 Mock 硬门禁、手机号与密码规则、规格与阶梯价、搭配提醒、跨午夜售卖时段、跨日待确认订单截止边界、订单状态机、规格/售罄快照、数据库 CHECK、幂等唯一约束、并发状态竞争、确认事务回滚、一单一台账、作废后统计排除、订单分页、年/月趋势聚合和 starter 清理。`scripts/feature-acceptance.mjs` 用于本地服务启动后的新增功能 HTTP 验收。

## 目录

```text
app/
  api/[[...path]]/route.ts   统一 JSON API
  api/cron/expire-orders/    跨日待确认订单定时清理
  ui/GrillApp.tsx            顾客/管理双模式交互
db/
  client.ts                  Turso/libSQL 数据库适配层
  schema.ts                  Drizzle SQLite 模型
  runtime.ts                 表结构初始化与演示种子
drizzle/                     可部署迁移
lib/                         安全与冻结业务规则
tests/                       规则、数据库不变量、产品结构测试
```

详细设计与提测信息分别见仓库根目录 `delivery/technical_design.md` 和 `delivery/dev_test_handoff.md`。
