/* eslint-disable no-console -- a CLI script: printing what it finds is its job */
/**
 * One-off repair: the old input sanitizer stored "&" as "&amp;" (and again on every edit:
 * "&amp;amp;"), so the app and admin showed "Riz &amp; Co". This turns them back into "&"
 * in every string of every collection. Passwords are skipped (their hashes never hold "&").
 *
 *   node scripts/fix-ampersands.mjs                 dry run on .env's DATABASE_URL: only counts
 *   node scripts/fix-ampersands.mjs --apply         writes the changes
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
const SKIP_KEYS = new Set(["password"]);

if (!DATABASE_URL) {
  console.error("No DATABASE_URL in the environment or .env");
  process.exit(1);
}

const decode = (s) => {
  let out = s;
  while (out.includes("&amp;")) out = out.replace(/&amp;/g, "&");
  return out;
};

/** Collects { "a.b.0.c": newValue } for every string that changes; Dates, ObjectIds and buffers are left alone. */
const findChanges = (value, prefix, changes) => {
  if (typeof value === "string") {
    if (value.includes("&amp;")) changes[prefix] = decode(value);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => findChanges(item, `${prefix}.${i}`, changes));
  } else if (value && typeof value === "object" && value.constructor === Object) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "_id" || SKIP_KEYS.has(k)) continue;
      findChanges(v, prefix ? `${prefix}.${k}` : k, changes);
    }
  }
  return changes;
};

await mongoose.connect(DATABASE_URL);
const db = mongoose.connection.db;
console.log(`${APPLY ? "Fixing" : "Dry run on"} ${db.databaseName}\n`);

let total = 0;
for (const { name } of await db.listCollections({ type: "collection" }).toArray()) {
  if (name.startsWith("system.")) continue;
  const col = db.collection(name);
  let docs = 0;
  // A plain scan: Atlas shared tiers refuse server-side JavaScript ($where)
  for await (const doc of col.find({})) {
    const changes = findChanges(doc, "", {});
    if (!Object.keys(changes).length) continue;
    docs += 1;
    if (docs <= 3) console.log(`  ${name} ${doc._id}:`, Object.entries(changes).map(([k, v]) => `${k} → ${JSON.stringify(v)}`).join(", "));
    if (APPLY) await col.updateOne({ _id: doc._id }, { $set: changes });
  }
  if (docs) {
    console.log(`${name}: ${docs} document(s)${docs > 3 ? " (first 3 shown)" : ""}\n`);
    total += docs;
  }
}

console.log(total ? `${total} document(s) ${APPLY ? "fixed" : "to fix: run again with --apply"}` : "Nothing to fix");
await mongoose.disconnect();
