/* eslint-disable no-console -- a CLI script: printing progress is its job */
/**
 * Demo data for building and trying the mobile app.
 *
 *   npm run seed:demo      fills the DEMO database (default kadou24h-demo)
 *   npm run dev:demo       runs the API on that database (your .env, except the DB)
 *
 * Everything goes through the real API (like the e2e), so the data obeys every
 * business rule: approved stores & riders, approved products, published jobs,
 * listed workers, stations, delivery rates and a home banner.
 * Product photos/names come from the public dummyjson.com demo catalogue.
 *
 * Safety: the database name must contain "demo", "test" or "e2e", and it is
 * emptied first. Your .env database is never touched. Only REDIS_* is read from .env.
 *
 * Options (env): DEMO_DATABASE_URL, DEMO_SEED_PORT
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dotenv = fs.existsSync(path.join(ROOT, ".env"))
  ? parseEnv(fs.readFileSync(path.join(ROOT, ".env"), "utf8"))
  : {};

const isLocal = process.argv.includes("--local") || process.argv.includes("--force") || process.env.ALLOW_LOCAL_SEED === "true";
const DATABASE_URL = isLocal
  ? (process.env.DATABASE_URL || dotenv.DATABASE_URL || "mongodb://localhost/kadou24h-server")
  : (process.env.DEMO_DATABASE_URL || "mongodb://127.0.0.1:27017/kadou24h-demo");

const PORT = Number(process.env.DEMO_SEED_PORT || 5077);
const HOST = `http://localhost:${PORT}`;
const BASE = `${HOST}/api/v1`;
const SECRET = crypto.randomBytes(24).toString("hex");
const ADMIN = {
  email: isLocal && dotenv.SUPER_ADMIN_EMAIL ? dotenv.SUPER_ADMIN_EMAIL : "demo-super@kadou24h.test",
  password: isLocal && dotenv.SUPER_ADMIN_PASSWORD ? dotenv.SUPER_ADMIN_PASSWORD : "DemoSuper@2026",
};
const PASSWORD = "Kadou2026";

const dbName = DATABASE_URL.split("/").pop()?.split("?")[0] || "kadou24h-server";
if (!/demo|test|e2e/i.test(dbName) && !isLocal && dbName !== "kadou24h-server") {
  console.error(`Refusing to seed "${dbName}": the name must contain "demo", "test" or "e2e", or pass --local.`);
  process.exit(1);
}

await mongoose.connect(DATABASE_URL);
await mongoose.connection.dropDatabase();
await mongoose.disconnect();

// ── Server on the target DB ──────────────────────────────────────────
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
    BCRYPT_SALT_ROUND: "10",
    SUPER_ADMIN_EMAIL: ADMIN.email,
    SUPER_ADMIN_PASSWORD: ADMIN.password,
    ADMIN_EMAIL: isLocal && dotenv.ADMIN_EMAIL ? dotenv.ADMIN_EMAIL : "demo-admin@kadou24h.test",
    ADMIN_PASSWORD: isLocal && dotenv.ADMIN_PASSWORD ? dotenv.ADMIN_PASSWORD : "DemoAdmin@2026",
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
const stop = (code) => {
  server.kill();
  process.exit(code);
};

for (let i = 0; i < 120; i++) {
  if (server.exitCode !== null) {
    console.error("Server exited during start-up:\n" + serverLog.slice(-2000));
    process.exit(1);
  }
  try {
    await fetch(HOST);
    break;
  } catch {
    await sleep(500);
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────
// One IP per user (like real phones), so the per-IP rate limits are not hit
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${json.message ?? ""} ${JSON.stringify(json.errorSources ?? "")}`);
  return json.data;
};
const lastOtp = (phone) =>
  serverLog.split("\n").filter((l) => l.includes(`[SMS:log] to ${phone}`)).at(-1)?.match(/(?:est|is) (\d{6})/)?.[1];
const signup = async (name, phone, email) => {
  await call("POST", "/auth/register", { name, phone, password: PASSWORD, language: "fr", ...(email && { email }) }, null, {
    "X-Forwarded-For": ipFor(phone),
  });
  await sleep(150);
  const s = await call("POST", "/auth/verify-account", { phone, otp: lastOtp(phone) }, null, { "X-Forwarded-For": ipFor(phone) });
  return { token: s.accessToken, id: s.user._id, name, phone };
};
const paid = (paymentId) =>
  call("POST", "/payments/webhook", { paymentId, status: "success" }, null, { "x-webhook-secret": SECRET });

/** USD demo price → GNF, rounded to 500 */
const gnf = (usd) => Math.max(500, Math.round((usd * 8600) / 500) * 500);
const img = (url) => ({ url, publicId: `demo/${crypto.createHash("md5").update(url).digest("hex").slice(0, 12)}` });

