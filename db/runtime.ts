import { env } from "cloudflare:workers";
import { hashPassword } from "@/lib/security";
import { assertMockConfiguration } from "@/lib/rules.mjs";
import { normalizeItemSelection, priceForSelection } from "@/lib/menu-options.mjs";

const STORE_ID = "store-demo";
let ready: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL, currency TEXT NOT NULL, address TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, phone_normalized TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, nickname TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','DISABLED')), created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_users (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('MANAGER','OPERATOR')), status TEXT NOT NULL CHECK(status IN ('ACTIVE','DISABLED')))`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, subject_type TEXT NOT NULL CHECK(subject_type IN ('CUSTOMER','ADMIN')), subject_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_subject_idx ON sessions(subject_type, subject_id)`,
  `CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL, purpose TEXT NOT NULL, expires_at TEXT NOT NULL, resend_after TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS registration_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, phone_normalized TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, business_type TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ENABLED','DISABLED')), sale_periods_json TEXT NOT NULL, sort_order INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(store_id, code), UNIQUE(store_id, name))`,
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, category_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, business_type TEXT NOT NULL, price_cent INTEGER NOT NULL CHECK(price_cent > 0), status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')), sold_out INTEGER NOT NULL CHECK(sold_out IN (0,1)), image_url TEXT NOT NULL, attrs_json TEXT NOT NULL, sale_periods_json TEXT NOT NULL, sort_order INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(store_id, sku))`,
  `CREATE INDEX IF NOT EXISTS items_category_idx ON items(category_id, status, sort_order)`,
  `CREATE TABLE IF NOT EXISTS quote_tokens (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, user_id TEXT NOT NULL, client_request_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, cart_hash TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS quote_request_idx ON quote_tokens(store_id, user_id, client_request_id)`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, order_no TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, client_request_id TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING_CONFIRM','CONFIRMED','REJECTED','CANCELLED','VOIDED')), total_cent INTEGER NOT NULL CHECK(total_cent >= 0), note TEXT NOT NULL, table_no TEXT NOT NULL, submitted_at TEXT NOT NULL, processed_at TEXT, confirmed_by TEXT, rejection_code TEXT, rejection_note TEXT, void_reason TEXT, voided_by TEXT, voided_at TEXT, UNIQUE(store_id, user_id, client_request_id))`,
  `CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(store_id, status, submitted_at)`,
  `CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, item_id TEXT NOT NULL, sku_snapshot TEXT NOT NULL, name_snapshot TEXT NOT NULL, image_snapshot TEXT NOT NULL, category_id_snapshot TEXT NOT NULL, category_code_snapshot TEXT NOT NULL, category_name_snapshot TEXT NOT NULL, business_type_snapshot TEXT NOT NULL, attrs_snapshot_json TEXT NOT NULL, selection_snapshot_json TEXT NOT NULL DEFAULT '{}', fulfillment_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(fulfillment_status IN ('AVAILABLE','SOLD_OUT')), unavailable_reason TEXT, unit_price_cent INTEGER NOT NULL CHECK(unit_price_cent > 0), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99), subtotal_cent INTEGER NOT NULL CHECK(subtotal_cent > 0))`,
  `CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id)`,
  `CREATE TABLE IF NOT EXISTS consumption_records (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, store_id TEXT NOT NULL, user_id TEXT NOT NULL, confirmed_amount_cent INTEGER NOT NULL CHECK(confirmed_amount_cent >= 0), status TEXT NOT NULL CHECK(status IN ('CONFIRMED','VOIDED')), confirmed_at_utc TEXT NOT NULL, business_date TEXT NOT NULL, confirmed_timezone TEXT NOT NULL, confirmed_utc_offset TEXT NOT NULL, operator_id TEXT NOT NULL, voided_at TEXT, voided_by TEXT, void_reason TEXT)`,
  `CREATE INDEX IF NOT EXISTS consumption_period_idx ON consumption_records(store_id, status, business_date)`,
  `CREATE TABLE IF NOT EXISTS order_status_history (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, actor_type TEXT NOT NULL CHECK(actor_type IN ('CUSTOMER','ADMIN','SYSTEM')), actor_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(order_id, to_status))`,
  `CREATE INDEX IF NOT EXISTS order_history_order_idx ON order_status_history(order_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS audit_store_time_idx ON audit_logs(store_id, created_at)`,
];

