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
const call = async (method, url, body, token, headers = {}) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }), ...headers },
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
    a = await call("POST", `/deliveries/${legId}/verify-pickup`, { pin: vt.body.data?.pickupPin }, R.token);
    check(`${label}: pickup PIN accepted`, a.status === 200, brief(a));
    const ct = await call("GET", `/deliveries/${legId}/track`, null, C.token);
    const rt = await call("GET", `/deliveries/${legId}/track`, null, R.token);
    check(
      `${label}: rider never sees the PINs`,
      rt.status === 200 && rt.body.data.pickupPin === undefined && rt.body.data.handoverPin === undefined,
      brief(rt),
    );
    const pin = ct.body.data?.handoverPin;
    const [h1, h2] = await Promise.all([
      call("POST", `/deliveries/${legId}/verify-handover`, { pin }, R.token),
      call("POST", `/deliveries/${legId}/verify-handover`, { pin }, R.token),
    ]);
    check(`${label}: handover PIN accepted exactly once (double tap)`, [h1, h2].filter((x) => x.status === 200).length === 1, `${brief(h1)} | ${brief(h2)}`);
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

  // ═════ 3. Prepaid: webhook security, then vendor paid at delivery ═════
  r = await order([{ productId, qty: 1 }], { paymentMethod: "orange_money" });
  const paidOrder = r.body.data.order;
  const paidSub = r.body.data.subOrders[0];
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
  const before = (await wallet(V.token, "vendor")).availableBalance;
  await deliver(paidSub, "Prepaid");
  vw = await wallet(V.token, "vendor");
  check("prepaid: vendor paid at delivery", vw.availableBalance === before + paidSub.vendorEarning, JSON.stringify([before, vw.availableBalance]));
  r = await call("POST", `/orders/admin/sub-orders/${paidSub._id}/cancel`, { reason: "Too late to cancel" }, admin);
  check("admin cannot cancel a delivered sub-order (refund instead)", r.status === 400, brief(r));

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