try {
  // ── Admin & catalogue ──────────────────────────────────────────────
  const admin = (await call("POST", "/auth/login", { identifier: ADMIN.email, password: ADMIN.password })).accessToken;

  const catalog = await (await fetch("https://dummyjson.com/products?limit=0")).json();
  const products = catalog.products ?? [];
  if (products.length === 0) throw new Error("Could not load the demo catalogue from dummyjson.com");
  const thumbOf = (slugs) => products.find((p) => slugs.includes(p.category))?.thumbnail;

  const PRODUCT_CATEGORIES = [
    { key: "groceries", fr: "Épicerie", en: "Groceries", from: ["groceries"] },
    { key: "electronics", fr: "Électronique", en: "Electronics", from: ["smartphones", "laptops", "tablets", "mobile-accessories"] },
    { key: "beauty", fr: "Beauté", en: "Beauty", from: ["beauty", "skin-care", "fragrances"] },
    { key: "fashion", fr: "Mode", en: "Fashion", from: ["mens-shirts", "mens-shoes", "womens-dresses", "womens-shoes", "womens-bags", "tops"] },
    { key: "home", fr: "Maison", en: "Home", from: ["home-decoration", "kitchen-accessories", "furniture"] },
    { key: "sport", fr: "Sport", en: "Sport", from: ["sports-accessories"] },
  ];
  const catId = {};
  for (const [i, c] of PRODUCT_CATEGORIES.entries()) {
    const thumb = thumbOf(c.from);
    const created = await call("POST", "/categories", {
      name: { fr: c.fr, en: c.en }, type: "product", isFeatured: true, sortOrder: i,
      ...(thumb && { image: img(thumb) }),
    }, admin);
    catId[c.key] = created._id;
  }
  const bizCat = (await call("POST", "/categories", { name: { fr: "Magasin", en: "Store" }, type: "business" }, admin))._id;
  // More store types for the "Become a vendor" picker
  for (const [i, [fr, en]] of [["Électronique", "Electronics"], ["Alimentation", "Groceries"], ["Mode & beauté", "Fashion & beauty"], ["Restaurant", "Restaurant"]].entries()) {
    await call("POST", "/categories", { name: { fr, en }, type: "business", sortOrder: i + 1 }, admin);
  }
  const SERVICES = [
    ["Plombier", "Plumber"], ["Électricien", "Electrician"], ["Menuisier", "Carpenter"],
    ["Mécanicien", "Mechanic"], ["Coiffeur", "Hairdresser"],
  ];
  const serviceId = {};
  for (const [i, [fr, en]] of SERVICES.entries()) {
    serviceId[en] = (await call("POST", "/categories", { name: { fr, en }, type: "service", sortOrder: i }, admin))._id;
  }
  const JOB_CATS = [["Vente", "Sales"], ["Marketing", "Marketing"], ["Service client", "Customer service"], ["Logistique", "Logistics"]];
  const jobCatId = {};
  for (const [i, [fr, en]] of JOB_CATS.entries()) {
    jobCatId[en] = (await call("POST", "/categories", { name: { fr, en }, type: "job", sortOrder: i }, admin))._id;
  }
  console.log("✓ categories");

  // ── Stations & delivery rates ──────────────────────────────────────
  const stations = {};
  for (const s of [
    { key: "conakry", name: "Gare Madina", city: "Conakry", lat: 9.546, lng: -13.672 },
    { key: "kindia", name: "Gare de Kindia", city: "Kindia", lat: 10.057, lng: -12.865 },
    { key: "labe", name: "Gare de Labé", city: "Labé", lat: 11.318, lng: -12.283 },
    { key: "kankan", name: "Gare de Kankan", city: "Kankan", lat: 10.385, lng: -9.305 },
  ]) {
    stations[s.key] = (await call("POST", "/transit-stations", { name: s.name, city: s.city, location: { lat: s.lat, lng: s.lng } }, admin))._id;
  }
  await call("POST", "/delivery-rates", { type: "local", city: "Conakry", vehicleType: "motorbike", baseFee: 5000, perKmFee: 1000, minFee: 7000 }, admin);
  for (const [to, fee, hours] of [["kindia", 30000, 4], ["labe", 60000, 12], ["kankan", 90000, 20]]) {
    await call("POST", "/delivery-rates", { type: "intercity", fromStationId: stations.conakry, toStationId: stations[to], fee, estimatedHours: hours }, admin);
  }
  console.log("✓ stations & delivery rates");

  // ── Stores (approved, open) with approved products ─────────────────
  const STORES = [
    { owner: "Ibrahima Sow", phone: "+224620000002", storeName: "TechHub Kaloum", market: "Marché Niger", area: "Kaloum", lat: 9.509, lng: -13.712, cats: ["electronics"], demo: true },
    { owner: "Fatoumata Camara", phone: "+224620000012", storeName: "Marché Madina Express", market: "Marché Madina", area: "Madina", lat: 9.546, lng: -13.672, cats: ["groceries", "home"] },
    { owner: "Mariama Barry", phone: "+224620000013", storeName: "Beauté Kipé", market: "Centre commercial Kipé", area: "Kipé", lat: 9.598, lng: -13.64, cats: ["beauty", "fashion"] },
    { owner: "Alpha Condé Diallo", phone: "+224620000014", storeName: "Sport Ratoma", market: "Marché Ratoma", area: "Ratoma", lat: 9.62, lng: -13.63, cats: ["sport", "fashion"] },
  ];
  const stores = [];
  for (const s of STORES) {
    const owner = await signup(s.owner, s.phone);
    const logoSource = products.find((p) => PRODUCT_CATEGORIES.find((c) => c.key === s.cats[0]).from.includes(p.category));
    await call("PUT", "/vendors/me/application", {
      storeName: s.storeName, businessCategoryId: bizCat, businessPhone: s.phone, marketName: s.market,
      address: { text: `${s.area}, Conakry`, city: "Conakry", location: { lat: s.lat, lng: s.lng } },
      ...(logoSource && { logo: img(logoSource.thumbnail) }),
    }, owner.token);
    await call("POST", "/wallets/me/payout-methods", { mode: "vendor", type: "orange_money", accountName: s.owner, accountNumber: s.phone }, owner.token);
    const profile = await call("POST", "/vendors/me/application/submit", null, owner.token);
    await call("PATCH", `/vendors/admin/${profile._id}/review`, { action: "approve" }, admin);
    await call("PATCH", "/vendors/me/availability", {
      isOpen: true,
      availability: { enabled: true, days: ["mon", "tue", "wed", "thu", "fri", "sat"], openTime: "08:00", closeTime: "21:00" },
    }, owner.token);
    stores.push({ ...s, ...owner, vendorId: profile._id, productIds: [] });
  }
  console.log(`✓ ${stores.length} stores`);

  let productCount = 0;
  for (const store of stores) {
    const sources = products.filter((p) =>
      store.cats.some((key) => PRODUCT_CATEGORIES.find((c) => c.key === key).from.includes(p.category)),
    );
    // Spread a store's products over its categories, max 12
    const picked = sources.filter((_, i) => i % Math.max(1, Math.floor(sources.length / 12)) === 0).slice(0, 12);
    for (const [i, p] of picked.entries()) {
      const categoryKey = store.cats.find((key) => PRODUCT_CATEGORIES.find((c) => c.key === key).from.includes(p.category));
      const price = gnf(p.price);
      const hasDiscount = p.discountPercentage >= 12;
      const isElectronic = categoryKey === "electronics";
      const created = await call("POST", "/products", {
        name: p.title,
        categoryId: catId[categoryKey],
        description: p.description,
        price,
        ...(hasDiscount && { discountPrice: Math.round((price * (1 - p.discountPercentage / 100)) / 500) * 500 }),
        images: (p.images?.length ? p.images : [p.thumbnail]).slice(0, 5).map(img),
        features: [...(p.tags ?? []).map((t) => t.charAt(0).toUpperCase() + t.slice(1)), ...(p.warrantyInformation ? [p.warrantyInformation] : [])],
        inTheBox: isElectronic ? [p.title, "Câble de charge", "Guide d'utilisation"] : [],
        tags: [...(p.rating >= 4.5 ? ["popular"] : []), ...(i < 2 ? ["new"] : [])],
        stockQty: i % 7 === 6 ? 0 : Math.max(3, p.stock ?? 20),
        minStockAlert: 5,
        prepTimeMinutes: 15,
      }, store.token);
      await call("PATCH", `/products/${created._id}/approval`, { approvalStatus: "approved" }, admin);
      store.productIds.push(created._id);
      productCount++;
    }
  }
  console.log(`✓ ${productCount} products`);

  // ── Riders: 2 moto (online, linked to TechHub) + 1 bus driver ─────
  const riders = [];
  for (const r of [
    { name: "Kamal Hossain Bah", phone: "+224620000003", lat: 9.512, lng: -13.705, brand: "Haojue", color: "Rouge", plate: "RC-1234-A", demo: true },
    { name: "Ousmane Keita", phone: "+224620000015", lat: 9.55, lng: -13.67, brand: "TVS", color: "Noir", plate: "RC-5678-B" },
  ]) {
    const u = await signup(r.name, r.phone);
    await call("PUT", "/riders/me/application", {
      partnerType: "moto", vehicle: { type: "motorbike", color: r.color, brand: r.brand, plateNumber: r.plate },
      vestNumber: `K24-${r.phone.slice(-3)}`, cityArea: "Conakry", nationalIdNumber: `GN-${r.phone.slice(-6)}`,
    }, u.token);
    const profile = await call("POST", "/riders/me/application/submit", null, u.token);
    await call("PATCH", `/riders/admin/${profile._id}/review`, { action: "approve" }, admin);
    await call("PATCH", "/deliveries/rider/online-status", { isOnline: true }, u.token);
    await call("PATCH", "/deliveries/rider/location", { lat: r.lat, lng: r.lng }, u.token);
    riders.push({ ...r, ...u, riderId: profile._id });
  }
  const bus = await signup("Mamadou Saliou Diallo", "+224620000004");
  await call("PUT", "/riders/me/application", {
    partnerType: "transit", vehicle: { type: "bus", brand: "Toyota Coaster", plateNumber: "RC-9090-C" },
    cityArea: "Conakry", nationalIdNumber: "GN-900004",
    transitRoutes: [{ fromStationId: stations.conakry, toStationId: stations.labe }],
  }, bus.token);
  const busProfile = await call("POST", "/riders/me/application/submit", null, bus.token);
  await call("PATCH", `/riders/admin/${busProfile._id}/review`, { action: "approve" }, admin);
  await call("PATCH", "/deliveries/rider/online-status", { isOnline: true }, bus.token);

  // TechHub invites both moto riders; they accept
  const techHub = stores[0];
  for (const r of riders) {
    const link = await call("POST", "/vendor-rider-links/invite", { riderId: r.riderId }, techHub.token);
    await call("PATCH", `/vendor-rider-links/${link._id}/respond`, { accept: true }, r.token);
  }
  console.log("✓ riders (2 moto linked to TechHub, 1 bus driver)");

  // ── Workers (listed professional profiles) ─────────────────────────
  const people = (await (await fetch("https://dummyjson.com/users?limit=12&select=firstName,lastName,image")).json()).users ?? [];
  const WORKERS = [
    { name: "Mamadou Diallo", phone: "+224620000021", service: "Electrician", profession: "Électricien certifié", rate: 60000, years: 6, area: "Kipé", skills: ["Installation électrique", "Réparation d'éclairage", "Groupe électrogène", "Câblage maison"], lat: 9.6, lng: -13.64 },
    { name: "Kofi Mensah Camara", phone: "+224620000022", service: "Plumber", profession: "Plombier", rate: 50000, years: 8, area: "Ratoma", skills: ["Fuites d'eau", "Installation sanitaire", "Chauffe-eau"], lat: 9.62, lng: -13.63 },
    { name: "Aminata Sow", phone: "+224620000023", service: "Hairdresser", profession: "Coiffeuse", rate: 40000, years: 5, area: "Madina", skills: ["Tresses", "Coiffure de mariage", "Soins capillaires"], lat: 9.546, lng: -13.672 },
    { name: "Ibrahim Traoré", phone: "+224620000024", service: "Mechanic", profession: "Mécanicien moto & auto", rate: 70000, years: 10, area: "Matoto", skills: ["Moteur", "Freins", "Diagnostic"], lat: 9.58, lng: -13.6 },
    { name: "Fatou Keita", phone: "+224620000025", service: "Carpenter", profession: "Menuisière", rate: 55000, years: 7, area: "Dixinn", skills: ["Meubles sur mesure", "Portes et fenêtres", "Réparation"], lat: 9.53, lng: -13.69 },
  ];
  const workerAccounts = [];
  for (const [i, w] of WORKERS.entries()) {
    const u = await signup(w.name, w.phone);
    const photo = people[i]?.image;
    await call("PUT", "/professional-profiles/me", {
      profession: w.profession,
      summary: `${w.profession} avec ${w.years} ans d'expérience à Conakry. Sérieux, ponctuel et disponible pour les urgences.`,
      city: `Conakry • ${w.area}`,
      location: { lat: w.lat, lng: w.lng },
      skills: w.skills,
      languages: ["Français", i % 2 ? "Pular" : "Soussou"],
      hourlyRate: w.rate,
      experienceYears: w.years,
      serviceCategoryId: serviceId[w.service],
      ...(photo && { photo: img(photo) }),
      workingHours: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "18:00" },
      idDocument: img("https://picsum.photos/seed/kadou-id-" + i + "/800/500"),
    }, u.token);
    // Become a worker: sent for review, then approved by the team
    const profile = await call("POST", "/professional-profiles/me/worker-application/submit", null, u.token);
    await call("PATCH", `/professional-profiles/admin/workers/${profile._id}/review`, { action: "approve" }, admin);
    workerAccounts.push({ token: u.token, profileId: profile._id });
  }
  console.log(`✓ ${WORKERS.length} workers`);

  // ── Published jobs (paid via the payment webhook) ──────────────────
  const JOBS = [
    { store: 0, title: "Vendeur / Vendeuse en électronique", cat: "Sales", type: "full_time", min: 1500000, max: 2500000, about: "TechHub recrute un vendeur motivé pour conseiller nos clients sur les téléphones et ordinateurs." },
    { store: 1, title: "Livreur à moto (temps partiel)", cat: "Logistics", type: "part_time", min: 800000, max: 1200000, about: "Marché Madina Express cherche un livreur à moto fiable pour les livraisons du soir à Conakry." },
    { store: 2, title: "Conseillère beauté", cat: "Customer service", type: "full_time", min: 1200000, max: 1800000, about: "Beauté Kipé recrute une conseillère pour accueillir et conseiller notre clientèle." },
    { store: 3, title: "Chargé(e) de marketing digital", cat: "Marketing", type: "contract", min: 2000000, max: 3000000, about: "Sport Ratoma cherche une personne créative pour gérer nos réseaux sociaux et promotions." },
  ];
  for (const j of JOBS) {
    const store = stores[j.store];
    const job = await call("POST", "/jobs", {
      organizationName: store.storeName, title: j.title, categoryId: jobCatId[j.cat], jobType: j.type, workplace: "on_site",
      country: "Guinée", city: "Conakry", area: store.area, location: { lat: store.lat, lng: store.lng },
      salaryCurrency: "GNF", salaryMin: j.min, salaryMax: j.max, salaryFrequency: "monthly", about: j.about,
      responsibilities: ["Accueillir et conseiller les clients", "Suivre les ventes de la journée", "Garder le magasin propre et organisé"],
      requirements: ["Bonne communication en français", "Ponctualité et sérieux", "Expérience appréciée"],
      benefits: ["Salaire mensuel", "Primes sur objectifs", "Formation"],
      prefLanguages: ["Français"], vacancies: 2,
      applicationDeadline: new Date(Date.now() + 30 * 864e5).toISOString(),
    }, store.token);
    const { payment } = await call("POST", `/jobs/${job._id}/publish`, { paymentMethod: "orange_money" }, store.token);
    if (payment?.status !== "success") await paid(payment._id);
  }
  console.log(`✓ ${JOBS.length} published jobs`);

  // ── Subscription plans (demo prices; the admin sets the real ones) ──
  const PLANS = [
    { name: "CV en avant — 30 jours", audience: "job_seeker", price: 10000, durationDays: 30, features: ["cv_visibility"], highlights: ["Votre profil en tête de la liste des travailleurs", "Badge « Profil en avant »"] },
    { name: "Pro — 90 jours", audience: "service_provider", price: 25000, durationDays: 90, features: ["cv_visibility"], highlights: ["Votre profil en tête pendant 3 mois", "Badge « Profil en avant »"] },
  ];
  for (const plan of PLANS) await call("POST", "/subscriptions/admin/plans", plan, admin);
  console.log(`✓ ${PLANS.length} subscription plans`);

  // ── Ads: banners (2 on home = carousel), a home popup, a category interstitial ──
  const now = Date.now();
  for (const ad of [
    { name: "Promo électronique", type: "banner", placement: "home", image: "https://picsum.photos/seed/kadou-home/1200/500", advertiser: "TechHub Kaloum" },
    { name: "Livraison offerte ce week-end", type: "banner", placement: "home", image: "https://picsum.photos/seed/kadou-home2/1200/500", advertiser: "Kadou24h" },
    { name: "Marché frais", type: "banner", placement: "search", image: "https://picsum.photos/seed/kadou-search/1200/500", advertiser: "Marché Madina Express" },
    { name: "Soldes de la rentrée — jusqu’à -30 %", type: "popup", placement: "home", image: "https://picsum.photos/seed/kadou-popup/800/1000", advertiser: "Mode Conakry" },
    { name: "Nouveaux smartphones en stock", type: "interstitial", placement: "category", image: "https://picsum.photos/seed/kadou-inter/900/1600", advertiser: "TechHub Kaloum" },
  ]) {
    await call("POST", "/advertisements/admin", {
      name: ad.name, advertiserName: ad.advertiser, type: ad.type, placement: ad.placement, images: [ad.image],
      description: ad.name, startAt: new Date(now - 864e5).toISOString(), endAt: new Date(now + 90 * 864e5).toISOString(), status: "active",
    }, admin);
  }
  console.log("✓ ads (banners, popup, interstitial)");

  // ── Demo customer with a saved address ─────────────────────────────
  const customer = await signup("Aïssatou Bah", "+224620000001", "aissatou.demo@kadou24h.test");
  await call("POST", "/addresses", {
    label: "home", fullName: "Aïssatou Bah", phone: "+224620000001", region: "Conakry", city: "Conakry", commune: "Ratoma",
    neighborhood: "Kipé", landmark: "En face du kiosque Orange Money, portail bleu", location: { lat: 9.597, lng: -13.641 },
  }, customer.token);
  console.log("✓ demo customer");

  // ── Order history: 2 delivered + reviewed, 1 on its way (all real flows) ──
  const [kamal, ousmane] = riders;
  const buy = async ({ productIds, paymentMethod }) => {
    for (const productId of productIds) await call("POST", "/cart/items", { productId, qty: 1 }, customer.token);
    const { order, subOrders } = await call("POST", "/orders", { deliveryType: "local", paymentMethod }, customer.token);
    if (paymentMethod !== "cod") {
      const payment = await call("POST", "/payments/initiate", { purpose: "order", refId: order._id, method: paymentMethod }, customer.token);
      await paid(payment._id);
      // The store receives an online order once paid: re-read it (status new, delivery leg set)
      const details = await call("GET", `/orders/${order._id}`, null, customer.token);
      return { order, subOrder: details.subOrders[0] };
    }
    return { order, subOrder: subOrders[0] };
  };
  const shipOut = async ({ order, subOrder }, rider) => {
    for (const status of ["accepted", "preparing", "ready_for_pickup"]) {
      await call("PATCH", `/orders/vendor/sub-orders/${subOrder._id}/status`, { status }, techHub.token);
    }
    const legId = subOrder.currentLegId;
    await call("POST", `/deliveries/${legId}/assign`, { riderId: rider.riderId }, techHub.token);
    await call("POST", `/deliveries/${legId}/accept`, null, rider.token);
    await call("PATCH", `/deliveries/${legId}/going-to-pickup`, null, rider.token);
    const { pickupPin } = await call("GET", `/orders/vendor/sub-orders/${subOrder._id}`, null, techHub.token);
    await call("POST", `/deliveries/${legId}/verify-pickup`, { pin: pickupPin }, rider.token);
    return { order, subOrder, legId };
  };
  const handOver = async ({ order, subOrder, legId }, rider) => {
    const details = await call("GET", `/orders/${order._id}`, null, customer.token);
    const pin = details.subOrders.find((s) => s._id === subOrder._id).deliveryPin;
    await call("POST", `/deliveries/${legId}/verify-handover`, { pin }, rider.token);
  };
  // TechHub's in-stock products, cheapest first. A rider may carry at most
  // 1 000 000 GNF of COD cash, so only cheap items go cash on delivery.
  const techHubProducts = await call("GET", `/products?vendorId=${techHub.vendorId}&inStock=true&sort=price_asc&limit=50`);
  const cheap = techHubProducts.map((p) => p._id);
  const codOrPhone = (productId) =>
    (techHubProducts.find((p) => p._id === productId).discountPrice ?? techHubProducts.find((p) => p._id === productId).price) < 600000
      ? "cod"
      : "orange_money";

  const first = await shipOut(await buy({ productIds: [cheap[0]], paymentMethod: codOrPhone(cheap[0]) }), ousmane);
  await handOver(first, ousmane);
  await call("POST", "/reviews", { subOrderId: first.subOrder._id, rating: 5, comment: "Livraison rapide et produit conforme. Merci TechHub !" }, customer.token);

  const second = await shipOut(await buy({ productIds: [cheap.at(-1)], paymentMethod: "orange_money" }), ousmane);
  await handOver(second, ousmane);
  await call("POST", "/reviews", { subOrderId: second.subOrder._id, rating: 4, comment: "Bon produit, le livreur a bien trouvé la maison." }, customer.token);

  // On its way with the demo rider: the customer sees the rider and the delivery PIN
  await shipOut(await buy({ productIds: [cheap[1]], paymentMethod: codOrPhone(cheap[1]) }), kamal);

  // For the vendor demo: one new order to accept, one being prepared (2 items, so it can be modified)
  await buy({ productIds: [cheap[2]], paymentMethod: "cod" });
  const preparing = await buy({ productIds: [cheap[3], cheap[4]], paymentMethod: "cod" });
  for (const status of ["accepted", "preparing"]) {
    await call("PATCH", `/orders/vendor/sub-orders/${preparing.subOrder._id}/status`, { status }, techHub.token);
  }
  console.log("✓ orders (2 delivered + reviewed, 1 on its way, 1 new, 1 preparing)");

  // ── Worker bookings (paid directly to the worker, outside the app) ──
  const [mamadou, kofi] = workerAccounts;
  const inDays = (days, hour) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const done = await call("POST", "/bookings", { workerProfileId: mamadou.profileId, scheduledAt: inDays(1, 9), description: "Installer trois prises et un interrupteur dans le salon." }, customer.token);
  await call("PATCH", `/bookings/${done._id}/accept`, null, mamadou.token);
  await call("PATCH", `/bookings/${done._id}/done`, { agreedPrice: 180000 }, mamadou.token);
  await call("PATCH", `/bookings/${done._id}/confirm`, null, customer.token);
  await call("POST", `/bookings/${done._id}/review`, { rating: 5, comment: "Travail propre et rapide, je recommande.", photos: [img("https://picsum.photos/seed/kadou-work-1/800/600")] }, customer.token);
  const upcoming = await call("POST", "/bookings", { workerProfileId: kofi.profileId, scheduledAt: inDays(2, 10), description: "Fuite sous l'évier de la cuisine, à réparer." }, customer.token);
  await call("PATCH", `/bookings/${upcoming._id}/accept`, null, kofi.token);
  await call("POST", "/bookings", { workerProfileId: mamadou.profileId, scheduledAt: inDays(3, 14), description: "Le groupe électrogène ne démarre plus, diagnostic à faire." }, customer.token);
  console.log("✓ bookings (1 completed + reviewed, 1 accepted, 1 new request for Mamadou)");

  // TechHub products waiting for the admin: one pending, one sent back with a note
  const pendingSource = products.find((p) => p.category === "smartphones") ?? products[0];
  await call("POST", "/products", {
    name: "Écouteurs sans fil Kadou", categoryId: catId.electronics, description: "Écouteurs Bluetooth, 20 h d’autonomie.",
    price: 150000, images: [img(pendingSource.thumbnail)], stockQty: 10, minStockAlert: 3,
  }, techHub.token);
  const rejected = await call("POST", "/products", {
    name: "Chargeur rapide", categoryId: catId.electronics, description: "Chargeur",
    price: 45000, images: [img(pendingSource.thumbnail)], stockQty: 25, minStockAlert: 5,
  }, techHub.token);
  await call("PATCH", `/products/${rejected._id}/approval`, { approvalStatus: "rejected", adminReviewNote: "La photo ne montre pas le chargeur. Ajoutez une vraie photo du produit." }, admin);
  console.log("✓ TechHub: 1 product pending, 1 rejected");

  console.log(`
Demo database ready: ${dbName}
Start the API on it:   npm run dev:demo

Demo accounts (password for all: ${PASSWORD})
  Customer        +224 620 00 00 01   Aïssatou Bah (address in Kipé, 2 delivered orders + 1 on its way)
  Vendor          +224 620 00 00 02   TechHub Kaloum: 1 new + 1 preparing order, 2 linked riders, 1 product pending + 1 rejected
  Rider (moto)    +224 620 00 00 03   linked to TechHub, online, carrying 1 order
  Bus driver      +224 620 00 00 04   Conakry → Labé
  Other stores    +224 620 00 00 12 / 13 / 14
  Workers         +224 620 00 00 21 … 25 (21 Mamadou: 1 new booking request, 1 completed; 22 Kofi: 1 accepted)
  Admin (dashboard) ${ADMIN.email} / ${ADMIN.password}
`);
  stop(0);
} catch (error) {
  console.error("\nSeed failed:", error.message);
  console.error("\n── last server output ──\n" + serverLog.split("\n").slice(-25).join("\n"));
  stop(1);
}
