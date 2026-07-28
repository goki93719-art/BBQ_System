/* eslint-disable @typescript-eslint/no-explicit-any */
import { ensureDatabase, STORE_ID } from "@/db/runtime";
import { clearCookie, randomToken, readCookie, sessionCookie, sha256, verifyPassword, hashPassword } from "@/lib/security";
import {
  businessDate,
  canonicalCart,
  inSalePeriods,
  maskPhone,
  normalizePhone,
  periodStart,
  validPassword,
} from "@/lib/rules.mjs";

type Row = Record<string, any>;
type RouteContext = { params: Promise<{ path?: string[] }> };

class ApiError extends Error {
  constructor(
    public status: number,
    public errorCode: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function success(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json({ data }, { status, headers });
}

function errorResponse(error: unknown, traceId: string) {
  if (error instanceof ApiError) {
    return Response.json(
      { error_code: error.errorCode, message: error.message, trace_id: traceId, details: error.details },
      { status: error.status },
    );
  }
  console.error("api_error", traceId, error instanceof Error ? error.message : "unknown");
  return Response.json(
    { error_code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试。", trace_id: traceId },
    { status: 500 },
  );
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Row;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求内容不是有效 JSON。");
  }
}

function isoAfter(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function endDateExclusive() {
  return addDays(businessDate(new Date()), 1);
}

function fillTrend(period: string, start: string, end: string, rows: Row[]) {
  const values = new Map(rows.map((row) => [row.bucket, row]));
  const buckets: string[] = [];
  if (period === "today") {
    const hour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()));
    for (let index = 0; index <= hour; index += 1) buckets.push(`${String(index).padStart(2, "0")}:00`);
  } else if (period === "year") {
    const currentMonth = businessDate(new Date()).slice(0, 7);
    let month = start.slice(0, 7);
    while (month <= currentMonth) {
      buckets.push(month);
      const [year, value] = month.split("-").map(Number);
      const next = value === 12 ? [year + 1, 1] : [year, value + 1];
      month = `${next[0]}-${String(next[1]).padStart(2, "0")}`;
    }
  } else {
    for (let date = start; date < end; date = addDays(date, 1)) buckets.push(date);
  }
  return buckets.map((bucket) => ({
    bucket,
    amount_cent: Number(values.get(bucket)?.amount_cent ?? 0),
    order_count: Number(values.get(bucket)?.order_count ?? 0),
  }));
}

function pageParams(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize, url };
}

async function createSession(db: D1Database, subjectType: "CUSTOMER" | "ADMIN", subjectId: string) {
  const token = randomToken();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO sessions (id, subject_type, subject_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
  ).bind(crypto.randomUUID(), subjectType, subjectId, await sha256(token), isoAfter(7 * 86400), now).run();
  return token;
}

async function customerFromRequest(db: D1Database, request: Request) {
  const token = readCookie(request, "customer_session");
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "请先登录顾客账号。");
  const row = await db.prepare(
    `SELECT u.id, u.store_id, u.phone_normalized, u.nickname
     FROM sessions s JOIN users u ON u.id = s.subject_id
     WHERE s.subject_type = 'CUSTOMER' AND s.token_hash = ? AND s.revoked_at IS NULL
       AND s.expires_at > ? AND u.status = 'ACTIVE'`,
  ).bind(await sha256(token), new Date().toISOString()).first<Row>();
  if (!row) throw new ApiError(401, "SESSION_EXPIRED", "登录已失效，请重新登录。");
  return row;
}

async function adminFromRequest(db: D1Database, request: Request, managerOnly = false) {
  const token = readCookie(request, "admin_session");
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "请先登录管理端。");
  const row = await db.prepare(
    `SELECT a.id, a.store_id, a.username, a.display_name, a.role
     FROM sessions s JOIN admin_users a ON a.id = s.subject_id
     WHERE s.subject_type = 'ADMIN' AND s.token_hash = ? AND s.revoked_at IS NULL
       AND s.expires_at > ? AND a.status = 'ACTIVE'`,
  ).bind(await sha256(token), new Date().toISOString()).first<Row>();
  if (!row) throw new ApiError(401, "SESSION_EXPIRED", "管理端登录已失效。");
  if (managerOnly && row.role !== "MANAGER") {
    throw new ApiError(403, "FORBIDDEN", "该操作仅店长可执行。");
  }
  return row;
}

function publicCustomer(row: Row) {
  return { id: row.id, nickname: row.nickname, phone_masked: maskPhone(row.phone_normalized) };
}

function publicAdmin(row: Row) {
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}

async function orderDetails(db: D1Database, order: Row) {
  const [items, history] = await Promise.all([
    db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").bind(order.id).all<Row>(),
    db.prepare("SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at").bind(order.id).all<Row>(),
  ]);
  return { ...order, items: items.results, history: history.results };
}

