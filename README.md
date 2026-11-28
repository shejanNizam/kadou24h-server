# Kadou24h — Backend API

The backend for **Kadou24h**, a multi-vendor marketplace and delivery platform built for Guinea (West Africa). It is one platform for:

- shopping from local stores;
- delivery by moto riders, including **delivery to other cities** (moto → bus → moto);
- **moto-taxi rides**;
- a **jobs board** and local service providers;
- an **AI help assistant**.

It serves the mobile app (customer, seller and rider modes) and the admin panel.

**Stack:** Node.js · Express 5 · TypeScript · MongoDB (Mongoose 9) · Redis · Socket.io · Zod · Jest

**Part of a three-project system:**

| Project | What |
|---|---|
| **kadou24h-server** (this) | REST + real-time API |
| [kadou24h-app](../kadou24h-app) | Mobile app: Expo, React Native |
| [kadou24h-dashboard](../kadou24h-dashboard) | Admin panel: Next.js, Ant Design |

---

## At a glance

| | |
|---|---|
| Feature modules | 40 (orders, delivery, payments, wallet, chat, rides, jobs, AI assistant…) |
| End-to-end checks | **659**, all passing. They run the real server against a throwaway database, over HTTP and sockets. |
| Unit/integration tests | **196** (Jest + Supertest) |
| Languages | French (default) and English. Every error has a stable code and a translated message. |
| API reference | Swagger UI at `/api/docs`, plus [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) |

---

## Engineering highlights

### Money handled safely
- **Escrow for stores.** A store's earnings are held until delivery, then released to its wallet after a configurable delay.
- **Withdrawals** have per-method fees and an admin approval step.
- **Commission and fees** come from admin settings and are never hard-coded:
  - the commission is a percentage with a minimum;
  - the service fee is charged per order.
- **Cash on delivery** works in two steps:
  - the service and delivery fees are paid online first;
  - the rider collects only the product price, confirmed with a 4-digit PIN shown in the customer's app.
- **Refunds and disputes:**
  - a dispute is allowed only where it makes sense (a delivered part, or money actually paid);
  - one open dispute per store part, enforced by a unique partial index;
  - the refund amount is capped at what was paid.
- **Payment gateway adapter.** There is a demo mode for testing; a live provider plugs in without code changes elsewhere.

### Delivery and dispatch
- **Open dispatch.** The nearest online riders get the job first, and the search radius grows over time. The first rider to accept takes it.
- **Alerts.** The store and the team are alerted if nobody accepts.
- **Delivery to another city** has three legs: moto to the bus station, bus between cities, moto to the door.
  - The fare split is snapshotted at checkout, so later price changes never change a running order.
  - The address is checked against the arrival station.
- **Live tracking and status changes** go over Socket.io, scaled with the Redis adapter.

### Moto-taxi
- Kadou24h suggests the price before the ride.
- Riders may bid up to a configurable percentage above it, and the passenger chooses or makes a counter-offer.
- Every bid expires on a timer.

### Security and abuse protection ([docs/SECURITY.md](docs/SECURITY.md))
- **Rate limits for shared IPs.** Mobile carriers in Guinea put many phones behind one IP (CGNAT), so limits are counted **per account** and **per phone/email**, not only per IP.
- **Account lock.** 10 wrong passwords lock the account, whatever IPs they come from.
- **OTP codes (SMS/email):**
  - stored as an HMAC;
  - limited tries per code and an atomic resend cooldown;
  - a daily SMS budget that stops "SMS-pumping" bills.
- **Sessions.** Every request re-reads the user, so a suspension or "log out everywhere" applies at once.
- **Data privacy:**
  - customers never see a store's or rider's phone or email;
  - people talk only through in-app chat;
  - phone numbers and links in chat are masked automatically, with warnings and escalating restrictions.
- **Input hardening:** Zod validation (unknown fields dropped), Mongo-operator and XSS stripping, Helmet, CORS.

### AI help assistant
- **The key stays on the server.** OpenAI is called only from the server; the app never sees the key.
- **Answers come from live data.** The assistant uses the platform settings (fees, delays) and the person's own recent orders. **No name, phone, email or address is ever sent to the AI.**
- **Structured answers** say when a human is needed. One tap turns the conversation into a **support ticket**, and the team reads the full transcript.
- **Cost controls:**
  - daily limits per person and for the whole platform (Redis);
  - a per-minute limit;
  - failed calls are not counted.
- **Tested without spending money.** The e2e suite runs against a **local fake OpenAI server**.

### Internationalisation
- **Coded errors.** Every error is answered as `{ code, params, message }`, with the message in the client's language (Accept-Language or the user's saved choice).
- **Notifications** are stored as code + params and rendered per language.
- **Catalog tests** keep every code defined in both languages.