const seedCategories = [
  ["cat-skewer", "烤串", "SKEWER", "FOOD", 10],
  ["cat-veg", "素菜", "VEGETABLE", "FOOD", 20],
  ["cat-staple", "主食", "STAPLE", "FOOD", 25],
  ["cat-drink", "饮料", "DRINK", "DRINK", 30],
  ["cat-beer", "啤酒", "BEER", "BEER", 40],
];

const seedItems = [
  ["lamb", "cat-skewer", "SK-001", "炭烤羊肉串", "肥瘦相间，孜然飘香", 800, "🔥", '{"辣度":"中辣"}'],
  ["beef", "cat-skewer", "SK-002", "秘制牛肉串", "厚切牛肉，肉汁丰盈", 1000, "🥩", '{"辣度":"微辣"}'],
  ["wing", "cat-skewer", "SK-003", "蜜汁烤鸡翅", "外焦里嫩，甜咸平衡", 1800, "🍗", '{"口味":"蜜汁"}'],
  ["sausage", "cat-skewer", "SK-004", "火山烤肠", "爆汁脆皮，经典夜宵", 800, "🌭", '{"辣度":"可选"}'],
  ["squid", "cat-skewer", "SK-005", "香烤鱿鱼", "海味鲜香，弹嫩有嚼劲", 1600, "🦑", '{"辣度":"中辣"}'],
  ["eggplant", "cat-veg", "VG-001", "蒜蓉烤茄子", "蒜香浓郁，软糯入味", 2200, "🍆", '{"推荐":"店长推荐"}'],
  ["chives", "cat-veg", "VG-002", "烤韭菜", "清香爽口，撒料入味", 800, "🌿", '{"辣度":"微辣"}'],
  ["corn", "cat-veg", "VG-003", "黄油烤玉米", "香甜多汁，黄油奶香", 1200, "🌽", '{"口味":"奶香"}'],
  ["mushroom", "cat-veg", "VG-004", "烤香菇", "鲜嫩多汁，椒盐提香", 1000, "🍄", '{"口味":"椒盐"}'],
  ["tofu", "cat-veg", "VG-005", "脆皮豆腐", "表皮焦脆，内里软嫩", 1200, "◻️", '{"辣度":"中辣"}'],
  ["riceball", "cat-staple", "ST-001", "炭火烤饭团", "外层焦香，米粒软糯", 1200, "🍙", '{"口味":"酱香"}'],
  ["bun", "cat-staple", "ST-002", "炼乳烤馒头", "金黄酥脆，奶香微甜", 800, "🫓", '{"口味":"香甜"}'],
  ["noodle", "cat-staple", "ST-003", "铁板炒面", "酱香浓郁，镬气十足", 1800, "🍜", '{"份量":"一人份"}'],
  ["pancake", "cat-staple", "ST-004", "香葱烤饼", "外酥内软，葱香扑鼻", 1000, "🥞", '{"口味":"椒盐"}'],
  ["cola", "cat-drink", "DR-001", "冰镇可乐", "330ml 罐装", 600, "🥤", '{"容量":"330ml","温度":"冰"}'],
  ["sprite", "cat-drink", "DR-002", "雪碧", "330ml 罐装", 600, "🫧", '{"容量":"330ml","温度":"冰"}'],
  ["plum", "cat-drink", "DR-003", "古法酸梅汤", "清爽解腻", 1200, "🧃", '{"容量":"500ml","温度":"冰"}'],
  ["water", "cat-drink", "DR-004", "矿泉水", "550ml", 400, "💧", '{"容量":"550ml"}'],
  ["tea", "cat-drink", "DR-005", "乌龙茶", "无糖冷泡", 1000, "🍵", '{"容量":"500ml","糖度":"无糖"}'],
  ["lager", "cat-beer", "BR-001", "本地拉格", "清爽麦香，冰爽顺口", 1600, "🍺", '{"容量":"500ml","ABV":"4.5%"}'],
  ["ipa", "cat-beer", "BR-002", "精酿 IPA", "热带果香，酒花饱满", 3200, "🍻", '{"容量":"330ml","ABV":"6.2%"}'],
  ["wheat", "cat-beer", "BR-003", "小麦白啤", "香蕉丁香香气", 2600, "🌾", '{"容量":"500ml","ABV":"5.0%"}'],
  ["zero", "cat-beer", "BR-004", "无醇啤酒", "轻松畅饮，麦香依旧", 1800, "🟡", '{"容量":"330ml","ABV":"0.0%"}'],
  ["stout", "cat-beer", "BR-005", "烘焙世涛", "咖啡可可风味", 3800, "⚫", '{"容量":"330ml","ABV":"7.0%"}'],
];

