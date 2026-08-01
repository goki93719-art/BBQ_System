"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  cartLineKey,
  missingBalanceGroups,
  priceForSelection,
  selectionLabel,
} from "@/lib/menu-options.mjs";

type Json = Record<string, any>;

function createClientRequestId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      return `request-${Date.now().toString(36)}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
  } catch {
    // Public-IP HTTP pages may expose only part of the Web Crypto API.
  }
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function api(path: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    const payload = (await response.json()) as Json;
    if (!response.ok) {
      const error = new Error(payload.message ?? "请求失败") as Error & { code?: string; details?: Json };
      error.code = payload.error_code;
      error.details = payload.details;
      throw error;
    }
    return payload.data as Json;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("网络连接超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

const money = (cent: number) => `¥${(Number(cent || 0) / 100).toFixed(2)}`;
const dateTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const analyticsNow = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
}).formatToParts(new Date());
const defaultAnalyticsYear = Number(analyticsNow.find((part) => part.type === "year")?.value);
const defaultAnalyticsMonth = analyticsNow.find((part) => part.type === "month")?.value ?? "01";
const statusText: Record<string, string> = {
  PENDING_CONFIRM: "待商家确认",
  CONFIRMED: "已确认",
  REJECTED: "已拒绝",
  CANCELLED: "已撤回",
  VOIDED: "已作废",
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark">E</span>
      <span><strong>Edison 爱吃烧烤</strong><small>GRILL & GOOD TIMES</small></span>
    </div>
  );
}

function Toast({ message, tone = "dark", onDismiss }: { message: string; tone?: string; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);
  if (!message) return null;
  return <div className={`toast toast-${tone}`} role="status">{message}</div>;
}

function TrendLineChart({ rows, scope }: { rows: Json[]; scope: "year" | "month" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverPoint, setHoverPoint] = useState<{ index: number; left: number; top: number } | null>(null);
  const hasData = rows.some((row) => Number(row.amount_cent) > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasData) return;

    const draw = () => {
      const width = Math.max(320, Math.floor(canvas.getBoundingClientRect().width));
      const height = 300;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);

      const padding = { top: 26, right: 22, bottom: 48, left: 66 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const values = rows.map((row) => Number(row.amount_cent ?? 0));
      const maximum = Math.max(1, ...values);

      context.font = '11px "PingFang SC", sans-serif';
      context.textBaseline = "middle";
      for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + chartHeight * index / 4;
        const value = maximum * (4 - index) / 4;
        context.beginPath();
        context.strokeStyle = "#e8e2d7";
        context.lineWidth = 1;
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillStyle = "#777c73";
        context.textAlign = "right";
        context.fillText(`¥${(value / 100).toFixed(value >= 100000 ? 0 : 2)}`, padding.left - 10, y);
      }

      const pointFor = (value: number, index: number) => ({
        x: padding.left + chartWidth * index / Math.max(1, rows.length - 1),
        y: padding.top + chartHeight - value / maximum * chartHeight,
      });
      const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
      gradient.addColorStop(0, "rgba(228,81,50,.22)");
      gradient.addColorStop(1, "rgba(228,81,50,0)");
      context.beginPath();
      values.forEach((value, index) => {
        const point = pointFor(value, index);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      const last = pointFor(values.at(-1) ?? 0, values.length - 1);
      const first = pointFor(values[0] ?? 0, 0);
      context.lineTo(last.x, padding.top + chartHeight);
      context.lineTo(first.x, padding.top + chartHeight);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      values.forEach((value, index) => {
        const point = pointFor(value, index);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.strokeStyle = "#e45132";
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();

      const markerStep = scope === "year" ? 1 : Math.max(1, Math.ceil(rows.length / 12));
      const peakIndex = values.indexOf(maximum);
      values.forEach((value, index) => {
        if (index % markerStep !== 0 && index !== rows.length - 1 && index !== peakIndex) return;
        const point = pointFor(value, index);
        context.beginPath();
        context.fillStyle = "#fffdf8";
        context.strokeStyle = "#e45132";
        context.lineWidth = 2;
        context.arc(point.x, point.y, value > 0 ? 4 : 2.5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });

      const labelStep = scope === "year" ? 1 : Math.max(1, Math.ceil(rows.length / 8));
      rows.forEach((row, index) => {
        if (index % labelStep !== 0 && index !== rows.length - 1) return;
        const point = pointFor(values[index], index);
        const parts = String(row.bucket).split("-");
        const label = scope === "year" ? `${Number(parts[1])}月` : `${Number(parts[2])}日`;
        context.fillStyle = "#777c73";
        context.textAlign = "center";
        context.fillText(label, point.x, height - 22);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasData, rows, scope]);

  if (!hasData) return <div className="trend-empty">所选周期暂无已确认订单</div>;
  const showHoverPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = 300;
    const padding = { top: 26, right: 22, bottom: 48, left: 66 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const localX = (event.clientX - rect.left) * width / Math.max(1, rect.width);
    const ratio = Math.min(1, Math.max(0, (localX - padding.left) / Math.max(1, chartWidth)));
    const index = Math.round(ratio * Math.max(0, rows.length - 1));
    const maximum = Math.max(1, ...rows.map((row) => Number(row.amount_cent ?? 0)));
    const value = Number(rows[index]?.amount_cent ?? 0);
    const x = padding.left + chartWidth * index / Math.max(1, rows.length - 1);
    const y = padding.top + chartHeight - value / maximum * chartHeight;
    setHoverPoint({ index, left: x / width * 100, top: y / height * 100 });
  };
  const formatBucket = (bucket: unknown) => {
    const parts = String(bucket).split("-");
    return scope === "year"
      ? `${Number(parts[0])} 年 ${Number(parts[1])} 月`
      : `${Number(parts[1])} 月 ${Number(parts[2])} 日`;
  };
  const total = rows.reduce((sum, row) => sum + Number(row.amount_cent ?? 0), 0);
  const peak = rows.reduce((current, row) => Number(row.amount_cent) > Number(current?.amount_cent ?? -1) ? row : current, rows[0]);
  return (
    <div className="trend-chart">
      <div className="trend-summary">
        <span className="trend-hint">悬浮折线查看明细</span>
        <span>周期确认金额 <strong>{money(total)}</strong></span>
        <span>峰值 <strong>{peak ? money(peak.amount_cent) : "—"}</strong></span>
      </div>
      <div className="trend-canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label={`${scope === "year" ? "年度月度" : "月度每日"}确认金额折线图，悬浮可查看具体金额`}
          onPointerDown={showHoverPoint}
          onPointerMove={showHoverPoint}
          onPointerLeave={() => setHoverPoint(null)}
          onPointerCancel={() => setHoverPoint(null)}
          role="img"
        />
        {hoverPoint && rows[hoverPoint.index] && <><i
          aria-hidden="true"
          className="trend-hover-dot"
          style={{ left: `${hoverPoint.left}%`, top: `${hoverPoint.top}%` }}
        /><div
          className={`trend-tooltip ${hoverPoint.top < 20 ? "below" : ""}`}
          role="status"
          style={{ left: `clamp(52px, ${hoverPoint.left}%, calc(100% - 52px))`, top: `${hoverPoint.top}%` }}
        >
          <span>{formatBucket(rows[hoverPoint.index]?.bucket)}</span>
          <strong>{money(rows[hoverPoint.index]?.amount_cent)}</strong>
        </div></>}
      </div>
    </div>
  );
}

function CustomerAuth({ onLogin }: { onLogin: (user: Json) => void }) {
  const [phone, setPhone] = useState("13800138000");
  const [code, setCode] = useState("9999");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await api("/api/auth/code/login", {
        method: "POST",
        body: JSON.stringify({ phone, code }),
      });
      onLogin(data.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-art">
        <div className="fire-orb"><span>炭火正旺</span></div>
        <p className="eyebrow">今晚 · 好好吃饭</p>
        <h1>一把炭火，<br />一桌人间烟火。</h1>
        <p>选好喜欢的串，交给我们把火候照顾好。</p>
        <div className="auth-proof"><span>20+ 道精选</span><span>无需支付</span><span>实时接单</span></div>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <div className="auth-title">
          <p className="eyebrow">欢迎回来</p>
          <h2>先登录，再开吃</h2>
        </div>
        <label>账号（手机号）<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="username" /></label>
        <label>验证码<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={4} /></label>
        {message && <p className="form-message">{message}</p>}
        <button className="primary-button wide" disabled={busy}>{busy ? "请稍候…" : "登录并开始点餐"}</button>
        <p className="demo-tip">测试版固定验证码：9999，无需获取验证码；新账号首次登录会自动创建。</p>
      </form>
    </section>
  );
}

function CustomerApp({ user, onLogout }: { user: Json; onLogout: () => void }) {
  const [tab, setTab] = useState<"menu" | "orders" | "consumption">("menu");
  const [menu, setMenu] = useState<Json>({ categories: [], store: {} });
  const [categoryId, setCategoryId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchedKeyword, setSearchedKeyword] = useState("");
  const [cart, setCart] = useState<Record<string, Json>>({});
  const [orders, setOrders] = useState<Json[]>([]);
  const [consumption, setConsumption] = useState<Json>({ summary: {}, items: [] });
  const [period, setPeriod] = useState("month");
  const [cartOpen, setCartOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<{ token: string; requestId: string } | null>(null);
  const [note, setNote] = useState("");
  const [selectedItem, setSelectedItem] = useState<Json | null>(null);
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [draftSelection, setDraftSelection] = useState<Json>({});
  const [pendingRepeatOrder, setPendingRepeatOrder] = useState<Json | null>(null);
  const [repeatBusy, setRepeatBusy] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const orderSubmitLockRef = useRef(false);
  const checkoutRequestIdRef = useRef<string | null>(null);
  const dismissMessage = useCallback(() => setMessage(""), []);

  const loadMenu = useCallback(async (query = "") => {
    const data = await api(`/api/menu${query ? `?keyword=${encodeURIComponent(query)}` : ""}`);
    setMenu(data);
    setSearchedKeyword(data.keyword ?? "");
    setCategoryId((current) =>
      data.categories.some((category: Json) => category.id === current)
        ? current
        : data.categories[0]?.id ?? "");
  }, []);
  const loadOrders = useCallback(async () => {
    const data = await api("/api/orders?page_size=50");
    setOrders(data.items);
  }, []);
  const loadConsumption = useCallback(async () => {
    const data = await api(`/api/consumption?period=${period}`);
    setConsumption(data);
  }, [period]);

  useEffect(() => { void loadMenu(); void loadOrders(); }, [loadMenu, loadOrders]);
  useEffect(() => { if (tab === "consumption") void loadConsumption(); }, [tab, loadConsumption]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);
  useEffect(() => {
    if (!cartOpen && !selectedItem && !pendingRepeatOrder) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedItem) setSelectedItem(null);
      else if (pendingRepeatOrder) {
        if (!repeatBusy) setPendingRepeatOrder(null);
      }
      else if (!orderSubmitting) setCartOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [cartOpen, orderSubmitting, pendingRepeatOrder, repeatBusy, selectedItem]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadMenu(searchedKeyword); };
    const timer = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [loadMenu, searchedKeyword]);
  useEffect(() => {
    if (searchedKeyword) return;
    const latest = new Map<string, Json>(
      menu.categories.flatMap((category: Json) => category.items).map((item: Json) => [String(item.id), item]),
    );
    setCart((current) => Object.fromEntries(Object.entries(current).map(([key, line]) => {
      const item = latest.get(line.id);
      return [key, {
        ...line,
        invalid: !item?.sellable,
        invalidReason: item ? item.sale_label : "已下架",
      }];
    })));
  }, [menu, searchedKeyword]);

  const cartLines = Object.values(cart);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const invalidCartLines = cartLines.filter((line) => line.invalid);
  const validCartLines = cartLines.filter((line) => !line.invalid);
  const cartTotal = cartLines.reduce((sum, line) => sum + (line.invalid ? 0 : line.price_cent * line.quantity), 0);
  const activeCategory = menu.categories.find((category: Json) => category.id === categoryId) ?? menu.categories[0];
  const missingGroups = missingBalanceGroups(validCartLines);
  const selectedUnitPrice = selectedItem
    ? priceForSelection(selectedItem.price_cent, selectedItem.business_type, draftSelection)
    : 0;

  function resetCheckoutAttempt() {
    checkoutRequestIdRef.current = null;
    setQuote(null);
  }

  function openItem(item: Json) {
    if (!item.sellable) return;
    const selection = Object.fromEntries(
      (item.option_groups ?? []).map((group: Json) => [group.key, group.values[0]?.value]),
    );
    setSelectedItem(item);
    setDraftSelection(selection);
    setDraftQuantity(1);
  }

  function addSelectedItem() {
    if (!selectedItem?.sellable) return;
    const key = cartLineKey(selectedItem.id, draftSelection);
    setCart((current) => {
      const quantity = Math.min(99, (current[key]?.quantity ?? 0) + draftQuantity);
      return {
        ...current,
        [key]: {
          ...selectedItem,
          lineKey: key,
          selection: draftSelection,
          selection_label: selectionLabel(draftSelection),
          price_cent: selectedUnitPrice,
          quantity,
          invalid: false,
        },
      };
    });
    setMessage(`${selectedItem.name} × ${draftQuantity} 已加入购物车`);
    setSelectedItem(null);
    resetCheckoutAttempt();
  }

  function changeQuantity(lineKey: string, delta: number) {
    if (orderSubmitting) return;
    setCart((current) => {
      const next = { ...current };
      const quantity = (next[lineKey]?.quantity ?? 0) + delta;
      if (quantity <= 0) delete next[lineKey];
      else next[lineKey] = { ...next[lineKey], quantity: Math.min(99, quantity) };
      return next;
    });
    resetCheckoutAttempt();
  }

  function clearCart() {
    if (!cartLines.length || orderSubmitting) return;
    setCart({});
    resetCheckoutAttempt();
    setNote("");
    setCartOpen(false);
    setMessage("购物车已清空");
  }

  async function submitOrder(confirmQuote = false) {
    if (orderSubmitLockRef.current) return;
    if (!cartLines.length) return;
    if (invalidCartLines.length) {
      setMessage("请先移除失效商品，再确认提交。");
      return;
    }
    orderSubmitLockRef.current = true;
    setOrderSubmitting(true);
    let requestId = "";
    try {
      requestId = quote?.requestId ?? checkoutRequestIdRef.current ?? createClientRequestId();
      checkoutRequestIdRef.current = requestId;
      const data = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId: requestId,
          items: cartLines.map((line) => ({
            itemId: line.id,
            quantity: line.quantity,
            unitPriceCent: line.price_cent,
            selection: line.selection,
          })),
          note,
          quoteToken: confirmQuote ? quote?.token : undefined,
        }),
      });
      setCart({});
      setQuote(null);
      checkoutRequestIdRef.current = null;
      setCartOpen(false);
      setMessage(`订单 ${data.order.order_no} 已提交，等待商家确认`);
      await loadOrders();
      setTab("orders");
    } catch (error) {
      const apiError = error as Error & { code?: string; details?: Json };
      if (apiError.code === "CART_CHANGED" && apiError.details) {
        const next: Record<string, Json> = {};
        let unavailableCount = 0;
        for (const line of apiError.details.items ?? []) {
          const key = line.line_key ?? cartLineKey(line.item_id, line.selection);
          const original = cart[key];
          if (original) {
            if (!line.available) unavailableCount += 1;
            next[key] = {
              ...original,
              name: line.name ?? original.name,
              price_cent: line.unit_price_cent || original.price_cent,
              quantity: line.quantity,
              selection: line.selection ?? original.selection,
              selection_label: line.selection_label ?? original.selection_label,
              invalid: !line.available,
              invalidReason: line.reason || "商品已失效",
            };
          }
        }
        setCart(next);
        setQuote(unavailableCount ? null : { token: apiError.details.quote_token, requestId });
        setMessage(unavailableCount
          ? `检测到 ${unavailableCount} 种商品已售罄或失效，已标记并从合计中扣除。`
          : apiError.message);
        return;
      }
      setMessage(apiError.message);
    } finally {
      orderSubmitLockRef.current = false;
      setOrderSubmitting(false);
    }
  }

  function requestRepeatOrder(order: Json) {
    if (cartLines.length) {
      setPendingRepeatOrder(order);
      return;
    }
    void repeatLastOrder(order, "replace");
  }

  async function repeatLastOrder(order: Json, strategy: "replace" | "append") {
    setRepeatBusy(true);
    try {
      const fullMenu = await api("/api/menu");
      setMenu(fullMenu);
      setKeyword("");
      setSearchedKeyword("");
      const currentMenu = new Map<string, Json>(
        fullMenu.categories.flatMap((category: Json) => category.items).map((item: Json) => [String(item.id), item]),
      );
      const next: Record<string, Json> = {};
      let skipped = 0;
      for (const orderedItem of order.items ?? []) {
        const item = currentMenu.get(orderedItem.item_id);
        if (!item?.sellable) {
          skipped += 1;
          continue;
        }
        const selection = orderedItem.selection ?? {};
        const key = cartLineKey(item.id, selection);
        const unitPrice = priceForSelection(item.price_cent, item.business_type, selection);
        next[key] = {
          ...item,
          lineKey: key,
          selection,
          selection_label: selectionLabel(selection),
          price_cent: unitPrice,
          quantity: Math.min(99, (next[key]?.quantity ?? 0) + Number(orderedItem.quantity)),
          invalid: false,
        };
      }
      if (!Object.keys(next).length) {
        setMessage("上次订单的商品当前都不可售，先看看今日菜单吧。");
        setTab("menu");
        return;
      }
      setCart((current) => {
        if (strategy === "replace") return next;
        const merged = { ...current };
        for (const [key, line] of Object.entries(next)) {
          merged[key] = {
            ...line,
            quantity: Math.min(99, Number(merged[key]?.quantity ?? 0) + Number(line.quantity)),
          };
        }
        return merged;
      });
      resetCheckoutAttempt();
      setTab("menu");
      setCartOpen(true);
      const result = strategy === "append"
        ? "已将上次订单追加到购物车。"
        : cartLines.length
          ? "已用上次订单替换购物车。"
          : "上次订单已放入购物车。";
      setMessage(skipped ? `${result}${skipped} 个不可售商品已跳过。` : result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重订失败，请稍后再试");
    } finally {
      setPendingRepeatOrder(null);
      setRepeatBusy(false);
    }
  }

  function searchMenu(event: FormEvent) {
    event.preventDefault();
    void loadMenu(keyword.trim());
  }

  function clearSearch() {
    setKeyword("");
    void loadMenu("");
  }

  async function cancel(orderId: string) {
    try {
      await api(`/api/orders/${orderId}/cancel`, { method: "POST", body: "{}" });
      setMessage("订单已撤回");
      await loadOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤回失败");
      await loadOrders();
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    onLogout();
  }

  return (
    <div className="customer-shell">
      <header className="customer-header">
        <Brand compact />
        <nav aria-label="顾客端主导航">
          <button aria-current={tab === "menu" ? "page" : undefined} className={tab === "menu" ? "active" : ""} onClick={() => setTab("menu")}>今日菜单</button>
          <button aria-current={tab === "orders" ? "page" : undefined} className={tab === "orders" ? "active" : ""} onClick={() => { setTab("orders"); void loadOrders(); }}>我的订单</button>
          <button aria-current={tab === "consumption" ? "page" : undefined} className={tab === "consumption" ? "active" : ""} onClick={() => setTab("consumption")}>消费记录</button>
        </nav>
        <div className="user-chip"><span>{user.nickname?.slice(0, 1)}</span><div><strong>{user.nickname}</strong><small>{user.phone_masked}</small></div><button onClick={logout}>退出</button></div>
      </header>

      {tab === "menu" && (
        <main>
          <section className="menu-hero">
            <div><p className="eyebrow">OPEN NOW · 炭火正旺</p><h1>今晚想吃点<br /><em>有烟火气的。</em></h1><p>{menu.store?.address} · 下单后由门店确认，无需在线支付</p></div>
            <div className="hero-special"><span>今日推荐</span><strong>蒜蓉烤茄子</strong><small>蒜香浓郁 · 软糯入味</small><b>¥22</b></div>
          </section>
          <section className="menu-section">
            <div className="section-heading"><div><p className="eyebrow">OUR MENU</p><h2>趁热挑，慢慢吃</h2></div><form className="menu-search" onSubmit={searchMenu}><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索菜名、口味、标签" aria-label="搜索菜单" /><button>搜索</button>{searchedKeyword && <button type="button" onClick={clearSearch}>清除</button>}</form></div>
            <div className="category-tabs">
              {menu.categories.map((category: Json) => <button key={category.id} aria-pressed={activeCategory?.id === category.id} className={activeCategory?.id === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)}>{category.name}<small>{category.items.length}</small></button>)}
            </div>
            <div className="item-grid">
              {searchedKeyword && !activeCategory && <div className="empty-state">没有找到“{searchedKeyword}”，换个关键词试试。</div>}
              {activeCategory?.items.map((item: Json, index: number) => (
                <article className={`menu-card color-${index % 5}`} key={item.id}>
                  <div className="food-visual"><span>{item.image_url || "🔥"}</span>{index === 0 && <b>人气</b>}</div>
                  <div className="food-copy">
                    <div><h3>{item.name}</h3><p>{item.description}</p></div>
                    <div className="monthly-sales">月售 <b>{item.monthly_sold ?? 0}</b></div>
                    <footer><strong>{money(item.price_cent)}{item.business_type === "BEER" && <small> 起</small>}</strong><button disabled={!item.sellable} onClick={() => openItem(item)} aria-label={`选择 ${item.name}`}>{item.sellable ? "选择" : item.sale_label}</button></footer>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}

      {tab === "orders" && (
        <main className="content-page">
          <div className="page-title"><p className="eyebrow">MY ORDERS</p><h1>我的订单</h1><p>每一单都有迹可循，门店确认后才会记入消费。</p></div>
          {orders[0] && (
            <section className="last-order">
              <div><span>上次点单</span><strong>{orders[0].order_no}</strong><small>{orders[0].items?.length ?? 0} 种 · {money(orders[0].total_cent)}</small></div>
              <button className="primary-button" disabled={repeatBusy} onClick={() => requestRepeatOrder(orders[0])}>{repeatBusy ? "正在加入…" : "一键重订"}</button>
            </section>
          )}
          <div className="order-list">
            {orders.length === 0 && <div className="empty-state">还没有订单，去菜单挑点喜欢的吧。</div>}
            {orders.map((order) => (
              <article className="order-card" key={order.id}>
                <header><div><span className={`status status-${order.status}`}>{statusText[order.status]}</span><strong>{order.order_no}</strong></div><time>{dateTime(order.submitted_at)}</time></header>
                <div className="order-items">{order.items.map((item: Json) => <p className={item.fulfillment_status === "SOLD_OUT" ? "sold-out-line" : ""} key={item.id}><span>{item.name_snapshot}{item.selection_label ? ` · ${item.selection_label}` : ""} × {item.quantity}{item.fulfillment_status === "SOLD_OUT" && <em>售罄 · 已移除金额</em>}</span><b>{money(item.subtotal_cent)}</b></p>)}</div>
                <footer><span>{order.status === "REJECTED" && order.rejection_note ? `拒绝原因：${order.rejection_note}` : order.note || "无备注"}{order.removed_amount_cent > 0 && <small>已移除售罄商品 {money(order.removed_amount_cent)}</small>}</span><div><strong>{money(order.total_cent)}</strong>{order.status === "PENDING_CONFIRM" && <button className="outline-danger" onClick={() => cancel(order.id)}>撤回订单</button>}</div></footer>
              </article>
            ))}
          </div>
        </main>
      )}

      {tab === "consumption" && (
        <main className="content-page">
          <div className="page-title"><p className="eyebrow">MY TASTE</p><h1>消费记录</h1><p>这里只统计已确认、未作废的订单。</p></div>
          <div className="period-tabs" aria-label="消费记录周期">{["today", "week", "month", "year"].map((value) => <button key={value} aria-pressed={period === value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{{ today: "今日", week: "本周", month: "本月", year: "本年" }[value]}</button>)}</div>
          <div className="metric-grid">
            <div><span>确认金额</span><strong>{money(consumption.summary?.amount_cent)}</strong><small>不代表已支付</small></div>
            <div><span>订单数</span><strong>{consumption.summary?.order_count ?? 0}</strong><small>已确认未作废</small></div>
            <div><span>平均客单</span><strong>{consumption.summary?.average_cent == null ? "—" : money(consumption.summary.average_cent)}</strong><small>按当前周期</small></div>
          </div>
          <div className="ledger">{consumption.items?.map((record: Json) => <div key={record.id}><span><b>{record.order_no}</b><small>{dateTime(record.confirmed_at_utc)}</small></span><strong>{money(record.confirmed_amount_cent)}</strong></div>)}</div>
        </main>
      )}

      <button className="cart-fab" aria-label={`打开购物车，当前 ${cartCount} 件商品`} onClick={() => setCartOpen(true)}><span>🛒</span><b>{cartCount || 0}</b><strong>{cartCount ? `${money(cartTotal)} · 去结算` : "购物车"}</strong></button>
      {cartOpen && (
        <div className="drawer-backdrop" onClick={() => !orderSubmitting && setCartOpen(false)}>
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="购物车" aria-busy={orderSubmitting} onClick={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">YOUR CART</p><h2>购物车</h2></div><div className="cart-header-actions">{!!cartLines.length && <button className="clear-cart" aria-label="一键清空购物车" disabled={orderSubmitting} onClick={clearCart}>清空</button>}<button className="cart-close" aria-label="关闭购物车" disabled={orderSubmitting} onClick={() => setCartOpen(false)}>×</button></div></header>
            <div className="cart-lines">
              {!cartLines.length && <div className="empty-state">还没选好吃的，去菜单逛逛。</div>}
              {cartLines.map((line) => <div className={`cart-line ${line.invalid ? "invalid" : ""}`} key={line.lineKey}><span className="cart-icon">{line.image_url}</span><div><strong>{line.name}</strong>{line.selection_label && <em>{line.selection_label}</em>}<small>{line.invalid ? `失效：${line.invalidReason}` : money(line.price_cent)}</small>{line.invalid && <button className="remove-invalid" disabled={orderSubmitting} onClick={() => changeQuantity(line.lineKey, -line.quantity)}>移除失效商品</button>}</div><div className="stepper"><button aria-label={`减少一份${line.name}`} disabled={line.invalid || orderSubmitting} onClick={() => changeQuantity(line.lineKey, -1)}>−</button><b>{line.quantity}</b><button aria-label={`增加一份${line.name}`} disabled={line.invalid || orderSubmitting} onClick={() => changeQuantity(line.lineKey, 1)}>+</button></div></div>)}
            </div>
            {!!invalidCartLines.length && <div className="cart-stock-alert" role="alert"><strong>购物车有 {invalidCartLines.length} 种失效商品</strong><span>商品可能已售罄或下架，已自动从合计金额中扣除，请移除后再提交。</span></div>}
            <label className="note-field">订单备注<textarea value={note} disabled={orderSubmitting} onChange={(event) => { setNote(event.target.value); resetCheckoutAttempt(); }} maxLength={200} placeholder="例如：少辣、不要香菜" /></label>
            {!!cartLines.length && (
              <div className={`balance-tip ${missingGroups.length ? "" : "complete"}`}>
                <span>{missingGroups.length ? "搭配小提示" : "搭配很丰富"}</span>
                <p>{missingGroups.length ? `还可以加点${missingGroups.join("、")}，吃得更舒服。仅供参考，不影响下单。` : "荤素、主食和饮品都照顾到了，可以放心提交。"}</p>
              </div>
            )}
            {quote && <div className="quote-alert">菜单有变化，已为你更新购物车。请再次确认金额。</div>}
            <footer><div><span>合计（失效商品不计）</span><strong>{money(cartTotal)}</strong></div><button className="primary-button wide" disabled={orderSubmitting || !cartLines.length || invalidCartLines.length > 0} onClick={() => submitOrder(Boolean(quote))}>{orderSubmitting ? "订单提交中…" : invalidCartLines.length ? "请先移除失效商品" : quote ? "确认变更并提交" : "提交订单 · 门店确认"}</button></footer>
          </aside>
        </div>
      )}
      {selectedItem && (
        <div className="option-backdrop" onClick={() => setSelectedItem(null)}>
          <section className="option-dialog" role="dialog" aria-modal="true" aria-label={`选择 ${selectedItem.name}`} onClick={(event) => event.stopPropagation()}>
            <header><div className="option-food">{selectedItem.image_url || "🔥"}</div><div><p className="eyebrow">CUSTOMIZE</p><h2>{selectedItem.name}</h2><p>{selectedItem.description}</p></div><button aria-label="关闭" onClick={() => setSelectedItem(null)}>×</button></header>
            {(selectedItem.option_groups ?? []).map((group: Json) => (
              <fieldset key={group.key}>
                <legend>{group.label}</legend>
                <div className={`option-values ${group.key === "capacity" ? "capacity-values" : ""}`}>
                  {group.values.map((option: Json) => (
                    <button key={option.value} aria-pressed={draftSelection[group.key] === option.value} className={draftSelection[group.key] === option.value ? "active" : ""} onClick={() => setDraftSelection((current) => ({ ...current, [group.key]: option.value }))}>
                      <strong>{option.label}</strong>
                      {option.price_cent != null && <small>{money(option.price_cent)}</small>}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            {!selectedItem.option_groups?.length && <div className="simple-choice">这道菜无需选择口味，直接调整份数即可。</div>}
            <div className="option-quantity"><span>数量</span><div className="stepper large"><button aria-label="减少数量" onClick={() => setDraftQuantity((value) => Math.max(1, value - 1))}>−</button><b>{draftQuantity}</b><button aria-label="增加数量" onClick={() => setDraftQuantity((value) => Math.min(99, value + 1))}>+</button></div></div>
            <footer><div><span>小计</span><strong>{money(selectedUnitPrice * draftQuantity)}</strong></div><button className="primary-button" onClick={addSelectedItem}>加入购物车</button></footer>
          </section>
        </div>
      )}
      {pendingRepeatOrder && (
        <div className="option-backdrop repeat-backdrop" onClick={() => !repeatBusy && setPendingRepeatOrder(null)}>
          <section className="repeat-dialog" role="dialog" aria-modal="true" aria-labelledby="repeat-dialog-title" onClick={(event) => event.stopPropagation()}>
            <span className="repeat-icon" aria-hidden="true">↻</span>
            <p className="eyebrow">REORDER</p>
            <h2 id="repeat-dialog-title">购物车已有商品</h2>
            <p>请选择如何处理上次订单。追加会保留当前商品，相同规格会自动合并数量。</p>
            <div className="repeat-current"><span>当前购物车</span><strong>{cartCount} 件 · {money(cartTotal)}</strong></div>
            <footer>
              <button className="ghost-button" disabled={repeatBusy} onClick={() => setPendingRepeatOrder(null)}>取消</button>
              <button className="outline-danger" disabled={repeatBusy} onClick={() => void repeatLastOrder(pendingRepeatOrder, "replace")}>替换购物车</button>
              <button className="primary-button" disabled={repeatBusy} onClick={() => void repeatLastOrder(pendingRepeatOrder, "append")}>{repeatBusy ? "处理中…" : "追加到购物车"}</button>
            </footer>
          </section>
        </div>
      )}
      <Toast message={message} tone={quote ? "warm" : "dark"} onDismiss={dismissMessage} />
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (admin: Json) => void }) {
  const [username, setUsername] = useState("manager");
  const [password, setPassword] = useState("Manager123");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await api("/api/admin/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      onLogin(data.admin);
    } catch (error) { setMessage(error instanceof Error ? error.message : "登录失败"); }
  }
  return (
    <section className="admin-login">
      <div className="admin-login-copy"><Brand /><p className="eyebrow">STORE OPERATIONS</p><h1>把每一单<br />稳稳接住。</h1><p>订单、菜单、经营数据，都在一个清晰的工作台里。</p></div>
      <form className="auth-card" onSubmit={submit}><p className="eyebrow">管理端登录</p><h2>开始今天的营业</h2><label>账号<input value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message && <p className="form-message">{message}</p>}<button className="primary-button wide">进入管理工作台</button><p className="demo-tip">店长 manager / Manager123<br />操作员 operator / Operator123</p></form>
    </section>
  );
}

type NewItemInput = {
  categoryId: string;
  name: string;
  sku: string;
  priceCent: number;
  description: string;
  imageUrl: string;
  sortOrder: number;
};

type ItemFormField = "categoryId" | "name" | "sku" | "priceYuan" | "sortOrder";
type ItemFormErrors = Partial<Record<ItemFormField, string>>;

type NewCategoryInput = {
  name: string;
  code: string;
  businessType: "FOOD" | "BEER" | "DRINK";
  sortOrder: number;
};

type CategoryFormField = "name" | "code" | "businessType" | "sortOrder";
type CategoryFormErrors = Partial<Record<CategoryFormField, string>>;

const businessTypeLabels: Record<NewCategoryInput["businessType"], string> = {
  FOOD: "餐食",
  BEER: "啤酒",
  DRINK: "饮料",
};

function ItemCreateDrawer({
  categories,
  defaultSortOrder,
  onClose,
  onSubmit,
}: {
  categories: Json[];
  defaultSortOrder: number;
  onClose: () => void;
  onSubmit: (input: NewItemInput) => Promise<void>;
}) {
  const enabledCategories = categories.filter((category) => category.status === "ENABLED");
  const [form, setForm] = useState({
    categoryId: enabledCategories[0]?.id ?? "",
    name: "",
    sku: "",
    priceYuan: "",
    description: "",
    imageUrl: "🔥",
    sortOrder: String(defaultSortOrder),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ItemFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const sortOrderRef = useRef<HTMLInputElement>(null);
  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const previewPrice = Number(form.priceYuan);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field in fieldErrors) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[field as ItemFormField];
        return next;
      });
    }
    if (error) setError("");
  }

  function showValidationErrors(errors: ItemFormErrors) {
    const order: ItemFormField[] = ["name", "categoryId", "sku", "priceYuan", "sortOrder"];
    const invalidFields = order.filter((field) => errors[field]);
    const refs: Record<ItemFormField, { current: HTMLInputElement | HTMLSelectElement | null }> = {
      name: nameRef,
      categoryId: categoryRef,
      sku: skuRef,
      priceYuan: priceRef,
      sortOrder: sortOrderRef,
    };
    setFieldErrors(errors);
    setError(invalidFields.length > 1 ? `请检查并完善 ${invalidFields.length} 项商品信息。` : errors[invalidFields[0]] ?? "请完善商品信息。");
    window.requestAnimationFrame(() => refs[invalidFields[0]]?.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const sku = form.sku.trim().toUpperCase();
    const priceCent = Math.round(Number(form.priceYuan) * 100);
    const sortOrder = Number(form.sortOrder);
    const errors: ItemFormErrors = {};
    if (!name) errors.name = "请填写商品名称。";
    if (!form.categoryId) errors.categoryId = "请选择商品品类。";
    if (!sku) errors.sku = "请填写 SKU 唯一编码。";
    else if (!/^[A-Z0-9_-]{2,30}$/.test(sku)) errors.sku = "SKU 需为 2–30 位英文、数字、横线或下划线。";
    if (!form.priceYuan.trim()) errors.priceYuan = "请填写商品单价。";
    else if (!Number.isInteger(priceCent) || priceCent <= 0) errors.priceYuan = "请输入大于 0 的正确商品单价。";
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) errors.sortOrder = "排序值需为 0–9999 的整数。";
    if (Object.keys(errors).length) return showValidationErrors(errors);
    setSubmitting(true);
    try {
      await onSubmit({
        categoryId: form.categoryId,
        name,
        sku,
        priceCent,
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim() || "🔥",
        sortOrder,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "新增商品失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-form-backdrop" onClick={() => !submitting && onClose()}>
      <aside className="admin-form-drawer" role="dialog" aria-modal="true" aria-labelledby="item-create-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><p className="eyebrow">NEW MENU ITEM</p><h2 id="item-create-title">新增商品</h2><p>填写商品资料，保存后立即进入菜单管理列表。</p></div>
          <button type="button" aria-label="关闭新增商品表单" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="admin-form-body">
            <div className="item-form-preview" aria-label="商品预览">
              <span>{form.imageUrl.trim() || "🔥"}</span>
              <div><small>{selectedCategory?.name ?? "待选择品类"}</small><strong>{form.name.trim() || "商品名称"}</strong><b>{previewPrice > 0 ? money(Math.round(previewPrice * 100)) : "¥0.00"}</b></div>
            </div>
            <div className="admin-form-grid">
              <label className={`admin-form-field admin-form-field-wide ${fieldErrors.name ? "has-error" : ""}`}>商品名称<span>必填</span>
                <input ref={nameRef} value={form.name} maxLength={40} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "item-name-error" : undefined} placeholder="例如：秘制五花肉串" onChange={(event) => updateField("name", event.target.value)} />
                {fieldErrors.name && <small className="admin-field-error" id="item-name-error">{fieldErrors.name}</small>}
              </label>
              <label className={`admin-form-field ${fieldErrors.categoryId ? "has-error" : ""}`}>品类<span>必填</span>
                <select ref={categoryRef} value={form.categoryId} aria-invalid={Boolean(fieldErrors.categoryId)} aria-describedby={fieldErrors.categoryId ? "item-category-error" : undefined} onChange={(event) => updateField("categoryId", event.target.value)}>
                  {enabledCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                </select>
                {fieldErrors.categoryId && <small className="admin-field-error" id="item-category-error">{fieldErrors.categoryId}</small>}
              </label>
              <label className="admin-form-field">商品图标<span>建议使用 Emoji</span>
                <input value={form.imageUrl} maxLength={12} placeholder="🔥" onChange={(event) => updateField("imageUrl", event.target.value)} />
              </label>
              <label className={`admin-form-field ${fieldErrors.sku ? "has-error" : ""}`}>SKU<span>必填 · 唯一编码</span>
                <input ref={skuRef} value={form.sku} maxLength={30} autoCapitalize="characters" spellCheck={false} aria-invalid={Boolean(fieldErrors.sku)} aria-describedby={fieldErrors.sku ? "item-sku-error" : undefined} placeholder="例如：SK-025" onChange={(event) => updateField("sku", event.target.value.toUpperCase())} />
                {fieldErrors.sku && <small className="admin-field-error" id="item-sku-error">{fieldErrors.sku}</small>}
              </label>
              <label className={`admin-form-field ${fieldErrors.priceYuan ? "has-error" : ""}`}>单价（元）<span>必填</span>
                <div className="price-input"><i>¥</i><input ref={priceRef} type="number" inputMode="decimal" min="0.01" max="99999" step="0.01" value={form.priceYuan} aria-invalid={Boolean(fieldErrors.priceYuan)} aria-describedby={fieldErrors.priceYuan ? "item-price-error" : undefined} placeholder="18.00" onChange={(event) => updateField("priceYuan", event.target.value)} /></div>
                {fieldErrors.priceYuan && <small className="admin-field-error" id="item-price-error">{fieldErrors.priceYuan}</small>}
              </label>
              <label className="admin-form-field admin-form-field-wide">商品描述<span>{form.description.length}/300</span>
                <textarea value={form.description} maxLength={300} rows={4} placeholder="简单描述口味、食材或推荐理由" onChange={(event) => updateField("description", event.target.value)} />
              </label>
              <label className={`admin-form-field ${fieldErrors.sortOrder ? "has-error" : ""}`}>列表排序<span>数字越小越靠前</span>
                <input ref={sortOrderRef} type="number" inputMode="numeric" min="0" max="9999" step="1" value={form.sortOrder} aria-invalid={Boolean(fieldErrors.sortOrder)} aria-describedby={fieldErrors.sortOrder ? "item-sort-error" : undefined} onChange={(event) => updateField("sortOrder", event.target.value)} />
                {fieldErrors.sortOrder && <small className="admin-field-error" id="item-sort-error">{fieldErrors.sortOrder}</small>}
              </label>
            </div>
            {error && <p className="admin-form-error" role="alert">{error}</p>}
          </div>
          <footer>
            <button type="button" className="ghost-button" disabled={submitting} onClick={onClose}>取消</button>
            <button type="submit" className="primary-button" disabled={submitting || enabledCategories.length === 0}>{submitting ? "保存中…" : "保存并上架"}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function CategoryCreateDrawer({
  defaultSortOrder,
  onClose,
  onSubmit,
}: {
  defaultSortOrder: number;
  onClose: () => void;
  onSubmit: (input: NewCategoryInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    code: "",
    businessType: "FOOD" as NewCategoryInput["businessType"],
    sortOrder: String(defaultSortOrder),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<CategoryFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const businessTypeRef = useRef<HTMLSelectElement>(null);
  const sortOrderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field in fieldErrors) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[field as CategoryFormField];
        return next;
      });
    }
    if (error) setError("");
  }

  function showValidationErrors(errors: CategoryFormErrors) {
    const order: CategoryFormField[] = ["name", "code", "businessType", "sortOrder"];
    const invalidFields = order.filter((field) => errors[field]);
    const refs: Record<CategoryFormField, { current: HTMLInputElement | HTMLSelectElement | null }> = {
      name: nameRef,
      code: codeRef,
      businessType: businessTypeRef,
      sortOrder: sortOrderRef,
    };
    setFieldErrors(errors);
    setError(invalidFields.length > 1 ? `请检查并完善 ${invalidFields.length} 项品类信息。` : errors[invalidFields[0]] ?? "请完善品类信息。");
    window.requestAnimationFrame(() => refs[invalidFields[0]]?.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();
    const sortOrder = Number(form.sortOrder);
    const errors: CategoryFormErrors = {};
    if (!name) errors.name = "请填写品类名称。";
    else if (name.length > 20) errors.name = "品类名称不能超过 20 个字符。";
    if (!code) errors.code = "请填写品类编码。";
    else if (!/^[A-Z0-9_]{2,30}$/.test(code)) errors.code = "品类编码需为 2–30 位英文、数字或下划线。";
    if (!businessTypeLabels[form.businessType]) errors.businessType = "请选择业务类型。";
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) errors.sortOrder = "排序值需为 0–9999 的整数。";
    if (Object.keys(errors).length) return showValidationErrors(errors);
    setSubmitting(true);
    try {
      await onSubmit({ name, code, businessType: form.businessType, sortOrder });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "新增品类失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-form-backdrop" onClick={() => !submitting && onClose()}>
      <aside className="admin-form-drawer" role="dialog" aria-modal="true" aria-labelledby="category-create-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><p className="eyebrow">NEW CATEGORY</p><h2 id="category-create-title">新增品类</h2><p>建立新的菜单分组，保存后默认启用并立即展示。</p></div>
          <button type="button" aria-label="关闭新增品类表单" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="admin-form-body">
            <div className="item-form-preview category-form-preview" aria-label="品类预览">
              <span>{form.name.trim().slice(0, 1) || "品"}</span>
              <div><small>{businessTypeLabels[form.businessType]}</small><strong>{form.name.trim() || "品类名称"}</strong><b>{form.code.trim().toUpperCase() || "CATEGORY_CODE"}</b></div>
            </div>
            <div className="admin-form-grid">
              <label className={`admin-form-field admin-form-field-wide ${fieldErrors.name ? "has-error" : ""}`}>品类名称<span>必填</span>
                <input ref={nameRef} value={form.name} maxLength={20} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "category-name-error" : undefined} placeholder="例如：特色小炒" onChange={(event) => updateField("name", event.target.value)} />
                {fieldErrors.name && <small className="admin-field-error" id="category-name-error">{fieldErrors.name}</small>}
              </label>
              <label className={`admin-form-field admin-form-field-wide ${fieldErrors.code ? "has-error" : ""}`}>品类编码<span>必填 · 唯一编码</span>
                <input ref={codeRef} value={form.code} maxLength={30} autoCapitalize="characters" spellCheck={false} aria-invalid={Boolean(fieldErrors.code)} aria-describedby={fieldErrors.code ? "category-code-error" : undefined} placeholder="例如：SPECIAL_DISH" onChange={(event) => updateField("code", event.target.value.toUpperCase().replace(/\s+/g, "_"))} />
                {fieldErrors.code && <small className="admin-field-error" id="category-code-error">{fieldErrors.code}</small>}
              </label>
              <label className={`admin-form-field ${fieldErrors.businessType ? "has-error" : ""}`}>业务类型<span>必填</span>
                <select ref={businessTypeRef} value={form.businessType} aria-invalid={Boolean(fieldErrors.businessType)} aria-describedby={fieldErrors.businessType ? "category-type-error" : undefined} onChange={(event) => updateField("businessType", event.target.value)}>
                  {Object.entries(businessTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
                {fieldErrors.businessType && <small className="admin-field-error" id="category-type-error">{fieldErrors.businessType}</small>}
              </label>
              <label className={`admin-form-field ${fieldErrors.sortOrder ? "has-error" : ""}`}>列表排序<span>数字越小越靠前</span>
                <input ref={sortOrderRef} type="number" inputMode="numeric" min="0" max="9999" step="1" value={form.sortOrder} aria-invalid={Boolean(fieldErrors.sortOrder)} aria-describedby={fieldErrors.sortOrder ? "category-sort-error" : undefined} onChange={(event) => updateField("sortOrder", event.target.value)} />
                {fieldErrors.sortOrder && <small className="admin-field-error" id="category-sort-error">{fieldErrors.sortOrder}</small>}
              </label>
            </div>
            {error && <p className="admin-form-error" role="alert">{error}</p>}
          </div>
          <footer>
            <button type="button" className="ghost-button" disabled={submitting} onClick={onClose}>取消</button>
            <button type="submit" className="primary-button" disabled={submitting}>{submitting ? "保存中…" : "保存并启用"}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function AdminApp({ admin, onLogout }: { admin: Json; onLogout: () => void }) {
  const [tab, setTab] = useState<"orders" | "menu" | "analytics" | "audit">("orders");
  const [pendingOrders, setPendingOrders] = useState<Json[]>([]);
  const [orderHistory, setOrderHistory] = useState<Json[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(10);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderTotalPages, setOrderTotalPages] = useState(1);
  const [todayOrderSummary, setTodayOrderSummary] = useState<Json>({ pending_count: 0, confirmed_count: 0, confirmed_amount_cent: 0 });
  const [categories, setCategories] = useState<Json[]>([]);
  const [items, setItems] = useState<Json[]>([]);
  const [analytics, setAnalytics] = useState<Json>({ summary: {}, top_items: [], trend: [] });
  const [audits, setAudits] = useState<Json[]>([]);
  const [analyticsYear, setAnalyticsYear] = useState(defaultAnalyticsYear);
  const [analyticsMonth, setAnalyticsMonth] = useState(defaultAnalyticsMonth);
  const [message, setMessage] = useState("");
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const manager = admin.role === "MANAGER";
  const dismissMessage = useCallback(() => setMessage(""), []);

  const loadOrders = useCallback(async () => {
    const [pendingData, historyData] = await Promise.all([
      api("/api/admin/orders?status=PENDING_CONFIRM&page_size=100"),
      api(`/api/admin/orders?view=history&page=${orderPage}&page_size=${orderPageSize}`),
    ]);
    setPendingOrders(pendingData.items);
    setOrderHistory(historyData.items);
    setOrderPage(historyData.page);
    setOrderTotal(historyData.total);
    setOrderTotalPages(historyData.total_pages);
    setTodayOrderSummary(pendingData.today_summary);
  }, [orderPage, orderPageSize]);
  const loadMenu = useCallback(async () => {
    const [categoryData, itemData] = await Promise.all([api("/api/admin/categories?page_size=100"), api("/api/admin/items?page_size=100")]);
    setCategories(categoryData.items);
    setItems(itemData.items);
  }, []);
  const loadAnalytics = useCallback(async () => {
    if (!manager) return;
    const data = await api(`/api/admin/analytics?year=${analyticsYear}${analyticsMonth ? `&month=${analyticsMonth}` : ""}`);
    setAnalytics(data);
  }, [analyticsMonth, analyticsYear, manager]);
  const loadAudits = useCallback(async () => {
    if (!manager) return;
    const data = await api("/api/admin/audits?page_size=100");
    setAudits(data.items);
  }, [manager]);

  useEffect(() => {
    void loadOrders();
    const refreshOnFocus = () => { void loadOrders(); };
    const refreshOnVisible = () => { if (document.visibilityState === "visible") void loadOrders(); };
    const timer = window.setInterval(refreshOnVisible, 3000);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [loadOrders]);
  useEffect(() => { if (tab === "menu") void loadMenu(); if (tab === "analytics") void loadAnalytics(); if (tab === "audit") void loadAudits(); }, [tab, loadMenu, loadAnalytics, loadAudits]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);

  const pending = pendingOrders;

  async function process(order: Json, action: "confirm" | "reject" | "void") {
    try {
      let body: Json = {};
      if (action === "reject") {
        const reason = window.prompt("拒绝原因：SOLD_OUT / STORE_BUSY / INVALID_ORDER / OTHER", "STORE_BUSY");
        if (!reason) return;
        body = { reasonCode: reason, note: reason === "OTHER" ? window.prompt("请填写补充说明") ?? "" : "" };
      }
      if (action === "void") {
        const reason = window.prompt("请输入 5–200 字作废原因", "店长纠错作废");
        if (!reason) return;
        body = { reason };
      }
      await api(`/api/admin/orders/${order.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      setMessage(action === "confirm" ? "订单已确认并入账" : action === "reject" ? "订单已拒绝" : "订单已作废并从统计排除");
      await loadOrders();
      if (tab === "analytics") await loadAnalytics();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
      await loadOrders();
    }
  }

  async function toggleCategory(category: Json) {
    await api(`/api/admin/categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ status: category.status === "ENABLED" ? "DISABLED" : "ENABLED", version: category.version }) });
    await loadMenu();
  }
  async function toggleItem(item: Json, field: "status" | "soldOut") {
    const body = field === "status" ? { status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE", version: item.version } : { soldOut: !item.sold_out, version: item.version };
    try {
      const data = await api(`/api/admin/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) });
      const impact = data.sold_out_impact;
      setMessage(
        field === "soldOut" && body.soldOut
          ? impact?.order_count
            ? `已售罄并更新 ${impact.order_count} 个待确认订单，移除金额 ${money(impact.amount_cent)}`
            : "已设为售罄，顾客菜单即时生效"
          : field === "soldOut"
            ? "已恢复供应"
            : "商品上下架状态已更新",
      );
      await Promise.all([loadMenu(), loadOrders()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新失败");
      await Promise.all([loadMenu(), loadOrders()]);
    }
  }
  async function createCategory(input: NewCategoryInput) {
    await api("/api/admin/categories", { method: "POST", body: JSON.stringify(input) });
    await loadMenu();
    setMessage(`${input.name} 品类已新增并启用`);
  }
  function openItemForm() {
    if (!categories.some((category) => category.status === "ENABLED")) {
      setMessage("请先新增并启用一个品类，再添加商品。");
      return;
    }
    setItemFormOpen(true);
  }
  async function createItem(input: NewItemInput) {
    await api("/api/admin/items", { method: "POST", body: JSON.stringify(input) });
    await loadMenu();
    setMessage(`${input.name} 已新增并上架`);
  }
  async function logout() { await api("/api/admin/auth/logout", { method: "POST", body: "{}" }); onLogout(); }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand compact />
        <div className="store-open"><i />营业中<small>Asia/Shanghai</small></div>
        <nav aria-label="门店管理主导航">
          <button aria-current={tab === "orders" ? "page" : undefined} className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><span>▤</span>订单中心{pending.length > 0 && <b>{pending.length}</b>}</button>
          <button aria-current={tab === "menu" ? "page" : undefined} className={tab === "menu" ? "active" : ""} onClick={() => setTab("menu")}><span>◫</span>菜单管理</button>
          {manager && <button aria-current={tab === "analytics" ? "page" : undefined} className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}><span>↗</span>经营分析</button>}
          {manager && <button aria-current={tab === "audit" ? "page" : undefined} className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><span>◎</span>审计日志</button>}
        </nav>
        <div className="admin-profile"><span>{admin.display_name.slice(0, 1)}</span><div><strong>{admin.display_name}</strong><small>{manager ? "店长" : "操作员"}</small></div><button onClick={logout}>退出</button></div>
      </aside>
      <main className="admin-main">
        {tab === "orders" && <>
          <div className="admin-title"><div><p className="eyebrow">ORDER DESK</p><h1>订单中心</h1><p>新订单每 3 秒自动刷新，先确认备注，再稳稳接单。</p></div><button className="ghost-button" onClick={loadOrders}>立即刷新</button></div>
          <div className="admin-metrics"><div><span>今日待处理</span><strong>{todayOrderSummary.pending_count ?? 0}</strong><small>按营业日统计</small></div><div><span>今日已确认</span><strong>{todayOrderSummary.confirmed_count ?? 0}</strong><small>已确认未作废</small></div><div><span>今日确认金额</span><strong>{money(todayOrderSummary.confirmed_amount_cent)}</strong><small>已排除作废订单</small></div></div>
          <section className="admin-panel"><header><h2>待确认订单</h2><span>{pending.length} 单等待处理</span></header>
            <div className="admin-order-grid">
              {pending.length === 0 && <div className="empty-state">所有订单都已处理，干得漂亮。</div>}
              {pending.map((order) => <article className="admin-order" key={order.id}><header><div><strong>{order.order_no}</strong><small>{order.nickname} · {order.phone_masked}</small></div><time>{dateTime(order.submitted_at)}</time></header><div>{order.items.map((item: Json) => <p className={item.fulfillment_status === "SOLD_OUT" ? "sold-out-line" : ""} key={item.id}><span>{item.name_snapshot}{item.selection_label ? ` · ${item.selection_label}` : ""} × {item.quantity}{item.fulfillment_status === "SOLD_OUT" && <em>售罄 · 已移除</em>}</span><b>{money(item.subtotal_cent)}</b></p>)}</div>{order.note && <blockquote>备注：{order.note}</blockquote>}{order.removed_amount_cent > 0 && <div className="sold-out-summary">售罄商品已移除 {money(order.removed_amount_cent)}</div>}<footer><strong>{money(order.total_cent)}</strong><span><button className="outline-danger" onClick={() => process(order, "reject")}>拒绝</button><button className="primary-button" disabled={order.total_cent <= 0} onClick={() => process(order, "confirm")}>{order.total_cent > 0 ? "确认接单" : "请拒绝"}</button></span></footer></article>)}
            </div>
          </section>
          <section className="admin-panel compact-table order-history">
            <header className="order-history-header">
              <div><h2>近一年订单记录</h2><span>共 {orderTotal} 条，按时间倒序</span></div>
              <label>每页
                <select value={orderPageSize} onChange={(event) => { setOrderPageSize(Number(event.target.value)); setOrderPage(1); }}>
                  {[10, 20, 50].map((size) => <option value={size} key={size}>{size} 条</option>)}
                </select>
              </label>
            </header>
            {orderHistory.length === 0 && <div className="empty-state">近一年暂无已处理订单。</div>}
            {orderHistory.map((order) => <div className="table-row" key={order.id}><span><b>{order.order_no}</b><small>{order.nickname} · {dateTime(order.submitted_at)}</small></span><span className={`status status-${order.status}`}>{statusText[order.status]}</span><strong>{money(order.total_cent)}</strong>{manager && order.status === "CONFIRMED" ? <button className="text-danger" onClick={() => process(order, "void")}>作废</button> : <i />}</div>)}
            <footer className="order-pagination">
              <span>第 {orderPage} / {orderTotalPages} 页</span>
              <div>
                <button disabled={orderPage <= 1} onClick={() => setOrderPage((page) => Math.max(1, page - 1))}>上一页</button>
                <button disabled={orderPage >= orderTotalPages} onClick={() => setOrderPage((page) => Math.min(orderTotalPages, page + 1))}>下一页</button>
              </div>
            </footer>
          </section>
        </>}

        {tab === "menu" && <>
          <div className="admin-title"><div><p className="eyebrow">MENU CONTROL</p><h1>菜单管理</h1><p>店长操作会写入审计日志，历史订单始终保留快照。</p></div>{manager && <span className="button-row"><button className="ghost-button" onClick={() => setCategoryFormOpen(true)}>新增品类</button><button className="primary-button" onClick={openItemForm}>新增商品</button></span>}</div>
          <section className="admin-panel"><header><h2>品类</h2><span>{categories.length} 个品类</span></header><div className="category-admin-grid">{categories.map((category) => <div key={category.id}><span className="category-icon">{category.name.slice(0, 1)}</span><span><strong>{category.name}</strong><small>{category.code} · V{category.version}</small></span><button aria-label={`${category.status === "ENABLED" ? "停用" : "启用"}品类${category.name}`} aria-pressed={category.status === "ENABLED"} disabled={!manager} onClick={() => toggleCategory(category)} className={category.status === "ENABLED" ? "switch on" : "switch"}><i /></button></div>)}</div></section>
          <section className="admin-panel compact-table product-table">
            <header><h2>商品</h2><span>{items.length} 道在库商品</span></header>
            <div className="menu-table-head" aria-hidden="true"><span>商品名称</span><span>品类</span><span>单价</span><span>上下架操作</span><span>库存操作</span></div>
            {items.map((item) => (
              <div className="table-row menu-row" key={item.id}>
                <span className="menu-product-cell"><span className="table-food">{item.image_url}</span><span><b>{item.name}</b><small>{item.sku}</small></span></span>
                <span className="menu-category-cell">{item.category_name}</span>
                <strong className="menu-price">{money(item.price_cent)}</strong>
                <button aria-label={`${item.status === "ACTIVE" ? "下架" : "上架"}${item.name}`} aria-pressed={item.status === "ACTIVE"} disabled={!manager} className={`menu-state-action listing-action ${item.status === "ACTIVE" ? "active" : "inactive"}`} onClick={() => toggleItem(item, "status")}><i />{item.status === "ACTIVE" ? "上架中" : "已下架"}</button>
                <button aria-label={`${item.sold_out ? "恢复库存" : "设为售罄"}${item.name}`} aria-pressed={item.sold_out} disabled={!manager} className={`menu-state-action inventory-action ${item.sold_out ? "sold-out" : "available"}`} onClick={() => toggleItem(item, "soldOut")}><i />{item.sold_out ? "已售罄" : "有库存"}</button>
              </div>
            ))}
          </section>
        </>}

        {tab === "analytics" && <>
          <div className="admin-title"><div><p className="eyebrow">BUSINESS PULSE</p><h1>经营分析</h1><p>按年份或月份查看确认金额、订单与销售趋势。</p></div></div>
          {manager && <div className="analytics-filters">
            <label>年份
              <select value={analyticsYear} onChange={(event) => setAnalyticsYear(Number(event.target.value))}>
                {(analytics.available_years ?? [analyticsYear]).map((year: number) => <option value={year} key={year}>{year} 年</option>)}
              </select>
            </label>
            <label>月份
              <select value={analyticsMonth} onChange={(event) => setAnalyticsMonth(event.target.value)}>
                <option value="">全年（月度汇总）</option>
                {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((month) => <option value={month} key={month}>{Number(month)} 月</option>)}
              </select>
            </label>
            <span>{analyticsMonth ? `${analyticsYear} 年 ${Number(analyticsMonth)} 月 · 按日展示` : `${analyticsYear} 年 · 按月展示`}</span>
          </div>}
          <div className="admin-metrics large"><div><span>确认金额</span><strong>{money(analytics.summary?.amount_cent)}</strong><small>已确认未作废</small></div><div><span>订单数</span><strong>{analytics.summary?.order_count ?? 0}</strong><small>消费台账</small></div><div><span>平均客单</span><strong>{analytics.summary?.average_cent == null ? "—" : money(analytics.summary.average_cent)}</strong><small>按订单计算</small></div><div><span>活跃顾客</span><strong>{analytics.summary?.active_customers ?? 0}</strong><small>去重用户</small></div></div>
          <div className="analytics-grid">
            <section className="admin-panel"><header><h2>热销贡献</h2><span>按确认金额</span></header><div className="rank-list">{!analytics.top_items?.length && <div className="empty-state">所选周期暂无热销数据</div>}{analytics.top_items?.map((item: Json, index: number) => <div key={item.item_id}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.name}</strong><small>{item.quantity} 份</small></span><em>{money(item.amount_cent)}</em></div>)}</div></section>
            <section className="admin-panel"><header><h2>品类贡献</h2><span>金额占比</span></header><div className="contribution-list">{!analytics.category_contribution?.length && <div className="empty-state">所选周期暂无品类数据</div>}{analytics.category_contribution?.map((category: Json) => <div key={category.category_id}><span><strong>{category.name}</strong><small>{money(category.amount_cent)}</small></span><div><i style={{ width: `${category.contribution_bps / 100}%` }} /></div><b>{(category.contribution_bps / 100).toFixed(1)}%</b></div>)}</div></section>
            {manager && <section className="admin-panel trend-panel"><header><h2>销售趋势</h2><span>{analytics.scope === "year" ? "全年按月汇总" : "当月按日汇总"}</span></header><TrendLineChart rows={analytics.trend ?? []} scope={analytics.scope === "year" ? "year" : "month"} /></section>}
          </div>
        </>}

        {tab === "audit" && <><div className="admin-title"><div><p className="eyebrow">AUDIT TRAIL</p><h1>审计日志</h1><p>管理写操作与订单状态变化不可物理删除。</p></div><button className="ghost-button" onClick={loadAudits}>刷新</button></div><section className="admin-panel compact-table audit-table">{audits.map((log) => <div className="table-row" key={log.id}><span><b>{log.action}</b><small>{log.entity_type} · {log.entity_id.slice(0, 12)}</small></span><span>{log.actor_name}<small>{log.actor_type}</small></span><span>{log.reason || "—"}</span><time>{dateTime(log.created_at)}</time></div>)}</section></>}
      </main>
      {categoryFormOpen && <CategoryCreateDrawer defaultSortOrder={Math.min(9999, Math.max(10, ...categories.map((category) => Number(category.sort_order ?? 0))) + 10)} onClose={() => setCategoryFormOpen(false)} onSubmit={createCategory} />}
      {itemFormOpen && <ItemCreateDrawer categories={categories} defaultSortOrder={Math.min(9999, Math.max(10, ...items.map((item) => Number(item.sort_order ?? 0))) + 10)} onClose={() => setItemFormOpen(false)} onSubmit={createItem} />}
      <Toast message={message} onDismiss={dismissMessage} />
    </div>
  );
}