---

## Architecture

```
src/
├── server.ts              Boot: MongoDB, Redis, Socket.io, background sweeps, admin seeding
├── app.ts                 Express app: security middleware, routes, Swagger, error handler
├── socket/                Socket.io (auth, rooms, Redis adapter for horizontal scaling)
└── app/
    ├── config/            Env validation (Zod: the server refuses to start with bad config), Redis, Cloudinary
    ├── middlewares/       checkAuth, validateRequest, rateLimiter, locale, sanitizeInput, globalErrorHandler
    ├── i18n/              Error catalog (fr/en) and translation
    ├── modules/           One folder per feature: model · interface · validation · service · controller · route
    └── utils/             QueryBuilder, JWT, logger (Winston), email, push (FCM), SMS
```

Each module follows the same layout, for example `order/`:

```
order.interface.ts   Types and enums
order.model.ts       Mongoose schema and indexes
order.validation.ts  Zod schemas for requests
order.*.service.ts   Business logic (checkout, customer, vendor, admin, payment…)
order.controller.ts  HTTP layer (thin)
order.route.ts       Routes, roles, validation, Swagger annotations
```

### Modules by domain

| Domain | Modules |
|---|---|
| Accounts | `auth`, `auth_identity` (Google/Apple), `otp`, `user`, `device_token`, `audit_log` |
| Marketplace | `category`, `product`, `vendor_profile`, `cart`, `favorite`, `coupon`, `review`, `advertisement` |
| Orders and delivery | `order`, `delivery`, `delivery_rate`, `transit_station`, `rider_profile`, `vendor_rider_link`, `address` |
| Money | `payment` (gateway adapter, refunds, disputes), `wallet`, `subscription`, `counter` |
| Rides | `ride` (moto-taxi with bidding) |
| Jobs and services | `job`, `professional_profile`, `booking` (provider penalties, reviews) |
| Communication | `chat` (moderation, voice notes, retention), `notification`, `support_ticket`, `report`, `ai_assistant` |
| Platform | `settings`, `admin_dashboard`, `app_error` (mobile crash reports), `health`, `upload` |

### Roles
- One account can hold several app roles at once: `customer`, plus `vendor` and/or `rider` after admin approval of a KYC application.
- The app switches between them as **modes**.
- Admin roles (`staff`, `admin`, `super_admin`) are separate and never mixed with app roles.

Database design: [docs/DB_DESIGN.md](docs/DB_DESIGN.md) and [docs/kadou24h.dbml](docs/kadou24h.dbml) (diagram-ready schema).

---

## Testing

```bash
npm test            # Jest: validation, moderation, i18n catalog, prompts, security rules
npm run test:e2e    # End-to-end: starts its own server on a throwaway DB, runs the full journeys
```

The e2e runner ([scripts/e2e/money-flow.e2e.mjs](scripts/e2e/money-flow.e2e.mjs)) walks through complete flows:

- **Sign-up and approval:** sign-up with OTP, then store and rider applications approved by an admin.
- **Orders:** checkout with cash on delivery and online payment, then dispatch, pickup PIN, delivery PIN and escrow release.
- **Money after the order:** withdrawals, refunds, disputes, intercity relay legs, moto-taxi bidding.
- **Communication:** chat moderation, and the AI assistant against a fake OpenAI server.
- **Security:** rate limits, account lock, access control on every owned resource.

Built-in safety: the database name must contain `e2e` or `test`, and it is dropped after the run. Real data and real third-party services are never touched.

---

## Getting started

**Prerequisites:** Node.js 22, MongoDB, Redis.

```bash
npm install
cp .env.example .env      # then fill in the values
npm run dev:local         # http://localhost:7000 · Swagger at /api/docs
```

All variables are documented in [.env.example](.env.example). The server validates them at start-up: it refuses to run with missing or invalid values, and warns about weak secrets in production. Optional services switch themselves off when their keys are empty: SMS goes to the log, push and the AI assistant are disabled.

Docker: `docker compose up -d`

| Script | What |
|---|---|
| `npm run dev:local` | Development with hot reload, reading `.env` |
| `npm run build` / `npm start` | Compile to `dist/` and run in production |
| `npm run lint` | ESLint |
| `npm test` / `npm run test:e2e` | Jest / end-to-end suite |

---

## Documentation

| File | What |
|---|---|
| [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | Every endpoint, flows, errors, enums, changelog |
| [docs/DB_DESIGN.md](docs/DB_DESIGN.md) | Data model and business rules |
| [docs/SECURITY.md](docs/SECURITY.md) | Security review: what is in place and the production checklist |