async function ensureOrderItemExtensions(db: D1Database) {
  const columns = await db.prepare("PRAGMA table_info(order_items)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  if (!names.has("selection_snapshot_json")) {
    await db.prepare("ALTER TABLE order_items ADD COLUMN selection_snapshot_json TEXT NOT NULL DEFAULT '{}'").run();
  }
  if (!names.has("fulfillment_status")) {
    await db.prepare("ALTER TABLE order_items ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'AVAILABLE'").run();
  }
  if (!names.has("unavailable_reason")) {
    await db.prepare("ALTER TABLE order_items ADD COLUMN unavailable_reason TEXT").run();
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS order_items_item_status_idx ON order_items(item_id, fulfillment_status)").run();
}

async function seedHistoricalData(db: D1Database) {
  const seeded = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind("seed_v4").first();
  if (seeded) return;
  const now = new Date();
  const nowIso = now.toISOString();
  const catalogStatements: D1PreparedStatement[] = [];
  for (const [id, name, code, type, sort] of seedCategories) {
    catalogStatements.push(
      db.prepare("INSERT OR IGNORE INTO categories VALUES (?, ?, ?, ?, ?, 'ENABLED', '[]', ?, 1, ?, ?)")
        .bind(id, STORE_ID, name, code, type, sort, nowIso, nowIso),
    );
  }
  seedItems.forEach(([id, categoryId, sku, name, description, price, image, attrs], order) => {
    const type = String(categoryId) === "cat-beer" ? "BEER" : String(categoryId) === "cat-drink" ? "DRINK" : "FOOD";
    const soldOut = id === "stout" ? 1 : 0;
    catalogStatements.push(
      db.prepare(
        `INSERT OR IGNORE INTO items
         (id, store_id, category_id, sku, name, description, business_type, price_cent, status, sold_out,
          image_url, attrs_json, sale_periods_json, sort_order, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, '[]', ?, 1, ?, ?)`,
      ).bind(id, STORE_ID, categoryId, sku, name, description, type, price, soldOut, image, attrs, (order + 1) * 10, nowIso, nowIso),
    );
  });
  await db.batch(catalogStatements);

  const categoryById = new Map(seedCategories.map(([id, name, code, type]) => [String(id), {
    id: String(id), name: String(name), code: String(code), type: String(type),
  }]));
  const historyItems = seedItems.filter(([id]) => id !== "stout");
  const statements: D1PreparedStatement[] = [];
  for (let monthOffset = 0; monthOffset < 6; monthOffset += 1) {
    const orderCount = monthOffset === 0 ? 8 : 4;
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 1, 12));
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth();
    for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
      const safeCurrentDay = Math.max(1, now.getUTCDate() - 1);
      const day = monthOffset === 0
        ? Math.min(safeCurrentDay, 2 + orderIndex * 3)
        : 3 + orderIndex * 5;
      const confirmedAt = new Date(Date.UTC(year, month, day, 12, 30)).toISOString();
      const businessDay = confirmedAt.slice(0, 10);
      const monthKey = businessDay.slice(0, 7).replace("-", "");
      const orderId = `history-${monthKey}-${String(orderIndex + 1).padStart(2, "0")}`;
      const orderNo = `HIST${monthKey}${String(orderIndex + 1).padStart(3, "0")}`;
      const selected = [0, 1, 2].map((lineIndex) =>
        historyItems[(monthOffset * 7 + orderIndex * 3 + lineIndex) % historyItems.length]);
      const lines = selected.map((item, lineIndex) => {
        const [id, categoryId, sku, name, , basePrice, image, attrs] = item;
        const category = categoryById.get(String(categoryId))!;
        const selection = normalizeItemSelection(category.code, category.type, {
          spice_level: ["免辣", "微辣", "中辣", "特辣"][(orderIndex + lineIndex) % 4],
          capacity: ["500ML", "1.5L", "3L"][(monthOffset + lineIndex) % 3],
        }) ?? {};
        const unitPrice = priceForSelection(Number(basePrice), category.type, selection);
        const quantity = 1 + ((monthOffset + orderIndex + lineIndex) % 3);
        return {
          id: String(id), sku: String(sku), name: String(name), image: String(image), attrs: String(attrs),
          category, selection, unitPrice, quantity, subtotal: unitPrice * quantity,
        };
      });
      const totalCent = lines.reduce((sum, line) => sum + line.subtotal, 0);
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO orders
           (id, store_id, order_no, user_id, client_request_id, request_hash, status, total_cent, note,
            table_no, submitted_at, processed_at, confirmed_by)
           VALUES (?, ?, ?, 'user-demo', ?, ?, 'CONFIRMED', ?, '历史演示数据', '', ?, ?, 'admin-manager')`,
        ).bind(orderId, STORE_ID, orderNo, `history-${orderId}`, `seed-${orderId}`, totalCent, confirmedAt, confirmedAt),
        db.prepare(
          `INSERT OR IGNORE INTO consumption_records
           (id, order_id, store_id, user_id, confirmed_amount_cent, status, confirmed_at_utc, business_date,
            confirmed_timezone, confirmed_utc_offset, operator_id)
           VALUES (?, ?, ?, 'user-demo', ?, 'CONFIRMED', ?, ?, 'Asia/Shanghai', '+08:00', 'admin-manager')`,
        ).bind(`record-${orderId}`, orderId, STORE_ID, totalCent, confirmedAt, businessDay),
        db.prepare(
          `INSERT OR IGNORE INTO order_status_history
           (id, order_id, from_status, to_status, actor_type, actor_id, reason, created_at)
           VALUES (?, ?, 'PENDING_CONFIRM', 'CONFIRMED', 'SYSTEM', 'seed-v4', '销售看板历史演示数据', ?)`,
        ).bind(`history-status-${orderId}`, orderId, confirmedAt),
      );
      for (const [lineIndex, line] of lines.entries()) {
        statements.push(
          db.prepare(
            `INSERT OR IGNORE INTO order_items
             (id, order_id, item_id, sku_snapshot, name_snapshot, image_snapshot, category_id_snapshot,
              category_code_snapshot, category_name_snapshot, business_type_snapshot, attrs_snapshot_json,
              selection_snapshot_json, fulfillment_status, unavailable_reason, unit_price_cent, quantity, subtotal_cent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', NULL, ?, ?, ?)`,
          ).bind(
            `${orderId}-line-${lineIndex + 1}`, orderId, line.id, line.sku, line.name, line.image,
            line.category.id, line.category.code, line.category.name, line.category.type, line.attrs,
            JSON.stringify(line.selection), line.unitPrice, line.quantity, line.subtotal,
          ),
        );
      }
    }
  }
  for (let index = 0; index < statements.length; index += 60) {
    await db.batch(statements.slice(index, index + 60));
  }
  await db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v4", nowIso).run();
}