async function currentCart(db: D1Database, requested: Row[]) {
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > 50) {
    throw new ApiError(400, "INVALID_CART", "购物车需包含 1–50 个商品。");
  }
  const merged = new Map<string, { itemId: string; quantity: number; unitPriceCent: number }>();
  for (const raw of requested) {
    const itemId = String(raw.itemId ?? "");
    const quantity = Number(raw.quantity);
    const unitPriceCent = Number(raw.unitPriceCent);
    if (!itemId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isInteger(unitPriceCent)) {
      throw new ApiError(400, "INVALID_CART_ITEM", "商品、数量或价格格式不正确。");
    }
    const previous = merged.get(itemId);
    const combined = (previous?.quantity ?? 0) + quantity;
    if (combined > 99) throw new ApiError(422, "QUANTITY_LIMIT", "单项商品最多购买 99 件。");
    merged.set(itemId, { itemId, quantity: combined, unitPriceCent });
  }
  const ids = [...merged.keys()];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT i.*, c.name category_name, c.code category_code, c.status category_status,
            c.sale_periods_json category_sale_periods
     FROM items i JOIN categories c ON c.id = i.category_id
     WHERE i.store_id = ? AND i.id IN (${placeholders})`,
  ).bind(STORE_ID, ...ids).all<Row>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  return [...merged.values()].map((requestItem) => {
    const item = byId.get(requestItem.itemId);
    let reason = "";
    if (!item || item.status !== "ACTIVE" || item.category_status !== "ENABLED") reason = "已下架";
    else if (item.sold_out) reason = "已售罄";
    else if (
      !inSalePeriods(JSON.parse(item.sale_periods_json || "[]")) ||
      !inSalePeriods(JSON.parse(item.category_sale_periods || "[]"))
    ) reason = "当前不在售卖时段";
    return {
      itemId: requestItem.itemId,
      quantity: requestItem.quantity,
      requestedPriceCent: requestItem.unitPriceCent,
      unitPriceCent: item?.price_cent ?? 0,
      available: !reason,
      reason,
      item,
    };
  });
}

async function handleAuth(db: D1Database, request: Request, segments: string[]) {
  const action = segments[1];
  if (request.method === "POST" && action === "sms" && segments[2] === "request") {
    const body = await readBody(request);
    const phone = normalizePhone(body.phone);
    if (!phone) throw new ApiError(400, "INVALID_PHONE", "请输入正确的手机号。");
    const now = new Date().toISOString();
    const latest = await db.prepare(
      "SELECT resend_after FROM auth_challenges WHERE phone_normalized = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(phone).first<Row>();
    if (latest && latest.resend_after > now) throw new ApiError(429, "SMS_TOO_FREQUENT", "60 秒内请勿重复获取验证码。");
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("UPDATE auth_challenges SET consumed_at = ? WHERE phone_normalized = ? AND consumed_at IS NULL").bind(now, phone),
      db.prepare("INSERT INTO auth_challenges VALUES (?, ?, 'LOGIN_OR_REGISTER', ?, ?, 0, NULL, ?)").bind(id, phone, isoAfter(300), isoAfter(60), now),
    ]);
    return success({ challenge_id: id, expires_in: 300, resend_after: 60, mock_hint: "测试验证码：9999" }, 201);
  }

  if (request.method === "POST" && action === "sms" && segments[2] === "login") {
    const body = await readBody(request);
    const phone = normalizePhone(body.phone);
    if (!phone || typeof body.challengeId !== "string" || typeof body.code !== "string") {
      throw new ApiError(400, "INVALID_AUTH_INPUT", "手机号、挑战凭证或验证码格式不正确。");
    }
    const now = new Date().toISOString();
    const challenge = await db.prepare("SELECT * FROM auth_challenges WHERE id = ? AND phone_normalized = ?").bind(body.challengeId, phone).first<Row>();
    if (!challenge || challenge.consumed_at || challenge.expires_at <= now) throw new ApiError(422, "CHALLENGE_EXPIRED", "验证码已失效，请重新获取。");
    if (challenge.attempts >= 5) throw new ApiError(422, "CHALLENGE_LOCKED", "验证码错误次数过多，请重新获取。");
    if (body.code !== "9999") {
      await db.prepare("UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?").bind(challenge.id).run();
      throw new ApiError(422, "INVALID_SMS_CODE", "验证码错误，请输入测试验证码 9999。");
    }
    const consumed = await db.prepare("UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").bind(now, challenge.id).run();
    if (!consumed.meta.changes) throw new ApiError(409, "CHALLENGE_ALREADY_USED", "验证码已被使用，请重新获取。");
    const user = await db.prepare("SELECT * FROM users WHERE phone_normalized = ? AND status = 'ACTIVE'").bind(phone).first<Row>();
    if (user) {
      const token = await createSession(db, "CUSTOMER", user.id);
      return success({ user: publicCustomer(user), need_register: false }, 200, { "Set-Cookie": sessionCookie("customer_session", token) });
    }
    const registrationToken = randomToken();
    await db.prepare("INSERT INTO registration_tokens VALUES (?, ?, ?, ?, NULL)").bind(
      crypto.randomUUID(), await sha256(registrationToken), phone, isoAfter(600),
    ).run();
    return success({ need_register: true, registration_token: registrationToken, phone_masked: maskPhone(phone) });
  }

  if (request.method === "POST" && action === "password" && segments[2] === "login") {
    const body = await readBody(request);
    const phone = normalizePhone(body.phone);
    if (!phone || typeof body.password !== "string") throw new ApiError(400, "INVALID_AUTH_INPUT", "手机号或密码格式不正确。");
    const user = await db.prepare("SELECT * FROM users WHERE phone_normalized = ? AND status = 'ACTIVE'").bind(phone).first<Row>();
    if (!user) throw new ApiError(422, "NEED_REGISTER", "该手机号尚未注册，请使用验证码完成注册。");
    if (!(await verifyPassword(body.password, user.password_hash))) throw new ApiError(422, "INVALID_CREDENTIALS", "手机号或密码错误。");
    const token = await createSession(db, "CUSTOMER", user.id);
    return success({ user: publicCustomer(user) }, 200, { "Set-Cookie": sessionCookie("customer_session", token) });
  }

  if (request.method === "POST" && action === "register") {
    const body = await readBody(request);
    const phone = normalizePhone(body.phone);
    if (!phone || !validPassword(body.password) || typeof body.registrationToken !== "string") {
      throw new ApiError(400, "INVALID_REGISTER_INPUT", "手机号、注册凭证或密码不符合要求。");
    }
    const tokenHash = await sha256(body.registrationToken);
    const tokenRow = await db.prepare(
      "SELECT * FROM registration_tokens WHERE token_hash = ? AND phone_normalized = ? AND consumed_at IS NULL AND expires_at > ?",
    ).bind(tokenHash, phone, new Date().toISOString()).first<Row>();
    if (!tokenRow) throw new ApiError(422, "REGISTRATION_TOKEN_INVALID", "注册凭证已失效，请重新验证手机号。");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const nickname = String(body.nickname ?? "炭火好友").trim().slice(0, 20) || "炭火好友";
    try {
      await db.batch([
        db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)").bind(id, STORE_ID, phone, await hashPassword(body.password), nickname, now),
        db.prepare("UPDATE registration_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").bind(now, tokenRow.id),
      ]);
    } catch {
      throw new ApiError(409, "PHONE_ALREADY_REGISTERED", "该手机号已经注册，请直接登录。");
    }
    const token = await createSession(db, "CUSTOMER", id);
    return success({ user: publicCustomer({ id, nickname, phone_normalized: phone }) }, 201, { "Set-Cookie": sessionCookie("customer_session", token) });
  }

  if (request.method === "GET" && action === "me") {
    return success({ user: publicCustomer(await customerFromRequest(db, request)) });
  }

  if (request.method === "POST" && action === "logout") {
    const token = readCookie(request, "customer_session");
    if (token) await db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), await sha256(token)).run();
    return success({ logged_out: true }, 200, { "Set-Cookie": clearCookie("customer_session") });
  }
  throw new ApiError(404, "NOT_FOUND", "接口不存在。");
}

async function handleMenu(db: D1Database, request: Request) {
  const keyword = (new URL(request.url).searchParams.get("keyword") ?? "").trim().toLocaleLowerCase();
  const categoryRows = await db.prepare(
    "SELECT * FROM categories WHERE store_id = ? AND status = 'ENABLED' ORDER BY sort_order, name",
  ).bind(STORE_ID).all<Row>();
  const itemRows = await db.prepare(
    `SELECT i.*, c.status category_status, c.sale_periods_json category_sale_periods
     FROM items i JOIN categories c ON c.id = i.category_id
     WHERE i.store_id = ? AND i.status = 'ACTIVE' AND c.status = 'ENABLED'
     ORDER BY i.sort_order, i.name`,
  ).bind(STORE_ID).all<Row>();
  const visibleItems = keyword
    ? itemRows.results.filter((item) =>
      `${item.name} ${item.description} ${item.attrs_json}`.toLocaleLowerCase().includes(keyword))
    : itemRows.results;
  const categories = categoryRows.results.map((category) => ({
    ...category,
    items: visibleItems.filter((item) => item.category_id === category.id).map((item) => {
      const inPeriod = inSalePeriods(JSON.parse(item.sale_periods_json || "[]")) &&
        inSalePeriods(JSON.parse(item.category_sale_periods || "[]"));
      return {
        ...item,
        attrs: JSON.parse(item.attrs_json || "{}"),
        sellable: !item.sold_out && inPeriod,
        sale_label: item.sold_out ? "已售罄" : !inPeriod ? "非售卖时段" : "",
      };
    }),
  })).filter((category) => !keyword || category.items.length > 0);
  const store = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(STORE_ID).first<Row>();
  return success({ store, categories, keyword });
}

async function createOrder(db: D1Database, request: Request) {
  const customer = await customerFromRequest(db, request);
  const body = await readBody(request);
  const clientRequestId = String(body.clientRequestId ?? "");
  const note = String(body.note ?? "").trim();
  const tableNo = String(body.tableNo ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientRequestId)) throw new ApiError(400, "INVALID_REQUEST_ID", "client_request_id 格式不正确。");
  if (note.length > 200 || tableNo.length > 30) throw new ApiError(400, "INVALID_ORDER_TEXT", "备注或桌号超过长度限制。");
  const requested = Array.isArray(body.items) ? body.items : [];
  const requestHash = await sha256(canonicalCart(requested, { note, tableNo }));
  const existing = await db.prepare(
    "SELECT * FROM orders WHERE store_id = ? AND user_id = ? AND client_request_id = ?",
  ).bind(STORE_ID, customer.id, clientRequestId).first<Row>();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "同一请求标识不能用于不同订单。");
    return success({ order: await orderDetails(db, existing), idempotent_replay: true });
  }
  const cart = await currentCart(db, requested);
  const latestCanonical = canonicalCart(cart.map((line) => ({
    itemId: line.itemId,
    quantity: line.quantity,
    unitPriceCent: line.unitPriceCent,
  })));
  const cartHash = await sha256(latestCanonical);
  const pendingQuote = await db.prepare(
    "SELECT * FROM quote_tokens WHERE store_id = ? AND user_id = ? AND client_request_id = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY rowid DESC LIMIT 1",
  ).bind(STORE_ID, customer.id, clientRequestId, new Date().toISOString()).first<Row>();
  let quoteValid = false;
  if (typeof body.quoteToken === "string" && pendingQuote) {
    quoteValid = pendingQuote.token_hash === await sha256(body.quoteToken) && pendingQuote.cart_hash === cartHash;
  }
  const hasChange = cart.some((line) => !line.available || line.requestedPriceCent !== line.unitPriceCent);
  if (hasChange || (pendingQuote && !quoteValid)) {
    const quoteToken = randomToken();
    await db.batch([
      db.prepare("UPDATE quote_tokens SET consumed_at = ? WHERE store_id = ? AND user_id = ? AND client_request_id = ? AND consumed_at IS NULL").bind(new Date().toISOString(), STORE_ID, customer.id, clientRequestId),
      db.prepare("INSERT INTO quote_tokens VALUES (?, ?, ?, ?, ?, ?, ?, NULL)").bind(
        crypto.randomUUID(), STORE_ID, customer.id, clientRequestId, await sha256(quoteToken), cartHash, isoAfter(300),
      ),
    ]);
    throw new ApiError(409, "CART_CHANGED", "购物车内容已变化，请确认后重新提交。", {
      quote_token: quoteToken,
      items: cart.map((line) => ({
        item_id: line.itemId,
        quantity: line.quantity,
        unit_price_cent: line.unitPriceCent,
        available: line.available,
        reason: line.reason,
        name: line.item?.name ?? "已失效商品",
      })),
    });
  }
  if (pendingQuote && !quoteValid) throw new ApiError(409, "CART_CHANGED", "请使用最新报价确认凭证。");
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const orderNo = `THL${now.replace(/\D/g, "").slice(2, 14)}${Math.floor(Math.random() * 900 + 100)}`;
  const totalCent = cart.reduce((sum, line) => sum + line.unitPriceCent * line.quantity, 0);
  const statements = [
    db.prepare(
      `INSERT INTO orders (id, store_id, order_no, user_id, client_request_id, request_hash, status, total_cent, note, table_no, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING_CONFIRM', ?, ?, ?, ?)`,
    ).bind(orderId, STORE_ID, orderNo, customer.id, clientRequestId, requestHash, totalCent, note, tableNo, now),
    db.prepare(
      `INSERT INTO order_status_history VALUES (?, ?, NULL, 'PENDING_CONFIRM', 'CUSTOMER', ?, '订单提交', ?)`,
    ).bind(crypto.randomUUID(), orderId, customer.id, now),
    db.prepare(
      `INSERT INTO audit_logs VALUES (?, ?, 'CUSTOMER', ?, 'ORDER_SUBMIT', 'ORDER', ?, NULL, ?, '', ?, ?)`,
    ).bind(crypto.randomUUID(), STORE_ID, customer.id, orderId, JSON.stringify({ status: "PENDING_CONFIRM", total_cent: totalCent }), `order:${orderId}:PENDING_CONFIRM`, now),
  ];
  for (const line of cart) {
    const item = line.item!;
    statements.push(db.prepare(
      `INSERT INTO order_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), orderId, item.id, item.sku, item.name, item.image_url, item.category_id,
      item.category_code, item.category_name, item.business_type, item.attrs_json, item.price_cent,
      line.quantity, item.price_cent * line.quantity,
    ));
  }
  if (pendingQuote) statements.push(db.prepare("UPDATE quote_tokens SET consumed_at = ? WHERE id = ?").bind(now, pendingQuote.id));
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await db.prepare(
      "SELECT * FROM orders WHERE store_id = ? AND user_id = ? AND client_request_id = ?",
    ).bind(STORE_ID, customer.id, clientRequestId).first<Row>();
    if (concurrent) {
      if (concurrent.request_hash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "同一请求标识不能用于不同订单。");
      return success({ order: await orderDetails(db, concurrent), idempotent_replay: true });
    }
    throw error;
  }
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Row>();
  return success({ order: await orderDetails(db, order!), idempotent_replay: false }, 201);
}

async function customerOrders(db: D1Database, request: Request, segments: string[]) {
  const customer = await customerFromRequest(db, request);
  if (request.method === "POST" && segments.length === 3 && segments[2] === "cancel") {
    const orderId = segments[1];
    const order = await db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").bind(orderId, customer.id).first<Row>();
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "订单不存在。");
    if (order.status !== "PENDING_CONFIRM") {
      throw new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已处理，无法撤回。", { final_status: order.status, processed_at: order.processed_at });
    }
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE orders SET status = 'CANCELLED', processed_at = ? WHERE id = ? AND user_id = ? AND status = 'PENDING_CONFIRM'").bind(now, order.id, customer.id),
      db.prepare(
        `INSERT OR IGNORE INTO order_status_history
         SELECT ?, id, 'PENDING_CONFIRM', 'CANCELLED', 'CUSTOMER', ?, '顾客撤回', ?
         FROM orders WHERE id = ? AND status = 'CANCELLED' AND processed_at = ?`,
      ).bind(crypto.randomUUID(), customer.id, now, order.id, now),
      db.prepare(
        `INSERT OR IGNORE INTO audit_logs
         SELECT ?, store_id, 'CUSTOMER', ?, 'ORDER_CANCEL', 'ORDER', id, ?, ?, '顾客撤回', ?, ?
         FROM orders WHERE id = ? AND status = 'CANCELLED' AND processed_at = ?`,
      ).bind(
        crypto.randomUUID(), customer.id, JSON.stringify({ status: "PENDING_CONFIRM" }),
        JSON.stringify({ status: "CANCELLED" }), `order:${order.id}:CANCELLED`, now, order.id, now,
      ),
    ]);
    const updated = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(order.id).first<Row>();
    if (updated?.status !== "CANCELLED") throw new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已由其他人处理。", { final_status: updated?.status, processed_at: updated?.processed_at });
    return success({ order: await orderDetails(db, updated) });
  }
  if (request.method === "GET" && segments.length === 2) {
    const order = await db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").bind(segments[1], customer.id).first<Row>();
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "订单不存在。");
    return success({ order: await orderDetails(db, order) });
  }
  const { page, pageSize, offset } = pageParams(request);
  const result = await db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?").bind(customer.id, pageSize, offset).all<Row>();
  const ordersWithItems = await Promise.all(result.results.map((row) => orderDetails(db, row)));
  return success({ items: ordersWithItems, page, page_size: pageSize });
}

async function customerConsumption(db: D1Database, request: Request) {
  const customer = await customerFromRequest(db, request);
  const { url, page, pageSize, offset } = pageParams(request);
  const period = url.searchParams.get("period") ?? "month";
  const start = periodStart(period);
  const end = endDateExclusive();
  const cutoff = new Date().toISOString();
  const summary = await db.prepare(
    `SELECT COALESCE(SUM(confirmed_amount_cent), 0) amount_cent, COUNT(*) order_count
     FROM consumption_records
     WHERE user_id = ? AND status = 'CONFIRMED'
       AND business_date >= ? AND business_date < ? AND confirmed_at_utc <= ?`,
  ).bind(customer.id, start, end, cutoff).first<Row>();
  const rows = await db.prepare(
    `SELECT c.*, o.order_no FROM consumption_records c JOIN orders o ON o.id = c.order_id
     WHERE c.user_id = ? AND c.status = 'CONFIRMED'
       AND c.business_date >= ? AND c.business_date < ? AND c.confirmed_at_utc <= ?
     ORDER BY c.confirmed_at_utc DESC LIMIT ? OFFSET ?`,
  ).bind(customer.id, start, end, cutoff, pageSize, offset).all<Row>();
  const amount = Number(summary?.amount_cent ?? 0);
  const orderCount = Number(summary?.order_count ?? 0);
  return success({
    summary: { amount_cent: amount, order_count: orderCount, average_cent: orderCount ? Math.round(amount / orderCount) : null },
    items: rows.results,
    period,
    page,
    page_size: pageSize,
  });
}

async function adminAuth(db: D1Database, request: Request, segments: string[]) {
  const action = segments[2];
  if (request.method === "POST" && action === "login") {
    const body = await readBody(request);
    const username = String(body.username ?? "").trim();
    const admin = await db.prepare("SELECT * FROM admin_users WHERE username = ? AND status = 'ACTIVE'").bind(username).first<Row>();
    if (!admin || typeof body.password !== "string" || !(await verifyPassword(body.password, admin.password_hash))) {
      throw new ApiError(422, "INVALID_CREDENTIALS", "账号或密码错误。");
    }
    const token = await createSession(db, "ADMIN", admin.id);
    return success({ admin: publicAdmin(admin) }, 200, { "Set-Cookie": sessionCookie("admin_session", token) });
  }
  if (request.method === "GET" && action === "me") return success({ admin: publicAdmin(await adminFromRequest(db, request)) });
  if (request.method === "POST" && action === "logout") {
    const token = readCookie(request, "admin_session");
    if (token) await db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), await sha256(token)).run();
    return success({ logged_out: true }, 200, { "Set-Cookie": clearCookie("admin_session") });
  }
  throw new ApiError(404, "NOT_FOUND", "接口不存在。");
}

async function adminOrders(db: D1Database, request: Request, segments: string[]) {
  const admin = await adminFromRequest(db, request);
  const orderId = segments[2];
  const action = segments[3];
  if (request.method === "POST" && orderId && action) {
    const order = await db.prepare("SELECT * FROM orders WHERE id = ? AND store_id = ?").bind(orderId, admin.store_id).first<Row>();
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "订单不存在。");
    const now = new Date().toISOString();
    if (action === "confirm") {
      if (order.status === "CONFIRMED" && order.confirmed_by === admin.id) {
        const record = await db.prepare("SELECT * FROM consumption_records WHERE order_id = ?").bind(order.id).first<Row>();
        return success({ order, consumption_record: record, idempotent_replay: true });
      }
      if (order.status !== "PENDING_CONFIRM") throw new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已处理。", { final_status: order.status, processed_at: order.processed_at });
      const recordId = crypto.randomUUID();
      await db.batch([
        db.prepare("UPDATE orders SET status = 'CONFIRMED', processed_at = ?, confirmed_by = ? WHERE id = ? AND status = 'PENDING_CONFIRM'").bind(now, admin.id, order.id),
        db.prepare(
          `INSERT INTO consumption_records
           SELECT ?, id, store_id, user_id, total_cent, 'CONFIRMED', ?, ?, 'Asia/Shanghai', '+08:00', ?, NULL, NULL, NULL
           FROM orders WHERE id = ? AND status = 'CONFIRMED' AND confirmed_by = ?`,
        ).bind(recordId, now, businessDate(new Date(now)), admin.id, order.id, admin.id),
        db.prepare(
          `INSERT OR IGNORE INTO order_status_history
           SELECT ?, id, 'PENDING_CONFIRM', 'CONFIRMED', 'ADMIN', ?, '接单确认', ? FROM orders
           WHERE id = ? AND status = 'CONFIRMED' AND confirmed_by = ?`,
        ).bind(crypto.randomUUID(), admin.id, now, order.id, admin.id),
        db.prepare(
          `INSERT OR IGNORE INTO audit_logs
           SELECT ?, store_id, 'ADMIN', ?, 'ORDER_CONFIRM', 'ORDER', id, ?, ?, '接单确认', ?, ?
           FROM orders WHERE id = ? AND status = 'CONFIRMED' AND confirmed_by = ?`,
        ).bind(crypto.randomUUID(), admin.id, JSON.stringify({ status: "PENDING_CONFIRM" }), JSON.stringify({ status: "CONFIRMED" }), `order:${order.id}:CONFIRMED`, now, order.id, admin.id),
      ]);
      const updated = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(order.id).first<Row>();
      if (updated?.status !== "CONFIRMED" || updated.confirmed_by !== admin.id) {
        throw new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已由其他人处理。", { final_status: updated?.status, processed_at: updated?.processed_at });
      }
      const record = await db.prepare("SELECT * FROM consumption_records WHERE order_id = ?").bind(order.id).first<Row>();
      return success({ order: updated, consumption_record: record, idempotent_replay: false });
    }
    if (action === "reject") {
      if (order.status !== "PENDING_CONFIRM") throw new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已处理。", { final_status: order.status, processed_at: order.processed_at });
      const body = await readBody(request);
      const code = String(body.reasonCode ?? "");
      const note = String(body.note ?? "").trim();
      if (!["SOLD_OUT", "STORE_BUSY", "INVALID_ORDER", "OTHER"].includes(code) || (code === "OTHER" && (note.length < 1 || note.length > 200))) {
        throw new ApiError(400, "INVALID_REJECTION_REASON", "请选择拒绝原因；其他原因需填写 1–200 字说明。");
      }
      await db.batch([
        db.prepare("UPDATE orders SET status = 'REJECTED', processed_at = ?, rejection_code = ?, rejection_note = ? WHERE id = ? AND status = 'PENDING_CONFIRM'").bind(now, code, note, order.id),
        db.prepare(
          `INSERT OR IGNORE INTO order_status_history
           SELECT ?, id, 'PENDING_CONFIRM', 'REJECTED', 'ADMIN', ?, ?, ?
           FROM orders WHERE id = ? AND status = 'REJECTED' AND processed_at = ?`,
        ).bind(crypto.randomUUID(), admin.id, `${code}:${note}`, now, order.id, now),
        db.prepare(
          `INSERT OR IGNORE INTO audit_logs
           SELECT ?, store_id, 'ADMIN', ?, 'ORDER_REJECT', 'ORDER', id, ?, ?, ?, ?, ?
           FROM orders WHERE id = ? AND status = 'REJECTED' AND processed_at = ?`,
        ).bind(
          crypto.randomUUID(), admin.id, JSON.stringify({ status: "PENDING_CONFIRM" }),
          JSON.stringify({ status: "REJECTED", reason_code: code }), `${code}:${note}`,
          `order:${order.id}:REJECTED`, now, order.id, now,
        ),
      ]);
      const updated = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(order.id).first<Row>();
      if (updated?.status !== "REJECTED") throw new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已由其他人处理。", { final_status: updated?.status, processed_at: updated?.processed_at });
      return success({ order: updated });
    }
    if (action === "void") {
      if (admin.role !== "MANAGER") throw new ApiError(403, "FORBIDDEN", "仅店长可以作废订单。");
      if (order.status === "VOIDED") return success({ order, idempotent_replay: true });
      if (order.status !== "CONFIRMED") throw new ApiError(409, "ORDER_ALREADY_PROCESSED", "只有已确认订单可以作废。", { final_status: order.status });
      const body = await readBody(request);
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 5 || reason.length > 200) throw new ApiError(400, "INVALID_VOID_REASON", "作废原因需为 5–200 字。");
      await db.batch([
        db.prepare(
          `UPDATE orders SET status = 'VOIDED', void_reason = ?, voided_by = ?, voided_at = ?, processed_at = ?
           WHERE id = ? AND status = 'CONFIRMED' AND EXISTS (
             SELECT 1 FROM consumption_records WHERE order_id = ? AND status = 'CONFIRMED'
           )`,
        ).bind(reason, admin.id, now, now, order.id, order.id),
        db.prepare(
          `UPDATE consumption_records SET status = 'VOIDED', voided_at = ?, voided_by = ?, void_reason = ?
           WHERE order_id = ? AND status = 'CONFIRMED' AND EXISTS (
             SELECT 1 FROM orders WHERE id = ? AND status = 'VOIDED' AND voided_by = ?
           )`,
        ).bind(now, admin.id, reason, order.id, order.id, admin.id),
        db.prepare("INSERT OR IGNORE INTO order_status_history SELECT ?, id, 'CONFIRMED', 'VOIDED', 'ADMIN', ?, ?, ? FROM orders WHERE id = ? AND status = 'VOIDED' AND voided_by = ?").bind(crypto.randomUUID(), admin.id, reason, now, order.id, admin.id),
        db.prepare("INSERT OR IGNORE INTO audit_logs SELECT ?, store_id, 'ADMIN', ?, 'ORDER_VOID', 'ORDER', id, ?, ?, ?, ?, ? FROM orders WHERE id = ? AND status = 'VOIDED' AND voided_by = ?").bind(
          crypto.randomUUID(), admin.id, JSON.stringify({ status: "CONFIRMED" }), JSON.stringify({ status: "VOIDED" }),
          reason, `order:${order.id}:VOIDED`, now, order.id, admin.id,
        ),
      ]);
      const updated = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(order.id).first<Row>();
      if (updated?.status !== "VOIDED") throw new ApiError(500, "VOID_TRANSACTION_FAILED", "作废事务未完成。");
      return success({ order: updated, idempotent_replay: false });
    }
  }
  const { page, pageSize, offset, url } = pageParams(request);
  const status = url.searchParams.get("status");
  const query = status
    ? "SELECT o.*, u.nickname, u.phone_normalized FROM orders o JOIN users u ON u.id = o.user_id WHERE o.store_id = ? AND o.status = ? ORDER BY o.submitted_at DESC LIMIT ? OFFSET ?"
    : "SELECT o.*, u.nickname, u.phone_normalized FROM orders o JOIN users u ON u.id = o.user_id WHERE o.store_id = ? ORDER BY o.submitted_at DESC LIMIT ? OFFSET ?";
  const values = status ? [STORE_ID, status, pageSize, offset] : [STORE_ID, pageSize, offset];
  const result = await db.prepare(query).bind(...values).all<Row>();
  const detailed = await Promise.all(result.results.map(async (row) => ({
    ...(await orderDetails(db, row)),
    phone_normalized: undefined,
    phone_masked: maskPhone(row.phone_normalized),
  })));
  return success({ items: detailed, page, page_size: pageSize });
}

async function adminMenu(db: D1Database, request: Request, segments: string[]) {
  const admin = await adminFromRequest(db, request, request.method !== "GET");
  const resource = segments[1];
  const id = segments[2];
  if (request.method === "GET") {
    const { page, pageSize, offset } = pageParams(request);
    const query = resource === "categories"
      ? "SELECT * FROM categories WHERE store_id = ? ORDER BY sort_order, name LIMIT ? OFFSET ?"
      : `SELECT i.*, c.name category_name FROM items i JOIN categories c ON c.id = i.category_id
         WHERE i.store_id = ? ORDER BY c.sort_order, i.sort_order, i.name LIMIT ? OFFSET ?`;
    const rows = await db.prepare(query).bind(STORE_ID, pageSize, offset).all<Row>();
    const totalRow = await db.prepare(
      resource === "categories"
        ? "SELECT COUNT(*) total FROM categories WHERE store_id = ?"
        : "SELECT COUNT(*) total FROM items WHERE store_id = ?",
    ).bind(STORE_ID).first<Row>();
    return success({
      items: rows.results.map((row) => ({ ...row, attrs: row.attrs_json ? JSON.parse(row.attrs_json) : undefined })),
      page,
      page_size: pageSize,
      total: Number(totalRow?.total ?? 0),
    });
  }
  const body = await readBody(request);
  const now = new Date().toISOString();
  if (resource === "categories" && request.method === "POST") {
    const name = String(body.name ?? "").trim();
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!name || name.length > 20 || !/^[A-Z0-9_]{2,30}$/.test(code)) throw new ApiError(400, "INVALID_CATEGORY", "品类名称或编码格式不正确。");
    const categoryId = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare("INSERT INTO categories VALUES (?, ?, ?, ?, ?, 'ENABLED', '[]', ?, 1, ?, ?)").bind(categoryId, STORE_ID, name, code, String(body.businessType ?? "FOOD"), Number(body.sortOrder ?? 50), now, now),
        db.prepare("INSERT INTO audit_logs VALUES (?, ?, 'ADMIN', ?, 'CATEGORY_CREATE', 'CATEGORY', ?, NULL, ?, '', ?, ?)").bind(crypto.randomUUID(), STORE_ID, admin.id, categoryId, JSON.stringify({ name, code }), `category:${categoryId}:create`, now),
      ]);
    } catch {
      throw new ApiError(409, "CATEGORY_CONFLICT", "品类名称或编码已存在。");
    }
    return success({ id: categoryId }, 201);
  }
  if (resource === "categories" && request.method === "PATCH" && id) {
    const before = await db.prepare("SELECT * FROM categories WHERE id = ? AND store_id = ?").bind(id, STORE_ID).first<Row>();
    if (!before) throw new ApiError(404, "CATEGORY_NOT_FOUND", "品类不存在。");
    const name = String(body.name ?? before.name).trim();
    const status = body.status === "DISABLED" ? "DISABLED" : body.status === "ENABLED" ? "ENABLED" : before.status;
    const version = Number(body.version ?? before.version);
    await db.batch([
      db.prepare("UPDATE categories SET name = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(name, status, now, id, version),
      db.prepare("INSERT OR IGNORE INTO audit_logs SELECT ?, store_id, 'ADMIN', ?, 'CATEGORY_UPDATE', 'CATEGORY', id, ?, ?, '', ?, ? FROM categories WHERE id = ? AND version = ?").bind(
        crypto.randomUUID(), admin.id, JSON.stringify({ name: before.name, status: before.status }),
        JSON.stringify({ name, status }), `category:${id}:v${version + 1}`, now, id, version + 1,
      ),
    ]);
    const updated = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first<Row>();
    if (updated?.version !== version + 1) throw new ApiError(409, "VERSION_CONFLICT", "品类已被其他人修改，请刷新。");
    return success({ item: updated });
  }
  if (resource === "items" && request.method === "POST") {
    const name = String(body.name ?? "").trim();
    const sku = String(body.sku ?? "").trim().toUpperCase();
    const priceCent = Number(body.priceCent);
    const category = await db.prepare("SELECT * FROM categories WHERE id = ? AND store_id = ?").bind(String(body.categoryId ?? ""), STORE_ID).first<Row>();
    if (!category || !name || !sku || !Number.isInteger(priceCent) || priceCent <= 0) throw new ApiError(400, "INVALID_ITEM", "商品名称、SKU、品类或价格不正确。");
    const itemId = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?, '[]', ?, 1, ?, ?)").bind(
          itemId, STORE_ID, category.id, sku, name, String(body.description ?? "").slice(0, 300),
          category.business_type, priceCent, String(body.imageUrl ?? "🔥"), JSON.stringify(body.attrs ?? {}),
          Number(body.sortOrder ?? 50), now, now,
        ),
        db.prepare("INSERT INTO audit_logs VALUES (?, ?, 'ADMIN', ?, 'ITEM_CREATE', 'ITEM', ?, NULL, ?, '', ?, ?)").bind(crypto.randomUUID(), STORE_ID, admin.id, itemId, JSON.stringify({ name, sku, price_cent: priceCent }), `item:${itemId}:create`, now),
      ]);
    } catch {
      throw new ApiError(409, "ITEM_CONFLICT", "SKU 已存在。");
    }
    return success({ id: itemId }, 201);
  }
  if (resource === "items" && request.method === "PATCH" && id) {
    const before = await db.prepare("SELECT * FROM items WHERE id = ? AND store_id = ?").bind(id, STORE_ID).first<Row>();
    if (!before) throw new ApiError(404, "ITEM_NOT_FOUND", "商品不存在。");
    const name = String(body.name ?? before.name).trim();
    const priceCent = Number(body.priceCent ?? before.price_cent);
    const status = body.status === "INACTIVE" ? "INACTIVE" : body.status === "ACTIVE" ? "ACTIVE" : before.status;
    const soldOut = body.soldOut === undefined ? before.sold_out : body.soldOut ? 1 : 0;
    const version = Number(body.version ?? before.version);
    if (!name || !Number.isInteger(priceCent) || priceCent <= 0) throw new ApiError(400, "INVALID_ITEM", "商品名称或价格不正确。");
    await db.batch([
      db.prepare("UPDATE items SET name = ?, price_cent = ?, status = ?, sold_out = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(name, priceCent, status, soldOut, now, id, version),
      db.prepare("INSERT OR IGNORE INTO audit_logs SELECT ?, store_id, 'ADMIN', ?, 'ITEM_UPDATE', 'ITEM', id, ?, ?, '', ?, ? FROM items WHERE id = ? AND version = ?").bind(
        crypto.randomUUID(), admin.id, JSON.stringify({ name: before.name, price_cent: before.price_cent, status: before.status, sold_out: before.sold_out }),
        JSON.stringify({ name, price_cent: priceCent, status, sold_out: soldOut }), `item:${id}:v${version + 1}`, now, id, version + 1,
      ),
    ]);
    const updated = await db.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<Row>();
    if (updated?.version !== version + 1) throw new ApiError(409, "VERSION_CONFLICT", "商品已被其他人修改，请刷新。");
    return success({ item: updated });
  }
  throw new ApiError(404, "NOT_FOUND", "接口不存在。");
}

async function adminAnalytics(db: D1Database, request: Request) {
  const admin = await adminFromRequest(db, request);
  const { url } = pageParams(request);
  const requested = url.searchParams.get("period") ?? "today";
  if (!["today", "week", "month", "year"].includes(requested)) {
    throw new ApiError(400, "INVALID_PERIOD", "统计周期不正确。");
  }
  if (admin.role === "OPERATOR" && requested !== "today") {
    throw new ApiError(403, "FORBIDDEN", "操作员仅可查看今日摘要。");
  }
  const period = requested;
  const start = periodStart(period);
  const end = endDateExclusive();
  const cutoff = new Date().toISOString();
  const summary = await db.prepare(
    `SELECT COALESCE(SUM(confirmed_amount_cent), 0) amount_cent, COUNT(*) order_count,
            COUNT(DISTINCT user_id) active_customers
     FROM consumption_records WHERE store_id = ? AND status = 'CONFIRMED'
       AND business_date >= ? AND business_date < ? AND confirmed_at_utc <= ?`,
  ).bind(STORE_ID, start, end, cutoff).first<Row>();
  const topItems = await db.prepare(
    `SELECT oi.name_snapshot name, oi.item_id item_id, SUM(oi.quantity) quantity,
            SUM(oi.subtotal_cent) amount_cent
     FROM order_items oi JOIN consumption_records c ON c.order_id = oi.order_id
     WHERE c.store_id = ? AND c.status = 'CONFIRMED'
       AND c.business_date >= ? AND c.business_date < ? AND c.confirmed_at_utc <= ?
     GROUP BY oi.name_snapshot, oi.item_id ORDER BY amount_cent DESC, name, item_id LIMIT 8`,
  ).bind(STORE_ID, start, end, cutoff).all<Row>();
  const categoryRows = await db.prepare(
    `SELECT oi.category_id_snapshot category_id, oi.category_name_snapshot name,
            SUM(oi.subtotal_cent) amount_cent
     FROM order_items oi JOIN consumption_records c ON c.order_id = oi.order_id
     WHERE c.store_id = ? AND c.status = 'CONFIRMED'
       AND c.business_date >= ? AND c.business_date < ? AND c.confirmed_at_utc <= ?
     GROUP BY oi.category_id_snapshot, oi.category_name_snapshot
     ORDER BY amount_cent DESC, name, category_id`,
  ).bind(STORE_ID, start, end, cutoff).all<Row>();
  const bucketExpression = period === "today"
    ? "strftime('%H:00', datetime(confirmed_at_utc, '+8 hours'))"
    : period === "year"
      ? "substr(business_date, 1, 7)"
      : "business_date";
  const trend = await db.prepare(
    `SELECT ${bucketExpression} bucket, SUM(confirmed_amount_cent) amount_cent, COUNT(*) order_count
     FROM consumption_records WHERE store_id = ? AND status = 'CONFIRMED'
       AND business_date >= ? AND business_date < ? AND confirmed_at_utc <= ?
     GROUP BY ${bucketExpression} ORDER BY ${bucketExpression}`,
  ).bind(STORE_ID, start, end, cutoff).all<Row>();
  const total = Number(summary?.amount_cent ?? 0);
  return success({
    period,
    range: { start, end_exclusive: end, cutoff_utc: cutoff },
    summary: { ...summary, average_cent: summary?.order_count ? Math.round(summary.amount_cent / summary.order_count) : null },
    top_items: topItems.results,
    category_contribution: categoryRows.results.map((row) => ({
      ...row,
      contribution_bps: total ? Math.round(Number(row.amount_cent) * 10_000 / total) : 0,
    })),
    trend: fillTrend(period, start, end, trend.results),
  });
}

async function adminAudits(db: D1Database, request: Request) {
  await adminFromRequest(db, request, true);
  const { page, pageSize, offset } = pageParams(request);
  const rows = await db.prepare(
    `SELECT l.*, COALESCE(a.display_name, u.nickname, '系统') actor_name
     FROM audit_logs l
     LEFT JOIN admin_users a ON l.actor_type = 'ADMIN' AND a.id = l.actor_id
     LEFT JOIN users u ON l.actor_type = 'CUSTOMER' AND u.id = l.actor_id
     WHERE l.store_id = ? ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(STORE_ID, pageSize, offset).all<Row>();
  return success({ items: rows.results, page, page_size: pageSize });
}

async function route(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const db = await ensureDatabase();
  if (path[0] === "auth") return handleAuth(db, request, path);
  if (path[0] === "menu" && request.method === "GET") return handleMenu(db, request);
  if (path[0] === "orders") {
    if (request.method === "POST" && path.length === 1) return createOrder(db, request);
    return customerOrders(db, request, path);
  }
  if (path[0] === "consumption" && request.method === "GET") return customerConsumption(db, request);
  if (path[0] === "admin" && path[1] === "auth") return adminAuth(db, request, path);
  if (path[0] === "admin" && path[1] === "orders") return adminOrders(db, request, path);
  if (path[0] === "admin" && ["categories", "items"].includes(path[1])) return adminMenu(db, request, path);
  if (path[0] === "admin" && path[1] === "analytics" && request.method === "GET") return adminAnalytics(db, request);
  if (path[0] === "admin" && path[1] === "audits" && request.method === "GET") return adminAudits(db, request);
  if (path[0] === "admin" && path[1] === "store" && request.method === "GET") {
    await adminFromRequest(db, request);
    return success({ store: await db.prepare("SELECT * FROM stores WHERE id = ?").bind(STORE_ID).first() });
  }
  throw new ApiError(404, "NOT_FOUND", "接口不存在。");
}

async function handler(request: Request, context: RouteContext) {
  const traceId = crypto.randomUUID();
  try {
    return await route(request, context);
  } catch (error) {
    return errorResponse(error, traceId);
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