export function GrillApp() {
  const [mode, setMode] = useState<"customer" | "admin">("customer");
  const [customer, setCustomer] = useState<Json | null>(null);
  const [admin, setAdmin] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([api("/api/auth/me"), api("/api/admin/auth/me")]).then(([customerResult, adminResult]) => {
      if (customerResult.status === "fulfilled") setCustomer(customerResult.value.user);
      if (adminResult.status === "fulfilled") setAdmin(adminResult.value.admin);
      setLoading(false);
    });
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [mode]);

  if (loading) return <div className="launch-screen"><Brand /><div className="launch-line"><i /></div><p>炭火正在升温…</p></div>;
  return (
    <>
      <div className="mode-switch" aria-label="切换顾客端与管理端">
        <button aria-pressed={mode === "customer"} className={mode === "customer" ? "active" : ""} onClick={() => setMode("customer")}>顾客点餐</button>
        <button aria-pressed={mode === "admin"} className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")}>门店管理</button>
      </div>
      {mode === "customer"
        ? customer ? <CustomerApp user={customer} onLogout={() => setCustomer(null)} /> : <CustomerAuth onLogin={setCustomer} />
        : admin ? <AdminApp admin={admin} onLogout={() => setAdmin(null)} /> : <AdminLogin onLogin={setAdmin} />}
    </>
  );
}