async function initialize() {
  const runtimeEnv = env as typeof env & { APP_ENV?: string; MOCK_SMS_ENABLED?: string };
  const processEnvironment: Record<string, string | undefined> =
    typeof process !== "undefined" ? process.env : {};
  const appEnvironment = runtimeEnv.APP_ENV ?? processEnvironment.APP_ENV ?? "development";
  const mockSmsEnabled = runtimeEnv.MOCK_SMS_ENABLED ?? processEnvironment.MOCK_SMS_ENABLED ?? "true";
  assertMockConfiguration(appEnvironment, mockSmsEnabled);
  const db = runtimeEnv.DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  await ensureOrderItemExtensions(db);
  const seeded = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind("seed_v1").first();
  if (seeded) {
    const securityUpdated = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind("seed_v3").first();
    if (!securityUpdated) {
      const now = new Date().toISOString();
      const [customerHash, managerHash, operatorHash] = await Promise.all([
        hashPassword("grill1234"),
        hashPassword("Manager123"),
        hashPassword("Operator123"),
      ]);
      await db.batch([
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(customerHash, "user-demo"),
        db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").bind(managerHash, "admin-manager"),
        db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").bind(operatorHash, "admin-operator"),
        db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v3", now),
      ]);
    }
    const fixtureUpdated = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind("seed_v2").first();
    if (!fixtureUpdated) {
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE items SET sold_out = 1, updated_at = ?, version = version + 1 WHERE id = ?").bind(now, "stout"),
        db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v2", now),
      ]);
    }
    const brandUpdated = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind("seed_v5").first();
    if (!brandUpdated) {
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE stores SET name = ? WHERE id = ?").bind("Edison 爱吃烧烤", STORE_ID),
        db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v5", now),
      ]);
    }
    await seedHistoricalData(db);
    return;
  }
  const now = new Date().toISOString();
  const [customerHash, managerHash, operatorHash] = await Promise.all([
    hashPassword("grill1234"),
    hashPassword("Manager123"),
    hashPassword("Operator123"),
  ]);
  const statements = [
    db.prepare("INSERT OR IGNORE INTO stores VALUES (?, ?, ?, ?, ?)").bind(STORE_ID, "Edison 爱吃烧烤", "Asia/Shanghai", "CNY", "上海市烟火路 88 号"),
    db.prepare("INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?)").bind("user-demo", STORE_ID, "13800138000", customerHash, "炭火好友", "ACTIVE", now),
    db.prepare("INSERT OR IGNORE INTO admin_users VALUES (?, ?, ?, ?, ?, ?, ?)").bind("admin-manager", STORE_ID, "manager", managerHash, "林店长", "MANAGER", "ACTIVE"),
    db.prepare("INSERT OR IGNORE INTO admin_users VALUES (?, ?, ?, ?, ?, ?, ?)").bind("admin-operator", STORE_ID, "operator", operatorHash, "小陈", "OPERATOR", "ACTIVE"),
  ];
  for (const [id, name, code, type, sort] of seedCategories) {
    statements.push(db.prepare("INSERT OR IGNORE INTO categories VALUES (?, ?, ?, ?, ?, 'ENABLED', '[]', ?, 1, ?, ?)").bind(id, STORE_ID, name, code, type, sort, now, now));
  }
  seedItems.forEach(([id, categoryId, sku, name, description, price, image, attrs], order) => {
    const type = String(categoryId) === "cat-beer" ? "BEER" : String(categoryId) === "cat-drink" ? "DRINK" : "FOOD";
    const soldOut = id === "stout" ? 1 : 0;
    statements.push(db.prepare("INSERT OR IGNORE INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, '[]', ?, 1, ?, ?)").bind(
      id, STORE_ID, categoryId, sku, name, description, type, price, soldOut, image, attrs, (order + 1) * 10, now, now,
    ));
  });
  statements.push(db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v1", now));
  statements.push(db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v2", now));
  statements.push(db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v3", now));
  statements.push(db.prepare("INSERT OR REPLACE INTO app_meta VALUES (?, ?)").bind("seed_v5", now));
  await db.batch(statements);
  await seedHistoricalData(db);
}

export async function ensureDatabase() {
  ready ??= initialize().catch((error) => {
    ready = null;
    throw error;
  });
  await ready;
  return env.DB;
}

export { STORE_ID };
