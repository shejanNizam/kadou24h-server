/* eslint-disable no-console -- a CLI test runner: printing results is its job */
/**
 * End-to-end test of the money, delivery and security flows against a real server.
 *
 *   npm run test:e2e
 *
 * Starts its own server on a THROWAWAY database (default kadou24h-e2e), runs the
 * whole journey over HTTP + sockets, prints PASS/FAIL per check, then drops the
 * database and stops the server. Needs a local MongoDB and Redis.
 *
 * Safety: only REDIS_* are read from .env. Every secret, the admin account and
 * the database are test values, so real data, email and uploads are never touched.
 * The database name must contain "e2e" or "test", or the run refuses to start.
 *
 * Options (env): E2E_DATABASE_URL, E2E_PORT, E2E_KEEP_DB=1 (skip the drop to inspect).
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { io } from "socket.io-client";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.E2E_PORT || 5055);
const DATABASE_URL = process.env.E2E_DATABASE_URL || "mongodb://127.0.0.1:27017/kadou24h-e2e";
const HOST = `http://localhost:${PORT}`;
const BASE = `${HOST}/api/v1`;
const SECRET = crypto.randomBytes(24).toString("hex");
const ADMIN = { email: "e2e-super@kadou24h.test", password: "E2eSuper@2026" };

const dbName = new URL(DATABASE_URL).pathname.slice(1);
if (!/e2e|test/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName}" is not a throwaway (name must contain "e2e" or "test").`);
  process.exit(1);
}

// Start from an empty database (a kept or crashed earlier run must not leak in)
await mongoose.connect(DATABASE_URL);
await mongoose.connection.dropDatabase();
await mongoose.disconnect();

// ── Server ───────────────────────────────────────────────────────────
const dotenv = fs.existsSync(path.join(ROOT, ".env"))
  ? parseEnv(fs.readFileSync(path.join(ROOT, ".env"), "utf8"))
  : {};
const redisEnv = Object.fromEntries(
  ["REDIS_HOST", "REDIS_PORT", "REDIS_USERNAME", "REDIS_PASSWORD"]
    .map((key) => [key, process.env[key] ?? dotenv[key]])
    .filter(([, value]) => value !== undefined),
);

let serverLog = "";
const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: "development",
    PORT: String(PORT),
    DATABASE_URL,
    JWT_ACCESS_SECRET: crypto.randomBytes(16).toString("hex"),
    JWT_ACCESS_EXPIRES: "1d",
    JWT_REFRESH_SECRET: crypto.randomBytes(16).toString("hex"),
    JWT_REFRESH_EXPIRES: "7d",
    JWT_RESET_SECRET: crypto.randomBytes(16).toString("hex"),
    BCRYPT_SALT_ROUND: "4",
    SUPER_ADMIN_EMAIL: ADMIN.email,
    SUPER_ADMIN_PASSWORD: ADMIN.password,
    ADMIN_EMAIL: "e2e-admin@kadou24h.test",
    ADMIN_PASSWORD: "E2eAdmin@2026",
    FRONTEND_URL: "*",
    PAYMENT_WEBHOOK_SECRET: SECRET,
    REDIS_HOST: "localhost",
    REDIS_PORT: "6379",
    ...redisEnv,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanup = async () => {
  server.kill();
  if (process.env.E2E_KEEP_DB) return console.log(`(kept database ${dbName})`);
  await mongoose.connect(DATABASE_URL);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

const results = [];
const finish = async (crash) => {
  console.log(results.join("\n"));
  if (crash) {
    console.log("\nCRASH:", crash?.stack ?? crash);
    console.log("\n── last server output ──\n" + serverLog.split("\n").slice(-30).join("\n"));
  }
  await cleanup().catch((error) => console.log("cleanup failed:", error.message));
  const passed = results.filter((line) => line.startsWith("PASS")).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(crash || passed !== results.length ? 1 : 0);
};
process.on("unhandledRejection", finish);

const waitForServer = async () => {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("server exited during start-up");
    try {
      await fetch(HOST);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error("server did not start within 60s");
};

// ── Helpers ──────────────────────────────────────────────────────────
// Each user calls from their own IP, like real phones — otherwise the whole run
// shares one IP and hits the global 200 requests / 15 min limit (trust proxy is on)
const ipFor = (token) => {
  const h = crypto.createHash("sha256").update(token ?? "anonymous").digest();
  return `10.${h[0]}.${h[1]}.${h[2]}`;
};
const call = async (method, url, body, token, headers = {}) => {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ipFor(token),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra ? "  — " + extra : ""}`);
const brief = (r) => `${r.status} ${r.body.message ?? ""} ${JSON.stringify(r.body.errorSources ?? "")}`.slice(0, 300);
const ok = (r) => r.status === 200 || r.status === 201;
const lastOtp = (to) =>
  serverLog.split("\n").filter((l) => l.includes(`[SMS:log] to ${to}`)).at(-1)?.match(/(?:est|is) (\d{6})/)?.[1];
const stamp = String(Date.now()).slice(-6);
const signup = async (name, phone) => {
  await call("POST", "/auth/register", { name, phone, password: "kadou2026" });
  const r = await call("POST", "/auth/verify-account", { phone, otp: lastOtp(phone) });
  return { token: r.body.data?.accessToken, id: r.body.data?.user?._id };
};
const webhook = (body, secret = SECRET) =>
  call("POST", "/payments/webhook", body, null, secret ? { "x-webhook-secret": secret } : {});
const wallet = async (token, mode) => (await call("GET", `/wallets/me?mode=${mode}`, null, token)).body.data;
// Notifications are sent in the background — give them a moment
const notificationTypes = async (token, mode) => {
  await sleep(400);
  const r = await call("GET", `/notifications?mode=${mode}&limit=100`, null, token);
  return (r.body.data ?? []).map((n) => n.type);
};
const stockOf = async (productId) => (await call("GET", `/products/${productId}`)).body.data?.product?.stockQty;

// ═════════════════════════════════════════════════════════════════════
const run = async () => {
  await waitForServer();

  // ── Setup: admin, categories, vendor + product, rider, customers ──
  let r = await call("POST", "/auth/login", { identifier: ADMIN.email, password: ADMIN.password });
  const admin = r.body.data?.accessToken;
  if (!admin) throw new Error(`admin login failed: ${brief(r)}`);
  r = await call("POST", "/categories", { name: { fr: "Magasin", en: "Store" }, type: "business" }, admin);
  const bizCat = r.body.data._id;
  r = await call("POST", "/categories", { name: { fr: "Épicerie", en: "Groceries" }, type: "product" }, admin);
  const prodCat = r.body.data._id;

  const V = await signup("Vendor Store", `+22462${stamp}1`);
  await call("PUT", "/vendors/me/application", {
    storeName: "TechHub", businessCategoryId: bizCat, businessPhone: "+224620000111",
    address: { text: "Kaloum", city: "Conakry", location: { lat: 9.51, lng: -13.71 } },
  }, V.token);
  await call("POST", "/wallets/me/payout-methods", { mode: "vendor", type: "orange_money", accountName: "Vendor Store", accountNumber: "+224620000111" }, V.token);
  r = await call("POST", "/vendors/me/application/submit", null, V.token);
  if (!r.body.data) throw new Error(`vendor submit failed: ${brief(r)}`);
  const vendorId = r.body.data._id;
  await call("PATCH", `/vendors/admin/${vendorId}/review`, { action: "approve" }, admin);
  r = await call("PATCH", "/vendors/me/availability", { isOpen: true }, V.token);
  check("vendor approved & open", r.status === 200, brief(r));
  check("vendor gets a 'profile approved' notification", (await notificationTypes(V.token, "vendor")).includes("profile_approved"));

  r = await call("POST", "/products", { name: "Rice 25kg", categoryId: prodCat, price: 100000, stockQty: 50 }, V.token);
  check("create product with a plain JSON body", ok(r), brief(r));
  const productId = r.body.data?._id;
  r = await call("GET", `/products/${productId}`);
  check("product details show no store phone (client rule)", r.body.data?.product?.vendorId?.businessPhone === undefined, JSON.stringify(r.body.data?.product?.vendorId));
  r = await call("PATCH", `/products/${productId}/approval`, { approvalStatus: "approved" }, admin);
  check("admin approves product", r.status === 200, brief(r));

  const R = await signup("Moto Rider", `+22462${stamp}2`);
  await call("PUT", "/riders/me/application", { partnerType: "moto", vehicle: { type: "motorbike" }, cityArea: "Kaloum", nationalIdNumber: "1234-5" }, R.token);
  r = await call("POST", "/riders/me/application/submit", null, R.token);
  const riderId = r.body.data._id;
  await call("PATCH", `/riders/admin/${riderId}/review`, { action: "approve" }, admin);
  r = await call("PATCH", "/deliveries/rider/online-status", { isOnline: true }, R.token);
  check("rider goes online (plain body)", r.status === 200, brief(r));
  await call("PATCH", "/deliveries/rider/location", { lat: 9.512, lng: -13.712 }, R.token);

  const C = await signup("Customer One", `+22462${stamp}3`);
  r = await call("POST", "/addresses", { fullName: "Customer One", phone: `+22462${stamp}3`, city: "Conakry", location: { lat: 9.53, lng: -13.68 } }, C.token);
  const addressId = r.body.data._id;
  const X = await signup("Stranger", `+22462${stamp}4`);
  const order = (items, extra = {}) =>
    call("POST", "/orders", { items, addressId, deliveryType: "local", paymentMethod: "cod", ...extra }, C.token);

  // Runs the whole delivery for one sub-order; returns the delivery id
  const deliver = async (subOrder, label) => {
    for (const status of ["accepted", "preparing", "ready_for_pickup"]) {
      const s = await call("PATCH", `/orders/vendor/sub-orders/${subOrder._id}/status`, { status }, V.token);
      if (s.status !== 200) check(`${label}: vendor ${status}`, false, brief(s));
    }
    const legId = String(subOrder.currentLegId);
    let a = await call("POST", `/deliveries/${legId}/assign`, { riderId }, V.token);
    check(`${label}: vendor assigns rider`, a.status === 200, brief(a));
    await call("POST", `/deliveries/${legId}/accept`, null, R.token);
    await call("POST", `/deliveries/${legId}/going-to-pickup`, null, R.token);
    const vt = await call("GET", `/deliveries/${legId}/track`, null, V.token);
    const ct = await call("GET", `/deliveries/${legId}/track`, null, C.token);
    const vendorDetail = (await call("GET", `/orders/vendor/sub-orders/${subOrder._id}`, null, V.token)).body.data;
    check(`${label}: vendor order detail carries the store's pickup PIN`, Boolean(vt.body.data?.pickupPin) && vendorDetail?.pickupPin === vt.body.data.pickupPin, JSON.stringify([vendorDetail?.pickupPin, vt.body.data?.pickupPin]));
    const custDetail = (await call("GET", `/orders/${subOrder.orderId}`, null, C.token)).body.data;
    const custSub = custDetail?.subOrders?.find((s) => String(s._id) === String(subOrder._id));
    check(`${label}: customer order detail carries the delivery PIN`, Boolean(ct.body.data?.handoverPin) && custSub?.deliveryPin === ct.body.data.handoverPin, JSON.stringify([custSub?.deliveryPin, ct.body.data?.handoverPin]));
    check(`${label}: PINs not crossed (vendor ≠ handover, customer ≠ pickup)`, vt.body.data.handoverPin === undefined && ct.body.data.pickupPin === undefined && vendorDetail.deliveryPin === undefined && custSub.pickupPin === undefined);
    a = await call("POST", `/deliveries/${legId}/verify-pickup`, { pin: vt.body.data?.pickupPin }, R.token);
    check(`${label}: pickup PIN accepted`, a.status === 200, brief(a));
    const afterPickup = (await call("GET", `/orders/vendor/sub-orders/${subOrder._id}`, null, V.token)).body.data;
    check(`${label}: pickup PIN gone from the vendor detail once used`, afterPickup?.pickupPin === undefined);
    const rt = await call("GET", `/deliveries/${legId}/track`, null, R.token);
    check(
      `${label}: rider never sees the PINs`,
      rt.status === 200 && rt.body.data.pickupPin === undefined && rt.body.data.handoverPin === undefined,
      brief(rt),
    );
    check(`${label}: customer tracking has no store phone`, ct.body.data?.fromPhone === undefined, String(ct.body.data?.fromPhone));
    const pin = ct.body.data?.handoverPin;
    const [h1, h2] = await Promise.all([
      call("POST", `/deliveries/${legId}/verify-handover`, { pin }, R.token),
      call("POST", `/deliveries/${legId}/verify-handover`, { pin }, R.token),
    ]);
    check(`${label}: handover PIN accepted exactly once (double tap)`, [h1, h2].filter((x) => x.status === 200).length === 1, `${brief(h1)} | ${brief(h2)}`);
    const doneDetail = (await call("GET", `/orders/${subOrder.orderId}`, null, C.token)).body.data;
    const doneSub = doneDetail?.subOrders?.find((s) => String(s._id) === String(subOrder._id));
    check(`${label}: delivery PIN gone once delivered, deliveredAt set`, doneSub && doneSub.deliveryPin === undefined && Boolean(doneSub.deliveredAt), JSON.stringify([doneSub?.deliveryPin, doneSub?.deliveredAt]));
    return legId;
  };

  // ═════ 1. COD: vendor paid only after the rider's cash is settled ═════
  r = await order([{ productId, qty: 2 }]);
  check("place COD order (plain body)", ok(r), brief(r));
  const codSub = r.body.data?.subOrders?.[0];
  const earning = codSub?.vendorEarning;
  let vw = await wallet(V.token, "vendor");
  check("escrow held at checkout", vw.heldBalance === earning && vw.availableBalance === 0, JSON.stringify(vw));
  check("vendor gets a 'new order' notification", (await notificationTypes(V.token, "vendor")).includes("order_placed"));

  r = await call("GET", `/deliveries/${codSub.currentLegId}/available-riders`, null, V.token);
  check(
    "available-riders list has no rider phone (client rule)",
    r.status === 200 && r.body.data.length > 0 && r.body.data.every((x) => x.phone === undefined),
    brief(r),
  );

  const legId = await deliver(codSub, "COD");
  const customerTypes = await notificationTypes(C.token, "customer");
  check(
    "customer notified: accepted, ready, on the way, delivered, review",
    ["order_accepted", "ready_for_pickup", "rider_on_the_way", "order_delivered", "feedback_request"].every((t) => customerTypes.includes(t)),
    JSON.stringify(customerTypes),
  );
  check("rider notified of the job and the cash to collect", (await notificationTypes(R.token, "rider")).includes("collect_payment"));

  r = await call("GET", `/orders/vendor/sub-orders/${codSub._id}`, null, V.token);
  check("COD delivered → settlement awaiting_cod", r.body.data?.subOrder?.settlement === "awaiting_cod", r.body.data?.subOrder?.settlement);
  vw = await wallet(V.token, "vendor");
  check("vendor NOT paid while rider holds the cash", vw.availableBalance === 0 && vw.heldBalance === earning, JSON.stringify([vw.heldBalance, vw.availableBalance]));
  let rw = await wallet(R.token, "rider");
  const cod = codSub.codAmountToCollect;
  check("rider owes the COD cash, fee credited once", rw.cashOwed === cod && rw.availableBalance === codSub.deliveryFee, JSON.stringify([rw.cashOwed, rw.availableBalance, cod]));
  // Earnings summary (app Earnings / Profile headers)
  r = await call("GET", "/wallets/me/summary?mode=vendor", null, V.token);
  let vs = r.body.data;
  const todayKey = new Date().toISOString().slice(0, 10);
  check(
    "summary (vendor): today = 1 delivered order, its earning",
    r.status === 200 && vs.today.count === 1 && vs.today.earnings === earning,
    JSON.stringify(vs?.today ?? brief(r)),
  );
  check(
    "summary (vendor): 7 daily buckets ending today",
    vs.series?.length === 7 && vs.series.at(-1).key === todayKey && vs.series.at(-1).earnings === earning && vs.period.earnings === earning,
    JSON.stringify(vs.series?.map((b) => b.key)),
  );
  check(
    "summary (vendor): COD money shown as 'awaiting rider cash', not escrow",
    vs.balances.awaitingCod === earning && vs.balances.inEscrow === 0 && vs.balances.withdrawable === 0,
    JSON.stringify(vs.balances),
  );
  r = await call("GET", "/wallets/me/summary?mode=rider&range=6m", null, R.token);
  const rs = r.body.data;
  check(
    "summary (rider): fee earned today, cash owed blocks withdrawal",
    r.status === 200 && rs.today.count === 1 && rs.today.earnings === codSub.deliveryFee &&
      rs.balances.cashOwed === codSub.codAmountToCollect &&
      rs.balances.withdrawable === Math.max(0, rs.balances.availableBalance - rs.balances.cashOwed) &&
      rs.balances.cashLimit > 0,
    JSON.stringify(rs?.balances ?? brief(r)),
  );
  check("summary (rider): 6 monthly buckets ending this month", rs.series?.length === 6 && rs.series.at(-1).key === todayKey.slice(0, 7), JSON.stringify(rs.series?.map((b) => b.key)));
  r = await call("GET", "/wallets/me/summary?mode=vendor&range=1y", null, V.token);
  check("summary: unknown range → 400", r.status === 400, brief(r));
  r = await call("GET", "/wallets/me/summary?mode=vendor", null, X.token);
  check("summary: a customer with no store gets zeros, not an error", r.status === 200 && r.body.data.today.count === 0 && r.body.data.counts.newOrders === 0, brief(r));

  r = await call("GET", "/riders/me", null, R.token);
  check("rider stats counted once, no active job left", r.body.data?.stats?.completed === 1 && r.body.data?.activeDeliveryCount === 0, JSON.stringify([r.body.data?.stats, r.body.data?.activeDeliveryCount]));

  r = await call("POST", "/wallets/me/cod-settlements", { amount: cod + 1, method: "orange_money" }, R.token);
  check("cannot declare more cash than owed", r.status === 400, brief(r));
  r = await call("POST", "/wallets/me/cod-settlements", { amount: cod, method: "orange_money", reference: "OM123" }, R.token);
  check("rider declares cash handover", r.status === 201 && r.body.data.status === "pending", brief(r));
  const settlementId = r.body.data._id;
  r = await call("POST", "/wallets/me/cod-settlements", { amount: 1, method: "orange_money" }, R.token);
  check("cannot declare the same cash twice", r.status === 400, brief(r));
  r = await call("PATCH", `/wallets/admin/cod-settlements/${settlementId}`, { status: "confirmed" }, admin);
  check("admin confirms → covered sub-order released", r.status === 200 && r.body.data.releasedSubOrders?.length === 1, brief(r));
  r = await call("PATCH", `/wallets/admin/cod-settlements/${settlementId}`, { status: "confirmed" }, admin);
  check("confirming twice is rejected", r.status === 400, brief(r));
  vw = await wallet(V.token, "vendor");
  check("vendor paid after settlement", vw.availableBalance === earning && vw.heldBalance === 0, JSON.stringify([vw.heldBalance, vw.availableBalance]));
  check("vendor gets an 'earnings updated' notification", (await notificationTypes(V.token, "vendor")).includes("earnings_updated"));
  rw = await wallet(R.token, "rider");
  check("rider cashOwed back to 0", rw.cashOwed === 0, String(rw.cashOwed));
  vs = (await call("GET", "/wallets/me/summary?mode=vendor", null, V.token)).body.data;
  check("summary (vendor): nothing awaiting rider cash after settlement", vs.balances.awaitingCod === 0 && vs.balances.withdrawable === earning, JSON.stringify(vs.balances));

  // ═════ 2. Withdrawal: two admins reject at once → refunded once ═════
  const payoutMethodId = vw.payoutMethods?.[0]?._id;
  r = await call("POST", "/wallets/me/withdrawals", { mode: "vendor", amount: 10000, payoutMethodId }, V.token);
  check("vendor requests a withdrawal", ok(r), brief(r));
  const withdrawalId = r.body.data?._id;
  const reject = () => call("PATCH", `/wallets/admin/withdrawals/${withdrawalId}`, { status: "rejected", rejectionReason: "Wrong number" }, admin);
  const rejects = await Promise.all([reject(), reject()]);
  check("concurrent rejects: only one succeeds", rejects.filter((x) => x.status === 200).length === 1, rejects.map(brief).join(" | "));
  vw = await wallet(V.token, "vendor");
  check("rejected withdrawal refunded exactly once", vw.availableBalance === earning, JSON.stringify([earning, vw.availableBalance]));
  check("vendor gets a 'withdrawal' notification", (await notificationTypes(V.token, "vendor")).includes("withdrawal_update"));

  // ═════ 3. Prepaid: the store gets it once paid, webhook security, vendor paid at delivery ═════
  const count = (types, type) => types.filter((x) => x === type).length;
  const heldBeforeOnline = (await wallet(V.token, "vendor")).heldBalance;
  const placedBefore = count(await notificationTypes(V.token, "vendor"), "order_placed");
  r = await order([{ productId, qty: 1 }], { paymentMethod: "orange_money" });
  const paidOrder = r.body.data.order;
  const paidSub = r.body.data.subOrders[0];
  check("online order waits for its payment (pending_payment + due time)", paidSub.status === "pending_payment" && Boolean(paidOrder.paymentDueAt), JSON.stringify([paidSub.status, paidOrder.paymentDueAt]));
  r = await call("GET", `/orders/vendor/sub-orders/${paidSub._id}`, null, V.token);
  check("unpaid: the store cannot open it", r.status === 404, brief(r));
  r = await call("GET", "/orders/vendor/sub-orders?limit=50", null, V.token);
  check("unpaid: not in the store's list", ok(r) && !(r.body.data ?? []).some((s) => s._id === paidSub._id), brief(r));
  r = await call("GET", "/orders/vendor/sub-orders?status=pending_payment", null, V.token);
  check("unpaid: the store cannot ask for that status", r.status === 400, brief(r));
  check("unpaid: no escrow held, no 'new order' notice", (await wallet(V.token, "vendor")).heldBalance === heldBeforeOnline && count(await notificationTypes(V.token, "vendor"), "order_placed") === placedBefore);
  r = await call("POST", "/conversations", { type: "order", subOrderId: paidSub._id }, C.token);
  check("unpaid: no chat with the store about it yet", r.status === 400, brief(r));
  r = await call("POST", "/payments/initiate", { purpose: "order", refId: paidOrder._id, method: "orange_money" }, C.token);
  check("payment starts pending", r.status === 201 && r.body.data.status === "pending", brief(r));
  const paymentId = r.body.data._id;
  r = await webhook({ paymentId, status: "success" }, null);
  check("webhook without secret → 401", r.status === 401, brief(r));
  r = await webhook({ paymentId, status: "success" }, "x".repeat(SECRET.length));
  check("webhook with wrong secret → 401", r.status === 401, brief(r));
  r = await webhook({ paymentId, status: "success", amount: paidOrder.total - 1 });
  check("webhook amount mismatch → 400", r.status === 400, brief(r));
  r = await call("POST", "/payments/initiate", { purpose: "order", refId: paidOrder._id, method: "orange_money" }, C.token);
  const paymentId2 = r.body.data._id;
  r = await webhook({ paymentId: paymentId2, status: "success", amount: paidOrder.total });
  check("valid webhook → paid", r.status === 200 && r.body.data.status === "success", brief(r));
  const paidSubNow = (await call("GET", `/orders/${paidOrder._id}`, null, C.token)).body.data?.subOrders?.[0];
  check("paid: the store receives it (new, delivery planned)", paidSubNow?.status === "new" && Boolean(paidSubNow?.currentLegId), JSON.stringify([paidSubNow?.status, paidSubNow?.currentLegId]));
  check("paid: escrow held now", (await wallet(V.token, "vendor")).heldBalance === heldBeforeOnline + paidSub.vendorEarning);
  check("paid: the store gets its 'new order' notice", count(await notificationTypes(V.token, "vendor"), "order_placed") === placedBefore + 1);
  r = await webhook({ paymentId: paymentId2, status: "success", amount: paidOrder.total });
  check("same webhook twice: nothing doubled", r.status === 200 && (await wallet(V.token, "vendor")).heldBalance === heldBeforeOnline + paidSub.vendorEarning);
  const before = (await wallet(V.token, "vendor")).availableBalance;
  await deliver(paidSubNow, "Prepaid");
  vw = await wallet(V.token, "vendor");
  check("prepaid: vendor paid at delivery", vw.availableBalance === before + paidSub.vendorEarning, JSON.stringify([before, vw.availableBalance]));
  r = await call("POST", `/orders/admin/sub-orders/${paidSub._id}/cancel`, { reason: "Too late to cancel" }, admin);
  check("admin cannot cancel a delivered sub-order (refund instead)", r.status === 400, brief(r));

  // ═════ 3b. Unpaid online order: cancelled when the payment window is over ═════
  const stockB = await stockOf(productId);
  const vendorCancelledBefore = count(await notificationTypes(V.token, "vendor"), "order_cancelled");
  const heldB = (await wallet(V.token, "vendor")).heldBalance;
  r = await order([{ productId, qty: 2 }], { paymentMethod: "mobile_money" });
  const lateOrder = r.body.data.order;
  check("online order reserves the stock", (await stockOf(productId)) === stockB - 2, JSON.stringify([stockB, await stockOf(productId)]));
  r = await call("POST", "/payments/initiate", { purpose: "order", refId: lateOrder._id, method: "mobile_money" }, C.token);
  const latePaymentId = r.body.data?._id;
  // Jump past the 30-minute window
  await mongoose.connect(DATABASE_URL);
  await mongoose.connection.collection("orders").updateOne({ _id: new mongoose.Types.ObjectId(lateOrder._id) }, { $set: { paymentDueAt: new Date(Date.now() - 1000) } });
  await mongoose.disconnect();
  r = await call("POST", "/payments/initiate", { purpose: "order", refId: lateOrder._id, method: "mobile_money" }, C.token);
  check("window over: no new payment", r.status === 400 && /time to pay/i.test(r.body.message ?? ""), brief(r));
  let expired;
  for (let i = 0; i < 80 && !expired; i++) {
    await sleep(1000);
    const d = (await call("GET", `/orders/${lateOrder._id}`, null, C.token)).body.data;
    if (d?.order?.status === "cancelled") expired = d;
  }
  check("window over: the sweep cancels it", expired?.subOrders?.[0]?.cancellation?.by === "system", JSON.stringify(expired?.subOrders?.[0]?.cancellation ?? "not cancelled after 80 s"));
  check("…stock released", (await stockOf(productId)) === stockB, JSON.stringify([stockB, await stockOf(productId)]));
  check("…no escrow movement for the store", (await wallet(V.token, "vendor")).heldBalance === heldB);
  r = await call("GET", "/cart", null, C.token);
  const cartLine = r.body.data?.groupedByVendor?.flatMap((g) => g.items).find((i) => i.productId === productId);
  check("…items back in the customer's cart", cartLine?.qty === 2, JSON.stringify(cartLine ?? r.body.data));
  check("…customer told", (await notificationTypes(C.token, "customer")).includes("order_cancelled"));
  check("…store never told (it never saw it)", count(await notificationTypes(V.token, "vendor"), "order_cancelled") === vendorCancelledBefore);
  r = await webhook({ paymentId: latePaymentId, status: "success", amount: lateOrder.total });
  check("late payment still recorded", r.status === 200, brief(r));
  r = await call("GET", "/payments/admin/refunds?limit=100", null, admin);
  const lateRefund = (r.body.data ?? []).find((x) => String(x.orderId?._id ?? x.orderId) === lateOrder._id);
  check("late payment → refund request for the admin", lateRefund?.status === "pending" && lateRefund?.amount === lateOrder.total, JSON.stringify(lateRefund ?? brief(r)));
  r = await call("GET", `/orders/${lateOrder._id}`, null, C.token);
  check("late payment does not revive the order", r.body.data?.order?.status === "cancelled" && r.body.data?.subOrders?.[0]?.status === "cancelled");
  await call("DELETE", "/cart", null, C.token);

  // ═════ 3c. Cash on delivery above the rider cash limit ═════
  const settingsNow = (await call("GET", "/settings", null, admin)).body.data;
  const summaryInput = { items: [{ productId, qty: 1 }], addressId, deliveryType: "local", paymentMethod: "cod" };
  r = await call("POST", "/orders/checkout-summary", summaryInput, C.token);
  check("checkout summary says COD is fine under the limit", r.body.data?.cod?.allowed === true && r.body.data?.cod?.limit === settingsNow.riderCashLimitDefault, JSON.stringify(r.body.data?.cod ?? brief(r)));
  await call("PATCH", "/settings", { riderCashLimitDefault: 50000 }, admin);
  r = await call("POST", "/orders/checkout-summary", summaryInput, C.token);
  check("above the limit: summary says COD not allowed", r.status === 200 && r.body.data?.cod?.allowed === false && r.body.data?.cod?.limit === 50000, JSON.stringify(r.body.data?.cod ?? brief(r)));
  const stockC = await stockOf(productId);
  r = await order([{ productId, qty: 1 }]);
  check("above the limit: COD order refused", r.status === 400 && /cash on delivery is not available/i.test(r.body.message ?? ""), brief(r));
  check("…nothing reserved", (await stockOf(productId)) === stockC);
  r = await order([{ productId, qty: 1 }], { paymentMethod: "card" });
  check("above the limit: online payment still works", ok(r), brief(r));
  if (ok(r)) await call("POST", `/orders/${r.body.data.order._id}/cancel`, { reason: "Cleanup run" }, C.token);
  check("customer can cancel an unpaid online order (stock back)", (await stockOf(productId)) === stockC);
  r = await call("PATCH", "/settings", { riderCashLimitDefault: settingsNow.riderCashLimitDefault }, admin);
  check("cash limit restored", r.status === 200, brief(r));

  // ═════ 4. Cancellations: stock and escrow restored exactly once ═════
  let stock = await stockOf(productId);
  r = await order([{ productId, qty: 1 }]);
  const cancelOrder = r.body.data.order;
  const heldBefore = (await wallet(V.token, "vendor")).heldBalance;
  r = await call("POST", `/orders/${cancelOrder._id}/cancel`, { reason: "Changed my mind" }, C.token);
  check("customer cancels (plain body)", r.status === 200, brief(r));
  vw = await wallet(V.token, "vendor");
  check("cancel reverses held escrow", vw.heldBalance === heldBefore - r.body.data?.subOrders?.[0]?.vendorEarning, JSON.stringify([heldBefore, vw.heldBalance]));
  check("cancel gives the stock back", (await stockOf(productId)) === stock, String(await stockOf(productId)));
  check("vendor told about the customer's cancel", (await notificationTypes(V.token, "vendor")).includes("order_cancelled"));

  stock = await stockOf(productId);
  r = await order([{ productId, qty: 2 }]);
  const raced = r.body.data;
  const both = await Promise.all([
    call("POST", `/orders/${raced.order._id}/cancel`, { reason: "Customer side" }, C.token),
    call("POST", `/orders/vendor/sub-orders/${raced.subOrders[0]._id}/cancel`, { reason: "Vendor side" }, V.token),
  ]);
  check("customer + vendor cancel at once: one wins", both.filter((x) => x.status === 200).length === 1, both.map(brief).join(" | "));
  check("…stock restored exactly once", (await stockOf(productId)) === stock, JSON.stringify([stock, await stockOf(productId)]));

  // ═════ 5. Concurrent orders: no lost wallet updates ═════
  const held0 = (await wallet(V.token, "vendor")).heldBalance;
  const burst = await Promise.all(Array.from({ length: 5 }, () => order([{ productId, qty: 1 }])));
  const heldExpected = held0 + burst.reduce((sum, x) => sum + (x.body.data?.subOrders?.[0]?.vendorEarning ?? 0), 0);
  vw = await wallet(V.token, "vendor");
  check("5 simultaneous orders: every escrow hold counted", burst.every(ok) && vw.heldBalance === heldExpected, JSON.stringify([heldExpected, vw.heldBalance]));
  for (const x of burst) await call("POST", `/orders/${x.body.data.order._id}/cancel`, { reason: "Cleanup run" }, C.token);

  // ═════ 5b. Become a worker: admin approval before customers see you ═════
  const file = (name) => ({ url: `https://example.com/${name}.jpg`, publicId: `e2e/${name}` });
  r = await call("POST", "/categories", { name: { fr: "Électricien", en: "Electrician" }, type: "service" }, admin);
  const serviceCat = r.body.data?._id;
  await call("PUT", "/professional-profiles/me", { profession: "Électricien", summary: "Court" }, C.token);
  r = await call("POST", "/professional-profiles/me/worker-application/submit", null, C.token);
  check("worker: incomplete profile cannot be sent (lists what is missing)", r.status === 400 && /idDocument/.test(r.body.message ?? "") && /photo/.test(r.body.message ?? ""), brief(r));
  r = await call("PUT", "/professional-profiles/me", {
    profession: "Électricien", summary: "Électricien avec 6 ans d'expérience, installations et dépannages à Conakry.",
    photo: file("worker-photo"), serviceCategoryId: serviceCat, experienceYears: 6, hourlyRate: 60000, city: "Conakry • Kipé",
    skills: ["Câblage"], workingHours: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" }, idDocument: file("worker-id"),
  }, C.token);
  check("worker: profile with working hours and ID saved", ok(r) && r.body.data?.workingHours?.from === "08:00" && Boolean(r.body.data?.idDocument), brief(r));
  r = await call("PUT", "/professional-profiles/me", { workingHours: { days: [1], from: "8h", to: "18:00" } }, C.token);
  check("worker: bad hours refused", r.status === 400, brief(r));
  r = await call("PATCH", "/professional-profiles/me/worker-listing", { isWorkerListed: true }, C.token);
  check("worker: cannot list myself before approval", r.status === 400, brief(r));
  r = await call("POST", "/professional-profiles/me/worker-application/submit", null, C.token);
  check("worker: sent for review (pending)", ok(r) && r.body.data?.approvalStatus === "pending", brief(r));
  const workerId = r.body.data?._id;
  r = await call("POST", "/professional-profiles/me/worker-application/submit", null, C.token);
  check("worker: cannot send twice", r.status === 409, brief(r));
  const publicIds = async () => ((await call("GET", "/professional-profiles/workers?limit=50")).body.data ?? []).map((w) => w._id);
  check("pending: not in the public list", !(await publicIds()).includes(workerId));
  r = await call("GET", `/professional-profiles/workers/${workerId}`);
  check("pending: public page 404", r.status === 404, brief(r));
  r = await call("POST", "/conversations", { type: "worker", workerProfileId: workerId }, X.token);
  check("pending: nobody can message the worker yet", r.status === 404, brief(r));
  r = await call("GET", "/professional-profiles/admin/workers?status=pending", null, C.token);
  check("admin list: customers refused", r.status === 403, brief(r));
  r = await call("GET", "/professional-profiles/admin/workers?status=pending", null, admin);
  check("admin list: the application with counts", ok(r) && r.body.data.some((w) => w._id === workerId) && r.body.meta?.counts?.pending >= 1 && r.body.data[0]?.userId?.phone !== undefined, brief(r));
  r = await call("GET", `/professional-profiles/admin/workers/${workerId}`, null, admin);
  check("admin detail: shows the ID document", ok(r) && r.body.data?.idDocument?.url === file("worker-id").url, brief(r));
  r = await call("PATCH", `/professional-profiles/admin/workers/${workerId}/review`, { action: "reject" }, admin);
  check("admin: reject needs a note", r.status === 400, brief(r));
  r = await call("PATCH", `/professional-profiles/admin/workers/${workerId}/review`, { action: "needs_changes", note: "Photo floue" }, admin);
  check("admin: request changes", ok(r) && r.body.data?.approvalStatus === "needs_changes", brief(r));
  r = await call("GET", "/professional-profiles/me/worker-summary", null, C.token);
  check("worker summary: status + note", r.body.data?.approvalStatus === "needs_changes" && r.body.data?.reviewNote === "Photo floue", brief(r));
  check("worker told about the review", (await notificationTypes(C.token, "customer")).includes("system_alert"));
  await call("PUT", "/professional-profiles/me", { photo: file("worker-photo-2") }, C.token);
  r = await call("POST", "/professional-profiles/me/worker-application/submit", null, C.token);
  check("worker: re-sent after changes", ok(r) && r.body.data?.approvalStatus === "pending", brief(r));
  r = await call("PATCH", `/professional-profiles/admin/workers/${workerId}/review`, { action: "approve" }, admin);
  check("admin: approve", ok(r) && r.body.data?.approvalStatus === "approved", brief(r));
  check("approved: in the public list", (await publicIds()).includes(workerId));
  r = await call("GET", `/professional-profiles/workers/${workerId}`);
  check("public worker page: no ID document, no CV files, no review data", ok(r) && r.body.data?.idDocument === undefined && r.body.data?.uploadedResume === undefined && r.body.data?.applicationHistory === undefined && r.body.data?.workingHours?.from === "08:00", brief(r));
  r = await call("GET", "/professional-profiles/workers?limit=50");
  check("public worker list: no ID document either", (r.body.data ?? []).every((w) => w.idDocument === undefined));
  check("worker told: approved", (await notificationTypes(C.token, "customer")).includes("profile_approved"));
  r = await call("POST", "/conversations", { type: "worker", workerProfileId: workerId }, X.token);
  const workerChat = r.body.data?._id;
  check("approved: a customer can message the worker", ok(r) && Boolean(workerChat), brief(r));
  await call("POST", `/conversations/${workerChat}/messages`, { text: "Bonjour, pouvez-vous venir demain ?" }, X.token);
  r = await call("GET", "/professional-profiles/me/worker-summary", null, C.token);
  check(
    "worker summary: the customer's message (count, unread, latest)",
    r.body.data?.messages?.conversations === 1 && r.body.data?.messages?.unread >= 1 && r.body.data?.recent?.[0]?.peer?.name === "Stranger" && r.body.data?.recent?.[0]?.peer?.phone === undefined,
    JSON.stringify(r.body.data?.messages ?? brief(r)),
  );
  r = await call("PUT", "/professional-profiles/me", { idDocument: file("worker-id-new") }, C.token);
  check("new ID document → back to review, hidden meanwhile", r.body.data?.approvalStatus === "pending" && !(await publicIds()).includes(workerId), brief(r));
  await call("PATCH", `/professional-profiles/admin/workers/${workerId}/review`, { action: "approve" }, admin);
  r = await call("PATCH", `/professional-profiles/admin/workers/${workerId}/review`, { action: "suspend", note: "Plaintes clients" }, admin);
  check("admin: suspend hides the worker", ok(r) && !(await publicIds()).includes(workerId), brief(r));
  r = await call("POST", "/professional-profiles/me/worker-application/submit", null, C.token);
  check("suspended worker cannot re-send", r.status === 409, brief(r));
  r = await call("PATCH", `/professional-profiles/admin/workers/${workerId}/review`, { action: "reinstate" }, admin);
  check("admin: reinstate shows it again", ok(r) && (await publicIds()).includes(workerId), brief(r));

  // ═════ 5c. Worker bookings: request → accept → done → confirm → review; penalties; paid visibility ═════
  const K = await signup("Kadi Booker", `+22462${stamp}6`);
  const L = await signup("Lamine Client", `+22462${stamp}7`);
  for (const [u, name, n] of [[K, "Kadi Booker", 6], [L, "Lamine Client", 7]]) {
    await call("POST", "/addresses", { fullName: name, phone: `+22462${stamp}${n}`, city: "Conakry", commune: "Ratoma", neighborhood: "Kipé", landmark: "Près de la mosquée", location: { lat: 9.6, lng: -13.6 } }, u.token);
  }
  const at = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();
  const job = "Installer trois prises et un interrupteur dans le salon.";
  const book = (token, extra = {}) => call("POST", "/bookings", { workerProfileId: workerId, scheduledAt: at(26), description: job, ...extra }, token);
  const db = async (task) => {
    await mongoose.connect(DATABASE_URL);
    try {
      return await task(mongoose.connection);
    } finally {
      await mongoose.disconnect();
    }
  };
  const oid = (id) => new mongoose.Types.ObjectId(id);

  r = await call("GET", "/professional-profiles/me/worker-summary", null, C.token);
  const trialDays = Math.round((new Date(r.body.data?.listing?.listedUntil).getTime() - Date.now()) / 86_400_000);
  check("visibility: the first approval gives 30 free days", r.body.data?.isVisible === true && r.body.data?.listing?.trialUsed === true && trialDays >= 29 && trialDays <= 30, JSON.stringify(r.body.data?.listing ?? brief(r)));
  r = await call("GET", `/professional-profiles/workers/${workerId}`);
  check("public worker page: no visibility date or penalties", ok(r) && r.body.data?.listedUntil === undefined && r.body.data?.bookingPenalty === undefined, brief(r));

  r = await book(K.token, { scheduledAt: at(0.1) });
  check("booking: less than 30 min ahead refused", r.status === 400, brief(r));
  r = await book(K.token, { description: "Court" });
  check("booking: a description is required", r.status === 400, brief(r));
  r = await book(C.token);
  check("booking: a worker cannot book themselves", r.status === 400 && /yourself/i.test(r.body.message ?? ""), brief(r));
  r = await book(K.token);
  const bk1 = r.body.data;
  const respondHours = (new Date(bk1?.respondBy).getTime() - Date.now()) / 3_600_000;
  check("booking: request sent (BK number, answer within 24 h)", r.status === 201 && bk1?.status === "requested" && /^BK\d+/.test(bk1?.bookingNumber ?? "") && respondHours > 23 && respondHours <= 24, brief(r));
  r = await book(K.token);
  check("booking: only one open booking per worker", r.status === 409, brief(r));
  r = await call("GET", `/bookings/${bk1?._id}`, null, X.token);
  check("booking: a stranger cannot see it", r.status === 404, brief(r));
  r = await call("GET", `/bookings/${bk1?._id}`, null, C.token);
  check(
    "booking: before accepting, the worker sees the area only (no phone, landmark or map point)",
    r.body.data?.role === "worker" && r.body.data?.address?.neighborhood === "Kipé" && r.body.data?.address?.landmark === undefined && r.body.data?.address?.phone === undefined && r.body.data?.address?.location === undefined && r.body.data?.customer?.phone === undefined,
    JSON.stringify(r.body.data?.address ?? brief(r)),
  );
  r = await call("GET", "/bookings?as=worker&status=requested", null, C.token);
  check("worker: the request is in my list", r.body.data?.some((b) => b._id === bk1?._id) && r.body.meta?.counts?.requested === 1, brief(r));
  check("worker told about the request", (await notificationTypes(C.token, "customer")).includes("booking_update"));
  r = await call("PATCH", `/bookings/${bk1?._id}/accept`, null, K.token);
  check("booking: the customer cannot accept", r.status === 404, brief(r));
  r = await call("PATCH", `/bookings/${bk1?._id}/accept`, null, C.token);
  check("booking: the worker accepts", ok(r) && r.body.data?.status === "accepted", brief(r));
  check("…then sees the full address and the customer's phone", r.body.data?.address?.landmark === "Près de la mosquée" && r.body.data?.customer?.phone === `+22462${stamp}6`, JSON.stringify(r.body.data?.customer));
  r = await call("GET", `/bookings/${bk1?._id}`, null, K.token);
  check("…and the customer sees the worker's phone", r.body.data?.role === "customer" && r.body.data?.worker?.phone === `+22462${stamp}3` && r.body.data?.worker?.profileId === workerId, JSON.stringify(r.body.data?.worker));
  check("customer told: accepted", (await notificationTypes(K.token, "customer")).includes("booking_update"));
  r = await call("POST", "/conversations", { type: "worker", bookingId: bk1?._id }, C.token);
  check("booking chat: the worker can write to the customer", ok(r) && Boolean(r.body.data?._id), brief(r));
  r = await call("POST", "/conversations", { type: "worker", bookingId: bk1?._id }, X.token);
  check("booking chat: a stranger cannot", r.status === 403, brief(r));
  r = await call("POST", `/bookings/${bk1?._id}/review`, { rating: 5 }, K.token);
  check("review: not before the job is completed", r.status === 400, brief(r));
  r = await call("PATCH", `/bookings/${bk1?._id}/done`, { agreedPrice: 150000 }, K.token);
  check("booking: only the worker marks it done", r.status === 404, brief(r));
  r = await call("PATCH", `/bookings/${bk1?._id}/done`, { agreedPrice: 150000 }, C.token);
  const confirmHours = (new Date(r.body.data?.confirmBy).getTime() - Date.now()) / 3_600_000;
  check("booking: worker marks it done (customer confirms within 48 h)", ok(r) && r.body.data?.status === "done" && confirmHours > 47 && confirmHours <= 48, brief(r));
  r = await call("PATCH", `/bookings/${bk1?._id}/cancel`, { reason: "Trop tard" }, K.token);
  check("booking: a finished job cannot be cancelled", r.status === 400, brief(r));
  r = await call("PATCH", `/bookings/${bk1?._id}/not-done`, { note: "Il manque l'interrupteur" }, K.token);
  check("booking: customer says it is not finished → back to accepted", ok(r) && r.body.data?.status === "accepted" && r.body.data?.confirmBy === undefined, brief(r));
  await call("PATCH", `/bookings/${bk1?._id}/done`, { agreedPrice: 150000 }, C.token);
  r = await call("PATCH", `/bookings/${bk1?._id}/confirm`, null, K.token);
  check("booking: customer confirms → completed", ok(r) && r.body.data?.status === "completed" && r.body.data?.canReview === true, brief(r));
  r = await call("POST", `/bookings/${bk1?._id}/review`, { rating: 5, comment: "Travail propre et rapide", photos: [file("work-done")] }, K.token);
  check("review: 5 stars, comment and a photo of the work", r.status === 201 && r.body.data?.photos?.length === 1, brief(r));
  r = await call("POST", `/bookings/${bk1?._id}/review`, { rating: 1 }, K.token);
  check("review: only once per booking", r.status === 409, brief(r));
  r = await call("GET", `/professional-profiles/workers/${workerId}/reviews`);
  check("public reviews: the review with its photo, author name only", r.body.meta?.total === 1 && r.body.meta?.stars?.["5"] === 1 && r.body.data?.[0]?.photos?.length === 1 && r.body.data?.[0]?.authorId?.name === "Kadi Booker" && r.body.data?.[0]?.authorId?.phone === undefined, brief(r));
  r = await call("GET", `/professional-profiles/workers/${workerId}`);
  check("worker rating updated from the review", r.body.data?.ratingAvg === 5 && r.body.data?.ratingCount === 1, JSON.stringify([r.body.data?.ratingAvg, r.body.data?.ratingCount]));
  r = await call("GET", "/professional-profiles/me/worker-summary", null, C.token);
  check("worker summary: completed jobs and estimated earnings", r.body.data?.bookings?.completed === 1 && r.body.data?.earnings?.total === 150000 && r.body.data?.earnings?.thisMonth === 150000, JSON.stringify([r.body.data?.bookings, r.body.data?.earnings]));

  // Decline, unanswered request, unconfirmed job
  r = await book(K.token);
  r = await call("PATCH", `/bookings/${r.body.data?._id}/decline`, { reason: "Pas disponible ce jour-là" }, C.token);
  check("booking: the worker declines (never a penalty)", ok(r) && r.body.data?.status === "declined" && r.body.data?.declineReason === "Pas disponible ce jour-là", brief(r));
  r = await book(L.token);
  const bkLate = r.body.data?._id;
  r = await book(K.token);
  const bkAuto = r.body.data?._id;
  await call("PATCH", `/bookings/${bkAuto}/accept`, null, C.token);
  await call("PATCH", `/bookings/${bkAuto}/done`, null, C.token);
  await db((c) =>
    Promise.all([
      c.collection("bookings").updateOne({ _id: oid(bkLate) }, { $set: { respondBy: new Date(Date.now() - 1000) } }),
      c.collection("bookings").updateOne({ _id: oid(bkAuto) }, { $set: { confirmBy: new Date(Date.now() - 1000) } }),
    ]),
  );
  r = await call("PATCH", `/bookings/${bkLate}/accept`, null, C.token);
  check("booking: an expired request cannot be accepted", r.status === 400 && /expired/i.test(r.body.message ?? ""), brief(r));
  let autoDone;
  for (let i = 0; i < 80 && !autoDone; i++) {
    await sleep(1000);
    const d = (await call("GET", `/bookings/${bkAuto}`, null, K.token)).body.data;
    if (d?.status === "completed") autoDone = d;
  }
  check("sweep: a job not confirmed in 48 h completes by itself", autoDone?.completedBy === "system", JSON.stringify(autoDone?.status ?? "not completed after 80 s"));
  r = await call("GET", `/bookings/${bkLate}`, null, L.token);
  check("…and the unanswered request expired", r.body.data?.status === "expired", brief(r));
  r = await call("GET", "/bookings/me/standing", null, K.token);
  check("declines and expiries never count against anyone", r.body.data?.customer?.strikes30d === 0, brief(r));

  // Customer cancels before acceptance: free
  r = await book(K.token);
  r = await call("PATCH", `/bookings/${r.body.data?._id}/cancel`, null, K.token);
  check("customer cancels before acceptance: no penalty", ok(r) && r.body.data?.booking?.status === "cancelled" && r.body.data?.penalty === null, brief(r));

  // Worker cancels after acceptance: warning → 15 days less visible → 7-day suspension
  const acceptedFor = async (u) => {
    const b = (await book(u.token)).body.data?._id;
    await call("PATCH", `/bookings/${b}/accept`, null, C.token);
    return b;
  };
  let b = await acceptedFor(K);
  r = await call("PATCH", `/bookings/${b}/cancel`, {}, C.token);
  check("cancel after acceptance needs a reason", r.status === 400, brief(r));
  r = await call("PATCH", `/bookings/${b}/cancel`, { reason: "Urgence familiale" }, C.token);
  check("worker 1st cancellation: a warning", ok(r) && r.body.data?.penalty?.penalty === "warning" && r.body.data?.penalty?.tier === 1, JSON.stringify(r.body.data?.penalty ?? brief(r)));
  b = await acceptedFor(L);
  r = await call("PATCH", `/bookings/${b}/cancel`, { reason: "Malade" }, C.token);
  const lessDays = Math.round((new Date(r.body.data?.penalty?.lessVisibleUntil).getTime() - Date.now()) / 86_400_000);
  check("worker 2nd cancellation: less visible for 15 days", r.body.data?.penalty?.penalty === "less_visible" && lessDays === 15, JSON.stringify(r.body.data?.penalty ?? brief(r)));
  check("…still listed (just lower)", (await publicIds()).includes(workerId));
  const pendingL = (await book(L.token)).body.data?._id;
  b = await acceptedFor(K);
  r = await call("PATCH", `/bookings/${b}/cancel`, { reason: "Pas de transport" }, C.token);
  check("worker 3rd cancellation: suspended 7 days, then one booking at a time", r.body.data?.penalty?.penalty === "suspension" && Boolean(r.body.data?.penalty?.suspendedUntil) && Boolean(r.body.data?.penalty?.limitedUntil), JSON.stringify(r.body.data?.penalty ?? brief(r)));
  check("suspended: hidden from customers", !(await publicIds()).includes(workerId));
  r = await book(X.token);
  check("suspended: no new bookings", r.status === 404, brief(r));
  r = await call("PATCH", `/bookings/${pendingL}/accept`, null, C.token);
  check("suspended: cannot accept a waiting request", r.status === 403 && /suspended/i.test(r.body.message ?? ""), brief(r));
  r = await call("GET", "/professional-profiles/me/worker-summary", null, C.token);
  check("worker summary: the penalty and the 3 counted cancellations", Boolean(r.body.data?.penalty?.suspendedUntil) && r.body.data?.penalty?.strikes?.length === 3 && r.body.data?.isVisible === false, JSON.stringify(r.body.data?.penalty ?? brief(r)));

  // Admin
  r = await call("GET", "/bookings/admin/penalties?role=worker&active=true", null, C.token);
  check("admin penalties: customers refused", r.status === 403, brief(r));
  r = await call("GET", "/bookings/admin/penalties?role=worker&active=true", null, admin);
  const severe = r.body.data?.find((s) => s.penalty === "suspension");
  check("admin penalties: the worker's 3 strikes with the booking", r.body.meta?.total === 3 && severe?.userId?.name === "Customer One" && /^BK/.test(severe?.bookingId?.bookingNumber ?? ""), brief(r));
  r = await call("PATCH", `/bookings/admin/penalties/${severe?._id}`, { action: "soften", note: "Première fois" }, admin);
  check("admin softens the suspension → 30 days less visible", ok(r) && r.body.data?.penalty === "less_visible" && r.body.data?.suspendedUntil === undefined, brief(r));
  check("…visible again", (await publicIds()).includes(workerId));
  r = await call("PATCH", `/bookings/${pendingL}/accept`, null, C.token);
  check("…and can accept again", ok(r) && r.body.data?.status === "accepted", brief(r));
  r = await call("PATCH", `/bookings/admin/penalties/${severe?._id}`, { action: "lift" }, admin);
  check("admin lifts it", ok(r) && Boolean(r.body.data?.liftedAt), brief(r));
  r = await call("PATCH", `/bookings/admin/penalties/${severe?._id}`, { action: "lift" }, admin);
  check("admin: a lifted penalty cannot be lifted twice", r.status === 400, brief(r));
  check("worker told about the change", (await notificationTypes(C.token, "customer")).filter((t) => t === "booking_update").length >= 5);
  r = await call("GET", "/bookings/admin?status=accepted", null, admin);
  check("admin bookings: list with counts and contacts", ok(r) && r.body.data?.some((x) => x._id === pendingL && x.customer?.phone === `+22462${stamp}7`) && r.body.meta?.counts?.completed >= 2, brief(r));
  r = await call("PATCH", `/bookings/admin/${pendingL}/cancel`, { reason: "Litige signalé" }, admin);
  check("admin cancels a booking: no penalty for anyone", ok(r) && r.body.data?.status === "cancelled" && r.body.data?.strikes?.length === 0, brief(r));

  // Customer cancels after acceptance 3 times → one booking at a time
  for (let i = 1; i <= 3; i++) {
    b = await acceptedFor(K);
    r = await call("PATCH", `/bookings/${b}/cancel`, { reason: "Plus besoin" }, K.token);
  }
  check("customer 3rd cancellation: one booking at a time for 30 days", r.body.data?.penalty?.penalty === "limited" && Boolean(r.body.data?.penalty?.limitedUntil), JSON.stringify(r.body.data?.penalty ?? brief(r)));
  r = await call("GET", "/bookings/me/standing", null, K.token);
  check("customer standing: 3 cancellations, limited", r.body.data?.customer?.strikes30d === 3 && Boolean(r.body.data?.customer?.limitedUntil), brief(r));
  r = await book(K.token);
  check("limited customer: a first booking is fine", r.status === 201, brief(r));
  r = await book(K.token);
  check("limited customer: a second one is refused", r.status === 400 && /one at a time/i.test(r.body.message ?? ""), brief(r));

  // Paid visibility: when the period ends the worker is hidden; a service-provider plan brings them back
  await db((c) => c.collection("professionalprofiles").updateOne({ _id: oid(workerId) }, { $set: { listedUntil: new Date(Date.now() - 1000) } }));
  check("visibility over: hidden from customers", !(await publicIds()).includes(workerId));
  r = await call("POST", "/conversations", { type: "worker", workerProfileId: workerId }, L.token);
  check("visibility over: no new chats from the worker page", r.status === 404, brief(r));
  r = await call("POST", "/subscriptions/admin/plans", { name: "Travailleur 30 jours", audience: "service_provider", price: 20000, durationDays: 30, features: [], highlights: ["Visible par les clients"] }, admin);
  r = await call("POST", "/subscriptions/subscribe", { planId: r.body.data?._id, paymentMethod: "orange_money" }, C.token);
  await webhook({ paymentId: r.body.data?.payment?._id, status: "success" });
  r = await call("GET", "/professional-profiles/me/worker-summary", null, C.token);
  const paidDays = Math.round((new Date(r.body.data?.listing?.listedUntil).getTime() - Date.now()) / 86_400_000);
  check("service-provider plan paid: visible again for its 30 days", r.body.data?.isVisible === true && paidDays === 30 && (await publicIds()).includes(workerId), JSON.stringify(r.body.data?.listing ?? brief(r)));
  // ═════ 6. Access control ═════
  r = await call("GET", `/deliveries/${legId}/track`, null, X.token);
  check("stranger cannot track a delivery", r.status === 403, brief(r));

  // ═════ 7. Sockets ═════
  const connect = (token) => new Promise((resolve) => {
    const s = io(HOST, { auth: { token }, transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve({ s, ok: true }));
    s.on("connect_error", (e) => resolve({ s, ok: false, err: e.message }));
  });
  const xs = await connect(X.token);
  check("socket connects with valid token", xs.ok, xs.err);
  let denied = null;
  xs.s.on("error_message", (m) => (denied = m.event));
  xs.s.emit("join_delivery", legId);
  await sleep(600);
  check("stranger cannot join a delivery room", denied === "join_delivery", String(denied));
  const cs = await connect(C.token);
  let spoofed = false;
  cs.s.on("rider:location_updated", () => (spoofed = true));
  cs.s.emit("join_delivery", legId);
  await sleep(400);
  xs.s.emit("rider_location", { deliveryId: legId, lat: 0, lng: 0 });
  await sleep(600);
  check("stranger cannot broadcast a fake rider location", spoofed === false);
  let kicked = false;
  xs.s.on("disconnect", () => (kicked = true));
  await call("POST", "/auth/logout-all", null, X.token);
  await sleep(800);
  check("logout-all disconnects live sockets", kicked);
  const again = await connect(X.token);
  check("revoked token cannot reconnect", !again.ok, again.err);
  [xs, cs, again].forEach((c) => c.s.close());

  // ═════ 8. Jobs: spontaneous applications & CV paywall ═════
  r = await call("POST", "/jobs/apply-spontaneous", { targetVendorId: vendorId, coverNote: "Hello", paymentMethod: "orange_money" }, C.token);
  check("spontaneous application created (pending payment)", ok(r), brief(r));
  const appPayment = r.body.data?.payment?._id;
  r = await call("GET", "/jobs/applications/received", null, V.token);
  check("vendor does NOT see it before payment", r.status === 200 && r.body.data.length === 0, brief(r));
  await webhook({ paymentId: appPayment, status: "success" });
  r = await call("GET", "/jobs/applications/received", null, V.token);
  const app = r.body.data?.[0];
  check("vendor sees it after payment", r.body.data?.length === 1, brief(r));
  check("vendor gets an 'application' notification", (await notificationTypes(V.token, "vendor")).includes("application_update"));
  check("contact hidden before CV unlock", app && app.applicant.phone === undefined && app.isCvUnlocked === false, JSON.stringify(app?.applicant));
  r = await call("POST", `/jobs/candidates/${X.id}/unlock-cv`, { paymentMethod: "orange_money" }, V.token);
  check("cannot unlock a candidate who never applied", r.status === 403, brief(r));
  r = await call("POST", `/jobs/candidates/${C.id}/unlock-cv`, { paymentMethod: "orange_money" }, V.token);
  const unlockPayment = r.body.data?.payment?._id;
  check("CV unlock costs settings.cvUnlockFee (5000)", r.body.data?.payment?.amount === 5000, brief(r));
  await webhook({ paymentId: unlockPayment, status: "success" });
  r = await call("GET", "/jobs/applications/received", null, V.token);
  check("contact visible after CV unlock", r.body.data?.[0]?.applicant?.phone === `+22462${stamp}3` && r.body.data[0].isCvUnlocked, JSON.stringify(r.body.data?.[0]?.applicant));
  // X's earlier session was revoked by logout-all — sign in again
  r = await call("POST", "/auth/login", { identifier: `+22462${stamp}4`, password: "kadou2026" });
  const xToken = r.body.data.accessToken;
  r = await call("PATCH", `/jobs/applications/${app._id}/status`, { status: "rejected" }, xToken);
  check("stranger cannot change someone's application", r.status === 403, brief(r));

  // ═════ 9. Worker directory & pagination ═════
  r = await call("GET", "/professional-profiles/workers?limit=5");
  check("worker directory is public & has no phone/email", r.status === 200 && JSON.stringify(r.body.data).includes('"phone"') === false, brief(r));
  r = await call("GET", "/orders/my-orders?limit=2", null, C.token);
  check("pagination meta has totalPage (+ totalPages alias)", r.body.meta?.totalPage >= 1 && r.body.meta?.totalPages === r.body.meta?.totalPage, JSON.stringify(r.body.meta));
  r = await call("GET", "/notifications?limit=1", null, C.token);
  check("extra meta fields (unreadCount) are kept", r.body.meta && "unreadCount" in r.body.meta, JSON.stringify(r.body.meta));

  // ═════ 10. Intercity relay: PINs reach the bus driver at the stations ═════
  r = await call("POST", "/transit-stations", { name: "Gare Madina", city: "Conakry", location: { lat: 9.515, lng: -13.705 } }, admin);
  const stA = r.body.data._id;
  r = await call("POST", "/transit-stations", { name: "Gare Labé", city: "Labé", location: { lat: 11.31, lng: -12.28 } }, admin);
  const stB = r.body.data._id;
  r = await call("POST", "/delivery-rates", { type: "intercity", fromStationId: stA, toStationId: stB, fee: 60000, estimatedHours: 12 }, admin);
  check("admin sets the Conakry → Labé fare", ok(r), brief(r));
  const B = await signup("Bus Driver", `+22462${stamp}5`);
  await call("PUT", "/riders/me/application", { partnerType: "transit", vehicle: { type: "bus" }, cityArea: "Conakry", nationalIdNumber: "9999-1", transitRoutes: [{ fromStationId: stA, toStationId: stB }] }, B.token);
  r = await call("POST", "/riders/me/application/submit", null, B.token);
  const busId = r.body.data._id;
  await call("PATCH", `/riders/admin/${busId}/review`, { action: "approve" }, admin);
  await call("PATCH", "/deliveries/rider/online-status", { isOnline: true }, B.token);

  r = await order([{ productId, qty: 1 }], { deliveryType: "intercity", destinationStationId: stB });
  check("place intercity order", ok(r), brief(r));
  const icSub = r.body.data?.subOrders?.[0];
  for (const status of ["accepted", "preparing", "ready_for_pickup"]) {
    await call("PATCH", `/orders/vendor/sub-orders/${icSub._id}/status`, { status }, V.token);
  }
  const det = await call("GET", `/orders/vendor/sub-orders/${icSub._id}`, null, V.token);
  const leg1 = String(det.body.data.subOrder.currentLegId);
  await call("POST", `/deliveries/${leg1}/assign`, { riderId }, V.token);
  await call("POST", `/deliveries/${leg1}/accept`, null, R.token);
  const leg1Track = await call("GET", `/deliveries/${leg1}/track`, null, V.token);
  r = await call("POST", `/deliveries/${leg1}/verify-pickup`, { pin: leg1Track.body.data.pickupPin }, R.token);
  check("relay: leg 1 picked up at the store", r.status === 200, brief(r));
  const myLegs = (await call("GET", "/deliveries/rider/my-deliveries", null, R.token)).body.data;
  check("relay: rider sees leg 1 in my-deliveries", myLegs.some((d) => String(d._id) === leg1));

  const legList = det.body.data.deliveries;
  const leg2 = legList?.find((d) => d.legNumber === 2)?._id;
  const leg3 = legList?.find((d) => d.legNumber === 3)?._id;
  check("relay: vendor detail lists all 3 legs", legList?.length === 3 && Boolean(leg2 && leg3), JSON.stringify(legList?.map((l) => l.legType)));
  const cust = (await call("GET", `/orders/${icSub.orderId}`, null, C.token)).body.data;
  check("customer order detail shows legs, no store phone", cust?.subOrders?.[0]?.deliveries?.length === 3 && cust.subOrders[0].vendorId?.businessPhone === undefined, JSON.stringify(cust?.subOrders?.[0]?.vendorId));
  const custLeg1 = await call("GET", `/deliveries/${leg1}/track`, null, C.token);
  check("relay: customer can follow leg 1 but gets no station PIN", custLeg1.status === 200 && custLeg1.body.data.handoverPin === undefined && custLeg1.body.data.pickupPin === undefined, brief(custLeg1));
  const custLeg3 = (await call("GET", `/deliveries/${leg3}/track`, null, C.token)).body.data;
  check("relay: customer's delivery PIN is the last leg's handover PIN", Boolean(custLeg3?.handoverPin) && cust.subOrders[0].deliveryPin === custLeg3.handoverPin, JSON.stringify([cust.subOrders[0].deliveryPin, custLeg3?.handoverPin]));
  const vendLeg2 = await call("GET", `/deliveries/${leg2}/track`, null, V.token);
  check("relay: vendor can follow leg 2 but gets no station PIN", vendLeg2.status === 200 && vendLeg2.body.data.pickupPin === undefined && vendLeg2.body.data.handoverPin === undefined, brief(vendLeg2));

  r = await call("POST", `/deliveries/${leg2}/assign`, { riderId: busId }, V.token);
  check("relay: vendor assigns the bus driver to leg 2", r.status === 200, brief(r));
  await call("POST", `/deliveries/${leg2}/accept`, null, B.token);
  const busView = (await call("GET", `/deliveries/${leg2}/track`, null, B.token)).body.data;
  check("relay: bus driver sees incomingHandoverPin", typeof busView?.incomingHandoverPin === "string", JSON.stringify(Object.keys(busView ?? {})));
  r = await call("POST", `/deliveries/${leg1}/verify-handover`, { pin: busView.incomingHandoverPin }, R.token);
  check("relay: leg 1 handed to the bus driver with that PIN", r.status === 200, brief(r));
  const riderView = (await call("GET", `/deliveries/${leg1}/track`, null, R.token)).body.data;
  check("relay: arriving rider sees outgoingPickupPin", typeof riderView?.outgoingPickupPin === "string", JSON.stringify(Object.keys(riderView ?? {})));
  r = await call("POST", `/deliveries/${leg2}/verify-pickup`, { pin: riderView.outgoingPickupPin }, B.token);
  check("relay: bus driver picks up leg 2 with that PIN", r.status === 200, brief(r));
  r = await call("GET", `/deliveries/${leg2}/track`, null, X.token);
  check("relay: strangers still cannot see station PINs", r.status === 403 || r.status === 401, brief(r));

  // ═════ 10b. Admin panel: the exact requests the dashboard sends ═════
  // Categories: in use → cannot delete, can deactivate
  r = await call("DELETE", `/categories/${prodCat}`, null, admin);
  check("admin: a category used by products cannot be deleted (409)", r.status === 409, brief(r));
  r = await call("POST", "/categories", { name: { fr: "Vide", en: "Empty" }, type: "product" }, admin);
  const emptyCat = r.body.data?._id;
  r = await call("PATCH", `/categories/${emptyCat}`, { isActive: false }, admin);
  check("admin: deactivate a category", r.status === 200 && r.body.data?.isActive === false, brief(r));
  r = await call("DELETE", `/categories/${emptyCat}`, null, admin);
  check("admin: an unused category can be deleted", r.status === 200, brief(r));

  // Products with uploaded images ({ url, publicId }) for a chosen store; null clears a sale price
  const image = { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", publicId: "sample" };
  r = await call("POST", "/products", { name: "Admin product", vendorId, categoryId: prodCat, price: 30000, discountPrice: 25000, images: [image], stockQty: 5 }, admin);
  check("admin: create a product with an uploaded image for a store", ok(r) && r.body.data?.images?.[0]?.url === image.url, brief(r));
  const adminProductId = r.body.data?._id;
  r = await call("PATCH", `/products/${adminProductId}`, { discountPrice: null }, admin);
  check("admin: clearing the sale price removes it", r.status === 200 && r.body.data?.discountPrice == null, JSON.stringify(r.body.data?.discountPrice));

  // Delivery rates with the dashboard's field names
  r = await call("POST", "/delivery-rates", { type: "local", city: "Kindia", vehicleType: "motorbike", baseFee: 4000, perKmFee: 800, minFee: 6000 }, admin);
  check("admin: create a local delivery rate", ok(r), brief(r));

  // Team member (super admin) with a password → can sign in
  r = await call("POST", "/user/team", { name: "Staff Member", email: `staff${stamp}@kadou24h.test`, password: "Staff2026x", role: "staff" }, admin);
  check("admin: create a staff account", ok(r), brief(r));
  r = await call("POST", "/auth/login", { identifier: `staff${stamp}@kadou24h.test`, password: "Staff2026x" });
  check("admin: the new staff member can sign in", r.status === 200 && r.body.data?.user?.roles?.includes("staff"), brief(r));

  // Plans: machine features + highlights; a PATCH of one field keeps the rest
  r = await call("POST", "/subscriptions/admin/plans", { name: "Pro", audience: "job_seeker", price: 50000, durationDays: 60, features: ["cv_visibility"], highlights: ["Seen first"] }, admin);
  const planId = r.body.data?._id;
  check("admin: create a plan", ok(r), brief(r));
  r = await call("PATCH", `/subscriptions/admin/plans/${planId}`, { isActive: false }, admin);
  check(
    "admin: deactivating a plan keeps its features & duration",
    r.status === 200 && r.body.data?.isActive === false && r.body.data?.durationDays === 60 && r.body.data?.features?.[0] === "cv_visibility",
    JSON.stringify(r.body.data),
  );
  r = await call("GET", "/subscriptions/admin/plans", null, admin);
  check("admin: plan list includes inactive plans", r.body.data?.some((p) => p._id === planId && p.activeSubscribers === 0), brief(r));
  r = await call("POST", "/subscriptions/admin/plans", { name: "Bad", audience: "job_seeker", price: 1, features: ["unlimited everything"] }, admin);
  check("admin: unknown plan features are refused", r.status === 400, brief(r));

  // Vendor review: suspend needs a note
  r = await call("PATCH", `/vendors/admin/${vendorId}/review`, { action: "suspend" }, admin);
  check("admin: suspending a store without a note is refused", r.status === 400 && /note/i.test(r.body.message), brief(r));
  r = await call("GET", `/vendors/admin/${vendorId}`, null, admin);
  check("admin: store detail includes the wallet summary", typeof r.body.data?.wallet?.availableBalance === "number", JSON.stringify(r.body.data?.wallet));

  // Orders: admin detail shows the customer and the partner on each leg; customer filter
  r = await call("GET", `/orders/admin/${paidOrder._id}`, null, admin);
  const firstLegRider = r.body.data?.subOrders?.[0]?.deliveries?.[0]?.riderId;
  check("admin: order detail has the customer and the rider names", r.body.data?.order?.customerId?.name === "Customer One" && firstLegRider?.userId?.name === "Moto Rider", JSON.stringify(firstLegRider));
  r = await call("GET", `/orders/admin/all?customerId=${X.id}`, null, admin);
  check("admin: orders filtered by customer", r.status === 200 && r.body.meta?.total === 0, brief(r));
  r = await call("GET", "/orders/admin/all?status=placed", null, admin);
  check("admin: an unknown order status is a clear 400", r.status === 400, brief(r));

  // Refunds: never for an unpaid order; a failed refund leaves the dispute open
  r = await order([{ productId, qty: 1 }]);
  const unpaid = r.body.data.order;
  r = await call("POST", "/payments/admin/refunds", { orderId: unpaid._id, amount: 1000, reason: "Test" }, admin);
  check("admin: no refund for an unpaid order", r.status === 400, brief(r));
  r = await call("POST", "/payments/disputes", { orderId: unpaid._id, reason: "Never arrived here" }, C.token);
  const disputeId = r.body.data?._id;
  r = await call("PATCH", `/payments/admin/disputes/${disputeId}/resolve`, { status: "resolved", adminResolution: "Refunding", issueRefund: true, refundAmount: 1000 }, admin);
  const disputeAfter = (await call("GET", "/payments/admin/disputes?status=open", null, admin)).body.data?.find((d) => d._id === disputeId);
  check("admin: a failed refund keeps the dispute open", r.status === 400 && !!disputeAfter, brief(r));
  await call("POST", `/orders/${unpaid._id}/cancel`, { reason: "Cleanup run" }, C.token);

  // Withdrawals search, overview money, safe search text
  r = await call("GET", "/wallets/admin/withdrawals?search=WD-", null, admin);
  check("admin: withdrawals can be searched", r.status === 200 && r.body.meta?.total >= 1, brief(r));
  r = await call("GET", "/admin/dashboard/overview", null, admin);
  const money = r.body.data?.orders;
  check("admin: revenue = platform fees + earned commission", money && money.totalRevenue === money.totalPlatformFees + money.totalCommission && money.totalCommission > 0, JSON.stringify(money));
  r = await call("GET", "/products?searchTerm=((((((a", null);
  check("search text with regex characters is safe (no 500)", r.status === 200, brief(r));

  // Lifting a chat restriction never undoes an admin's own suspension
  r = await call("PATCH", `/user/${X.id}/status`, { status: "suspended", reason: "Fraud check" }, admin);
  check("admin: suspend a user with a reason", r.status === 200, brief(r));
  await call("POST", `/conversations/admin/users/${X.id}/lift-restriction`, null, admin);
  r = await call("GET", `/user/${X.id}`, null, admin);
  check("lifting a chat restriction keeps a non-chat suspension", r.body.data?.status === "suspended", r.body.data?.status);
  await call("PATCH", `/user/${X.id}/status`, { status: "active" }, admin);

  // ═════ 11. Checkout rollback under a stock race ═════
  r = await call("POST", "/products", { name: "Last item", categoryId: prodCat, price: 50000, stockQty: 1 }, V.token);
  const scarceId = r.body.data._id;
  await call("PATCH", `/products/${scarceId}/approval`, { approvalStatus: "approved" }, admin);
  r = await call("POST", "/products", { name: "Plenty", categoryId: prodCat, price: 20000, stockQty: 10 }, V.token);
  const plentyId = r.body.data._id;
  await call("PATCH", `/products/${plentyId}/approval`, { approvalStatus: "approved" }, admin);
  // Plenty is decremented first, the scarce item second → the losers must give Plenty back
  const race = await Promise.all([1, 2, 3].map(() => order([{ productId: plentyId, qty: 1 }, { productId: scarceId, qty: 1 }])));
  const wins = race.filter(ok).length;
  check("race: exactly one order wins the last item", wins === 1, race.map((x) => x.status).join(","));
  check("race: losers' stock is rolled back", (await stockOf(plentyId)) === 10 - wins && (await stockOf(scarceId)) === 0, JSON.stringify([await stockOf(plentyId), await stockOf(scarceId)]));
};

run().then(() => finish(), finish);
