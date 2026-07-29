const PHONE_RE = /^1[3-9]\d{9}$/;
const PASSWORD_RE = /^(?=[\x21-\x7E]{8,20}$)(?=.*[A-Za-z])(?=.*\d).*$/;

export function normalizePhone(value) {
  let normalized = String(value ?? "").trim().replace(/[ -]/g, "");
  normalized = normalized.replace(/^(\+86|86)/, "");
  return PHONE_RE.test(normalized) ? normalized : null;
}

export function validPassword(value) {
  return PASSWORD_RE.test(String(value ?? ""));
}

export function maskPhone(phone) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function canonicalCart(items, extra = {}) {
  const normalized = [...items]
    .map((item) => ({
      itemId: String(item.itemId),
      quantity: Number(item.quantity),
      unitPriceCent: Number(item.unitPriceCent),
      selection: Object.fromEntries(
        Object.entries(item.selection ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, String(value)]),
      ),
    }))
    .sort((a, b) =>
      a.itemId.localeCompare(b.itemId) ||
      JSON.stringify(a.selection).localeCompare(JSON.stringify(b.selection)));
  return JSON.stringify({ items: normalized, note: extra.note ?? "", tableNo: extra.tableNo ?? "" });
}

export function transitionAllowed(from, to) {
  return (
    (from === "PENDING_CONFIRM" && ["CONFIRMED", "REJECTED", "CANCELLED"].includes(to)) ||
    (from === "CONFIRMED" && to === "VOIDED")
  );
}

export function periodStart(period, now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  if (period === "today") local.setHours(0, 0, 0, 0);
  else if (period === "week") {
    const day = local.getDay() || 7;
    local.setDate(local.getDate() - day + 1);
    local.setHours(0, 0, 0, 0);
  } else if (period === "year") {
    local.setMonth(0, 1);
    local.setHours(0, 0, 0, 0);
  } else {
    local.setDate(1);
    local.setHours(0, 0, 0, 0);
  }
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function assertMockConfiguration(appEnvironment, mockSmsEnabled) {
  if (appEnvironment === "production" && mockSmsEnabled === "true") {
    throw new Error("Refusing to start: Mock SMS must be disabled when APP_ENV=production");
  }
}

export function inSalePeriods(periods, now = new Date()) {
  if (!Array.isArray(periods) || periods.length === 0) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const day = dayMap[values.weekday];
  const previousDay = day === 1 ? 7 : day - 1;
  const minute = Number(values.hour) * 60 + Number(values.minute);
  const toMinute = (value) => {
    const [hour, min] = String(value).split(":").map(Number);
    return hour * 60 + min;
  };
  return periods.some((period) => {
    const days = Array.isArray(period.days) ? period.days : [1, 2, 3, 4, 5, 6, 7];
    const start = toMinute(period.start);
    const end = toMinute(period.end);
    if (start < end) return days.includes(day) && minute >= start && minute < end;
    return (days.includes(day) && minute >= start) || (days.includes(previousDay) && minute < end);
  });
}
