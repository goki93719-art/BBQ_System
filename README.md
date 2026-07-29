# 炭火里 · 智慧点餐 MVP

基于 Vinext / React / Cloudflare D1 的单门店烧烤点餐演示系统。一个响应式页面提供“顾客点餐”和“门店管理”双模式，数据持久化在 D1。

## 功能

- 顾客：手机号密码登录、Mock 验证码登录/注册、菜单搜索/浏览、全品类规格弹窗、烧烤辣度、啤酒容量阶梯价、月售、一键重订、搭配弱提示、变价确认、幂等下单、撤回、订单记录、个人消费记录。
- 管理：店长/操作员登录、3 秒订单轮询、确认/拒绝、店长作废、商品售罄即时配置、待确认订单售罄联动与金额扣除、品类与商品基础维护、经营统计、审计日志。
- 数据：24 道种子商品、近 6 个月历史订单与商品明细、订单规格快照、唯一消费台账、状态时间线、审计、固定营业日期/时区口径。

## 本地启动

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

也可以使用：

```bash
./scripts/start-local.sh
```

D1 绑定名为 `DB`。首次访问 API 时会使用 prepared statements 初始化本地表结构和可重复种子数据；用于部署的正式迁移位于 `drizzle/`。

## 演示账号

| 入口 | 账号 | 密码 / 验证码 | 权限 |
|---|---|---|---|
| 顾客 | `13800138000` | `grill1234` | 点餐、撤回、订单和个人消费 |
| 顾客 Mock 验证码 | 任意合法未注册大陆手机号 | `9999` | 验证后设置密码并自动登录 |
| 店长 | `manager` | `Manager123` | 全部管理能力 |
| 操作员 | `operator` | `Operator123` | 接单/拒绝、订单与今日摘要 |

Mock 验证码仅用于开发/评审。若运行时显式设置 `APP_ENV=production` 且未将 `MOCK_SMS_ENABLED=false`，服务会拒绝初始化。

## 验证

```bash
npm run build
npm test
npm run lint
npm run db:generate
```

自动化测试覆盖生产 Mock 硬门禁、手机号与密码规则、规格与阶梯价、搭配提醒、跨午夜售卖时段、订单状态机、规格/售罄快照、数据库 CHECK、幂等唯一约束、并发状态竞争、确认事务回滚、一单一台账、作废后统计排除和 starter 清理。`scripts/feature-acceptance.mjs` 用于本地服务启动后的新增功能 HTTP 验收。

## 目录

```text
app/
  api/[[...path]]/route.ts   统一 JSON API
  ui/GrillApp.tsx            顾客/管理双模式交互
db/
  schema.ts                  Drizzle D1 模型
  runtime.ts                 prepared statements 初始化与种子
drizzle/                     可部署迁移
lib/                         安全与冻结业务规则
tests/                       规则、数据库不变量、产品结构测试
```

详细设计与提测信息分别见仓库根目录 `delivery/technical_design.md` 和 `delivery/dev_test_handoff.md`。
