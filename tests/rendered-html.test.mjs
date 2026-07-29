import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("finished product metadata and starter cleanup are present", async () => {
  const [layout, page, app, styles, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/GrillApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /炭火里 · 智慧烧烤点餐系统/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(page, /<GrillApp \/>/);
  assert.match(app, /一键重订/);
  assert.match(app, /搭配小提示/);
  assert.match(app, /近一年订单记录/);
  assert.match(app, /今日待处理/);
  assert.match(app, /今日已确认/);
  assert.match(app, /今日确认金额/);
  assert.match(app, /\[10, 20, 50\]/);
  assert.match(app, /TrendLineChart/);
  assert.match(app, /全年（月度汇总）/);
  assert.match(app, /option-dialog/);
  assert.match(app, /月售/);
  assert.doesNotMatch(app, /className="attr-row"/);
  assert.doesNotMatch(app, /每500ML/);
  assert.doesNotMatch(app, /空桶补 0|mini-bars|admin-period/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.option-dialog/);
  assert.match(styles, /\.trend-panel \{ grid-column: 1 \/ -1; \}/);
  assert.match(styles, /\.capacity-values button strong \{ font-size: 16px; \}/);
  assert.match(styles, /\.food-copy footer strong \{[^}]*font-size: 28px;/);
  assert.doesNotMatch(`${layout}\n${page}\n${packageJson}`, /codex-preview|react-loading-skeleton|SkeletonPreview/);
  assert.deepEqual(JSON.parse(hosting), {
    project_id: "appgprj_6a690548f4c881918d2d5cda9518de61",
    d1: "DB",
    r2: null,
  });
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
