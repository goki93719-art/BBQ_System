const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];

function record(name, pass, evidence) {
  results.push({ name, result: pass ? "PASS" : "FAIL", evidence });
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function call(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload, cookie: cookieFrom(response) };
}

const customerLogin = await call("/api/auth/code/login", {
  method: "POST",
  body: { phone: "13800138000", code: "9999" },
});
const managerLogin = await call("/api/admin/auth/login", {
  method: "POST",
  body: { username: "manager", password: "Manager123" },
});
const customerCookie = customerLogin.cookie;
const managerCookie = managerLogin.cookie;
record("演示账号登录", customerLogin.status === 200 && managerLogin.status === 200, `customer=${customerLogin.status}, manager=${managerLogin.status}`);

const menu = await call("/api/menu");
const categories = menu.payload.data?.categories ?? [];
const items = categories.flatMap((category) => category.items ?? []);
const skewer = items.find((item) => item.category_code === "SKEWER" && item.sellable);
const beer = items.find((item) => item.business_type === "BEER" && item.sellable);
const spiceGroup = skewer?.option_groups?.find((group) => group.key === "spice_level");
const capacityGroup = beer?.option_groups?.find((group) => group.key === "capacity");
const prices = capacityGroup?.values ?? [];
record(
  "规格与阶梯价",
  menu.status === 200 &&
    spiceGroup?.values?.map((option) => option.value).join(",") === "免辣,微辣,中辣,特辣" &&
    prices.length === 3 &&
    prices[1].unit_price_per_500ml_cent < prices[0].unit_price_per_500ml_cent &&
    prices[2].unit_price_per_500ml_cent < prices[1].unit_price_per_500ml_cent,
  `spice=${spiceGroup?.values?.length}, capacity=${prices.length}`,
);

const soldItems = items.filter((item) => Number(item.monthly_sold) > 0);
record("历史数据与月售", soldItems.length >= 10, `monthly_sold_items=${soldItems.length}, catalog=${items.length}`);

const capacity3 = prices.find((option) => option.value === "3L");
const optionOrder = await call("/api/orders", {
  method: "POST",
  cookie: customerCookie,
  body: {
    clientRequestId: `feature-options-${crypto.randomUUID()}`,
    items: [
      { itemId: skewer.id, quantity: 2, unitPriceCent: skewer.price_cent, selection: { spice_level: "特辣" } },
      { itemId: beer.id, quantity: 1, unitPriceCent: capacity3.price_cent, selection: { capacity: "3L" } },
    ],
    note: "规格验收",
  },
});
const optionItems = optionOrder.payload.data?.order?.items ?? [];
record(
  "订单规格快照",
  optionOrder.status === 201 &&
    optionItems.some((item) => item.selection?.spice_level === "特辣") &&
    optionItems.some((item) => item.selection?.capacity === "3L" && item.unit_price_cent === capacity3.price_cent),
  `status=${optionOrder.status}, selections=${optionItems.map((item) => item.selection_label).join("/")}`,
);
if (optionOrder.status === 201) {
  await call(`/api/orders/${optionOrder.payload.data.order.id}/cancel`, { method: "POST", body: {}, cookie: customerCookie });
}

const linkTarget = items.find((item) =>
  item.sellable && item.id !== skewer.id && item.business_type !== "BEER");
const companion = items.find((item) =>
  item.sellable && item.id !== linkTarget.id && item.business_type === "DRINK");
const linkOrder = await call("/api/orders", {
  method: "POST",
  cookie: customerCookie,
  body: {
    clientRequestId: `feature-soldout-${crypto.randomUUID()}`,
    items: [
      { itemId: linkTarget.id, quantity: 2, unitPriceCent: linkTarget.price_cent, selection: {} },
      { itemId: companion.id, quantity: 1, unitPriceCent: companion.price_cent, selection: {} },
    ],
    note: "售罄联动验收",
  },
});

const adminItemsBefore = await call("/api/admin/items?page_size=100", { cookie: managerCookie });
const targetAdmin = adminItemsBefore.payload.data?.items?.find((item) => item.id === linkTarget.id);
const soldOut = await call(`/api/admin/items/${linkTarget.id}`, {
  method: "PATCH",
  cookie: managerCookie,
  body: { soldOut: true, version: targetAdmin.version },
});
const linkedOrder = await call(`/api/orders/${linkOrder.payload.data?.order?.id}`, { cookie: customerCookie });
const linkedSoldLine = linkedOrder.payload.data?.order?.items?.find((item) => item.item_id === linkTarget.id);
record(
  "售罄联动待确认订单金额",
  soldOut.status === 200 &&
    soldOut.payload.data?.sold_out_impact?.order_count >= 1 &&
    linkedSoldLine?.fulfillment_status === "SOLD_OUT" &&
    linkedOrder.payload.data?.order?.total_cent === companion.price_cent,
  `impact=${soldOut.payload.data?.sold_out_impact?.order_count}, status=${linkedSoldLine?.fulfillment_status}, total=${linkedOrder.payload.data?.order?.total_cent}`,
);

