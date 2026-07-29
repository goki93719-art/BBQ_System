import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("finished product metadata and starter cleanup are present", async () => {
  const [layout, page, app, styles, apiRoute, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/GrillApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/[[...path]]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Edison 爱吃烧烤/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(page, /<GrillApp \/>/);
  assert.match(app, /一键重订/);
  assert.match(app, /替换购物车/);
  assert.match(app, /追加到购物车/);
  assert.match(app, /strategy === "replace"/);
  assert.match(app, /Number\(merged\[key\]\?\.quantity \?\? 0\) \+ Number\(line\.quantity\)/);
  assert.match(app, /一键清空购物车/);
  assert.match(app, /\/api\/auth\/code\/login/);
  assert.match(app, /测试版固定验证码：9999/);
  assert.doesNotMatch(app, />密码登录<|>获取验证码</);
  assert.match(apiRoute, /action === "code" && segments\[2\] === "login"/);
  assert.match(apiRoute, /auto_registered: created/);
  assert.match(app, /购物车有 \{invalidCartLines\.length\} 种失效商品/);
  assert.match(app, /已标记并从合计中扣除/);
  assert.match(app, /商品名称/);
  assert.match(app, /上下架操作/);
  assert.match(app, /库存操作/);
  assert.match(app, /menu-category-cell/);
  assert.match(app, /window\.setTimeout\(onDismiss, 3000\)/);
  assert.doesNotMatch(app, /setMessage\(""\), 1500/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /role="dialog" aria-modal="true" aria-label="购物车"/);
  assert.match(app, /aria-label="顾客端主导航"/);
  assert.match(app, /搭配小提示/);
  assert.match(app, /近一年订单记录/);
  assert.match(app, /今日待处理/);
  assert.match(app, /今日已确认/);
  assert.match(app, /今日确认金额/);
  assert.match(app, /\[10, 20, 50\]/);
  assert.match(app, /TrendLineChart/);
  assert.match(app, /悬浮折线查看明细/);
  assert.match(app, /onPointerMove=\{showHoverPoint\}/);
  assert.match(app, /全年（月度汇总）/);
  assert.match(app, /option-dialog/);
  assert.match(app, /月售/);
  assert.doesNotMatch(app, /className="attr-row"/);
  assert.doesNotMatch(app, /每500ML/);
  assert.doesNotMatch(app, /空桶补 0|mini-bars|admin-period/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /font-size: 16px;/);
  assert.match(styles, /\.option-dialog/);
  assert.match(styles, /\.repeat-dialog/);
  assert.match(styles, /\.trend-panel \{ grid-column: 1 \/ -1; \}/);
  assert.match(styles, /\.trend-tooltip/);
  assert.match(styles, /\.capacity-values button strong \{ font-size: 16px; \}/);
  assert.match(styles, /\.food-copy footer strong \{[^}]*font-size: 28px;/);
  assert.match(styles, /\.inventory-action\.available/);
  assert.match(styles, /\.inventory-action\.sold-out/);
  assert.match(styles, /\.cart-line\.invalid .cart-icon/);
  assert.doesNotMatch(`${layout}\n${page}\n${packageJson}`, /codex-preview|react-loading-skeleton|SkeletonPreview/);
  assert.deepEqual(JSON.parse(hosting), {
    project_id: "appgprj_6a690548f4c881918d2d5cda9518de61",
    d1: "DB",
    r2: null,
  });
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
