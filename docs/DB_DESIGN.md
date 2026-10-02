# Kadou24h — Database Design Guide (v3.1)

> Companion guide to [`kadou24h.dbml`](./kadou24h.dbml) (the schema itself — paste it into dbdiagram.io to see the diagram).
> This document explains **what each collection is for, why it is shaped that way, and how data moves through it**.

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Core design ideas (read this first)](#2-core-design-ideas)
3. [Domain 1 — Accounts & roles](#3-domain-1--accounts--roles)
4. [Domain 2 — Vendor & rider profiles](#4-domain-2--vendor--rider-profiles)
5. [Domain 3 — Catalog](#5-domain-3--catalog)
6. [Domain 4 — Cart, orders & delivery](#6-domain-4--cart-orders--delivery)
7. [Domain 5 — Money](#7-domain-5--money)
8. [Domain 6 — Jobs, CV & subscriptions](#8-domain-6--jobs-cv--subscriptions)
9. [Domain 7 — Chat & trust](#9-domain-7--chat--trust)
10. [Domain 8 — Platform & admin](#10-domain-8--platform--admin)
11. [End-to-end walkthroughs](#11-end-to-end-walkthroughs)
12. [Status machines](#12-status-machines)
13. [Redis (what is NOT in MongoDB)](#13-redis--what-is-not-in-mongodb)
14. [Build phases](#14-build-phases)
15. [Open questions](#15-open-questions)

---

## 1. The big picture

**38 MongoDB collections** + **12 embedded sub-documents**, grouped into 8 domains:

| Domain | Collections | Embedded inside |
|---|---|---|
| **Accounts & roles** | `users`, `auth_identities`, `device_tokens` | `user_addresses` (in users) |
| **Vendor & rider profiles** | `vendor_profiles`, `rider_profiles`, `vendor_rider_links`, `transit_stations` | `verification_documents`, `application_history`, `rider_transit_routes` |
| **Catalog** | `categories`, `products`, `favorites`, `reviews` | — |
| **Cart, orders & delivery** | `carts`, `orders`, `sub_orders`, `deliveries`, `delivery_rates` | `cart_items`, `sub_order_items`, `sub_order_timeline`, `sub_order_modifications` |
| **Money** | `payments`, `wallets`, `wallet_transactions`, `withdrawals`, `cod_settlements`, `refunds`, `disputes` | `wallet_payout_methods` (in wallets) |
| **Jobs, CV & subscriptions** | `professional_profiles`, `jobs`, `job_applications`, `subscription_plans`, `user_subscriptions` | `profile_education`, `profile_experience` |
| **Chat & trust** | `conversations`, `messages`, `moderation_violations`, `reports`, `notifications` | `conversation_participants` |
| **Platform & admin** | `support_tickets`, `advertisements`, `settings`, `audit_logs`, `counters` | — |

### How the main pieces connect

```
                         ┌──────────────┐
                         │    users     │  one person, one phone, roles[]
                         └──────┬───────┘
        ┌───────────────┬───────┼──────────────┬──────────────────────┐
        ▼               ▼       ▼              ▼                      ▼
 vendor_profiles  rider_profiles  professional_profiles   wallets (vendor / rider)
        │               │        (CV + worker)               │
        │  vendor_rider_links                                ▼
        ▼               │                            wallet_transactions (ledger)
    products            │
        │               │
   ┌────┴─────┐         │
   ▼          ▼         ▼
 carts ──► orders ──► sub_orders (1 per vendor) ──► deliveries (1 or 3 legs)
             │             │
             ▼             ▼
          payments      reviews, conversations ──► messages
```

---

## 2. Core design ideas

These eight ideas explain almost every decision in the schema.

### 2.1 One person = one account, many modes
Everyone signs up as a **customer**. Becoming a vendor or delivery partner does **not** create a new account — it adds a **profile** (`vendor_profiles` / `rider_profiles`) that the admin must approve. After approval, `users.roles` gains `"vendor"` or `"rider"` and the app shows a **mode switch**.

```
users.roles = ["customer"]                     → new signup
users.roles = ["customer", "vendor"]           → approved vendor
users.roles = ["customer", "vendor", "rider"]  → both (allowed, with self-dealing rules)
users.roles = ["admin"]                        → admin panel only, never mixed with app roles
```

**Why:** one phone number per person (many Guineans have one SIM), bans apply to the whole person, and a vendor can still shop.

### 2.2 Two kinds of status
| Status | Where | Effect |
|---|---|---|
| **Account status** | `users.status` | `suspended`/`banned` blocks **everything** (serious fraud) |
| **Role status** | `vendor_profiles.approval_status`, `rider_profiles.approval_status` | `suspended` blocks **only that business**; the person can still shop |

### 2.3 Embed vs. reference (the MongoDB rule)
- **Embed** when the data is small, bounded, owned by the parent, and always read with it → order items, timeline, addresses, KYC documents, CV education.
- **Separate collection** when it grows without limit, or is queried on its own → `messages`, `wallet_transactions`, `deliveries`, `notifications`.

### 2.4 Snapshots — the past never changes
When an order is placed, the **product name, price, image and the delivery address are copied** into the order. If the vendor later changes the price or the user edits their address, old orders still show what was actually bought. Same for `subscription_plan_snapshot`, `cv_snapshot` in applications and `payout_method_snapshot` in withdrawals.

### 2.5 Money = integers in GNF
All amounts are **whole numbers in Guinean Francs** (GNF has no cents). No floats → no rounding bugs. USD shown in the UI is only a display conversion.

### 2.6 The ledger is the truth
`wallets` holds balances for fast reads, but **every** change is also written to `wallet_transactions` (append-only, never edited) inside the **same MongoDB transaction**. If a balance is ever wrong, it can be recomputed from the ledger.

### 2.7 Geo everywhere
Locations are GeoJSON points with `2dsphere` indexes → "products within 5 km", "jobs near you", "riders 1.2 km away", tracking maps.

### 2.8 Cached stats
`stats` / `rating_avg` / `rating_count` on vendors, riders, products and jobs are **denormalized counters** updated when something happens (review added, order delivered). This keeps list screens fast — no counting thousands of documents on every load.

---

## 3. Domain 1 — Accounts & roles

### `users`
The person. Every other collection points back here.

| Field group | Fields | Notes |
|---|---|---|
| Identity | `name`, `phone` (unique, primary login), `email` (optional for app users), `password` (null for Google/Apple-only), `avatar` | Phone is verified by SMS OTP |
| Roles | `roles[]`, `last_active_mode` | App opens in the last mode used |
| Status | `status`, `status_reason`, `token_version` | Bumping `token_version` logs the user out on every device |
| Preferences | `language` (default `fr`), `notification_prefs` | 6 toggles from the Notifications screen |
| Trust | `moderation` `{violationCount, chatRestrictedUntil}`, `blocked_user_ids[]` | Chat filter & block feature |
| Growth | `referral_code`, `referred_by` | "Share KADOU" link |
| Embedded | `user_addresses[]` (max 10) | See below |

**`user_addresses` (embedded):** label (home/office/other), full name, phone, region, city, commune, neighborhood, **landmark**, **directions**, **location pin (required)**, **place_photo** (gate/house). Built for Guinea, where formal street addresses often don't exist.

### `auth_identities` *(existing)*
Links a user to each login method: `local`, `google`, `apple`. One user can have several.

### `device_tokens` *(existing)*
Push notification tokens per device (iOS / Android / web).

---

## 4. Domain 2 — Vendor & rider profiles

### `vendor_profiles` — "Become a Vendor"
| Field group | Fields |
|---|---|
| Store | `store_name`, `logo`, `business_category_id`, `market_name`, `business_phone`, `business_email` |
| Location | `address_text`, `city`, `location` (geo) |
| Operation | `is_open` (Open/Closed toggle), `availability` `{days, openTime, closeTime}` |
| Approval | `approval_status`, `review_note`, `reviewed_by`, `reviewed_at` |
| Special | `is_platform_store` — the admin's own store (the admin can sell too) |
| Cached | `stats` `{ratingAvg, totalOrders, totalProducts, totalRevenue}` |
| Embedded | `verification_documents[]` (business license, national ID — each verified separately), `application_history[]` |

### `rider_profiles` — "Become a Delivery Partner"
| Field group | Fields |
|---|---|
| Type | `partner_type`: **`moto`** (local rider) or **`transit`** (bus driver for intercity) |
| Vehicle | `vehicle_type`, `vehicle_color`, `vehicle_brand`, `plate_number`, `vest_number` |
| Identity | `national_id_number`, `city_area` |
| Live state | `is_online` (only true in Driver Mode), `last_location`, `active_delivery_count` |
| Cash safety | `cash_limit` — max COD cash they may hold before being blocked from new COD jobs |
| Embedded | `verification_documents[]`, `application_history[]`, `rider_transit_routes[]` (bus drivers: e.g. Conakry → Labé) |

### Approval flow (same for both)
```
draft ──submit──► pending ──admin──► approved      → role added to users.roles, push + SMS
                     │
                     ├──admin──► needs_changes ──user fixes──► pending
                     └──admin──► rejected
approved ──admin──► suspended  (role only — person can still shop)
```
Every step is appended to `application_history`.

### `vendor_rider_links` — the vendor's rider network
Client rule: *"suppliers and delivery personnel connect via invitation or search."*
`vendor_id`, `rider_id`, `initiated_by`, `status` (invited → active / declined / removed).
When a vendor assigns a delivery, **linked riders appear first**, then nearby online riders.

### `transit_stations`
Admin-managed bus stations (name, city, location). Used for intercity legs and "pickup at the bus station".

---

## 5. Domain 3 — Catalog

### `categories`
One tree for everything, separated by `type`:
- `product` — Groceries, Electronics, Pharmacy… (with subcategories via `parent_id`)
- `job` — Sales, Marketing, Customer service…
- `business` — vendor store category
- `service` — worker professions (Plumber, Electrician…)

`name` is `{fr, en}`. `is_featured` = "Top Categories" on Home.

### `products`
| Field group | Fields |
|---|---|
| Basics | `vendor_id`, `category_id`, `subcategory_id`, `name`, `description`, `images[]` |
| Price | `price`, `discount_price` (GNF) |
| Detail page | `features[]` (chips), `in_the_box[]`, `tags[]` (popular / new / bestseller) |
| Stock | `stock_qty` (0 = "Out of Stock"), `min_stock_alert`, `prep_time_minutes`, `is_available` |
| Moderation | `approval_status` (admin "Pending approvals") |
| Search | `vendor_location` (copied from vendor → distance filter in one query), text index |
| Cached | `rating_avg`, `rating_count`, `sold_count` |

### `favorites`
`user_id` + `product_id` (unique pair). Separate because a user can favorite hundreds of products.

### `reviews`
**One review per vendor sub-order** (the "How was your order?" screen). It is shown on the vendor page **and** on every product in that sub-order (`product_ids[]`). `rider_id` lets the rider's rating update too. `report_count` feeds "Reported reviews" on the admin dashboard.

---

## 6. Domain 4 — Cart, orders & delivery

This is the heart of the app. Three levels:

```
orders        (what the CUSTOMER paid for — one checkout)
 └─ sub_orders  (what each VENDOR must prepare — one per vendor)
     └─ deliveries (what each RIDER must carry — 1 leg local, 3 legs intercity)
```

### `carts`
One per user, `cart_items[]` embedded (`product_id`, `vendor_id`, `qty`). **No prices stored** — always recalculated from current products, so the customer never pays a stale price.

### `orders` — one per checkout
| Field group | Fields |
|---|---|
| Who/where | `order_number` (e.g. AP421), `customer_id`, `address_snapshot` |
| Delivery | `delivery_type`: `local` / `intercity` / `station_pickup`, `destination_station_id`, `special_instructions` |
| Payment | `payment_method` (cod / orange_money / mobile_money / card), `payment_status` |
| Totals | `subtotal`, `delivery_fee` (sum of all legs), `tax_amount`, `platform_fee` (≥ 1,000 GNF), `discount`, `total` |
| Status | `status` — **derived** from its sub-orders (active / completed / cancelled / partially_cancelled) |

### `sub_orders` — one per vendor (the working document)
Why split? A cart can contain items from TechHub **and** GarageTech. Each vendor accepts, prepares and hands over **their own part**, with its own rider, status and money.

| Field group | Fields |
|---|---|
| Links | `order_id`, `vendor_id`, `customer_id`, `current_leg_id`, `current_rider_id` |
| Money | `subtotal`, `delivery_fee`, `discount_share`, `total`, `commission_rate` (snapshot), `commission_amount`, `vendor_earning` |
| Progress | `status`, `estimated_delivery_at`, `cancellation` |
| COD | `cod_amount_to_collect`, `cod_collected_by`, `cod_collected_at` |
| Escrow | `settlement`: `held` → `released` / `refunded` |
| Embedded | `sub_order_items[]` (snapshot), `sub_order_timeline[]` (tracking screens), `sub_order_modifications[]` (vendor removed an item after chat → new total + refund) |

**Commission rule:** `commission_amount = max(10% × subtotal, 1,000 GNF)`.

### `deliveries` — delivery legs
| Order type | Legs |
|---|---|
| Local | 1 × `local` (vendor → customer) |
| Intercity | `first_mile` (vendor → departure station, moto) → `line_haul` (station → station, **bus driver**) → `last_mile` (arrival station → customer, moto) |
| Station pickup | `first_mile` → `line_haul` (customer collects at the station) |

Each leg has its own `rider_id`, `fee` (100% goes to that partner — app is free for riders), status and **PINs**.

**PIN handover chain** (client's idea, extended to every handover):
- `pickup_pin_hash` — the person **giving** the parcel shows a PIN; the rider enters it → proves pickup.
- `handover_pin_hash` — the person **receiving** (next driver, or the customer) shows a PIN; the rider enters it → completes the leg.
- The customer's PIN on the last leg also confirms the **COD cash payment**. No SMS cost.
- PINs are stored hashed; `pin_attempts` + `pin_locked_until` lock after 5 wrong tries.

Every decline / reassignment stays as a record → full history of who held the parcel.

### `delivery_rates`
Admin-managed pricing, two types in one collection:
- `local`: per `city` + `vehicle_type` → `base_fee + per_km_fee × km`, at least `min_fee`
- `intercity`: per station pair → fixed `fee`, `estimated_hours`

---

## 7. Domain 5 — Money

### The two directions of money
```
MONEY IN  (customer / recruiter / job seeker → platform)   = payments
MONEY OUT (platform → vendor / rider)                      = wallets → withdrawals
```

### `payments` — every incoming payment
`purpose` says what it was for: `order`, `subscription`, `job_publish` (5,000 GNF), `cv_unlock` (5,000 GNF), `spontaneous_application`. `ref_id` points to the thing paid for. `idempotency_key` makes gateway webhooks safe to receive twice.

**CV unlock** has no separate table: a successful `payments` row with `purpose = cv_unlock`, `payer_id = recruiter`, `ref_id = candidate` *is* the unlock. A partial unique index blocks paying twice.

### `wallets` — one per user per earning mode
A person who is both vendor and rider has **two wallets** (incomes never mix).

| Balance | Meaning |
|---|---|
| `held_balance` | earned, but still in escrow (order not settled yet) |
| `available_balance` | can be withdrawn |
| `total_earned`, `total_commission`, `total_withdrawn` | lifetime totals for the Earnings screen |
| `cash_owed` | **riders only** — COD cash collected but not yet handed to the platform |

`wallet_payout_methods[]` (embedded): Orange Money / Mobile Money / bank accounts.

### `wallet_transactions` — the ledger
Every movement, e.g. `earning_held`, `earning_released`, `commission`, `withdrawal`, `withdrawal_fee`, `cod_collected`, `cod_settled`, `cod_offset`, `refund_deduction`, `adjustment`. Each row stores `amount` (+/−) and `balance_after`.

### `withdrawals`
Vendor/rider requests money → admin approves → pays → enters `transaction_id` + uploads `receipt_image` → `completed`. `created_by_admin = true` for the admin's "Create vendor payout".

### `cod_settlements`
Rider hands over collected cash (Orange Money transfer, office deposit, or offset against earnings) → admin confirms → `cash_owed` goes down.

### `refunds` & `disputes`
Admin "Issue refund" and "Payment dispute" screens. A refund also writes a `refund_deduction` in the vendor's ledger if the money was already credited.

---

## 8. Domain 6 — Jobs, CV & subscriptions

### `professional_profiles` — CV **and** worker listing
Any customer or vendor can have one.
| Part | Fields |
|---|---|
| CV | `profession`, `summary`, `photo`, `skills[]`, `languages[]`, `achievements[]`, `profile_education[]`, `profile_experience[]` |
| Files | `uploaded_resume` (own CV) and/or `generated_cv` (AI) |
| Worker listing | `is_worker_listed`, `hourly_rate`, `experience_years`, `service_category_id` → "Popular Workers" + worker search |
| Visibility | `cv_visible`, `visible_until` — switched on by an active subscription |

### `jobs`
Anyone can post (customer, vendor or rider mode → `posted_by_mode`). Fields mirror the 3-step "Create Job Post" form: basics, location, salary (`currency`, min, max, frequency), about / responsibilities / requirements / benefits, candidate preferences (used for the **% match**), application settings.
Publishing requires a **5,000 GNF payment**: `draft → pending_payment → published` (30 days, `expires_at`) → `expired` / `closed`.

### `job_applications`
- `kind = offer` → applied to a `job_id` (unique per job + applicant)
- `kind = spontaneous` → paid application sent directly to a seller (`target_vendor_id`)
- `cv_snapshot`, `match_score`, `status` (applied → under_review → shortlisted → interview → hired / rejected), `interview` details, `conversation_id` (recruiter ↔ candidate thread)

### `subscription_plans` & `user_subscriptions`
Admin creates plans (e.g. "Professional", 10$/month equivalent in GNF) with `features[]` and `audience` (job seeker / service provider). A purchase creates a `user_subscriptions` row with a `plan_snapshot`; a background job expires it at `ends_at`.

---

## 9. Domain 7 — Chat & trust

### `conversations`
`type`: `order` (customer/vendor/rider about a sub-order), `buyer_seller` (before ordering), `worker` (messaging a worker), `job_application`.
`conversation_participants[]` (embedded) stores each person's `mode` (so the vendor inbox and customer inbox are separate) and `unread_count`.
`allow_voice = true` **only** for customer ↔ rider (client rule — helps users who cannot read).
Every new conversation gets an automatic **system warning**: pay only through Kadou24h or on delivery.

### `messages`
Separate collection (unbounded). `type`: text / voice / image / system.
**Before saving**, a filter checks for phone numbers, emails, links and social handles → `moderation_status` = clean / masked / blocked.

### `moderation_violations`
Each filter hit is recorded. Escalation (configurable in `settings.moderation`): 1st → warning, 3rd → chat restricted 24h, 5th → suspended pending admin review.

### `reports`
"Report rider / issue / review" → admin queue. Targets: user, review, order, message.

### `notifications`
In-app inbox, per `mode`. `title`/`body` in `{fr, en}`, `data` for deep-links, TTL auto-delete after ~90 days. Push delivery uses `device_tokens`.

---

## 10. Domain 8 — Platform & admin

| Collection | Purpose |
|---|---|
| `support_tickets` | Help & Support form (type, urgency, attachments) → admin Support screen |
| `advertisements` | Banners sold to outside advertisers: placement, start/end, impressions, clicks |
| `settings` | **One document** with every configurable number: commission 10% / min 1,000, platform fee 1,000, job publish / CV unlock 5,000, withdrawal fees, rider cash limit, moderation thresholds, support contacts |
| `audit_logs` | Who did what (approvals, suspensions, every money action), with before/after |
| `counters` | Generates readable numbers: AP421, WD-10245, SUP-204 |

Admin team members are `users` with roles `super_admin` (Owner) / `admin` / `staff`.

---

## 11. End-to-end walkthroughs

### 11.1 New user becomes a vendor
1. Splash → language → sign up with phone → OTP → `users` created, `roles = ["customer"]`.
2. Profile → "Become a Vendor" → `vendor_profiles` created with `approval_status = draft`, documents uploaded.
3. Submit → `pending` → appears in admin "Vendors → Pending approvals".
4. Admin verifies each document → approves → `users.roles` adds `"vendor"`, a vendor `wallet` is created, push + SMS sent.
5. Profile shows **Switch to Vendor Dashboard**; `last_active_mode = vendor`.

### 11.2 Local COD order — with real numbers
Customer buys 2 items from TechHub = **100,000 GNF**, delivery 6 km.

**Checkout** (`orders` + 1 `sub_orders` + 1 `deliveries`):
| Line | Amount |
|---|---|
| Subtotal | 100,000 |
| Delivery fee (from `delivery_rates`) | 15,000 |
| Platform fee | 1,000 |
| **Customer pays (cash)** | **116,000** |

**Split:**
| Who | Amount | How |
|---|---|---|
| Vendor | 90,000 | 100,000 − commission max(10,000, 1,000) |
| Rider | 15,000 | full delivery fee |
| Platform | 11,000 | 10,000 commission + 1,000 platform fee |
| **Total** | **116,000** | ✔ |

**Flow:**
1. Vendor accepts → assigns a linked rider → `deliveries` leg `assigned` → rider accepts.
2. Vendor marks ready → rider arrives → enters vendor's **pickup PIN** → `picked_up`.
3. Rider delivers → customer pays 116,000 cash → gives **handover PIN** → rider enters it → `delivered`.
4. Ledger entries:
   - Rider wallet: `cod_collected` → `cash_owed += 116,000`; `earning` +15,000.
   - Vendor wallet: `earning_held` +90,000 (+ `commission` record 10,000).
5. Rider settles cash (or it is offset against the 15,000 earning) → `cash_owed` back to 0 → vendor's 90,000 `earning_released` → withdrawable.

### 11.3 Intercity order (Conakry → Labé)
`delivery_type = intercity` → **3 legs**:
| Leg | Who | Fee (example) |
|---|---|---|
| 1. first_mile: TechHub → Conakry bus station | moto rider A | 10,000 |
| 2. line_haul: Conakry → Labé station | bus driver B | 50,000 |
| 3. last_mile: Labé station → customer | moto rider C | 10,000 |
| **Delivery fee shown at checkout** | | **70,000** |

At each handover the **receiver's PIN** is entered (A→B, B→C, C→customer). Only leg 3 has `collects_cash = true`. Each partner is credited their own leg fee.

### 11.4 Vendor edits an order from chat
Customer: "please remove the headset". Vendor removes it → `sub_order_items[].removed = true`, a `sub_order_modifications` row (old total, new total, refund), totals recalculated. Prepaid → a `refunds` row; COD → `cod_amount_to_collect` simply drops.

### 11.5 Withdrawal
Vendor requests 25,000 GNF via Orange Money → `withdrawals` (pending) and ledger `withdrawal` (−25,000 from available) → admin pays, uploads receipt → `completed` with `fee` recorded. Rejected → `withdrawal_reversal` (+25,000 back).

### 11.6 Job post, application, CV unlock
1. Recruiter fills the form → `jobs` (draft) → pays 5,000 → `payments(job_publish)` → `published` for 30 days.
2. Candidate applies with CV → `job_applications(kind = offer)`, `match_score` computed.
3. Recruiter wants contact details → pays 5,000 → `payments(cv_unlock, ref_id = candidate)` → full CV visible.
4. Recruiter invites to interview → `status = interview`, `interview {at, location, mapUrl}` → candidate confirms in the thread.

### 11.7 Someone shares a phone number in chat
"Call me 622 12 34 56" → filter matches `phone` → message `blocked` (or masked) → `moderation_violations` row → `users.moderation.violationCount++` → at threshold, chat restricted / account suspended; admin can review.

---

## 12. Status machines

Statuses only move along these arrows — the backend rejects anything else.

**Sub-order (vendor side)**
```
new → accepted → preparing → ready_for_pickup → in_delivery → delivered
  └──────────┴──────────┴──→ cancelled  (before pickup)
```

**Delivery leg (rider side)**
```
pending_assignment → assigned → accepted → going_to_pickup → picked_up → in_transit → delivered
                        └→ declined (back to pending_assignment)        any → cancelled
```

**Settlement (escrow)**
```
held → released   (delivered + COD cash settled)
held → refunded   (cancelled / refunded)
```

**Withdrawal**: `pending → approved → completed` or `pending → rejected`
**Job**: `draft → pending_payment → published → closed / expired`
**Application**: `applied → under_review → shortlisted → interview → hired / rejected` (+ `withdrawn`)
**Profile approval**: `draft → pending → approved / rejected / needs_changes → pending …`, `approved → suspended`

---

## 13. Redis — what is NOT in MongoDB

| Key | Content | Why Redis |
|---|---|---|
| `otp:<purpose>:<phone>` | hashed OTP + attempts, 5-min TTL | short-lived |
| `rider:<id>:loc` | live lat/lng | updates every few seconds |
| rate-limit keys | OTP / login / chat send limits | fast counters |
| socket presence | who is online | Socket.io adapter (already in boilerplate) |
| BullMQ queues | notifications, escrow release, ad/subscription/job expiry | background jobs |

---

## 14. Build phases

| Phase | Collections |
|---|---|
| **1 — MVP** | users, auth_identities, device_tokens, vendor_profiles, rider_profiles, vendor_rider_links, categories, products, favorites, reviews, carts, orders, sub_orders, deliveries, delivery_rates, payments, wallets, wallet_transactions, withdrawals, cod_settlements, refunds, conversations, messages, moderation_violations, reports, notifications, support_tickets, settings, audit_logs, counters |
| **2** | transit_stations (+ intercity legs), professional_profiles, jobs, job_applications, subscription_plans, user_subscriptions, advertisements, disputes, coupons (new) |
| **3** | AI CV generation & job matching, card payments, referral rewards |

---

## 15. Open questions

| # | Question | Affects |
|---|---|---|
| 1 | Workers: completely free, or do service providers pay a subscription to stay visible? (client gave both answers) | `subscription_plans.audience` |
| 2 | Is the 1,000 GNF commission minimum per item or per vendor order? (designed: per sub-order) | `sub_orders.commission_amount` |
| 3 | Can customers prepay with Orange Money / card, or is everything paid at delivery? | `payments`, checkout flow |
| 4 | Do partners set their own prices, or does the admin set rates? (designed: admin) | `delivery_rates` |
| 5 | Default COD handover: Orange Money transfer, office deposit, or auto-offset? | `cod_settlements.method` |
| 6 | Chat filter: block the whole message or mask the contact part? | `messages.moderation_status` |
| 7 | Hide phone numbers completely, even from riders during delivery? | API responses |
| 8 | Payment gateway for Orange Money / Mobile Money / card? | `payments.provider` |
| 9 | Spontaneous application price — also 5,000 GNF? | `settings.spontaneous_application_fee` |