const adminItemsSold = await call("/api/admin/items?page_size=100", { cookie: managerCookie });
const sortedItems = adminItemsSold.payload.data?.items ?? [];
const firstSoldOut = sortedItems.findIndex((item) => item.sold_out);
record(
  "售罄商品自动排后",
  firstSoldOut >= 0 && sortedItems.slice(firstSoldOut).every((item) => item.sold_out),
  `first_sold_out_index=${firstSoldOut}, total=${sortedItems.length}`,
);

const updatedTarget = soldOut.payload.data?.item;
if (updatedTarget) {
  await call(`/api/admin/items/${linkTarget.id}`, {
    method: "PATCH",
    cookie: managerCookie,
    body: { soldOut: false, version: updatedTarget.version },
  });
}
if (linkOrder.status === 201) {
  await call(`/api/orders/${linkOrder.payload.data.order.id}/cancel`, { method: "POST", body: {}, cookie: customerCookie });
}

const chinaParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
}).formatToParts(new Date());
const analyticsYear = chinaParts.find((part) => part.type === "year").value;
const analyticsMonth = chinaParts.find((part) => part.type === "month").value;
const analytics = await call(`/api/admin/analytics?year=${analyticsYear}&month=${analyticsMonth}`, { cookie: managerCookie });
record(
  "销售看板历史数据",
  analytics.status === 200 &&
    analytics.payload.data?.scope === "month" &&
    analytics.payload.data?.summary?.order_count > 0 &&
    analytics.payload.data?.top_items?.length > 0 &&
    analytics.payload.data?.trend?.length >= 28,
  `scope=${analytics.payload.data?.scope}, orders=${analytics.payload.data?.summary?.order_count}, trend=${analytics.payload.data?.trend?.length}`,
);

const yearlyAnalytics = await call(`/api/admin/analytics?year=${analyticsYear}`, { cookie: managerCookie });
record(
  "年度月份聚合",
  yearlyAnalytics.status === 200 &&
    yearlyAnalytics.payload.data?.scope === "year" &&
    yearlyAnalytics.payload.data?.trend?.length === 12 &&
    yearlyAnalytics.payload.data?.trend?.every((row) => /^\d{4}-\d{2}$/.test(row.bucket)),
  `scope=${yearlyAnalytics.payload.data?.scope}, buckets=${yearlyAnalytics.payload.data?.trend?.length}`,
);

const historyDefault = await call("/api/admin/orders?view=history&page=1", { cookie: managerCookie });
const history10 = await call("/api/admin/orders?view=history&page=1&page_size=10", { cookie: managerCookie });
const history20 = await call("/api/admin/orders?view=history&page=1&page_size=20", { cookie: managerCookie });
const orderDashboard = await call("/api/admin/orders?status=PENDING_CONFIRM&page_size=100", { cookie: managerCookie });
const historyItems = history10.payload.data?.items ?? [];
record(
  "近一年订单倒序分页",
  history10.status === 200 &&
    historyDefault.payload.data?.page_size === 10 &&
    history10.payload.data?.page_size === 10 &&
    historyItems.length <= 10 &&
    historyItems.every((order) => order.status !== "PENDING_CONFIRM") &&
    historyItems.every((order) => order.submitted_at >= history10.payload.data?.retention_start) &&
    historyItems.every((order, index) => index === 0 || order.submitted_at <= historyItems[index - 1].submitted_at) &&
    history20.payload.data?.page_size === 20 &&
    history20.payload.data?.total === history10.payload.data?.total,
  `total=${history10.payload.data?.total}, page10=${historyItems.length}, page20=${history20.payload.data?.items?.length}`,
);
record(
  "订单中心当日指标",
  orderDashboard.status === 200 &&
    /^\d{4}-\d{2}-\d{2}$/.test(orderDashboard.payload.data?.today_summary?.business_date) &&
    Number.isInteger(orderDashboard.payload.data?.today_summary?.pending_count) &&
    Number.isInteger(orderDashboard.payload.data?.today_summary?.confirmed_count) &&
    Number.isInteger(orderDashboard.payload.data?.today_summary?.confirmed_amount_cent),
  JSON.stringify(orderDashboard.payload.data?.today_summary),
);

const summary = {
  total: results.length,
  passed: results.filter((result) => result.result === "PASS").length,
  failed: results.filter((result) => result.result === "FAIL").length,
};
console.log(JSON.stringify({ summary, results }, null, 2));
if (summary.failed) process.exitCode = 1;
