"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  cartLineKey,
  missingBalanceGroups,
  priceForSelection,
  selectionLabel,
} from "@/lib/menu-options.mjs";

type Json = Record<string, any>;

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
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
}

const money = (cent: number) => `¥${(Number(cent || 0) / 100).toFixed(2)}`;
const dateTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
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
      <span className="brand-mark">炭</span>
      <span><strong>炭火里</strong><small>GRILL & GOOD TIMES</small></span>
    </div>
  );
}

function Toast({ message, tone = "dark" }: { message: string; tone?: string }) {
  if (!message) return null;
  return <div className={`toast toast-${tone}`} role="status">{message}</div>;
}

function CustomerAuth({ onLogin }: { onLogin: (user: Json) => void }) {
  const [method, setMethod] = useState<"password" | "sms">("password");
  const [phone, setPhone] = useState("13800138000");
  const [password, setPassword] = useState("grill1234");
  const [code, setCode] = useState("9999");
  const [challengeId, setChallengeId] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [nickname, setNickname] = useState("炭火好友");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (registrationToken) {
        const data = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ phone, password, nickname, registrationToken }),
        });
        onLogin(data.user);
      } else if (method === "password") {
        const data = await api("/api/auth/password/login", {
          method: "POST",
          body: JSON.stringify({ phone, password }),
        });
        onLogin(data.user);
      } else {
        if (!challengeId) throw new Error("请先获取验证码");
        const data = await api("/api/auth/sms/login", {
          method: "POST",
          body: JSON.stringify({ phone, challengeId, code }),
        });
        if (data.need_register) {
          setRegistrationToken(data.registration_token);
          setMessage("手机号验证成功，请设置密码完成注册。");
        } else onLogin(data.user);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function requestCode() {
    setBusy(true);
    try {
      const data = await api("/api/auth/sms/request", { method: "POST", body: JSON.stringify({ phone }) });
      setChallengeId(data.challenge_id);
      setMessage("验证码已发送，测试码为 9999。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发送失败");
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
          <p className="eyebrow">{registrationToken ? "新客注册" : "欢迎回来"}</p>
          <h2>{registrationToken ? "设置你的登录密码" : "先登录，再开吃"}</h2>
        </div>
        {!registrationToken && (
          <div className="segmented">
            <button type="button" className={method === "password" ? "active" : ""} onClick={() => setMethod("password")}>密码登录</button>
            <button type="button" className={method === "sms" ? "active" : ""} onClick={() => setMethod("sms")}>验证码登录</button>
          </div>
        )}
        <label>手机号<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" /></label>
        {registrationToken && <label>昵称<input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={20} /></label>}
        {method === "password" || registrationToken ? (
          <label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="8–20 位，包含字母和数字" /></label>
        ) : (
          <label>验证码<span className="field-row"><input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={4} /><button type="button" className="ghost-button" onClick={requestCode} disabled={busy}>获取验证码</button></span></label>
        )}
        {message && <p className="form-message">{message}</p>}
        <button className="primary-button wide" disabled={busy}>{busy ? "请稍候…" : registrationToken ? "注册并进入菜单" : "登录并开始点餐"}</button>
        <p className="demo-tip">演示账号 13800138000 / grill1234 · Mock 验证码 9999</p>
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
  const cartTotal = cartLines.reduce((sum, line) => sum + (line.invalid ? 0 : line.price_cent * line.quantity), 0);
  const activeCategory = menu.categories.find((category: Json) => category.id === categoryId) ?? menu.categories[0];
  const missingGroups = missingBalanceGroups(cartLines);
  const selectedUnitPrice = selectedItem
    ? priceForSelection(selectedItem.price_cent, selectedItem.business_type, draftSelection)
    : 0;

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
    setQuote(null);
    window.setTimeout(() => setMessage(""), 1500);
  }

  function changeQuantity(lineKey: string, delta: number) {
    setCart((current) => {
      const next = { ...current };
      const quantity = (next[lineKey]?.quantity ?? 0) + delta;
      if (quantity <= 0) delete next[lineKey];
      else next[lineKey] = { ...next[lineKey], quantity: Math.min(99, quantity) };
      return next;
    });
    setQuote(null);
  }

  async function submitOrder(confirmQuote = false) {
    if (!cartLines.length) return;
    if (invalidCartLines.length) {
      setMessage("请先移除失效商品，再确认提交。");
      return;
    }
    const requestId = quote?.requestId ?? crypto.randomUUID();
    try {
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
      setCartOpen(false);
      setMessage(`订单 ${data.order.order_no} 已提交，等待商家确认`);
      await loadOrders();
      setTab("orders");
    } catch (error) {
      const apiError = error as Error & { code?: string; details?: Json };
      if (apiError.code === "CART_CHANGED" && apiError.details) {
        const next: Record<string, Json> = {};
        for (const line of apiError.details.items ?? []) {
          const key = line.line_key ?? cartLineKey(line.item_id, line.selection);
          const original = cart[key];
          if (original) {
            next[key] = {
              ...original,
              name: line.name ?? original.name,
              price_cent: line.unit_price_cent || original.price_cent,
              quantity: line.quantity,
              selection: line.selection ?? original.selection,
              selection_label: line.selection_label ?? original.selection_label,
              invalid: !line.available,
              invalidReason: line.reason,
            };
          }
        }
        setCart(next);
        setQuote({ token: apiError.details.quote_token, requestId });
      }
      setMessage(apiError.message);
    }
  }

  async function repeatLastOrder(order: Json) {
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
    setCart(next);
    setQuote(null);
    setTab("menu");
    setCartOpen(true);
    setMessage(skipped ? `已恢复上次订单，${skipped} 个不可售商品已跳过。` : "上次订单已放入购物车。");
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
        <nav>
          <button className={tab === "menu" ? "active" : ""} onClick={() => setTab("menu")}>今日菜单</button>
          <button className={tab === "orders" ? "active" : ""} onClick={() => { setTab("orders"); void loadOrders(); }}>我的订单</button>
          <button className={tab === "consumption" ? "active" : ""} onClick={() => setTab("consumption")}>消费记录</button>
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
              {menu.categories.map((category: Json) => <button key={category.id} className={activeCategory?.id === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)}>{category.name}<small>{category.items.length}</small></button>)}
            </div>
            <div className="item-grid">
              {searchedKeyword && !activeCategory && <div className="empty-state">没有找到“{searchedKeyword}”，换个关键词试试。</div>}
              {activeCategory?.items.map((item: Json, index: number) => (
                <article className={`menu-card color-${index % 5}`} key={item.id}>
                  <div className="food-visual"><span>{item.image_url || "🔥"}</span>{index === 0 && <b>人气</b>}</div>
                  <div className="food-copy">
                    <div><h3>{item.name}</h3><p>{item.description}</p></div>
                    <div className="attr-row">{Object.entries(item.attrs ?? {}).slice(0, 2).map(([key, value]) => <span key={key}>{String(value)}</span>)}</div>
                    <div className="monthly-sales">月售 <b>{item.monthly_sold ?? 0}</b></div>
                    <footer><strong>{money(item.price_cent)}{item.business_type === "BEER" && <small> 起</small>}</strong><button disabled={!item.sellable} onClick={() => openItem(item)} aria-label={`选择 ${item.name}`}>{item.sellable ? "选" : item.sale_label}</button></footer>
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
              <button className="primary-button" onClick={() => repeatLastOrder(orders[0])}>一键重订</button>
            </section>
          )}
          <div className="order-list">
            {orders.length === 0 && <div className="empty-state">还没有订单，去菜单挑点喜欢的吧。</div>}
            {orders.map((order) => (
              <article className="order-card" key={order.id}>
                <header><div><span className={`status status-${order.status}`}>{statusText[order.status]}</span><strong>{order.order_no}</strong></div><time>{dateTime(order.submitted_at)}</time></header>
                <div className="order-items">{order.items.map((item: Json) => <p className={item.fulfillment_status === "SOLD_OUT" ? "sold-out-line" : ""} key={item.id}><span>{item.name_snapshot}{item.selection_label ? ` · ${item.selection_label}` : ""} × {item.quantity}{item.fulfillment_status === "SOLD_OUT" && <em>售罄 · 已移除金额</em>}</span><b>{money(item.subtotal_cent)}</b></p>)}</div>
                <footer><span>{order.note || "无备注"}{order.removed_amount_cent > 0 && <small>已移除售罄商品 {money(order.removed_amount_cent)}</small>}</span><div><strong>{money(order.total_cent)}</strong>{order.status === "PENDING_CONFIRM" && <button className="outline-danger" onClick={() => cancel(order.id)}>撤回订单</button>}</div></footer>
              </article>
            ))}
          </div>
        </main>
      )}

      {tab === "consumption" && (
        <main className="content-page">
          <div className="page-title"><p className="eyebrow">MY TASTE</p><h1>消费记录</h1><p>这里只统计已确认、未作废的订单。</p></div>
          <div className="period-tabs">{["today", "week", "month", "year"].map((value) => <button key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{{ today: "今日", week: "本周", month: "本月", year: "本年" }[value]}</button>)}</div>
          <div className="metric-grid">
            <div><span>确认金额</span><strong>{money(consumption.summary?.amount_cent)}</strong><small>不代表已支付</small></div>
            <div><span>订单数</span><strong>{consumption.summary?.order_count ?? 0}</strong><small>已确认未作废</small></div>
            <div><span>平均客单</span><strong>{consumption.summary?.average_cent == null ? "—" : money(consumption.summary.average_cent)}</strong><small>按当前周期</small></div>
          </div>
          <div className="ledger">{consumption.items?.map((record: Json) => <div key={record.id}><span><b>{record.order_no}</b><small>{dateTime(record.confirmed_at_utc)}</small></span><strong>{money(record.confirmed_amount_cent)}</strong></div>)}</div>
        </main>
      )}

      <button className="cart-fab" onClick={() => setCartOpen(true)}><span>🛒</span><b>{cartCount || 0}</b><strong>{cartCount ? `${money(cartTotal)} · 去结算` : "购物车"}</strong></button>
      {cartOpen && (
        <div className="drawer-backdrop" onClick={() => setCartOpen(false)}>
          <aside className="cart-drawer" onClick={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">YOUR CART</p><h2>购物车</h2></div><button onClick={() => setCartOpen(false)}>×</button></header>
            <div className="cart-lines">
              {!cartLines.length && <div className="empty-state">还没选好吃的，去菜单逛逛。</div>}
              {cartLines.map((line) => <div className={`cart-line ${line.invalid ? "invalid" : ""}`} key={line.lineKey}><span className="cart-icon">{line.image_url}</span><div><strong>{line.name}</strong>{line.selection_label && <em>{line.selection_label}</em>}<small>{line.invalid ? `失效：${line.invalidReason}` : money(line.price_cent)}</small>{line.invalid && <button className="remove-invalid" onClick={() => changeQuantity(line.lineKey, -line.quantity)}>移除失效商品</button>}</div><div className="stepper"><button disabled={line.invalid} onClick={() => changeQuantity(line.lineKey, -1)}>−</button><b>{line.quantity}</b><button disabled={line.invalid} onClick={() => changeQuantity(line.lineKey, 1)}>+</button></div></div>)}
            </div>
            <label className="note-field">订单备注<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="例如：少辣、不要香菜" /></label>
            {!!cartLines.length && (
              <div className={`balance-tip ${missingGroups.length ? "" : "complete"}`}>
                <span>{missingGroups.length ? "搭配小提示" : "搭配很丰富"}</span>
                <p>{missingGroups.length ? `还可以加点${missingGroups.join("、")}，吃得更舒服。仅供参考，不影响下单。` : "荤素、主食和饮品都照顾到了，可以放心提交。"}</p>
              </div>
            )}
            {quote && <div className="quote-alert">菜单有变化，已为你更新购物车。请再次确认金额。</div>}
            <footer><div><span>合计（失效商品不计）</span><strong>{money(cartTotal)}</strong></div><button className="primary-button wide" disabled={!cartLines.length || invalidCartLines.length > 0} onClick={() => submitOrder(Boolean(quote))}>{invalidCartLines.length ? "请先移除失效商品" : quote ? "确认变更并提交" : "提交订单 · 门店确认"}</button></footer>
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
                    <button key={option.value} className={draftSelection[group.key] === option.value ? "active" : ""} onClick={() => setDraftSelection((current) => ({ ...current, [group.key]: option.value }))}>
                      <strong>{option.label}</strong>
                      {option.price_cent != null && <small>{money(option.price_cent)} · 每500ML {money(option.unit_price_per_500ml_cent)}</small>}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            {!selectedItem.option_groups?.length && <div className="simple-choice">这道菜无需选择口味，直接调整份数即可。</div>}
            <div className="option-quantity"><span>数量</span><div className="stepper large"><button onClick={() => setDraftQuantity((value) => Math.max(1, value - 1))}>−</button><b>{draftQuantity}</b><button onClick={() => setDraftQuantity((value) => Math.min(99, value + 1))}>+</button></div></div>
            <footer><div><span>小计</span><strong>{money(selectedUnitPrice * draftQuantity)}</strong></div><button className="primary-button" onClick={addSelectedItem}>加入购物车</button></footer>
          </section>
        </div>
      )}
      <Toast message={message} tone={quote ? "warm" : "dark"} />
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

function AdminApp({ admin, onLogout }: { admin: Json; onLogout: () => void }) {
  const [tab, setTab] = useState<"orders" | "menu" | "analytics" | "audit">("orders");
  const [orders, setOrders] = useState<Json[]>([]);
  const [categories, setCategories] = useState<Json[]>([]);
  const [items, setItems] = useState<Json[]>([]);
  const [analytics, setAnalytics] = useState<Json>({ summary: {}, top_items: [], trend: [] });
  const [audits, setAudits] = useState<Json[]>([]);
  const [period, setPeriod] = useState("today");
  const [message, setMessage] = useState("");
  const manager = admin.role === "MANAGER";

  const loadOrders = useCallback(async () => {
    const data = await api("/api/admin/orders?page_size=100");
    setOrders(data.items);
  }, []);
  const loadMenu = useCallback(async () => {
    const [categoryData, itemData] = await Promise.all([api("/api/admin/categories?page_size=100"), api("/api/admin/items?page_size=100")]);
    setCategories(categoryData.items);
    setItems(itemData.items);
  }, []);
  const loadAnalytics = useCallback(async () => {
    const data = await api(`/api/admin/analytics?period=${period}`);
    setAnalytics(data);
  }, [period]);
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
  useEffect(() => { if (tab === "analytics") void loadAnalytics(); }, [period, tab, loadAnalytics]);

  const pending = orders.filter((order) => order.status === "PENDING_CONFIRM");
  const todayConfirmed = orders.filter((order) => order.status === "CONFIRMED");

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
  async function addCategory() {
    const name = window.prompt("品类名称");
    const code = window.prompt("品类编码（英文/数字/下划线）");
    if (!name || !code) return;
    try { await api("/api/admin/categories", { method: "POST", body: JSON.stringify({ name, code, businessType: "FOOD" }) }); await loadMenu(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "新增失败"); }
  }
  async function addItem() {
    const categoryId = categories[0]?.id;
    const name = window.prompt("商品名称");
    const sku = window.prompt("SKU");
    const yuan = window.prompt("价格（元）", "18");
    if (!categoryId || !name || !sku || !yuan) return;
    try { await api("/api/admin/items", { method: "POST", body: JSON.stringify({ categoryId, name, sku, priceCent: Math.round(Number(yuan) * 100), description: "门店新上架商品" }) }); await loadMenu(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "新增失败"); }
  }
  async function logout() { await api("/api/admin/auth/logout", { method: "POST", body: "{}" }); onLogout(); }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand compact />
        <div className="store-open"><i />营业中<small>Asia/Shanghai</small></div>
        <nav>
          <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><span>▤</span>订单中心{pending.length > 0 && <b>{pending.length}</b>}</button>
          <button className={tab === "menu" ? "active" : ""} onClick={() => setTab("menu")}><span>◫</span>菜单管理</button>
          <button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}><span>↗</span>经营分析</button>
          {manager && <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><span>◎</span>审计日志</button>}
        </nav>
        <div className="admin-profile"><span>{admin.display_name.slice(0, 1)}</span><div><strong>{admin.display_name}</strong><small>{manager ? "店长" : "操作员"}</small></div><button onClick={logout}>退出</button></div>
      </aside>
      <main className="admin-main">
        {tab === "orders" && <>
          <div className="admin-title"><div><p className="eyebrow">ORDER DESK</p><h1>订单中心</h1><p>新订单每 3 秒自动刷新，先确认备注，再稳稳接单。</p></div><button className="ghost-button" onClick={loadOrders}>立即刷新</button></div>
          <div className="admin-metrics"><div><span>待处理</span><strong>{pending.length}</strong><small>需要关注</small></div><div><span>已确认</span><strong>{todayConfirmed.length}</strong><small>当前列表</small></div><div><span>订单总额</span><strong>{money(todayConfirmed.reduce((sum, order) => sum + order.total_cent, 0))}</strong><small>未扣作废</small></div></div>
          <section className="admin-panel"><header><h2>待确认订单</h2><span>{pending.length} 单等待处理</span></header>
            <div className="admin-order-grid">
              {pending.length === 0 && <div className="empty-state">所有订单都已处理，干得漂亮。</div>}
              {pending.map((order) => <article className="admin-order" key={order.id}><header><div><strong>{order.order_no}</strong><small>{order.nickname} · {order.phone_masked}</small></div><time>{dateTime(order.submitted_at)}</time></header><div>{order.items.map((item: Json) => <p className={item.fulfillment_status === "SOLD_OUT" ? "sold-out-line" : ""} key={item.id}><span>{item.name_snapshot}{item.selection_label ? ` · ${item.selection_label}` : ""} × {item.quantity}{item.fulfillment_status === "SOLD_OUT" && <em>售罄 · 已移除</em>}</span><b>{money(item.subtotal_cent)}</b></p>)}</div>{order.note && <blockquote>备注：{order.note}</blockquote>}{order.removed_amount_cent > 0 && <div className="sold-out-summary">售罄商品已移除 {money(order.removed_amount_cent)}</div>}<footer><strong>{money(order.total_cent)}</strong><span><button className="outline-danger" onClick={() => process(order, "reject")}>拒绝</button><button className="primary-button" disabled={order.total_cent <= 0} onClick={() => process(order, "confirm")}>{order.total_cent > 0 ? "确认接单" : "请拒绝"}</button></span></footer></article>)}
            </div>
          </section>
          <section className="admin-panel compact-table"><header><h2>近期订单</h2></header>{orders.filter((order) => order.status !== "PENDING_CONFIRM").slice(0, 12).map((order) => <div className="table-row" key={order.id}><span><b>{order.order_no}</b><small>{order.nickname} · {dateTime(order.submitted_at)}</small></span><span className={`status status-${order.status}`}>{statusText[order.status]}</span><strong>{money(order.total_cent)}</strong>{manager && order.status === "CONFIRMED" ? <button className="text-danger" onClick={() => process(order, "void")}>作废</button> : <i />}</div>)}</section>
        </>}

        {tab === "menu" && <>
          <div className="admin-title"><div><p className="eyebrow">MENU CONTROL</p><h1>菜单管理</h1><p>店长操作会写入审计日志，历史订单始终保留快照。</p></div>{manager && <span className="button-row"><button className="ghost-button" onClick={addCategory}>新增品类</button><button className="primary-button" onClick={addItem}>新增商品</button></span>}</div>
          <section className="admin-panel"><header><h2>品类</h2><span>{categories.length} 个品类</span></header><div className="category-admin-grid">{categories.map((category) => <div key={category.id}><span className="category-icon">{category.name.slice(0, 1)}</span><span><strong>{category.name}</strong><small>{category.code} · V{category.version}</small></span><button disabled={!manager} onClick={() => toggleCategory(category)} className={category.status === "ENABLED" ? "switch on" : "switch"}><i /></button></div>)}</div></section>
          <section className="admin-panel compact-table"><header><h2>商品</h2><span>{items.length} 道在库商品</span></header>{items.map((item) => <div className="table-row menu-row" key={item.id}><span className="table-food">{item.image_url}</span><span><b>{item.name}</b><small>{item.category_name} · {item.sku}</small></span><strong>{money(item.price_cent)}</strong><button disabled={!manager} className={item.sold_out ? "chip danger" : "chip"} onClick={() => toggleItem(item, "soldOut")}>{item.sold_out ? "已售罄" : "有库存"}</button><button disabled={!manager} className={item.status === "ACTIVE" ? "switch on" : "switch"} onClick={() => toggleItem(item, "status")}><i /></button></div>)}</section>
        </>}

        {tab === "analytics" && <>
          <div className="admin-title"><div><p className="eyebrow">BUSINESS PULSE</p><h1>经营分析</h1><p>{manager ? "确认金额、订单和热销贡献，以消费台账为唯一口径。" : "操作员仅可查看今日摘要。"}</p></div></div>
          {manager && <div className="period-tabs admin-period">{["today", "week", "month", "year"].map((value) => <button key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{{ today: "今日", week: "本周", month: "本月", year: "本年" }[value]}</button>)}</div>}
          <div className="admin-metrics large"><div><span>确认金额</span><strong>{money(analytics.summary?.amount_cent)}</strong><small>已确认未作废</small></div><div><span>订单数</span><strong>{analytics.summary?.order_count ?? 0}</strong><small>消费台账</small></div><div><span>平均客单</span><strong>{analytics.summary?.average_cent == null ? "—" : money(analytics.summary.average_cent)}</strong><small>按订单计算</small></div><div><span>活跃顾客</span><strong>{analytics.summary?.active_customers ?? 0}</strong><small>去重用户</small></div></div>
          <div className="analytics-grid"><section className="admin-panel"><header><h2>热销贡献</h2><span>按确认金额</span></header><div className="rank-list">{analytics.top_items?.map((item: Json, index: number) => <div key={item.item_id}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.name}</strong><small>{item.quantity} 份</small></span><em>{money(item.amount_cent)}</em></div>)}</div></section><section className="admin-panel"><header><h2>品类贡献</h2><span>金额占比</span></header><div className="contribution-list">{analytics.category_contribution?.map((category: Json) => <div key={category.category_id}><span><strong>{category.name}</strong><small>{money(category.amount_cent)}</small></span><div><i style={{ width: `${category.contribution_bps / 100}%` }} /></div><b>{(category.contribution_bps / 100).toFixed(1)}%</b></div>)}</div></section><section className="admin-panel"><header><h2>趋势明细</h2><span>{period === "today" ? "按小时" : period === "year" ? "按月" : "按营业日"} · 空桶补 0</span></header><div className="mini-bars">{analytics.trend?.map((bucket: Json) => <div key={bucket.bucket}><span><i style={{ height: `${Math.max(2, Math.min(100, bucket.amount_cent / Math.max(1, ...analytics.trend.map((row: Json) => row.amount_cent)) * 100))}%` }} /></span><small>{bucket.bucket.length > 5 ? bucket.bucket.slice(5) : bucket.bucket}</small></div>)}</div></section></div>
        </>}

        {tab === "audit" && <><div className="admin-title"><div><p className="eyebrow">AUDIT TRAIL</p><h1>审计日志</h1><p>管理写操作与订单状态变化不可物理删除。</p></div><button className="ghost-button" onClick={loadAudits}>刷新</button></div><section className="admin-panel compact-table audit-table">{audits.map((log) => <div className="table-row" key={log.id}><span><b>{log.action}</b><small>{log.entity_type} · {log.entity_id.slice(0, 12)}</small></span><span>{log.actor_name}<small>{log.actor_type}</small></span><span>{log.reason || "—"}</span><time>{dateTime(log.created_at)}</time></div>)}</section></>}
      </main>
      <Toast message={message} />
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

  if (loading) return <div className="launch-screen"><Brand /><div className="launch-line"><i /></div><p>炭火正在升温…</p></div>;
  return (
    <>
      <div className="mode-switch" aria-label="切换顾客端与管理端">
        <button className={mode === "customer" ? "active" : ""} onClick={() => setMode("customer")}>顾客点餐</button>
        <button className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")}>门店管理</button>
      </div>
      {mode === "customer"
        ? customer ? <CustomerApp user={customer} onLogout={() => setCustomer(null)} /> : <CustomerAuth onLogin={setCustomer} />
        : admin ? <AdminApp admin={admin} onLogout={() => setAdmin(null)} /> : <AdminLogin onLogin={setAdmin} />}
    </>
  );
}
