import { ensureDatabase } from "@/db/runtime";
import { rejectExpiredPendingOrders } from "@/lib/order-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error_code: "UNAUTHORIZED", message: "定时任务凭证无效。" }, { status: 401 });
  }
  const db = await ensureDatabase();
  const result = await rejectExpiredPendingOrders(db);
  return Response.json({ data: result });
}
