/* eslint-disable no-console -- a CLI script: printing what it finds is its job */
/**
 * One-off repair for the station handover bug (client test AP12, 2026-10-29):
 *  1. A relay leg stayed "picked up" when the next driver took the parcel without the
 *     previous driver typing a code. It is closed now (delivered at the next pickup time).
 *  2. Relay legs that were never paid get their fee, like the server now does at the
 *     station. Legs already paid are only marked (feePaidAt), never paid twice.
 *  3. Riders' "total earned" was never counted: it becomes the sum of their fees.
 *
 *   node scripts/fix-relay-legs.mjs            dry run on .env's DATABASE_URL: only prints
 *   node scripts/fix-relay-legs.mjs --apply    writes the changes
 *
 * Options (env): DATABASE_URL overrides .env. Take a backup before --apply.
 */
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dotenv = fs.existsSync(path.join(ROOT, ".env")) ? parseEnv(fs.readFileSync(path.join(ROOT, ".env"), "utf8")) : {};
const DATABASE_URL = process.env.DATABASE_URL || dotenv.DATABASE_URL;
const APPLY = process.argv.includes("--apply");
const MOVING = ["picked_up", "in_transit"];

if (!DATABASE_URL) {
  console.error("No DATABASE_URL in the environment or .env");
  process.exit(1);
}

await mongoose.connect(DATABASE_URL);
const db = mongoose.connection.db;
const deliveries = db.collection("deliveries");
const subOrders = db.collection("sub_orders");
const riders = db.collection("riderprofiles");
const wallets = db.collection("wallets");
const transactions = db.collection("wallet_transactions");
console.log(`${APPLY ? "Fixing" : "Dry run on"} ${db.databaseName}\n`);

const nextLegOf = (leg) => deliveries.findOne({ subOrderId: leg.subOrderId, legNumber: leg.legNumber + 1 });
/** The next driver has the parcel, so this leg is over (step 1 closes it) */
const handedOver = async (leg) => {
  const next = await nextLegOf(leg);
  return Boolean(next && [...MOVING, "delivered"].includes(next.status)) && next;
};
const numberOf = async (subOrderId) => (await subOrders.findOne({ _id: subOrderId }, { projection: { subOrderNumber: 1 } }))?.subOrderNumber;

// 1. Relay legs left open after the next driver took the parcel
let closed = 0;
for (const leg of await deliveries.find({ status: { $in: MOVING } }).toArray()) {
  const next = await handedOver(leg);
  if (!next) continue;
  closed += 1;
  const at = next.pickedUpAt ?? new Date();
  console.log(`  close ${await numberOf(leg.subOrderId)} leg #${leg.legNumber} (handed over ${at.toISOString()})`);
  if (!APPLY) continue;
  await deliveries.updateOne(
    { _id: leg._id, status: { $in: MOVING } },
    { $set: { status: "delivered", deliveredAt: at, pinAttempts: 0 }, $unset: { pinLockedUntil: 1 } },
  );
  if (leg.riderId) {
    await riders.updateOne({ _id: leg.riderId }, { $inc: { "stats.totalDeliveries": 1, "stats.completed": 1 } });
    await riders.updateOne({ _id: leg.riderId, activeDeliveryCount: { $gt: 0 } }, { $inc: { activeDeliveryCount: -1 } });
  }
  await subOrders.updateOne(
    { _id: leg.subOrderId },
    { $push: { timeline: { status: "leg_completed", note: `Leg #${leg.legNumber} handed over at ${leg.toName}`, at } } },
  );
}
console.log(`${closed} relay leg(s) to close\n`);

// 2. Fees: mark the paid ones, pay the relay legs that never were
let paid = 0;
let marked = 0;
const unpaid = await deliveries.find({ feePaidAt: { $exists: false }, riderId: { $ne: null }, fee: { $gt: 0 } }).toArray();
for (const leg of unpaid) {
  // In a dry run, the legs step 1 would close count as delivered
  const isDelivered = leg.status === "delivered" || (MOVING.includes(leg.status) && !APPLY && (await handedOver(leg)));
  if (!isDelivered) continue;
  const txn = await transactions.findOne({ deliveryId: leg._id, type: "earning_released" });
  if (txn) {
    marked += 1;
    if (APPLY) await deliveries.updateOne({ _id: leg._id }, { $set: { feePaidAt: txn.createdAt } });
    continue;
  }
  // Only relay legs: a final leg is paid with its order's settlement
  if (!(await nextLegOf(leg))) continue;
  const rider = await riders.findOne({ _id: leg.riderId }, { projection: { userId: 1 } });
  if (!rider) continue;
  paid += 1;
  console.log(`  pay ${await numberOf(leg.subOrderId)} leg #${leg.legNumber}: ${leg.fee} GNF to rider ${rider.userId}`);
  if (!APPLY) continue;
  const claimed = await deliveries.findOneAndUpdate(
    { _id: leg._id, feePaidAt: { $exists: false } },
    { $set: { feePaidAt: new Date() } },
  );
  if (!claimed) continue;
  const wallet = await wallets.findOneAndUpdate(
    { ownerId: rider.userId, ownerMode: "rider" },
    {
      $inc: { availableBalance: leg.fee },
      $setOnInsert: { heldBalance: 0, totalEarned: 0, totalWithdrawn: 0, totalCommission: 0, cashOwed: 0, payoutMethods: [], createdAt: new Date() },
      $set: { updatedAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );
  await transactions.insertOne({
    walletId: wallet._id,
    type: "earning_released",
    amount: leg.fee,
    balanceAfter: wallet.availableBalance,
    subOrderId: leg.subOrderId,
    deliveryId: leg._id,
    note: `Delivery fee earned for leg #${leg.legNumber} (repair)`,
    createdAt: new Date(),
  });
}
console.log(`${paid} relay leg(s) to pay, ${marked} already paid (marked only)\n`);

// 3. Riders' total earned = the fees they received (riders have no held stage)
let totals = 0;
const earned = await transactions
  .aggregate([{ $match: { type: "earning_released" } }, { $group: { _id: "$walletId", sum: { $sum: "$amount" } } }])
  .toArray();
const sums = new Map(earned.map((e) => [String(e._id), e.sum]));
for (const wallet of await wallets.find({ ownerMode: "rider" }).toArray()) {
  const sum = sums.get(String(wallet._id)) ?? 0;
  if ((wallet.totalEarned ?? 0) === sum) continue;
  totals += 1;
  console.log(`  rider ${wallet.ownerId}: total earned ${wallet.totalEarned ?? 0} → ${sum}`);
  if (APPLY) await wallets.updateOne({ _id: wallet._id }, { $set: { totalEarned: sum } });
}
console.log(`${totals} rider wallet total(s) to correct${APPLY ? "" : " (step 2's payments not counted yet)"}\n`);

console.log(APPLY ? "Done" : "Dry run only: run again with --apply");
await mongoose.disconnect();
