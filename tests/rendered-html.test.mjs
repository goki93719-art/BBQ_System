import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("finished product metadata and starter cleanup are present", async () => {
  const [layout, page, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /炭火里 · 智慧点餐/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(page, /<GrillApp \/>/);
  assert.doesNotMatch(`${layout}\n${page}\n${packageJson}`, /codex-preview|react-loading-skeleton|SkeletonPreview/);
  assert.deepEqual(JSON.parse(hosting), { d1: "DB", r2: null });
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
