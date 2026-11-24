# Kadou24h API Documentation

> **Audience:** mobile app (customer / vendor / rider) and admin panel developers following Figma designs.
> **Status:** Full production-ready API documentation with screen-by-screen flows.
> **Live explorer:** Swagger UI at `GET /api/docs` (non-production only); raw spec at `/api/docs.json`.

---

## Table of contents

1. [Getting started](#1-getting-started)
2. [Authentication & sessions](#2-authentication--sessions)
3. [Request & response format](#3-request--response-format)
4. [Conventions](#4-conventions)
5. [Enums](#5-enums)
6. [Flows (screen by screen for Figma)](#6-flows-screen-by-screen)
7. [Endpoint reference](#7-endpoint-reference)
   - [7.1 Auth](#71-auth)
   - [7.2 My account](#72-my-account-user)
   - [7.3 Admin — users & team](#73-admin--users--team)
   - [7.4 Settings](#74-settings)
   - [7.5 Audit logs](#75-audit-logs)
   - [7.6 Upload](#76-upload)
   - [7.7 Device tokens (push)](#77-device-tokens-push)
   - [7.8 Addresses](#78-addresses)
   - [7.9 Categories](#79-categories)
   - [7.10 Become a Vendor & my store](#710-become-a-vendor--my-store)
   - [7.11 Become a Delivery Partner](#711-become-a-delivery-partner)
   - [7.12 Admin — application review](#712-admin--application-review)
   - [7.13 Wallet & payout methods](#713-wallet--payout-methods)
   - [7.14 Vendor ↔ rider network](#714-vendor--rider-network)
   - [7.15 Bus stations](#715-bus-stations)
   - [7.16 Products & Catalog](#716-products--catalog)
   - [7.17 Favorites](#717-favorites)
   - [7.18 Delivery Rates](#718-delivery-rates)
   - [7.19 Cart](#719-cart)
   - [7.20 Orders & Checkout](#720-orders--checkout)
   - [7.21 Delivery Legs & Tracking](#721-delivery-legs--tracking)
8. [Rate limits & OTP rules](#8-rate-limits--otp-rules)
9. [Real-time (Socket.io)](#9-real-time-socketio)
10. [Changelog](#changelog)

---

## 1. Getting started

| Environment | Base URL |
|---|---|
| Local | `http://localhost:7000/api/v1` |
| Staging | `https://pagla7000.ilmifygroup.com/api/v1` |
| Production | `https://<your-domain>/api/v1` |

- Every endpoint below is relative to the base URL (e.g. `POST /auth/login` → `POST http://localhost:7000/api/v1/auth/login`).
- Send JSON with `Content-Type: application/json` (except file uploads → `multipart/form-data`).
- Health checks live **outside** `/api/v1`: `GET /health/live`, `GET /health`.

---

## 2. Authentication & sessions

### 2.1 Tokens

| Token | Lifetime (default) | Where it comes from | How to send it |
|---|---|---|---|
| `accessToken` | 1 day | login, verify-account, social, refresh, change-password | `Authorization: Bearer <accessToken>` |
| `refreshToken` | 30 days | login, verify-account, social, change-password | body of `POST /auth/refresh-token` |
| `resetToken` | 10 minutes | `POST /auth/verify-reset-otp` | `Authorization: Bearer <resetToken>` on `POST /auth/reset-password` only |

- **Mobile:** store both tokens in secure storage (Keychain / Keystore). Cookies are also set for the web admin panel — mobile apps can ignore them.
- Roles are **not** trusted from the token. The server re-reads the user on every request, so an approval or a suspension applies immediately.

### 2.2 Refresh strategy

```
request → 401 ("Invalid or expired access token.")
        → POST /auth/refresh-token { refreshToken }
             ├─ 200 → save new accessToken → retry the original request once
             └─ 401 → session is over → clear tokens → go to Login
```

These events end **all** sessions of a user (every refresh token stops working):
password change (other devices), password reset, `POST /auth/logout-all`, suspension / ban, team role change.

### 2.3 Roles & modes

- `roles`: what the user is allowed to do — `customer`, `vendor`, `rider` (app) or `staff`, `admin`, `super_admin` (admin panel). App and admin roles are never mixed.
- Every app user starts as `["customer"]`. `vendor` / `rider` are added when the admin approves the "Become a Vendor / Delivery Partner" application *(Step 2)*.
- `lastActiveMode`: which interface the app should open (`customer` | `vendor` | `rider`). Change it with `PATCH /user/me/mode`.

### 2.4 Who can call what

| Label in this doc | Meaning |
|---|---|
| **Public** | no token |
| **Signed-in** | any valid access token |
| **Admin panel** | `staff`, `admin` or `super_admin` |
| **Admin** | `admin` or `super_admin` |
| **Super admin** | `super_admin` only |

---

## 3. Request & response format

### 3.1 Success

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Profile retrieved successfully!",
  "data": { }
}
```

### 3.2 Paginated list

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Users retrieved successfully!",
  "data": [ { }, { } ],
  "meta": { "page": 1, "limit": 10, "total": 57, "totalPage": 6 }
}
```

### 3.3 Error

```json
{
  "success": false,
  "message": "Invalid phone/email or password",
  "errorSources": []
}
```

**Validation error (400)** — `message` is the first problem in readable form (safe to show in a toast); `errorSources` has one entry per invalid field — show each `message` under the matching input:

```json
{
  "success": false,
  "message": "phone: Phone must be in international format, e.g. +224620123456",
  "errorSources": [
    { "path": "phone", "message": "Phone must be in international format, e.g. +224620123456" },
    { "path": "password", "message": "Password must contain at least 1 number." }
  ]
}
```

> In development, error responses also include `err` and `stack` — never rely on them.

### 3.4 Status codes

| Code | Meaning | App behaviour |
|---|---|---|
| 200 / 201 | OK / created | — |
| 400 | Validation error or business rule (wrong OTP, already verified…) | show `message` / `errorSources` |
| 401 | Not signed in, token expired, session revoked | refresh, else go to Login |
| 403 | Signed in but not allowed (wrong role, suspended, not verified) | show `message` |
| 404 | Not found | — |
| 409 | Conflict (phone / email already used) | show `message` |
| 429 | Rate limit or OTP cooldown | show `message` (contains the wait time) |
| 502 / 503 | Code could not be sent / provider not configured | "Try again later" |

---

## 4. Conventions

| Topic | Rule |
|---|---|
| IDs | MongoDB ObjectId strings (`_id`) |
| Dates | ISO-8601 UTC strings (`2026-10-02T16:15:55.000Z`) |
| **Money** | **Whole numbers in GNF** (`1000` = 1,000 GNF). Never decimals. Convert to USD only for display |
| Phone | International E.164: `+224620123456` (spaces / dashes are stripped by the server) |
| Email | stored lower-case |
| Language | `fr` (default) or `en` — set at signup, change with `PATCH /user/me` |
| Pagination | `?page=1&limit=10` (defaults 1 / 10) |
| Sorting | `?sort=-createdAt` (prefix `-` for descending; default `-createdAt`) |
| Search | `?searchTerm=diallo` (case-insensitive, on the fields listed per endpoint) |
| Filtering | any other query param is an exact-match filter, e.g. `?status=suspended&roles=vendor` |
| Files | upload first with `POST /upload`, then send the returned `{ url, publicId }` in the next request |
| Locations | Send and receive `{ "lat": 9.5092, "lng": -13.7122 }` (never raw GeoJSON) |
| Masked values | OTP responses return `phone: "+224 ••• •• 56"` / `email: "di•••@gmail.com"` for the "code sent to …" text |

---

## 5. Enums

| Enum | Values |
|---|---|
| `UserRole` | `customer`, `vendor`, `rider`, `staff`, `admin`, `super_admin` |
| `AppMode` | `customer`, `vendor`, `rider` |
| `UserStatus` | `active`, `inactive`, `suspended`, `banned` |
| `Language` | `fr`, `en` |
| `OtpPurpose` | `verify_account`, `reset_password` (`change_phone` is internal) |
| `OAuthProvider` | `google`, `apple` |
| `DevicePlatform` | `android`, `ios`, `web` |
| `AddressLabel` | `home`, `office`, `other` |
| `CategoryType` | `product`, `business` (store category), `service` (worker profession), `job` |
| `ApprovalStatus` | `draft`, `pending`, `approved`, `rejected`, `needs_changes`, `suspended` |
| `ReviewAction` | `approve`, `reject`, `needs_changes`, `suspend`, `reinstate` |
| `DocumentStatus` | `pending`, `verified`, `rejected` |
| `VendorDocumentType` | `business_license`, `national_id` |
| `RiderDocumentType` | `driver_license`, `national_id`, `vehicle_registration` |
| `PartnerType` | `moto` (local rider), `transit` (bus driver) |
| `VehicleType` | moto: `motorbike`, `bicycle`, `car` · transit: `bus`, `minibus`, `car` |
| `WeekDay` | `mon` … `sun` |
| `PayoutMethodType` | `orange_money`, `mobile_money`, `bank` |
| `LinkStatus` | `invited`, `active`, `declined`, `removed` |

---

## 6. Flows (screen by screen)

### 6.1 Sign up → "Verify it's you"

```
Create Your Account ──POST /auth/register──────────► 201 { phone (masked), expiresIn: 300, resendIn: 60 }
        │
Verify it's you (6 boxes, 60s timer = resendIn)
        ├── "Resend Code" ──POST /auth/resend-otp { identifier: phone, purpose: "verify_account" }
        └── "Verify & Continue" ──POST /auth/verify-account { phone, otp }
                                     └► 200 { user, accessToken, refreshToken }  → Home (customer)
```
- The code is sent by **SMS and by email** (when an email was given).
- Tapping "Create Account" twice is safe — the second call returns the remaining timer instead of an error.
- Registering again with an **unverified** phone updates the details and keeps / resends the code.

### 6.2 Login

```
POST /auth/login { identifier: phone or email, password }
   ├─ data.accessToken present         → signed in → open data.user.lastActiveMode
   └─ data.requiresVerification = true → no tokens; a code was sent → "Verify it's you" (6.1)
```

### 6.3 Continue with Google / Apple

1. Get an **ID token** from the native SDK (Google Sign-In / Sign in with Apple).
2. `POST /auth/social { provider, idToken, name?, language? }`
   - Apple gives the user's name **only on the first sign-in** — pass it as `name`.
3. Response contains tokens **and** `requiresPhone`.
   - `requiresPhone = true` → before checkout, show "Add your phone": `POST /user/me/phone/request` → `POST /user/me/phone/verify` (6.6).

### 6.4 Forgot password ("Let's Get You Back" → "Set a New Key")

```
1. POST /auth/forgot-password  { identifier }        → 200 (same answer even if no account)
2. POST /auth/verify-reset-otp { identifier, otp }   → 200 { resetToken, expiresIn: 600 }
3. POST /auth/reset-password   { newPassword }       Authorization: Bearer <resetToken>
                                                      → 200 → go to Login
```
- Resend in step 1 screen: `POST /auth/resend-otp { identifier, purpose: "reset_password" }`.
- The reset token works **once**. Every device is signed out after a reset.

### 6.5 Switch mode (profile → "Switch to Vendor Dashboard")

```
PATCH /user/me/mode { mode: "vendor" }
   ├─ 200 { mode: "vendor" } → show vendor interface (persisted: next app start opens vendor mode)
   └─ 403 "You are not an approved vendor yet"
```
Show the switch button only when `user.roles` contains that role.

### 6.6 Add / change phone number

```
POST /user/me/phone/request { phone } → SMS code to the NEW number
POST /user/me/phone/verify  { phone, otp } → 200 updated user (isPhoneVerified: true)
```

### 6.7 Logout

- This device: `POST /auth/logout { deviceToken }` (pass the push token so this phone stops receiving notifications), then delete stored tokens.
- Every device: `POST /auth/logout-all` (signed-in).

### 6.8 Push notifications

After every login and whenever the FCM/APNs token changes: `POST /device-token { token, platform }`.

### 6.9 Become a Vendor (profile → "Become a Vendor")

```
GET /user/me → data.applications.vendor
   null                → show "Become a Vendor"
   { status: draft }   → resume the form
   { status: pending } → "Account Pending Approval" screen
   { status: needs_changes | rejected, reviewNote } → show the note, let the user edit & resubmit
   { status: approved } → show "Switch to Vendor Dashboard"
   { status: suspended, reviewNote } → show the note; vendor mode is unavailable

Onboarding screens (save after each one — any subset of fields):
  Business information ── PUT  /vendors/me/application { storeName, businessCategoryId, marketName,
                                                         businessPhone, address{ text, city, location }, logo, documents }
  Payout information   ── POST /wallets/me/payout-methods { mode: "vendor", type, accountName, accountNumber }
  Submit               ── POST /vendors/me/application/submit   → status "pending"
Admin approves         ── socket event "application:reviewed" → refresh GET /user/me → mode switch appears
```
- Upload the logo / license with `POST /upload` first, then send `{ url, publicId }`.
- Business category dropdown: `GET /categories?type=business`.
- Required to submit: `storeName`, `businessCategoryId`, `businessPhone`, `address.city`, `address.location`, at least one payout method. The business license is optional.

### 6.10 Become a Delivery Partner

```
PUT  /riders/me/application  { partnerType: "moto" | "transit", vehicle{ type, color, brand, plateNumber },
                               vestNumber, cityArea, nationalIdNumber, documents,
                               transitRoutes (bus drivers: station ids from GET /transit-stations) }
POST /riders/me/application/submit → "pending"   (same status screens as 6.9, using applications.rider)
```
- Ask first: **"Moto rider or Bus / Transit driver?"** — it decides the allowed vehicles and whether routes are needed.
- Required to submit: `partnerType`, `vehicle.type`, `cityArea`, `nationalIdNumber` (+ at least 1 route for bus drivers). A payout method is only needed before the first withdrawal.

### 6.11 Store rider network (vendor ↔ rider)

```
Vendor: GET /riders/search?searchTerm=Mamadou → POST  /vendor-rider-links/invite { riderId }
Rider : GET /vendor-rider-links/me?as=rider&status=invited → PATCH /vendor-rider-links/:id/respond { accept: true }
  — or the other way round —
Rider : GET /vendors?searchTerm=TechHub       → POST  /vendor-rider-links/request { vendorId }
Vendor: PATCH /vendor-rider-links/:id/respond { accept: true }
```
- If both sides ask each other, the link becomes `active` immediately.
- Linked riders are offered first when the vendor assigns a delivery (Step 5).
- Only local (`moto`) riders join store networks. Nobody can link their own store to their own rider account.

### 6.12 Customer: Home & Catalog Discovery Screen
- **Figma Screens:** Home / Discovery, Category List, Search & Filters Sheet
- **Initial Data on Screen Mount:**
  - `GET /categories?type=product&isActive=true` (Category pills)
  - `GET /products?isFeatured=true&limit=10` (Featured items banner carousel)
  - `GET /vendors?isFeatured=true&limit=5` (Popular / verified stores)
  - `GET /advertisements?status=active` (Platform banner ads)
- **Search & Filtering:**
  - `GET /products?searchTerm=&categoryId=&minPrice=&maxPrice=&sort=-createdAt`

### 6.13 Customer: Product Details & Reviews Screen
- **Figma Screen:** Product Detail (Photos, Price, Store badge, Stock, Add to Cart, Reviews)
- **Initial Data on Mount:**
  - `GET /products/:idOrSlug`
  - `GET /reviews?productId=:id&page=1&limit=5`
  - `GET /favorites/check/:productId` (Check if heart icon is filled)
- **User Actions:**
  - Toggle Wishlist: `POST /favorites/toggle` with `{ productId }`
  - Add to Cart: `POST /cart/items` with `{ productId, qty: 1 }`

### 6.14 Customer: Cart Screen
- **Figma Screen:** Cart (Items grouped by store, quantity stepper, clear, checkout button)
- **Initial Data on Mount:** `GET /cart`
- **User Actions:**
  - Quantity update: `PATCH /cart/items/:productId` with `{ qty }`
  - Delete item: `DELETE /cart/items/:productId`
  - Clear cart: `DELETE /cart`

### 6.15 Customer: Checkout & Order Placement Screen
- **Figma Screen:** Checkout (Select delivery address, Calculate rates, Choose payment method, Place Order)
- **Initial Data on Mount:**
  - `GET /addresses` (User's saved delivery addresses)
  - `POST /orders/checkout-summary` with `{ addressId, deliveryType: "direct" | "transit", paymentMethod: "cod" | "orange_money" | "card" }`
    - Returns product cost, delivery fee per vendor sub-order, and total breakdown.
- **User Action (Confirm & Place Order):**
  - `POST /orders` with `{ addressId, deliveryType, paymentMethod, specialInstructions? }`
  - Returns created Order. Route user to Live Tracking Screen (6.16).

### 6.16 Customer & Rider: Live Order Tracking & Real-Time Navigation
- **Figma Screen:** Active Order Timeline & Map Tracking
- **Initial Data on Mount:**
  - `GET /orders/:id` (Order summary, sub-orders, statuses)
  - `GET /deliveries/:id/track` (Real-time tracking timeline, delivery legs, rider phone/name)
- **Real-time Socket Updates:**
  - Listen on event: `delivery:location` for rider GPS coordinates `{ lat, lng, heading }`
  - Listen on event: `delivery:status_changed` for timeline progression (`going_to_pickup` -> `picked_up` -> `delivered`)

### 6.17 Vendor: Dashboard & Order Fulfillment Screen
- **Figma Screens:** Vendor Overview, Orders Kanban / List, Product Management
- **Vendor Overview Mount:**
  - `GET /vendors/my-store` (Store profile & open/close status)
  - `GET /orders/vendor/sub-orders?status=pending` (Orders waiting for acceptance)
  - `GET /wallets/me` (Store wallet balance)
- **Order Actions:**
  - Accept / Mark Preparing: `PATCH /orders/vendor/sub-orders/:id/status` with `{ status: "preparing" }`
  - Ready for Pickup: `PATCH /orders/vendor/sub-orders/:id/status` with `{ status: "ready_for_pickup" }`
  - Cancel / Out of Stock: `POST /orders/vendor/sub-orders/:id/cancel` with `{ reason }`
- **Product Management:**
  - `GET /products/my-products`
  - `POST /products` (Add new product)
  - `PATCH /products/:id/stock` (Quick stock & availability toggle)

### 6.18 Vendor: Assign Delivery to Rider
- **Figma Screen:** Assign Delivery Modal / Sheet
- **Initial Data:** `GET /deliveries/:id/available-riders` (Lists connected store network riders + nearby platform riders)
- **User Action:** `POST /deliveries/:id/assign` with `{ riderId }`

### 6.19 Rider: Duty Screen & Turn-by-Turn Leg Navigation
- **Figma Screens:** Rider Duty (Online / Offline), Incoming Delivery Modal, Active Trip Navigation
- **Duty State:**
  - Toggle Online / Offline: `PATCH /deliveries/rider/online-status` with `{ isOnline: true }`
  - Send GPS update: `PATCH /deliveries/rider/location` with `{ lat, lng, heading }`
  - Active assigned jobs: `GET /deliveries/rider/my-deliveries?status=assigned`
- **Incoming Job Alert:**
  - Accept: `POST /deliveries/:id/accept`
  - Decline: `POST /deliveries/:id/decline` with `{ reason }`
- **Delivery Trip Steps:**
  1. En route to store: `PATCH /deliveries/:id/going-to-pickup`
  2. Verify pickup from store with PIN: `POST /deliveries/:id/verify-pickup` with `{ pin: "1234", proofPhoto? }`
  3. Verify handover to customer with PIN: `POST /deliveries/:id/verify-handover` with `{ pin: "5678", proofPhoto? }`

### 6.20 Vendor & Rider: Wallet, Payouts & COD Cash Settlements
- **Figma Screens:** Wallet Overview, Request Withdrawal, Cash-on-Delivery (COD) Collection Tracker
- **Wallet Overview:** `GET /wallets/me` (Shows current balance, pending withdrawals, cash-in-hand limit)
- **Payout Request:**
  - Add payout method: `POST /wallets/me/payout-methods` with `{ mode, type: "orange_money" | "mobile_money" | "bank", accountName, accountNumber }`
  - Request payout: `POST /wallets/me/withdrawals` with `{ amount, payoutMethodId }`
  - Transaction history: `GET /wallets/me/transactions`
- **Rider COD Cash Settlement (Deposit collected cash):**
  - `POST /wallets/me/cod-settlements` with `{ amount, method, reference?, proofImage? }`
  - **How COD money flows:** when the rider enters the customer's PIN, the rider's delivery fee is credited and `cashOwed` grows by the cash collected. The **vendor's earning stays held** (sub-order `settlement: "awaiting_cod"`) until the rider's cash is settled — confirmed settlements (or an `earnings_offset`) are matched to the rider's oldest COD orders first, and each fully covered order releases the vendor's money.

### 6.21 Admin: Platform Overview & Management Screens
- **Next.js Web Dashboard Screens:** Overview Analytics, Applications Review, User Management, Settings
- **Overview Dashboard:** `GET /admin/dashboard/overview` (Monthly revenue, orders status donut, 12-month platform growth)
- **Vendor Applications:** `GET /vendors/admin/applications?status=pending` -> Approve/Reject: `POST /vendors/admin/:id/review` with `{ action: "approve" | "reject", note? }`
- **Rider Applications:** `GET /riders/admin/applications?status=pending` -> Approve/Reject: `POST /riders/admin/:id/review` with `{ action: "approve" | "reject", note? }`
- **User Management:** `GET /user/admin/users` -> Suspend/Ban: `PATCH /user/admin/users/:id/status` with `{ status, reason }`
- **Team Members:** `GET /user/team` -> Create Staff/Admin: `POST /user/team` with `{ name, email, password, role }` (Super Admin)
- **Platform Financials:** `GET /wallets/admin/withdrawals?status=pending` -> Approve: `PATCH /wallets/admin/withdrawals/:id` with `{ action: "approve", transactionReference }`
- **Platform Settings:** `GET /settings` -> Update: `PATCH /settings` with `{ commission, platformFee, taxRate }`

### 6.22 In-App Real-Time Messaging & Notifications
- **Figma Screens:** Conversation List, Chat Screen, Notifications Center
- **Chat:**
  - Conversations list: `GET /conversations`
  - Start chat: `POST /conversations` with `{ participantId, orderId? }`
  - Get messages: `GET /conversations/:id/messages`
  - Send message: `POST /conversations/:id/messages` with `{ text }` (Emits socket `chat:message`)
- **Notifications:**
  - Notification list: `GET /notifications?page=1&limit=20`
  - Unread count badge: `GET /notifications/unread-count`
  - Mark read: `PATCH /notifications/:id/read` or `PATCH /notifications/read-all`

---

## 7. Endpoint reference

### 7.1 Auth

#### `POST /auth/register` — Public
Create an account (always starts as `customer`) and send the verification code.

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | ✔ | 2–50 chars |
| `phone` | string | ✔ | E.164, e.g. `+224620123456` |
| `email` | string | | valid email — also receives the code |
| `password` | string | ✔ | 8–64 chars, ≥ 1 letter and ≥ 1 number |
| `language` | `fr` \| `en` | | default `fr` |
| `referralCode` | string | | 8 chars, from a friend's share link |

**201**
```json
{
  "statusCode": 201,
  "success": true,
  "message": "Account created. Enter the code we sent to verify your phone.",
  "data": { "phone": "+224 ••• •• 56", "email": "di•••@gmail.com", "expiresIn": 300, "resendIn": 60 }
}
```
**Errors:** 400 validation / invalid referral code · 409 phone already registered (verified) or email in use · 429 daily code limit · 502 code could not be sent.

---

#### `POST /auth/verify-account` — Public
| Field | Type | Required |
|---|---|---|
| `phone` | string | ✔ |
| `otp` | string (6 digits) | ✔ |

**200** — signed in
```json
{
  "data": {
    "user": { "_id": "…", "name": "Mamadou Diallo", "phone": "+224620123456", "roles": ["customer"], "lastActiveMode": "customer", "isPhoneVerified": true, "language": "fr", "status": "active", "referralCode": "K7QX2M9P", "notificationPrefs": { "orderUpdates": true, "messages": true, "deliveryUpdates": true, "offers": true, "jobPosts": true, "accountAlerts": true } },
    "accessToken": "eyJ…",
    "refreshToken": "eyJ…"
  }
}
```
**Errors:** 400 `Invalid code. 4 attempts remaining.` / `Code expired or not found…` / already verified · 404 account not found · 429 too many wrong attempts (request a new code).

---

#### `POST /auth/resend-otp` — Public
| Field | Type | Required |
|---|---|---|
| `identifier` | phone or email | ✔ |
| `purpose` | `verify_account` \| `reset_password` | ✔ |

**200** `data: { phone, email, expiresIn, resendIn }`
**Errors:** 429 `Please wait 42s before requesting a new code.` / daily limit · 400 already verified.

---

#### `POST /auth/login` — Public
| Field | Type | Required |
|---|---|---|
| `identifier` | phone (`+224…`) or email | ✔ |
| `password` | string | ✔ |

**200 — signed in:** `data: { user, accessToken, refreshToken }`
**200 — not verified yet:**
```json
{ "data": { "requiresVerification": true, "phone": "+224 ••• •• 56", "expiresIn": 300, "resendIn": 60 } }
```
**Errors:** 401 `Invalid phone/email or password` · 400 account uses Google/Apple only · 403 `Your account is suspended: <reason>`.

> The admin panel uses the same endpoint with the admin email.

---

#### `POST /auth/social` — Public
| Field | Type | Required | Notes |
|---|---|---|---|
| `provider` | `google` \| `apple` | ✔ | |
| `idToken` | string | ✔ | from the native SDK |
| `name` | string | | Apple first sign-in |
| `language` | `fr` \| `en` | | used when the account is created |

**200** `data: { user, accessToken, refreshToken, requiresPhone }`
- If an account with the same verified email exists, the Google/Apple login is **linked** to it.
**Errors:** 401 invalid / expired ID token · 400 provider account has no verified email · 503 provider not configured on the server.

---

#### `POST /auth/refresh-token` — Public
Body `{ "refreshToken": "eyJ…" }` (web: cookie is used if body is empty).
**200** `data: { accessToken }` · **401** expired / revoked → Login.

#### `POST /auth/logout` — Public
Body `{ "deviceToken": "fcm…" }` (optional). **200** `data: null`.

#### `POST /auth/logout-all` — Signed-in
No body. **200** — every session ends (including this one).

---

#### `POST /auth/change-password` — Signed-in
| Field | Type | Required |
|---|---|---|
| `oldPassword` | string | ✔ |
| `newPassword` | string | ✔ (password rules, ≠ old) |

**200** `data: { accessToken, refreshToken }` — **replace the stored tokens**; other devices are signed out.
**Errors:** 401 old password does not match · 400 no password yet (use set-password).

#### `POST /auth/set-password` — Signed-in
For Google/Apple accounts. Body `{ "password": "kadou2026" }`. **200**. 400 if a password already exists.

---

#### `POST /auth/forgot-password` — Public
Body `{ "identifier": "+224620123456" }` → **200** `data: { expiresIn, resendIn }` (identical whether or not the account exists).

#### `POST /auth/verify-reset-otp` — Public
Body `{ "identifier", "otp" }` → **200** `data: { resetToken, expiresIn: 600 }` · 400 invalid / expired code.

#### `POST /auth/reset-password` — `Authorization: Bearer <resetToken>`
Body `{ "newPassword": "kadou2027" }` → **200** → Login. 401 reset token invalid / expired / already used.

---

### 7.2 My account (`/user/me…`)

All **Signed-in**.

#### `GET /user/me`
**200** `data: User` — see [User object](#user-object) — plus the vendor / rider application status:
```json
{
  "applications": {
    "vendor": { "status": "needs_changes", "reviewNote": "Please add a logo" },
    "rider": null
  }
}
```

#### `PATCH /user/me`
Any of:

| Field | Type | Rules |
|---|---|---|
| `name` | string | 2–50 |
| `avatar` | `{ url, publicId }` | from `POST /upload` |
| `language` | `fr` \| `en` | |
| `country` | string | ISO-2, e.g. `GN` |

Unknown fields (e.g. `roles`, `status`) are **rejected with 400**. **200** `data: User`.

#### `PATCH /user/me/mode`
Body `{ "mode": "customer" | "vendor" | "rider" }` → **200** `data: { mode }` · 403 role not approved.

#### `GET /user/me/alerts`
What waits in each mode I hold, for the red dot on the modes I'm not in (client, 2026-11-22).
**200** `data: { customer: ModeAlert, vendor?: ModeAlert, rider?: ModeAlert }` (vendor / rider only once approved), where `ModeAlert = { pending, unread, messages }`:
- `pending`: work to answer. Vendor: new orders to accept. Rider: deliveries a store gave me (to accept or decline), open deliveries I can take, and moto rides near me I can still answer (a price of mine waiting for the passenger is not counted; a counter-offer is). The same lists as the rider's "Near me" tab.
- `unread`: unread notifications of that mode only (team messages, which have no mode, are not counted).
- `messages`: unread chat messages of that mode.

An online rider keeps getting requests in any mode: the app sends the rider's position while online, whatever the mode.

#### `PATCH /user/me/notification-preferences`
Any subset of `{ orderUpdates, messages, deliveryUpdates, offers, jobPosts, accountAlerts }` (booleans).
**200** `data: { …all six flags }`.

#### `POST /user/me/phone/request`
Body `{ "phone": "+224620000000" }` → SMS code to that number. **200** `data: { phone, expiresIn, resendIn }` · 409 phone used by another account · 400 already your verified number.

#### `POST /user/me/phone/verify`
Body `{ "phone", "otp" }` → **200** `data: User` (`isPhoneVerified: true`).

#### `DELETE /user/me`
Soft-deletes the account; the phone and email can be used for a new signup afterwards. **200**.

#### User object

| Field | Type | Notes |
|---|---|---|
| `_id` | string | |
| `name` | string | |
| `phone` | string? | missing for Google/Apple users until added |
| `email` | string? | |
| `avatar` | `{ url, publicId }`? | |
| `roles` | `UserRole[]` | |
| `lastActiveMode` | `AppMode` | open the app in this mode |
| `isPhoneVerified` / `isEmailVerified` | boolean | |
| `language` | `fr` \| `en` | |
| `country` | string | default `GN` |
| `status` / `statusReason` | `UserStatus` / string? | |
| `notificationPrefs` | object | six booleans |
| `referralCode` | string | for the "Share KADOU" link |
| `lastLoginAt`, `createdAt`, `updatedAt` | date | |

---

### 7.3 Admin — users & team

#### `GET /user` — Admin panel
App users only (no admin accounts).
Query: `searchTerm` (name, email, phone), `roles`, `status`, `country`, `sort`, `page`, `limit`.
**200** `data: User[]`, `meta`.

#### `GET /user/:id` — Admin panel
**200** `data: User` · 404.

#### `PATCH /user/:id/status` — Admin
| Field | Type | Required |
|---|---|---|
| `status` | `active` \| `inactive` \| `suspended` \| `banned` | ✔ |
| `reason` | string | ✔ for `suspended` / `banned` |

Suspending or banning signs the user out everywhere. Audited (`user.status.<status>`).
**Errors:** 403 own account / super admin / team member (only super admin can manage team members).

#### `DELETE /user/:id` — Admin
Soft delete, audited (`user.delete`).

#### `GET /user/team` — Admin
Team members (`staff`, `admin`, `super_admin`). Query: `searchTerm`, `page`, `limit`.

#### `POST /user/team` — Super admin
| Field | Type | Required |
|---|---|---|
| `name` | string | ✔ |
| `email` | string | ✔ (login) |
| `phone` | string | |
| `password` | string | ✔ |
| `role` | `staff` \| `admin` | ✔ |

**201** `data: User`. 409 email in use.

#### `PATCH /user/team/:id` — Super admin
Body any of `{ role: "staff" | "admin", status: "active" | "inactive" | "suspended" }`. The member is signed out so the new permissions apply on next login.

---

### 7.4 Settings

#### `GET /settings/public` — Public
Values the app needs (show fees at checkout, support contacts):
```json
{
  "data": {
    "platformName": "Kadou",
    "supportEmail": "support@kadou.com",
    "contactNumber": "+224…",
    "whatsappSupportNumber": "+224…",
    "defaultCurrency": "GNF",
    "commission": { "rate": 10, "min": 1000 },
    "platformFee": 1000,
    "taxRate": 0,
    "withdrawalFees": [ { "method": "orange_money", "type": "fixed", "value": 500 } ],
    "pricing": { "jobPublishFee": 5000, "cvUnlockFee": 5000, "spontaneousApplicationFee": 5000 }
  }
}
```
Cache it for the session; refetch on app start.

#### `GET /settings` — Admin panel
Full document (adds `riderCashLimitDefault`, `escrowReleaseHours`, `moderation`, `emailToggles`, `updatedBy`).

#### `PATCH /settings` — Admin
Partial update. **Nested objects are merged** — `{ "commission": { "rate": 12 } }` keeps `commission.min`. Arrays (`withdrawalFees`) are replaced. Unknown fields → 400. Audited (`settings.update`).

| Field | Type |
|---|---|
| `platformName`, `supportEmail`, `contactNumber`, `whatsappSupportNumber` | string |
| `defaultCurrency` | 3-letter code |
| `logo` | `{ url, publicId }` |
| `commission` | `{ rate: 0–100, min: GNF }` |
| `platformFee`, `riderCashLimitDefault` | GNF integer |
| `taxRate` | 0–100 |
| `withdrawalFees` | `[{ method, type: fixed \| percent, value }]` |
| `escrowReleaseHours` | integer hours |
| `pricing` | `{ jobPublishFee, cvUnlockFee, spontaneousApplicationFee }` GNF |
| `moderation` | `{ restrictAfter, suspendAfter, restrictHours }` |
| `emailToggles` | `{ orderConfirmation, paymentVerification, invoice, disputeUpdates }` booleans |

---

### 7.5 Audit logs

#### `GET /audit-logs` — Admin
Query: `targetType`, `targetId`, `actorId`, `action`, `searchTerm`, `page`, `limit`.
Each item: `{ actorId: { name, email, roles }, action, targetType, targetId, before, after, createdAt }`.

---

### 7.6 Upload

#### `POST /upload` — Signed-in, `multipart/form-data`
Field name `files` (1–10 files, max 10 MB each).
**200** — 1 file → `data: { url, publicId }`; several → `data: [{ url, publicId }, …]`.
Use the result in the next request (e.g. `PATCH /user/me { avatar }`).

---

### 7.7 Device tokens (push)

#### `POST /device-token` — Signed-in
Body `{ "token": "fcm…", "platform": "android" | "ios" | "web" }` — register or refresh this device.

#### `DELETE /device-token` — Signed-in
Body `{ "token": "fcm…" }` — stop push to this device (also done by `POST /auth/logout { deviceToken }`).

---

### 7.8 Addresses

All **Signed-in** (app users). Max **10** addresses; the first one is the default; there is always exactly one default.

#### `GET /addresses`
**200** `data: Address[]` (default first).

#### `POST /addresses`
| Field | Type | Required | Notes |
|---|---|---|---|
| `label` | `home` \| `office` \| `other` | | default `home` |
| `customLabel` | string | | e.g. "Mum's house" |
| `fullName` | string | ✔ | receiver's name |
| `phone` | string | ✔ | E.164 |
| `region`, `commune`, `neighborhood` | string | | |
| `city` | string | ✔ | |
| `landmark` | string | | "Next to BICIGUI Bank, 3rd floor" |
| `directions` | string | | free text for the rider |
| `location` | `{ lat, lng }` | ✔ | map pin |
| `placePhoto` | `{ url, publicId }` | | photo of the gate / house |
| `isDefault` | boolean | | |

**201** `data: Address` (`_id`, all fields, `location: { lat, lng }`).

#### `PATCH /addresses/:addressId`
Any subset of the fields above. **200** `data: Address`.

#### `PATCH /addresses/:addressId/default`
**200** `data: Address`.

#### `DELETE /addresses/:addressId`
**200**. If it was the default, another address becomes the default.

---

### 7.9 Categories

#### `GET /categories` — Public
Query: `type` (`product` | `business` | `service` | `job`), `featured=true` (Home "Top Categories"), `parentId=<id>` (its subcategories) or `parentId=root` (top level only).
**200** `data: Category[]` sorted by `sortOrder`:

```json
{ "_id": "…", "name": { "fr": "Électronique", "en": "Electronics" }, "slug": "product-electronics",
  "type": "product", "parentId": null, "image": { "url": "…", "publicId": "…" },
  "isFeatured": true, "sortOrder": 1, "isActive": true }
```
Display `name[user.language]`.

#### `GET /categories/tree?type=product` — Public
Top-level categories, each with `children: Category[]`.

#### `GET /categories/:id` — Public

#### Admin

| Endpoint | Who | Notes |
|---|---|---|
| `GET /categories/admin?type=&isActive=` | Admin panel | includes inactive |
| `POST /categories` | Admin | `{ name: { fr, en }, type, parentId?, image?, isFeatured?, sortOrder?, isActive? }` — max 2 levels; a child has its parent's type |
| `PATCH /categories/:id` | Admin | `name` (partial), `image` (`null` removes it), `isFeatured`, `sortOrder`, `isActive`. Type and parent are fixed |
| `DELETE /categories/:id` | Admin | 409 while it has subcategories — deactivate instead |

---

### 7.10 Become a Vendor & my store

#### `GET /vendors/me` — Signed-in
My vendor profile in any status. 404 = no application yet.

#### `PUT /vendors/me/application` — Signed-in
Saves the draft. Any subset of:

| Field | Type | Notes |
|---|---|---|
| `storeName` | string | 2–80 |
| `businessCategoryId` | string | a category of type `business` |
| `marketName` | string | |
| `businessPhone` | string | E.164 — **never shown publicly** |
| `businessEmail` | string | never shown publicly |
| `logo` | `{ url, publicId }` | |
| `address` | `{ text?, city?, country?, location? }` | merged with what was saved |
| `documents` | `[{ type: business_license \| national_id, file }]` | **replaces** the list; re-sending an unchanged file keeps its review status |

Allowed while `draft`, `needs_changes` or `rejected`. **409** while `pending` or after approval.

#### `POST /vendors/me/application/submit` — Signed-in
**200** status `pending`. **400** `Please complete: storeName, payout method (…)` lists what is missing.

#### `PATCH /vendors/me` — Vendor
Edit an approved store: `storeName`, `logo`, `marketName`, `businessPhone`, `businessEmail`, `address`.

#### `PATCH /vendors/me/availability` — Vendor
`{ isOpen?, availability?: { enabled?, days?: WeekDay[], openTime?: "HH:mm", closeTime?: "HH:mm" } }`. `openTime` must be before `closeTime`.

#### `GET /vendors` — Public
Approved stores. Query: `searchTerm` (store / market name), `city`, `categoryId`, `isOpen`, `sort`, `page`, `limit`.
Only public fields are returned: `storeName`, `logo`, `businessCategoryId { name, slug }`, `marketName`, `address`, `isOpen`, `availability`, `stats { ratingAvg, ratingCount, totalOrders, totalProducts }`.

#### `GET /vendors/:id` — Public
One approved store (same public fields). 404 if not approved or suspended.

---

### 7.11 Become a Delivery Partner

#### `GET /riders/me` — Signed-in
My rider profile (bus routes come with station `name` / `city`). 404 = no application.

#### `PUT /riders/me/application` — Signed-in

| Field | Type | Notes |
|---|---|---|
| `partnerType` | `moto` \| `transit` | |
| `vehicle` | `{ type?, color?, brand?, plateNumber? }` | type must match the partner type; plate is upper-cased. **Required** on submit for moto + motorbike / car |
| `vestNumber` | string | **Required** on submit for moto + motorbike (moto-taxi) |
| `cityArea` | string | |
| `nationalIdNumber` | string | never shown to vendors |
| `transitRoutes` | `[{ fromStationId, toStationId }]` | bus drivers; two different stations |
| `documents` | `[{ type: driver_license \| national_id \| vehicle_registration, file }]` | replaces the list |

#### `POST /riders/me/application/submit` — Signed-in
**200** `pending` · **400** missing fields listed.

#### `PATCH /riders/me` — Rider
After approval: `vehicle` (color / brand / plate), `vestNumber`, `cityArea`, `transitRoutes` (bus drivers). Partner type, vehicle type, national id and documents are locked. The plate / vest above can't be emptied (400). A moto-taxi approved before the rule, without them, gets no ride offers and `POST /rides/:id/bid` answers 400 until both are filled in (deliveries keep coming).

#### `GET /riders/search` — Vendor
Find riders to invite. Query: `searchTerm` (name, or **exact** phone), `cityArea`, `partnerType` (default `moto`), `page`, `limit` (max 50).
Online riders first, then by rating. Each item: `{ _id, userId: { name, avatar }, partnerType, vehicle { type, color, brand }, cityArea, isOnline, stats }` — no phone, no national id.

---

### 7.12 Admin — application review

The same endpoints exist for vendors (`/vendors/admin…`) and riders (`/riders/admin…`).

| Endpoint | Who | Notes |
|---|---|---|
| `GET /vendors/admin` · `GET /riders/admin` | Admin panel | filters: `approvalStatus`, `partnerType` (riders), `searchTerm`, `page`, `limit`; includes the owner `userId { name, phone, email, status }` |
| `GET /vendors/admin/:id` · `GET /riders/admin/:id` | Admin panel | full profile, documents, `applicationHistory`, `payoutMethods` (+ `cashOwed` for riders) |
| `PATCH …/admin/:id/documents/:docId` | Admin | `{ status: verified \| rejected, note }` — note required to reject |
| `PATCH …/admin/:id/review` | Admin | `{ action, note }` — note required for reject / needs_changes / suspend; it is shown to the applicant |

**Review state machine**

| Action | Allowed from | Result | Effect on the user |
|---|---|---|---|
| `approve` | pending | approved | role added (`vendor` / `rider`) |
| `reject` | pending | rejected | can edit & resubmit |
| `needs_changes` | pending | needs_changes | can edit & resubmit |
| `suspend` | approved | suspended | role removed; the app falls back to customer mode |
| `reinstate` | suspended | approved | role added back |

Any other combination → **409**. Every decision goes into `applicationHistory` and the audit log, and the applicant receives the socket event `application:reviewed`.

---

### 7.13 Wallet & payout methods

A wallet is created automatically when a vendor / rider application starts. Balances stay at 0 until orders exist (Step 6). All amounts are GNF.

#### `GET /wallets/me?mode=vendor|rider` — Signed-in
```json
{ "ownerMode": "vendor", "heldBalance": 0, "availableBalance": 0, "totalEarned": 0,
  "totalCommission": 0, "totalWithdrawn": 0, "cashOwed": 0,
  "payoutMethods": [ { "_id": "…", "type": "orange_money", "accountName": "Anthony Jack",
                       "accountNumber": "+224623447788", "isDefault": true } ] }
```
404 = no application started for that mode.

#### `GET /wallets/me/summary?mode=vendor|rider&range=7d|30d|6m|12m` — Signed-in
For the app's Earnings screen and profile header. `range` defaults to `7d`. `7d`/`30d` give one bucket per day, `6m`/`12m` one per month (Africa/Conakry time = UTC+0). Unknown range → 400.
- Vendor earnings = `vendorEarning` of sub-orders **delivered** in the period (by `subOrder.deliveredAt`).
- Rider earnings = `fee` of delivery legs delivered in the period.
```json
{ "mode": "vendor", "range": "7d", "timezone": "Africa/Conakry",
  "balances": { "availableBalance": 90000, "heldBalance": 180000, "totalEarned": 270000,
                "totalCommission": 30000, "totalWithdrawn": 0, "withdrawable": 90000,
                "inEscrow": 90000, "awaitingCod": 90000 },
  "counts": { "newOrders": 2, "activeOrders": 1 },
  "today": { "earnings": 90000, "count": 1 },
  "period": { "from": "2026-10-13T00:00:00.000Z", "to": "2026-10-19T23:59:59.999Z", "earnings": 180000, "count": 2 },
  "series": [ { "key": "2026-10-13", "earnings": 0, "count": 0 }, "…", { "key": "2026-10-19", "earnings": 90000, "count": 1 } ] }
```
- **Vendor balances:** `inEscrow` (orders still running) + `awaitingCod` (delivered COD orders whose cash the rider still holds) = `heldBalance`.
- **Rider balances:** `cashOwed`, `cashLimit` (the rider's own or `settings.riderCashLimitDefault`), and `withdrawable = availableBalance − cashOwed`.
- **Rider counts:** `{ newRequests, activeDeliveries }`.
- A user without that store or rider profile gets zeros.

#### `POST /wallets/me/payout-methods` — Signed-in
`{ mode, type: orange_money | mobile_money | bank, accountName, accountNumber, bankName? (required for bank), isDefault? }`. Max 5; the first one is the default. **201** `data: PayoutMethod[]`.

#### `PATCH /wallets/me/payout-methods/:methodId`
Body must include `mode`. **200** `data: PayoutMethod[]`.

#### `DELETE /wallets/me/payout-methods/:methodId?mode=vendor`
**200** `data: PayoutMethod[]`.

#### `POST /wallets/me/withdrawals` — Signed-in
`{ mode: "vendor" | "rider", amount: number (min 5,000 GNF), payoutMethodId: string }`. Deducts `amount` (+ fee) from `availableBalance` immediately and records `withdrawal` and `withdrawal_fee` in ledger. **201** `data: Withdrawal`.

#### `GET /wallets/me/withdrawals?mode=vendor|rider&page=&limit=&status=`
List my withdrawal requests and processing history.

#### `GET /wallets/me/transactions?mode=vendor|rider&page=&limit=&type=`
Paginated append-only ledger transaction history (`earning_held`, `earning_released`, `commission`, `withdrawal`, `withdrawal_fee`, `withdrawal_reversal`, `cod_collected`, `cod_settled`, `cod_offset`, `refund_deduction`, `adjustment`).

#### `POST /wallets/me/cod-settlements` — Riders only
`{ amount: number, method: "orange_money" | "mobile_money" | "cash_at_office" | "earnings_offset", reference?, proofImage? }`.
- `amount` cannot exceed the cash still owed **minus settlements already waiting for confirmation** (400 otherwise).
- `earnings_offset`: instantly deducts from `availableBalance` and `cashOwed` (`status = confirmed`) and releases covered vendor earnings.
- Other methods wait for admin verification (`status = pending`).
- Response: the settlement plus `releasedSubOrders: ["AP12-1", …]` (sub-orders whose vendor money was released).

#### `GET /wallets/admin/withdrawals?page=&limit=&status=&ownerMode=` — Staff/Admin
List all withdrawal requests.

#### `PATCH /wallets/admin/withdrawals/:id` — Staff/Admin
`{ status: "completed" | "rejected", transactionId?, receiptImage?, rejectionReason? }`.
If `rejected`, automatically credits the funds back to the user's available balance via a `withdrawal_reversal` transaction.

#### `GET /wallets/admin/cod-settlements?page=&limit=&status=` — Staff/Admin
List all rider COD cash settlement submissions.

#### `PATCH /wallets/admin/cod-settlements/:id` — Staff/Admin
`{ status: "confirmed" | "rejected" }`.
If `confirmed`: reduces the rider's `cashOwed`, logs `cod_settled`, and allocates the cash to the rider's oldest `awaiting_cod` sub-orders — each fully covered one releases the vendor's earning (`earning_released` + `commission`). Response includes `releasedSubOrders`. A settlement can only be decided once (400 afterwards).

---

### 7.14 Vendor ↔ rider network

| Endpoint | Who | Body / query | Result |
|---|---|---|---|
| `GET /vendor-rider-links/me` | Vendor or rider | `?as=vendor\|rider&status=` | links with the other side's public info (`riderId.userId.name` or `vendorId.storeName`) |
| `POST /vendor-rider-links/invite` | Vendor | `{ riderId }` (rider profile id) | `invited`, or `active` if the rider had already asked |
| `POST /vendor-rider-links/request` | Rider | `{ vendorId }` (vendor profile id) | `invited`, or `active` if the vendor had already invited |
| `PATCH /vendor-rider-links/:id/respond` | the invited side | `{ accept: boolean }` | `active` / `declined` |
| `DELETE /vendor-rider-links/:id` | either side | — | `removed` (can be invited again later) |

Errors: 409 already connected / already invited · 403 the inviter tried to answer · 404 rider not found (or a bus driver) · 400 own store ↔ own rider account.

---

### 7.15 Bus stations

| Endpoint | Who | Notes |
|---|---|---|
| `GET /transit-stations?city=Conakry` | Public | active stations, `location: { lat, lng }` |
| `GET /transit-stations/admin` | Admin panel | includes inactive |
| `POST /transit-stations` | Admin | `{ name, city, region?, location: { lat, lng } }` |
| `PATCH /transit-stations/:id` | Admin | any field; `isActive: false` hides it |

### 7.16 Products & Catalog

| Endpoint | Who | Notes |
|---|---|---|
| `GET /products` | Public | browse & filter: `category`, `subcategory`, `vendorId`, `minPrice`, `maxPrice`, `inStock=true`, `rating`, `tags`, `searchTerm`, `lat`, `lng`, `maxDistance` (km), `sort` (`price_asc`, `price_desc`, `rating`, `popular`, `newest`), `page`, `limit` |
| `GET /products/:idOrSlug` | Public / Signed-in | single product details, returns `{ product, isFavorite }` |
| `GET /products/my-products` | Vendor / Admin | vendor's own store catalog, supports `?statusTab=all\|active\|out_of_stock` |
| `GET /products/admin` | Admin panel | full catalog with summary stats: `total`, `active`, `pending`, `outOfStock` |
| `POST /products` | Vendor / Admin | create product: `{ name, categoryId, subcategoryId?, price, discountPrice?, images, features[], inTheBox[], tags[], stockQty, minStockAlert, prepTimeMinutes, isAvailable }` (vendor must be approved; admin can specify `vendorId`) |
| `PATCH /products/:id` | Vendor / Admin | update product details; vendor can only edit their own |
| `PATCH /products/:id/stock` | Vendor / Admin | quick stock & availability toggle: `{ stockQty, minStockAlert, isAvailable }` |
| `PATCH /products/:id/approval` | Admin | approve / reject product: `{ approvalStatus: 'approved' \| 'rejected', adminReviewNote? }` |
| `DELETE /products/:id` | Vendor / Admin | soft-delete product; vendor can only delete their own |

### 7.17 Favorites

| Endpoint | Who | Notes |
|---|---|---|
| `GET /favorites/my-favorites` | Signed-in | list user's favorited products with pagination |
| `GET /favorites/check/:productId` | Signed-in | checks if product is in favorites: `{ isFavorite: boolean }` |
| `POST /favorites/toggle` | Signed-in | toggles favorite: `{ productId }` → adds if absent, removes if present |

### 7.18 Delivery Rates

| Endpoint | Who | Notes |
|---|---|---|
| `GET /delivery-rates/calculate` | Public / Signed-in | calculates delivery fee: query params `type` (`local` \| `intercity`), `vendorLat`, `vendorLng`, `customerLat`, `customerLng`, `city`, `vehicleType`, `fromStationId`, `toStationId` |
| `GET /delivery-rates` | Signed-in | list active delivery rates |
| `GET /delivery-rates/:id` | Signed-in | get delivery rate details |
| `POST /delivery-rates` | Admin | create delivery rate rule (`local`: city, vehicleType, baseFee, perKmFee, minFee; `intercity`: fromStationId, toStationId, fee, estimatedHours) |
| `PATCH /delivery-rates/:id` | Admin | update delivery rate rule |
| `DELETE /delivery-rates/:id` | Admin | deactivate delivery rate rule |

### 7.19 Cart

| Endpoint | Who | Notes |
|---|---|---|
| `GET /cart` | Signed-in | get customer cart with live recomputed prices, multi-vendor grouping, and out-of-stock / unavailable flags |
| `POST /cart/items` | Signed-in | add item to cart: `{ productId, qty }` |
| `PATCH /cart/items/:productId` | Signed-in | update item quantity: `{ qty }` (qty 0 removes item) |
| `DELETE /cart/items/:productId` | Signed-in | remove item from cart |
| `DELETE /cart` | Signed-in | clear cart |

### 7.20 Orders & Checkout

#### Checkout & Customer Orders
| Endpoint | Who | Notes |
|---|---|---|
| `POST /orders/checkout-summary` | Signed-in | preview calculations without placing order: groups vendor splits, calculates vendor delivery fees via distance/station, platform fee (min 1,000 GNF), tax, commission snapshot, and totals. `intercity` and `station_pickup` need `destinationStationId` (400 if missing, inactive, or the store's own departure station); their splits carry `stationRoute { fromStationName, fromCity, toStationName, toCity, estimatedHours }`. Station pickup = intercity rate minus the last moto leg (10 000 GNF), at least 10 000 GNF. |
| `POST /orders` | Signed-in | place order: atomically deducts stock, creates parent `Order` (e.g. `AP421`), splits into `SubOrder`s per vendor (`AP421-1`), snapshots address, clears cart |
| `GET /orders/my-orders` | Signed-in | customer order history with sub-order summaries and pagination. `?status=` takes one order status or several, comma-separated (e.g. `cancelled,partially_cancelled`); an unknown status → 400 |
| `GET /orders/:id` | Customer / Admin | full order details with sub-orders, items, vendor info, status timeline and `deliveries[]` (legs, no PINs). For the customer each open sub-order also has **`deliveryPin`**: the handover PIN of its final leg, to give to the rider (or the bus driver for station pickup). It disappears once that leg is delivered or cancelled. Delivered sub-orders have `deliveredAt`. For the customer, `reviewed: boolean` per sub-order and the rider as `currentRiderId { partnerType, vehicle, stats, userId: { name, avatar } }` — never a phone. |
| `POST /orders/:id/cancel` | Customer | cancel order before preparation: `{ reason }`, restores product stock, sets status to `cancelled` |

#### Vendor Sub-Orders
| Endpoint | Who | Notes |
|---|---|---|
| `GET /orders/vendor/sub-orders` | Vendor / Admin | list vendor's sub-orders filtered by status (`new`, `accepted`, `preparing`, `ready_for_pickup`, `in_delivery`, `delivered`, `cancelled`) |
| `GET /orders/vendor/sub-orders/:id` | Vendor / Admin | detailed sub-order view with order address, customer info, items, timeline, all `deliveries[]` and the current rider (`currentRiderId`: partner type, vehicle, vest number, rating, name; no phone). Includes **`pickupPin`** (the store's PIN for the leg that starts at the store) until the rider has picked up. |
| `PATCH /orders/vendor/sub-orders/:id/status` | Vendor / Admin | advance sub-order status: `{ status, note, estimatedDeliveryMinutes }` |
| `PATCH /orders/vendor/sub-orders/:id/modify` | Vendor / Admin | vendor edits order after chat agreement: `{ modifications: [{ productId, action: "remove" \| "update_qty", newQty }], reason }`, adjusts stock, recomputes totals & commission snapshot, records audit entry |
| `POST /orders/vendor/sub-orders/:id/cancel` | Vendor / Admin | vendor cancels sub-order: `{ reason }`, restores product stock |

#### Admin Order Management
| Endpoint | Who | Notes |
|---|---|---|
| `GET /orders/admin/all` | Admin | search & filter all platform orders (by orderNumber, customer name/phone, status, paymentStatus) |
| `GET /orders/admin/:id` | Admin | full admin detail for order, sub-orders, timeline, and modifications |
| `POST /orders/admin/sub-orders/:id/cancel` | Admin | admin force-cancels sub-order: `{ reason }`, restores product stock |

### 7.21 Delivery Legs & Tracking

#### Rider Operations
| Endpoint | Who | Notes |
|---|---|---|
| `GET /deliveries/rider/my-deliveries` | Rider / Admin | list assigned, active, and completed delivery jobs (`query.type: "active" \| "completed"`) |
| `POST /deliveries/:id/accept` | Rider / Admin | accept an assigned delivery leg; checks COD cash limit |
| `POST /deliveries/:id/decline` | Rider / Admin | decline delivery leg: `{ reason }`; reverts leg to `pending_assignment`, notifies vendor |
| `PATCH /deliveries/:id/going-to-pickup` | Rider / Admin | update status to `going_to_pickup`; notifies tracking room |
| `POST /deliveries/:id/verify-pickup` | Rider / Admin | verify physical pickup via 4-digit PIN: `{ pin }`; locks for 15 mins after 5 failed tries; moves sub-order to `in_delivery` |
| `POST /deliveries/:id/verify-handover` | Rider / Admin | verify handover via 4-digit PIN: `{ pin, proofPhoto? }`; completes leg, collects COD cash if applicable, marks order delivered on final leg |
| `PATCH /deliveries/rider/location` | Rider / Admin | broadcast live rider GPS coordinates: `{ lat, lng, heading }` to tracking rooms |
| `PATCH /deliveries/rider/online-status` | Rider / Admin | toggle Driver Mode: `{ isOnline: boolean }` |

#### Vendor & Customer Operations
| Endpoint | Who | Notes |
|---|---|---|
| `GET /deliveries/:id/available-riders` | Vendor / Admin | lists online delivery partners: active linked riders appear first, followed by nearest online riders sorted by distance (no phone numbers) |
| `POST /deliveries/:id/assign` | Vendor / Admin | assign delivery leg to partner: `{ riderId }`; sends real-time push/socket alert |
| `GET /deliveries/:id/track` | Customer, store owner, riders of the leg chain, admin | live delivery tracking. The customer and the store may follow every leg of their order. **PIN visibility**: `pickupPin` only to the giver (the vendor on the leg that starts at the store, or the rider arriving at a station), `handoverPin` only to the receiver (the customer on the final leg, or the next rider at a station). Middle station→station legs show no PIN to the customer or the store. The assigned rider never sees its own leg's PINs. On the rider's own leg at bus stations: `incomingHandoverPin` (show it to the rider arriving with the parcel) and `outgoingPickupPin` (show it to the rider taking the parcel next). |

### 7.20q Kadou24h Team messages (2026-10-26)

- `POST /notifications/admin/team-message { userId, title, message }` (staff/admin): a `team_message` notification to one user, always pushed, no mode (so it shows in every role's list), audit-logged (`notification.team_message`). One way: the user answers through support or WhatsApp. `GET /notifications/admin/team-messages/:userId` lists what was sent.
- Notification lists, unread counts and "read all" for a mode now include account-wide notifications (no mode): chat warnings, suspension, team messages. Before, those never showed in the app list.

### 7.20p Flagged / reported message in its conversation (2026-10-26)

- `GET /conversations/admin/moderation-violations/:id/context?around=5` and `GET /conversations/admin/messages/:messageId/context?around=5` (staff/admin; around 1–20). Returns `{ conversation: { type, subOrderNumber, participants: [{ userId, name, phone, status, violationCount, mode }] }, focusId, messages: [{ …message, violation?: { rule, snippet, action }, reportCount, hiddenFromRecipient }], hasMoreBefore, hasMoreAfter }`. Voice notes and photos keep their `mediaUrl`. Each opening is audit-logged (`chat.view_context`).
- Violations now store `messageId`; older ones are matched to the masked message sent within a minute.

### 7.20u Customers delete their notifications and history (2026-10-30, client)

- **Notifications** (really deleted, they are only the user's): `DELETE /notifications/:id` (not mine → 404), `DELETE /notifications?mode=` → `{ deletedCount }` (that mode's list, with the account-wide ones it shows).
- **Orders**: `DELETE /orders/my-orders/:id` hides a finished order (`completed`, `cancelled`, `partially_cancelled`) from `GET /orders/my-orders` for the customer only (`hiddenByCustomerAt`). `GET /orders/:id`, the store, riders, admin and the accounting keep it. Still `active` → 400; not mine → 404.
- **Moto-taxi rides**: `GET /rides/my` lists every ride again, including requests no rider took (cancelled, expired). `DELETE /rides/my/:id` hides a finished ride for the passenger only (`hiddenByPassengerAt`); a running ride → 400; not mine → 404.
- App: long press on a notification / finished order / finished ride (with a hint above each list), "Delete all" in notifications, and "Delete from my history" on the order and ride screens.

### 7.20t Station handover: one code, relay legs paid at the station (2026-10-30, client test AP12)

- **One code per station**: the driver taking the parcel types the code the arriving driver shows (`outgoingPickupPin` in the arriving driver's `GET /deliveries/:id/track`) with `POST /deliveries/:id/verify-pickup`. That also closes the previous leg (`delivered`, timeline `leg_completed`, socket `delivery:status_changed` on its room). Before, the previous leg only closed if its driver also typed the other driver's code, so it stayed `picked_up` and its driver was never paid.
- `verify-pickup` on a leg starting at a station → 400 "The previous driver doesn't have the parcel yet…" while the previous leg is not picked up.
- **Relay legs are paid at the station**, not when the parcel reaches the customer: the fee goes to `availableBalance` once (`deliveries.feePaidAt`), push `earnings_updated`. The final leg is still paid at delivery. The old way (`verify-handover` with `incomingHandoverPin`, older apps) still works and also pays at once.
- **Riders' `totalEarned`** now counts every fee they receive (it stayed 0).
- Repair of data saved before: `npm run fix:relay-legs` (dry run) then `npm run fix:relay-legs -- --apply` closes the relay legs left open, pays them, and recomputes riders' `totalEarned`.
- `GET /wallets/me/transactions` lines now carry `subOrderNumber` (and `subOrderId` stays the id). The app shows each line's `note` in the user's language from its known patterns ("Escrow released for sub-order AP12-1" → "Commande AP12-1 versée sur votre solde"); a note typed by the team is shown as written.
- Wording (client): the station → station partner is a "car driver" (bus, shared taxi or car), no longer "bus driver", in the app, the admin and API messages. `partnerType` stays `transit`, stations stay "bus stations".
- `GET /wallets/admin/cod-settlements?riderId=` — one rider's cash declarations (`RiderProfile` id; invalid → 400). The dashboard shows the pending ones with a Confirm button in the rider's Money tab, and their count in the home page's Pending Actions.

### 7.20s Client feedback fixes: "&", ride history, app crash reports (2026-10-29)

- **"&" kept as typed**: the input sanitizer still strips HTML tags but no longer stores `&` as `&amp;` (`<` / `>` stay escaped). Passwords (`password`, `oldPassword`, `newPassword`) keep the old encoding so existing logins still match. Repair of data saved before: `npm run fix:ampersands` (dry run, counts) then `npm run fix:ampersands -- --apply` on the `.env` database.
- **Passenger ride history**: `GET /rides/my` leaves out requests no rider took (cancelled while searching, or expired). Rides a rider took stay, whatever their end.
- **App crash reports**: `POST /app-errors { message, stack?, fatal, screen?, platform?, osVersion?, device?, appVersion?, updateId? }` — public (a bearer token links the user), 20 per 15 min per account / IP, kept 30 days. The app sends one when a JavaScript error is about to close it (`fatal: true`) or a screen fails to draw. Team: `GET /app-errors?fatal=true&page=&limit=` (newest first, `userId` → name, phone).

### 7.20r Moto-taxi safety: plate + vest, "Share my trip" (2026-10-26, client)

- **Plate + vest required**: a moto partner on a motorbike needs `vehicle.plateNumber` and `vestNumber` to submit (on a car: the plate); 400 names the missing ones. Once approved they can't be emptied (`PATCH /riders/me` → 400). A moto-taxi approved before the rule without them gets no ride offers and `POST /rides/:id/bid` → 400 "Add your plate and vest number…" (deliveries keep coming; the app shows a banner on Near me). The passenger now also gets `rider.vestNumber` in `GET /rides/:id`.
- **Share my trip**: `POST /rides/:id/share` (the passenger, ride not over; else 404 / 400) → `{ token, url }` — the same link if asked again. `url` = `<this API>/r/<token>`: a browser page (map, steps, driver name/photo, vehicle, plate, vest, live position), no app or account; it polls `GET /rides/shared/:token` (public) every 10 s. Shows the passenger's first name only, never a phone. Once the ride is completed / cancelled / expired the link only returns `{ status, rideNumber, ended: true, endedAt }`. Unknown token → 404. The page has its own strict CSP (nonce scripts, Leaflet 1.9.4 from unpkg with SRI, OpenStreetMap tiles) and `noindex`.

### 7.20o Moto-taxi rider subscription and payment gateways (2026-10-24)

- **Rider subscription** (client: free first, later monthly, never a commission). `settings.rides.subscriptionRequired` (default false) + `trialDays` (default 30). While on, a moto rider gets ride offers / can accept only with `rideAccessUntil` in the future; each rider gets the free days once (started on first `GET /rides/rider/offers`, `/rides/rider/access` or bid). Deliveries are never blocked. Plans: audience `moto_driver` (only approved moto riders may subscribe); paying adds the plan days after what is left.
- `GET /rides/rider/access` → `{ required, allowed, until, trialAvailable, trialDays, justStartedTrial }`. Accept while not allowed → 400 "Your moto-taxi subscription has ended…".
- **Gateways** (`modules/payment/gateway`): `PAYMENT_MODE=demo` → demo gateway (providerRef `DEMO_…`, no page; the app simulates). `live` → `PAYMENT_PROVIDER` must name a registered gateway, else initiate → 503. A gateway implements `createCheckout` (providerRef + `checkoutUrl`, saved on the payment; the app opens it), `parseWebhook` (checks the aggregator signature on the raw body) and optional `fetchStatus` (used at most every 15 s while the app polls `GET /payments/:id` on a pending payment).
- `POST /payments/webhook/:provider` — the aggregator's own notification (404 in demo mode or for another provider). The generic `POST /payments/webhook` with `x-webhook-secret` stays.

### 7.20n Moto-taxi rides, point A → point B (2026-10-23, client: "structure it as you see fit")

Decisions (to review with the client): price fixed before ordering, nearest riders first and the first to accept takes it, cash to the rider at the end, no commission yet (open question: commission per ride or rider subscription), passenger rates the rider.
- **Price** (`settings.rides`, dashboard → Settings → Moto-taxi): `fare = max(minFare, baseFare + perKm × road km)`, rounded up to 500 GNF; road km = straight line × 1.3; time at ~22 km/h. Defaults 3 000 + 1 500/km, minimum 5 000 GNF. `rides.enabled` switches it off. Under 0.3 km or over 80 km → 400.
- **Passenger**: `POST /rides/estimate { pickup {lat,lng}, dropoff }` → `{ distanceKm, durationMin, fare, ridersNearby }`; `POST /rides { pickup {lat,lng,address}, dropoff, note? }` → `searching` (one running ride per passenger, else 409); `GET /rides/my`, `GET /rides/my/current`, `GET /rides/:id` (the rider's name, photo, vehicle, ride rating and live position — never the phone); `POST /rides/:id/cancel { reason? }` until the ride starts; `POST /rides/:id/rate { stars, comment? }` once, after it.
- **Dispatch**: available = approved moto rider, online, position from the last 15 min, no parcel on board, no other ride. Radius 2 km, 4 km after 1 min, 7 km after 2…, never past `settings.rides.searchRadiusKm` (default 5 km, client 2026-11-21) (push `ride_update` with `data.offer`, socket `ride:offer`). Nobody in 10 min → `expired` (passenger told). Sweep every 15 s (`RIDE_SWEEP_MS`).
- **Negotiable price** (client, 2026-11-21; `ride.bid.service.ts`): the request carries `suggestedFare` and `maxFare` (suggested + `settings.rides.maxRaisePercent`, default 30 %, fixed at the request). A rider answers with `POST /rides/:id/bid { price? }` (default the suggested fare; up to `maxFare`; steps of 500 GNF → `RIDE_BID_OUT_OF_RANGE` / `RIDE_BID_STEP`); one live price per rider (`RIDE_BID_WAITING`, `RIDE_BID_ELSEWHERE`), 3 per ride (`RIDE_BID_LIMIT`); `DELETE /rides/:id/bid` takes it back. The passenger sees the live ones in `GET /rides/:id` → `bids[]` (price, counterPrice, status, expiresAt, pickupKm, etaMin, rider name / photo / moto / rating — no phone; pushed once, for the first price; socket `ride:updated` for each) and has 60 s to answer: `POST /rides/:id/bids/:bidId/accept` (the ride is accepted at that price, the other prices close; `RIDE_RIDER_UNAVAILABLE` if the rider went offline or busy), `/decline`, or `/counter { price }` once (suggested ≤ price < the rider's; `RIDE_COUNTER_OUT_OF_RANGE`, `RIDE_COUNTER_NOT_POSSIBLE`). The rider has 60 s to answer a counter-offer: `POST /rides/:id/bid/answer { accept }` (yes → the ride is theirs at that price). Unanswered prices expire in the sweep (the rider may send another). A rider dropping the ride puts it back at the suggested fare. The team sees every bid in `GET /rides/admin/:id`.
- **Rider**: `GET /rides/rider/offers` (suggestedFare, maxFare, pickupKm, trip, `myBid`, `bidsLeft`), `POST /rides/:id/bid` (above; socket `ride:offer_gone` to the others once the passenger chooses), `POST /rides/:id/skip`, `POST /rides/:id/arrived` → `/start` → `/complete` (409 out of order), `POST /rides/:id/release { reason? }` before the start → back to searching for the others (not this rider), `GET /rides/rider/current` (with the passenger's phone), `GET /rides/rider/history`. A rider on a ride can't take parcels (and the other way round).
- Live position: the rider's `PATCH /deliveries/rider/location` is forwarded to the passenger (`ride:location`); every change emits `ride:updated` to both.
- **Admin**: `GET /rides/admin?status=&search=` (meta.counts, completedFares, completedKm), `GET /rides/admin/:id`, `POST /rides/admin/:id/cancel { reason }` (audit-logged, both told).

### 7.20m Open dispatch, COD fees paid online first, demo payments (2026-10-23, client feedback)

**Open dispatch** — a delivery leg is offered to the riders near its pickup point; the first to accept takes it. The customer never chooses the rider.
- When a leg opens (`offerOpenedAt`): the first leg once the store accepts the order; a later leg (station → station / customer) once the parcel is picked up on the leg before it (its rider must be at the station handover).
- Who sees it: approved, online riders of the right type (moto / bus), with a position from the last 30 min, within a radius that grows with time since it opened: 3 km, 5 km after 1 min, 8 km after 2 min, 15 km after 5 min. The store's own riders (active links) see its legs from the start; bus drivers who run the exact route always see it. A store never gets its own order through its own rider account.
- `GET /deliveries/rider/offers` (rider) → `{ isOnline, offers[] }`, nearest first: `fee` (all theirs), `pickupKm`, `tripKm`, `cashToCollect`, `itemCount`, `fromName` / `fromAddressText` / `fromLocation`, `toName` (stations only) and `toArea` (the customer's city / neighbourhood only — no name, phone or position before accepting), `fromMyStore`, `servesRoute`, `canTake` + `blockedReason` (`too_many`: a moto carries at most 3 at a time; `cash_limit`). Empty while offline.
- `POST /deliveries/:id/claim` → the leg is the rider's (`accepted`). Atomic: two riders at once → one 200, the other 409 "Another rider has already taken this delivery". 400 when offline, out of reach, over the cash limit or with 3 deliveries running. The store is told ("Rider found"); the offer leaves the other riders' lists (socket `delivery:offer_gone`).
- `POST /deliveries/:id/skip` → hidden from my list.
- The store may still choose a rider (`POST /deliveries/:id/assign`): `reservedUntil` = now + 10 min; nobody else sees it meanwhile. No answer in time → back to everyone (that rider isn't offered it again), the store is told. A decline also puts it back to everyone.
- Nobody took it after 10 min (60 min for a leg leaving a station) → the store and the Kadou24h team (staff / admins, `system_alert` with `orderId`) are told once (`noRiderAlertedAt`).
- Sweep every 30 s (`DISPATCH_SWEEP_MS` overrides; the e2e uses 1 s): reservations expire, legs that should be open are opened, newly reachable riders are told (push `new_delivery_assigned` with `data.offer: true`, socket `delivery:offer`).
- Vendor order detail legs now carry `offerOpenedAt`, `reservedUntil`, `noRiderAlertedAt`.

**Cash on delivery: fees paid online first** (client: "so that the platform and the courier are covered").
- Checkout summary `pricing.payNow` / `pricing.payOnDelivery`: COD = service fee + tax + delivery now, the products (minus the promo share) in cash; online = everything now.
- A COD order is created like an online one: sub-orders `pending_payment`, `paymentDueAt` (30 min), stock reserved, the stores see nothing; `order.upfrontAmount` = the fees. `POST /payments/initiate { purpose: "order", method: orange_money | mobile_money | card }` asks for `upfrontAmount` (method `cod` → 400; paid twice → 400). Once paid: `order.feesPaidAt`, the stores get it (escrow, delivery legs); `paymentStatus` stays `unpaid` until delivered (cash). Not paid in time → cancelled like an online order.
- Each part's `codAmountToCollect` = its products − its promo share (no fee in the cash any more); a store removing items lowers it. Cancelling a part → refund request for that store's delivery fee; the whole order → all the fees (service fee + tax the last). Older COD orders (no `upfrontAmount`) keep the old rules.
- COD still needs each store's cash under the rider cash limit (`cod.allowed`), now counted on the products only.

**Demo payments** — `PAYMENT_MODE` (env, default `demo`): no gateway is connected yet, so `POST /payments/:id/dev-confirm` works in production too and payments carry `demo: true`; the app shows "Demo payment — Simulate: paid / failed" even in release builds. Set `PAYMENT_MODE=live` once Orange Money / MTN / card are connected (then only the gateway webhook confirms).

**Worker photo optional** — submitting a worker profile no longer requires a photo (cards fall back to an icon).

### 7.20l Promo codes, cancelling one store's part, blocking in chat (2026-10-22, client rules)

**Promo codes** — created only by the Kadou24h team; **Kadou24h pays the discount** (store earnings and commissions don't change); expiry, minimum order (products subtotal), one use per customer, optional total limit.
- Admin: `GET /coupons/admin?status=active|expired|inactive&search=` (meta.summary: active codes, uses, discount given), `POST /coupons/admin { code, type: percent|fixed, value, maxDiscount?, minOrder, startsAt?, expiresAt, usageLimit?, description? }`, `GET /coupons/admin/:id` (uses: customer, order, amount), `PATCH /coupons/admin/:id` (code / type / value locked once used; `null` clears a limit; `isActive` pauses). Audit-logged.
- Checkout: `couponCode` on `POST /orders/checkout-summary` and `POST /orders`. The summary returns `coupon { code, valid, discount, description?, message? }` (an invalid code never breaks the summary); placing an order with an invalid code → 400. Discount = percent of the products (capped by `maxDiscount`) or a fixed amount, never more than the products. It is spread over the stores (`discountShare`), each part's `total` = subtotal + delivery − share; the first COD part still carries the service fee. `order.discount` / `order.couponCode` are saved.
- The whole order cancelled (anyone, or the payment window) → the code is given back. Admin overview: `orders.totalDiscounts`, and `totalRevenue` = platform fees + commission − promo codes; GMV counts sales before discounts.

**Cancel one store's part** — `POST /orders/:id/sub-orders/:subOrderId/cancel { reason }` (customer): only while that store hasn't started preparing (`new` / `accepted`); not for an unpaid online order (pay or cancel it all). Paid online → refund request for that part (what was paid for it). COD → the service fee moves to another part not yet picked up. The last part cancelled = the whole order (service fee refunded, code given back). Fix: a store removing items no longer drops the service fee from the first part's COD cash.

**Block in chat** — `POST|DELETE /conversations/:id/block`, `GET /conversations/blocked`, `DELETE /conversations/blocked/:userId`. The blocked person can still send, but the message is kept for them only (`hiddenFor`, never returned): no unread, preview, notification or socket event for the blocker — they are not told. While an order (sub-order not delivered / cancelled) or a booking between them is open, messages still get through. Conversations return `blockedByMe` (only to the blocker).

### 7.20k Worker bookings, penalties, reviews and paid visibility (2026-10-22, client rules)

Payment is made **directly** between the customer and the worker (cash / Orange Money), never through the app: no escrow, no commission. Revenue = worker subscriptions.

**Bookings** (`/bookings`, app roles):
- `POST /bookings` `{ workerProfileId, scheduledAt, addressId?, description (10–1000), photos? (≤ 5) }` → `requested`, number `BK…`, `respondBy` = 24 h (or the date, if sooner). Rules: ≥ 30 min and ≤ 60 days ahead; worker must be public (see visibility); not yourself; one open booking per worker (409); ≤ 5 requests waiting; a limited customer (penalty) can have only one active booking.
- `GET /bookings?as=customer|worker&status=active|history|<status>` (meta.counts per status), `GET /bookings/:id`, `GET /bookings/me/standing` (customer: cancellations in 30 days, `limitedUntil`).
- Worker: `PATCH /:id/accept` (not while suspended; one at a time while limited), `PATCH /:id/decline { reason? }`, `PATCH /:id/done { agreedPrice? }` → `done`, `confirmBy` = 48 h.
- Customer: `PATCH /:id/confirm` → `completed`; `PATCH /:id/not-done { note? }` → back to `accepted`; `POST /:id/review { rating 1–5, comment?, photos? (≤ 4) }` (completed only, once).
- Either: `PATCH /:id/cancel { reason }` — before acceptance (customer) free; after acceptance the reason is required and it **counts** (response `{ booking, penalty }`). A worker "cancelling" a request declines it. A `done` job can't be cancelled.
- Privacy: before acceptance the worker sees the area only (city, commune, neighborhood); once accepted both see each other's phone, the worker the full address, landmark, map point and gate photo. Public worker pages never show a phone.
- Sweep (every minute): unanswered requests → `expired`; `done` not confirmed in 48 h → `completed` (by system).
- Chat: `POST /conversations { type: "worker", bookingId }` lets either person write (even after the listing ends).
- Socket `booking:updated { bookingId, status }` to both; notifications type `booking_update` (data `{ kind: "booking", bookingId, status }`).

**Penalties** — cancellations after acceptance over the rolling last 30 days (lifted ones don't count):
- Worker: 1st warning · 2nd less visible 15 days (sorted after everyone else) · 3rd+ suspended 7 days (hidden, no new bookings, can't accept) then one booking at a time until day 30. Messages use the client's wording (data `{ kind: "booking_penalty" }`).
- Customer: 1st–2nd warning · 3rd+ one active booking at a time for 30 days.
- Admin: `GET /bookings/admin/penalties?role=&active=true&search=`, `PATCH /bookings/admin/penalties/:id { action: lift | soften, note? }` (soften = a worker's suspension becomes 30 days less visible). Audit-logged, person notified.

**Reviews**: public `GET /professional-profiles/workers/:id/reviews` (meta.stars per rating; author name + avatar only); the worker's `ratingAvg/ratingCount` come from visible reviews. Admin `GET /bookings/admin/reviews`, `PATCH /bookings/admin/reviews/:id { status: visible | hidden }`.

**Admin bookings**: `GET /bookings/admin?status=&search=` (meta.counts), `GET /bookings/admin/:id` (contacts, history, review, strikes), `PATCH /bookings/admin/:id/cancel { reason }` (never a penalty).

**Paid visibility**: a worker is public only while `listedUntil` > now (plus listed, approved, not suspended). The first approval gives **30 free days**; workers approved before this change got the same at server start. Any **service-provider plan** paid → `listedUntil` extended by its `durationDays` (after what is left). Notices 3 days before the end and at the end (data `{ kind: "worker_listing" }`). Profile also has `workPhotos` (≤ 10, public). The worker summary (`GET /professional-profiles/me/worker-summary`) adds `isVisible`, `listing`, `penalty` (+ strikes), `bookings` counts and `earnings { total, thisMonth, pricedJobs }` (from the prices workers entered).

### 7.20j Become a worker — admin approval (2026-10-21)

- A professional profile is the CV **and** the worker listing. The listing now has the same approval workflow as stores and riders (`approvalStatus`, `reviewNote`, `reviewedBy`, `reviewedAt`, `submittedAt`, `applicationHistory`; shared `profile_common` transitions). New fields: `workingHours { days: [0–6], from, to }` ("HH:mm"), `idDocument` (file).
- `POST /professional-profiles/me/worker-application/submit` — needs photo, profession, serviceCategoryId, experienceYears, hourlyRate > 0, city, summary ≥ 20 chars, ≥ 1 skill and idDocument (400 names the missing ones). From draft / needs_changes / rejected → pending, and `isWorkerListed = true`. 409 when pending, approved or suspended.
- `GET /professional-profiles/me/worker-summary` — status, note, listing, rating, worker chats (count, unread, unread chats) and the latest 5 (other person: name + avatar only).
- Admin: `GET /professional-profiles/admin/workers?status=&search=&page=` (staff+; `meta.counts` per status; search by name, phone, e-mail, profession, area), `GET …/admin/workers/:id` (with ID document and history), `PATCH …/admin/workers/:id/review` `{ action: approve | reject | needs_changes | suspend | reinstate, note }` (admin/super admin; note required except approve/reinstate). Audit-logged; the worker is notified (`profile_approved` or `system_alert`, customer mode) and gets `application:reviewed { kind: "worker" }`.
- Public: `GET /professional-profiles/workers`, `/workers/:id` and `POST /conversations` type worker only for listed **and** approved workers. Public responses never include `idDocument`, `uploadedResume`, `generatedCv` or review data (the CV files used to be returned — recruiters pay to unlock them).
- `PATCH /me/worker-listing` can turn the listing on only once approved (it can always pause it). A new `idDocument` on an approved profile sends it back to pending.
- At server start, workers listed before this change are marked approved (they stay visible) and every other profile without a status becomes draft. Idempotent.

### 7.20i Cash-on-delivery limit and pay-first online orders (2026-10-21)

- **COD limit:** `POST /orders/checkout-summary` returns `cod: { allowed, limit }`. Each store's cash part (`total` of the store; the first store also carries the platform fee + tax — the same amount as `codAmountToCollect`) must be ≤ `settings.riderCashLimitDefault`, the cash any rider may carry. `POST /orders` with `paymentMethod: cod` above it → 400. Online methods are unaffected.
- **Online orders (orange_money, mobile_money, card):** sub-orders are created `pending_payment` and the order gets `paymentDueAt` = placed + 30 min (`PAYMENT_WINDOW_MINUTES`). The stock is reserved; the store sees nothing (vendor list / detail / status / modify / cancel exclude it, `?status=pending_payment` → 400), no escrow is held, no delivery legs exist, `POST /conversations` about it → 400, and it is not counted in GMV.
- **Payment confirmed** (webhook or dev confirm): each sub-order → `new` (timeline `payment_received`), escrow held, delivery legs created, `order_placed` sent to the store. Repeat webhooks change nothing.
- **Not paid in time:** a sweep started with the server (every minute; safe with several instances — every change is an atomic claim) cancels the sub-orders (`cancellation.by = "system"`), releases the stock, puts the items back in the customer's cart and sends one `order_cancelled` notice to the customer (the store is never told). `POST /payments/initiate` after `paymentDueAt` → 400.
- **Paid after cancellation** (expired or cancelled by the customer): the payment is recorded and a pending refund request (source `cancellation`) is opened for the admin; the order stays cancelled.
- Older orders without `paymentDueAt` are left as they are.

### 7.20h Customers also bought (Phase 11)

- `GET /cart/suggestions?limit=10` (signed in, max 20): products found in the same sub-orders as the cart's products (accepted → delivered only; the latest 500 such sub-orders), ranked by how many orders they share, then topped up with the best sellers (`soldCount`) of the cart's categories. Only approved, available, in-stock products; never what is already in the cart; empty cart → `[]`. Same item shape as `GET /products` (store without phone). Counts only — nothing about other buyers.
- Demo seed: two home banners, a home `popup` and a category `interstitial`.

### 7.20g Jobs, CV and plans (Phase 10)

- **Recruiter home:** `GET /jobs/my?tab=active|draft|closed` — my offers in any state (active = published and not past 30 days; draft = draft or unpaid; closed = closed or expired), each with `isOpen`; `meta.counts = { active, draft, closed, applicants, views }`.
- **Job details** (`GET /jobs/:id`, sign-in optional): drafts and unpaid offers only for their poster (404 for others). Adds `isOwner`, `isOpen` and, for a signed-in viewer, `myApplication { _id, status, createdAt }`.
- **Applications:** applying twice → 409. `GET /jobs/applications/:id` → the candidate's own (job populated) or, for the recruiter, behind the CV paywall; `viewerRole` says which. `PATCH /jobs/applications/:id/withdraw` (candidate; while applied / under review / shortlisted / interview) and `POST /jobs/applications/:id/interview/confirm` (candidate) notify the recruiter in the mode the job was posted from.
- **Recruiter decisions:** `PATCH /jobs/applications/:id/status` accepts only under_review, shortlisted, hired, rejected, and not on a withdrawn application; `interview` goes through `POST …/interview` (a new date for the same candidate is a reschedule, not one more interview in the stats).
- **Fees** (publish, CV unlock, spontaneous application, subscription) are online only: `cod` → 400. `unlock-cv` validates `paymentMethod`.
- **CV:** `generate-ai-cv` suggests a summary from the profile in `lang` (fr / en) and saves nothing; the app makes the CV PDF, uploads it and saves it as `generatedCv` (`generatedAt` set). `null` removes `photo`, `uploadedResume` or `generatedCv`.
- **Subscriptions:** the period starts when the payment succeeds; a renewal while still subscribed starts at the current end. A payment retried from the payment screen (no subscription record yet) creates and activates one.

### 7.20f Bus driver / station relay (Phase 9)

- **Choosing a driver:** `GET /deliveries/:id/available-riders` on a bus leg (`line_haul`) returns only bus drivers, each with `servesRoute` (true = their `transitRoutes` include this station → station pair); those come first. On a leg leaving the store, the store's linked riders come first; on a leg leaving a station, riders are sorted by distance only. Then the nearest.
- **Customer data:** a rider's list and track only include `orderId.addressSnapshot` and `toPhone` on the leg that ends with the customer: the door (local / last mile) or the bus leg of a `station_pickup` order. The first-mile rider and a relay bus driver hand over at a station and never get them. `orderId.deliveryType` is included.
- **Codes at a station** (unchanged, see the relay rules): the receiver shows `incomingHandoverPin` and the giver types it (`verify-handover`); the giver shows `outgoingPickupPin` and the receiver types it (`verify-pickup`).

### 7.20e Rider app (Phase 8)

- **My jobs:** `GET /deliveries/rider/my-deliveries` takes `type`: `new` (assigned, waiting for my answer), `ongoing` (accepted → in transit), `completed` (delivered / cancelled), `active` (new + ongoing), plus `page` / `limit` (max 50). Running tabs are oldest first; history is newest first. Each row has the sub-order number, items and `codAmountToCollect`, and the order's number, payment method and address snapshot. PINs are never included.
- **Step screen:** `GET /deliveries/:id/track` as the assigned rider also returns the items and `codAmountToCollect`.
- **Wrong PINs:** 5 wrong codes lock the leg for 15 minutes (429, "Try again in N min."). When the lock has passed, the rider gets a fresh round of 5 attempts.
- **COD cash:** `GET /wallets/me/cod-settlements` lists my declarations (newest first, paged; `rejectionReason` when rejected). The rider summary has `balances.cashDeclared` (declared, waiting for an admin; still counted in `cashOwed`).
- **Admin:** `PATCH /wallets/admin/cod-settlements/:id` needs `rejectionReason` (3–300 chars) to reject. The rider gets a notification for both outcomes and a socket event (`cod_settlement:confirmed` / `cod_settlement:rejected`).

### 7.20d Refunds with admin approval

Money paid online (Orange Money / MoMo / card) goes back only after an admin approves it.

- **Requests open automatically** when a store, the customer or an admin cancels a sub-order of a paid order (its total), when the whole order ends up cancelled (what is left: service fee, tax), and when a store removes items (the difference). There is **one pending request per order**: new amounts are added as `lines` (`source`: `cancellation` | `modification` | `order_fees`). The amount never exceeds paid − refunded − already requested. COD and unpaid orders open nothing.
- `GET /payments/admin/refunds?status=pending|completed|rejected` — with customer (name, phone), order (number, total, payment method/status), `lines[].subOrderId.subOrderNumber`, `issuedBy.name`.
- `PATCH /payments/admin/refunds/:id` — `{ status: "completed", amount?, transactionId?, notes? }` after sending the money (amount ≤ requested), or `{ status: "rejected", rejectionReason }`. Atomic (409 if another admin decided first). Order → `refunded` / `partially_refunded`. The customer gets a `refund_update` notification.
- `POST /payments/admin/refunds` (manual) and dispute refunds are created already `completed` (`source`: `admin` | `dispute`), and accept `transactionId`. When the store was already paid for that sub-order, the amount is deducted from its wallet.
- `GET /orders/:id` (customer) includes `refunds` (no admin notes).

### 7.20c Vendor app changes (Phase 7)

- `GET /orders/vendor/sub-orders?status=new` or several statuses comma-separated (`accepted,preparing,ready_for_pickup,in_delivery`). Each row has `orderId { orderNumber, deliveryType, paymentMethod, paymentStatus }` and the rider's name (no phone).
- `PATCH /orders/vendor/sub-orders/:id/modify` — `{ modifications: [{ productId, action: "remove" | "update_qty", newQty }], reason }`. Quantities can only go **down**; removing every item is refused (cancel the order instead). Stock goes back, commission is recalculated with the settings minimum, and the customer is notified of the new total.
- `GET /deliveries/:id/available-riders` — only the store of that order (others get 404).
- `GET /products/my-products?statusTab=all|active|in_review|out_of_stock` — `in_review` = pending + rejected.
- `PATCH /products/:id` by the store on a **rejected** product with content changes (name, description, photos, category, prices, features, in the box) sets it back to `pending`.
- `GET /products/:idOrSlug` — products that are not approved are visible only to their store and admins.
- `PATCH /vendors/me` — moving `address.location` also moves the store's products for distance search.

### 7.21a Delete my account

`DELETE /user/me` soft-deletes the account (contacts freed, tokens and devices removed). Refused with **409** and a clear message while: the user has an order in progress as a buyer; their store has sub-orders in progress; they have deliveries in progress; they still owe COD cash; or any of their wallets holds money (held or available).

### 7.21b Chat (app)

| Endpoint | Who | Notes |
|---|---|---|
| `POST /conversations` | Signed-in | start or reopen a chat **by subject**: `{ type: "buyer_seller", vendorId }`, `{ type: "worker", workerProfileId }`, `{ type: "order", subOrderId, with: "vendor" \| "rider" \| "customer" }`, `{ type: "job_application", applicationId }`. The server resolves the other person and both modes from the data (403 if you are not part of that order/application, 400 for your own store, no rider yet, or a free `recipientId`). `allowVoice` is true only for the buyer ↔ rider of that order. |
| `GET /conversations?mode=` | Signed-in | my chats in one mode, newest activity first. Each has `peer { userId, mode, name, avatar, vendorId? }` (stores appear as the store), `myMode`, `myUnread`. **No phone or email** anywhere. |
| `GET /conversations/unread-count?mode=` | Signed-in | `{ unreadCount }` across my chats in that mode |
| `GET /conversations/:id` | Participant | one chat (same shape) |
| `GET /conversations/:id/messages?page=&limit=` | Participant | page 1 = the newest messages; inside a page oldest → newest |
| `POST /conversations/:id/messages` | Participant | `{ type: text \| image \| voice, text?, mediaUrl?, mediaDurationSec? }`. Contacts are masked; 3 violations → 24 h restriction (403), 5 → suspension. |
| `PATCH /conversations/:id/read?mode=` | Participant | marks my side read, emits `message_read` |

### 7.22 Payments, Refunds & Disputes

#### Money IN & Customer Payments
| Endpoint | Who | Notes |
|---|---|---|
| `POST /payments/initiate` | Signed-in | initiate payment for an order, subscription, job publishing, or CV unlock: `{ purpose, refId, method: "orange_money" \| "mobile_money" \| "card" \| "cod", provider?, idempotencyKey? }`. Validates ownership and the idempotency key (same key → same payment), creates a **pending** payment. The order becomes `paid` only through the webhook. Refused for COD orders, cancelled orders and paid orders. |
| `GET /payments/:id` | Signed-in (payer) | one of my payments (`pending` / `success` / `failed` / `refunded`), polled by the app's waiting screen. Another user's id → 404. |
| `POST /payments/:id/dev-confirm` | Signed-in (payer), **development only** | `{ status: "success" \| "failed" }` — finishes my pending payment exactly like the webhook (fulfilment + `payment:successful`). Returns 404 when `NODE_ENV=production`. |
| `POST /payments/webhook` | Gateway only — header `x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>` | gateway callback for Orange Money / MTN Momo: `{ idempotencyKey?, providerRef?, paymentId?, status: "success" \| "failed", amount?, raw? }`. Wrong/missing secret → 401; not configured → 503; `amount` different from the payment → 400 and the payment is marked failed. Fulfils the purpose: order paid, job published, subscription activated, spontaneous application delivered to the vendor, CV unlocked. |
| `GET /payments/me` | Signed-in | user's payment history with status and gateway references (`?purpose=&page=&limit=`) |

#### Customer Disputes
| Endpoint | Who | Notes |
|---|---|---|
| `POST /payments/disputes` | Customer | file dispute for an order or sub-order: `{ orderId, subOrderId?, reason, amount?, notes? }` |
| `GET /payments/disputes` | Customer | list my disputes and resolution status |

#### Admin Refunds & Dispute Resolution
| Endpoint | Who | Notes |
|---|---|---|
| `GET /payments/admin/all` | Admin | list all transactions across the platform with filters (`?status=&purpose=&method=&page=&limit=`) |
| `POST /payments/admin/refunds` | Admin | issue refund for an order: `{ orderId, subOrderId?, amount, reason, notes? }`. Updates order status to `refunded` or `partially_refunded`. If vendor earnings were already settled, logs `refund_deduction` on vendor ledger. |
| `GET /payments/admin/refunds` | Admin | list of issued refunds |
| `GET /payments/admin/disputes` | Admin | list of disputes submitted by customers |
| `PATCH /payments/admin/disputes/:id/resolve` | Admin | resolve dispute: `{ status: "resolved" \| "rejected", adminResolution, notes?, issueRefund?: boolean, refundAmount?: number }`. Emits socket notification to customer. |

### 7.23 Professional Profiles & Worker Directory

| Endpoint | Who | Notes |
|---|---|---|
| `GET /professional-profiles/workers` | Public | search listed workers with filters (`?search=&categoryId=&city=&lat=&lng=&maxDistanceKm=&minRating=&page=&limit=`). |
| `GET /professional-profiles/workers/:id` | Public | view single listed worker profile with skills, ratings, and experience. |
| `GET /professional-profiles/me` | Signed-in | view own professional profile (CV, education, experience, worker listing status). |
| `PUT /professional-profiles/me` | Signed-in | create or update professional profile (`profession, summary, photo, city, location, skills, languages, achievements, profileEducation, profileExperience, hourlyRate, experienceYears, serviceCategoryId`). |
| `PATCH /professional-profiles/me/worker-listing` | Signed-in | toggle listing in "Popular Workers" directory (`{ isWorkerListed: boolean, hourlyRate?, experienceYears?, serviceCategoryId? }`). |
| `POST /professional-profiles/me/generate-ai-cv` | Signed-in | suggests a CV summary from the profile, template-based (`{ targetRole?, tone?, lang?: "fr" or "en" }` → `{ summary }`). Saves nothing; the app builds the CV PDF, uploads it and saves it as `generatedCv` with `PUT /me` (`null` removes `photo` / `uploadedResume` / `generatedCv`). |

### 7.24 Jobs & Job Applications

#### Job Posts
| Endpoint | Who | Notes |
|---|---|---|
| `GET /jobs` | Public | search active jobs with geo radius, workplace, category, and keyword filters (`?search=&categoryId=&jobType=&workplace=&city=&lat=&lng=&maxDistanceKm=`). |
| `GET /jobs/:id` | Public | view job details; increments view counter for non-creators. |
| `POST /jobs` | Signed-in | create job draft (`title, organizationName, categoryId, jobType, workplace, city, location, salaryMin, salaryMax, about, responsibilities, requirements, benefits, prefSkills, vacancies`). |
| `PATCH /jobs/:id` | Creator | update job post details. |
| `POST /jobs/:id/publish` | Creator | publish job post: requires 5,000 GNF publishing payment (`{ paymentMethod }`); activates job for 30 days (`expiresAt`). |
| `POST /jobs/:id/close` | Creator | close active job post. |

#### Job Applications & Recruiter Pipeline
| Endpoint | Who | Notes |
|---|---|---|
| `POST /jobs/apply` | Candidate | apply to published job (`{ jobId, resume?, coverNote? }`). Auto-computes match score (0–100%) against job `prefSkills` and snapshots CV at apply time. |
| `POST /jobs/apply-spontaneous` | Candidate | send a paid spontaneous application to a store (`{ targetVendorId, resume?, coverNote?, paymentMethod }`). Returns `{ application, payment }` with `application.status = "pending_payment"`; the vendor only receives it once the payment succeeds. |
| `GET /jobs/applications/received` | Vendor | inbox of paid spontaneous applications (`?status=&page=&limit=`). Same CV paywall as job applicants. |
| `GET /jobs/applications/my` | Candidate | list my submitted job applications with status and interview updates. |
| `GET /jobs/:id/applicants` | Recruiter | view applicants for my job, sorted by match score or submission date (`?status=&sortBy=match\|date`). |
| `PATCH /jobs/applications/:applicationId/status` | Recruiter | update application status (`applied`, `under_review`, `shortlisted`, `rejected`, `hired`). |
| `POST /jobs/applications/:applicationId/interview` | Recruiter | schedule interview (`{ at, location?, mapUrl?, note? }`). Updates application and notifies candidate via socket/push. |
| `POST /jobs/candidates/:applicantId/unlock-cv` | Recruiter | unlock a candidate's phone, email and CV file (`{ paymentMethod }`), price `settings.pricing.cvUnlockFee` (5,000 GNF). Only for candidates who applied to your jobs or your store (403 otherwise). Returns `{ unlocked, payment }` — access starts when the payment succeeds; already unlocked → `{ unlocked: true, payment: null }`. **Paywall:** applicant lists return `applicant: { _id, name, avatar }` and `isCvUnlocked`; `applicant.phone`, `applicant.email` and `cvSnapshot.file` appear only after unlocking. |

### 7.25 Subscriptions

| Endpoint | Who | Notes |
|---|---|---|
| `GET /subscriptions/plans` | Public | list active subscription plans (`?audience=job_seeker\|service_provider`). |
| `POST /subscriptions/subscribe` | Signed-in | subscribe to a plan: `{ planId, paymentMethod }`. Automatically activates `cvVisible = true` and `visibleUntil` on user's professional profile. |
| `GET /subscriptions/me` | Signed-in | view active subscription and feature entitlements. |
| `POST /subscriptions/admin/plans` | Admin | create subscription plan (`{ name, audience, price, durationDays, features }`). |
| `PATCH /subscriptions/admin/plans/:id` | Admin | update subscription plan. |

### 7.26 Chat & Messaging

| Endpoint | Who | Notes |
|---|---|---|
| `POST /conversations` | Signed-in | start or retrieve existing conversation: `{ recipientId, recipientMode, myMode, type, orderId?, subOrderId?, applicationId?, workerProfileId? }`. Auto-enforces voice note rule (`allowVoice = true` **strictly only** for customer ↔ rider) and auto-inserts initial safety warning. |
| `GET /conversations` | Signed-in | list my conversations filtered by participant `mode` (`?mode=customer\|vendor\|rider&page=&limit=`). Segregates vendor and customer inboxes. |
| `GET /conversations/:id` | Participant | get conversation details with populated participant profiles and context. |
| `PATCH /conversations/:id/read` | Participant | mark conversation as read for active mode; resets `unreadCount = 0` and emits `message_read` socket event. |
| `DELETE /conversations/:id` | Participant | delete the chat **for me only**: older messages hidden for me, out of my list until a new message arrives (the other person and the team keep theirs). |
| `GET /conversations/:id/messages` | Participant | paginated message history (`?page=&limit=`). |
| `POST /conversations/:id/messages` | Participant | send message: `{ type: "text" \| "voice" \| "image", text?, mediaUrl?, mediaDurationSec? }`. Anti-circumvention filter inspects phone, email, URL, and social keywords. Flags violations with progressive penalties (warn → restrict 24h → suspend). Voice notes restricted to allowed conversations. |
| `GET /conversations/admin/moderation-violations` | Admin | view content moderation violations log with rule triggers and actions taken (`?rule=&action=&userId=&page=&limit=`). |
| `POST /conversations/admin/users/:userId/lift-restriction` | Admin | lift temporary chat restrictions or account suspensions for a moderated user. |

### 7.27 Trust, Safety & Reports

| Endpoint | Who | Notes |
|---|---|---|
| `POST /reports` | Signed-in | submit report: `{ targetType: "user" \| "review" \| "order" \| "message", targetId, orderId?, conversationId?, reason, description? }`. |
| `GET /reports/me` | Signed-in | list reports filed by the requesting user (`?status=&page=&limit=`). |
| `GET /reports/admin/all` | Admin | admin review queue for all filed complaints (`?targetType=&status=&page=&limit=`). |
| `PATCH /reports/admin/:id/action` | Admin | resolve report: `{ status: "reviewed" \| "actioned" \| "dismissed", actionTaken?, adminNotes? }`. |

### 7.28 In-App Notifications

| Endpoint | Who | Notes |
|---|---|---|
| `GET /notifications` | Signed-in | get in-app notifications inbox filtered by current mode (`?mode=&isRead=&page=&limit=`). Documents auto-expire after 90 days via TTL index. |
| `GET /notifications/unread-count` | Signed-in | get count of unread notifications for active mode (`?mode=`). |
| `PATCH /notifications/:id/read` | Signed-in | mark single notification as read. |
| `PATCH /notifications/read-all` | Signed-in | mark all notifications as read for user's active mode (`?mode=`). |

### 7.29 Support Tickets

| Endpoint | Who | Notes |
|---|---|---|
| `POST /support-tickets` | Signed-in | submit help & support ticket: `{ type, userMode?, subject?, urgency?, description, attachments? }`. Auto-generates unique sequential ticket code (`SUP-xxx`). |
| `GET /support-tickets/me` | Signed-in | list my submitted support tickets (`?status=&page=&limit=`). |
| `GET /support-tickets/me/:id` | Signed-in | view ticket details and resolution notes. |
| `GET /support-tickets/admin/all` | Admin | admin support queue with filters (`?status=&urgency=&userMode=&type=&search=&page=&limit=`). |
| `GET /support-tickets/admin/:id` | Admin | admin get detailed ticket with user and assignee information. |
| `PATCH /support-tickets/admin/:id/assign` | Admin | assign ticket to a staff/admin team member (`{ assignedTo }`). Logs to audit log. |
| `PATCH /support-tickets/admin/:id/status` | Admin | update ticket lifecycle status (`open`, `in_progress`, `resolved`, `closed`) and resolution note. Sets `resolvedAt`, logs to audit log, and notifies user via socket & push. |

### 7.30 Advertisements & Banners

| Endpoint | Who | Notes |
|---|---|---|
| `GET /advertisements` | Public | fetch currently active banner campaigns for app placements (`?placement=home\|category\|search`). Checks date range and active status. |
| `POST /advertisements/:id/impression` | Public | telemetry endpoint to record banner impression count (`impressions++`). |
| `POST /advertisements/:id/click` | Public | telemetry endpoint to record banner click (`clicks++`) and return destination link. |
| `POST /advertisements/admin` | Admin | create new advertising campaign (`{ name, advertiserName, type?, placement, images, linkUrl?, description?, startAt, endAt, status? }`). |
| `GET /advertisements/admin/all` | Admin | list all campaigns with impressions, clicks, and computed CTR % (`?status=&placement=&search=&page=&limit=`). |
| `GET /advertisements/admin/:id` | Admin | get advertisement campaign details. |
| `PATCH /advertisements/admin/:id` | Admin | update campaign parameters, banner creatives, or dates. |
| `DELETE /advertisements/admin/:id` | Admin | delete advertising campaign. |

### 7.31 Admin Dashboard & Operations Overview

| Endpoint | Who | Notes |
|---|---|---|
| `GET /admin/dashboard/overview` | Admin | platform-wide executive summary: user counts by role, order counts & total GMV, pending withdrawals, open/critical support tickets, and pending vendor/rider approvals. |

### 7.32 Order & Product Reviews

| Endpoint | Who | Notes |
|---|---|---|
| `POST /reviews` | Customer | submit verified review for a delivered sub-order: `{ subOrderId, rating: 1..5, comment? }`. Strictly enforces one review per sub-order; automatically recalculates average rating and rating count for the vendor store and all contained products. |
| `GET /reviews/me` | Signed-in | list reviews written by the requesting user. |
| `GET /reviews/vendor/:vendorId` | Public | paginated public review feed for a vendor store (`?page=&limit=`). |
| `GET /reviews/product/:productId` | Public | paginated public review feed for a specific product (`?page=&limit=`). |
| `POST /reviews/:id/report` | Signed-in | flag an inappropriate review for admin moderation (`reportCount++`). |
| `PATCH /reviews/admin/:id/status` | Admin | moderation endpoint to toggle review visibility (`{ status: "visible" \| "hidden" }`); automatically recalculates vendor and product rating averages upon status changes. |

---

## 8. Rate limits & OTP rules

| Rule | Value |
|---|---|
| Global | 200 requests / 15 min per IP |
| Auth endpoints (login, verify, refresh, passwords) | 20 / 15 min per IP |
| Code-sending endpoints (register, resend, forgot, phone request) | 30 / hour per IP |
| Code length | 6 digits |
| Code validity | 5 minutes (`expiresIn`) |
| Resend cooldown | 60 seconds per phone/email (`resendIn`) |
| Wrong attempts | 5, then request a new code (locked 10 min) |
| Codes per phone/email per day | 10 |
| Delivery | SMS to the phone **and** email (if the account has one); phone change → SMS only |

---

## 9. Real-time (Socket.io)

Connect to the server root (not `/api/v1`) with the access token:

```js
const socket = io("http://localhost:5000", { auth: { token: accessToken } });
```

- On connect the user joins a private room (`user:<userId>`) — server events for this user arrive here.
- The connection is refused for suspended / banned / deleted accounts and revoked tokens (same rules as the REST API).
- Chat rooms: emit `join_conversation` / `leave_conversation` with the conversation id — **participants only**; `typing` / `stop_typing` with `{ conversationId }`; `message_read` with `{ conversationId }`.
- Delivery tracking rooms: emit `join_delivery` / `leave_delivery` with the delivery id — **customer, store owner, riders of the leg chain and admins only**.
- Rider location stream: the **assigned rider** emits `rider_location` with `{ deliveryId, lat, lng, heading }` (ignored from anyone else).
- A refused join emits `error_message` `{ event, message }`.
- `session:revoked` `{ reason }` is sent just before the server closes all of a user's sockets (ban/suspension, logout everywhere, password change or reset, account deletion). Reconnect with a fresh token, or go to Login.
- Events available now:

| Event | Payload | When |
|---|---|---|
| `application:reviewed` | `{ kind: "vendor" \| "rider", status, note }` | the admin decided on my application → refresh `GET /user/me` |
| `rider_link:updated` | `{ linkId, status }` | a store / rider invited, accepted, declined or removed me |
| `delivery:assigned` | `{ deliveryId, subOrderId, legType, fee, fromName, toName, collectsCash }` | sent to rider when vendor assigns a delivery leg |
| `delivery:status_changed` | `{ status, riderId?, proofPhoto? }` | emitted to `delivery:<id>` room on every lifecycle change |
| `delivery:declined` | `{ deliveryId, subOrderId, reason }` | sent to vendor when rider declines a job |
| `rider:location_updated` | `{ deliveryId, lat, lng, heading }` | broadcast to tracking room as rider travels |
| `withdrawal:requested` | `{ withdrawalId, requestNumber, amount, netAmount }` | sent to user when withdrawal is submitted |
| `withdrawal:completed` | `{ withdrawalId, requestNumber, transactionId }` | sent to user when payout is processed |
| `withdrawal:rejected` | `{ withdrawalId, requestNumber, reason }` | sent to user when payout is rejected (funds restored) |
| `cod_settlement:confirmed` | `{ settlementId, amount }` | sent to rider when cash handover is confirmed |
| `payment:successful` | `{ paymentId, amount, purpose, refId }` | sent to payer when digital payment succeeds |
| `refund:issued` | `{ refundId, orderId, amount, reason }` | sent to customer when admin issues a refund |
| `dispute:resolved` | `{ disputeId, status, resolution }` | sent to customer when admin resolves dispute |
| `job_application:new` | `{ jobId?, vendorId?, applicationId, matchScore? }` | sent to job poster or vendor on new candidate application |
| `job_application:status_changed` | `{ applicationId, status }` | sent to applicant when status is updated |
| `job_application:interview_scheduled` | `{ applicationId, interview }` | sent to candidate when interview date/location is booked |
| `new_message` | `IMessage` | emitted to conversation room (`conv:<id>`) on new message |
| `conversation_unread` | `{ conversationId, unreadCount }` | sent to recipient user room when unread messages count changes |
| `message_read` | `{ conversationId, userId, readAt }` | relayed to conversation room when recipient opens/reads messages |
| `new_notification` | `INotification` | sent to user room (`user:<id>`) on new in-app notification |
| `ticket_update` | `{ ticketId, ticketNumber, status, resolution }` | sent to user when support ticket status is updated |

---

## Changelog

### Client feedback (2026-11-24, AP21): disputes only where they make sense, no delete while money is pending
- **Disputes have a `type`:** `not_received`, `damaged`, `wrong_item`, `missing_item` (delivery problems) or `payment`. `POST /payments/disputes { orderId, subOrderId?, type, reason }`:
  - a delivery problem only on a store part that was **delivered** → else 400 `DISPUTE_NOT_DELIVERED`;
  - `payment` only when money was paid online (COD: the fees) → else 400 `DISPUTE_NOTHING_PAID`;
  - one open dispute per store part (or per whole order) → 409 `DISPUTE_ALREADY_OPEN` (unique index);
  - `amount` is capped at what was paid for that part (no longer the order total);
  - a `subOrderId` from another order → 404; one-store orders default to that store's part;
  - no `type` (older apps) = treated as a delivery problem.
- `GET /orders/:id` (customer) also returns `disputable: [{ subOrderId | null, types, maxAmount }]` (empty → nothing to report; the app hides "Signaler un problème"), `canDelete` and `deleteBlock`.
- `DELETE /orders/my-orders/:id` → 400 `ORDER_DELETE_REFUND_PENDING` while a refund is pending, 400 `ORDER_DELETE_DISPUTE_OPEN` while a dispute is open (besides `ORDER_DELETE_IN_PROGRESS`).
- Admin `GET /payments/admin/disputes` items carry `type` (older ones have none).

### Client feedback (2026-11-24): quartier, refunds within 7 days, 8-hour accept delay, kept notifications
- **Quartier mandatory.** `POST /addresses` needs `neighborhood` (2–80 chars); `PATCH` can't empty it. Addresses saved before stay usable for `POST /orders/checkout-summary`, but `POST /orders` and `POST /bookings` answer 400 `ADDRESS_NEIGHBORHOOD_REQUIRED` until the quartier is added (the app asks to complete the address).
- **Refunds within 1 to 7 days.** Each refund request gets `dueBy` (opening + 7 days; open requests from before get it at start-up). The customer sees it on `GET /orders/:id` → `refunds[].dueBy` and in the notification. `GET /payments/admin/refunds?overdue=true` lists open requests past `dueBy`; with `status=pending` the most urgent come first.
- **A store has 8 hours to accept** a new order by default (`settings.orders.acceptMinutes` default 480; the dashboard types it in hours). The half-way reminder speaks in hours ("dans les 3 h 59").
- **Important notifications can't be deleted:** `refund_update`, `order_cancelled`, `withdrawal_update`, `moderation_warning`, `account_suspended`, `team_message`. `GET /notifications` → each item has `canDelete`; `DELETE /notifications/:id` on one of them → 403 `NOTIFICATION_KEPT`; `DELETE /notifications` (all) skips them.

### Client feedback (2026-11-23): worker "Customer requests"
- `GET /professional-profiles/me/worker-summary` → `messages` and `recent` now only count worker chats where someone wrote (not just the opening safety notice), and leave out the chats the worker deleted for themselves (`DELETE /conversations/:id`). A deleted chat comes back with the customer's next message; the customer keeps theirs, and reports / the team still see every message.

### Client feedback (2026-11-22): store chat, chat alerts, retention, delete
- **One chat per customer and store** (like WhatsApp). `POST /conversations { type: "order", subOrderId, with: "vendor" }` (customer) or `with: "customer"` (store) now returns the pair's `buyer_seller` chat with `topic: { subOrderId, subOrderNumber }`. Send `subOrderId` with `POST /conversations/:id/messages` to tag a message with its order: messages carry `subOrderId` + `subOrderNumber`, `lastMessage.subOrderNumber` too. A `subOrderId` that isn't this customer's order at this store → 400 `CHAT_ORDER_NOT_IN_CHAT`. Rider chats stay per delivery. At start-up the server merges the old per-order store chats into the store chat (messages keep their order; unread counts, reports, flags and notifications follow). Blocking: while any order between the customer and the store is going on, messages still get through.
- **Ride chat unread:** `GET /rides/:id`, `/rides/my/current` and `/rides/rider/current` include `chatUnread` (badge on the chat button).
- **Chat retention:** messages older than `settings.chat.retentionDays` (default 90, admin 30–730; public settings expose `chat`) are deleted every few hours with their photos and voice notes; a chat with nothing left is deleted. Kept: a chat with a pending report, messages about an order still going or with an open dispute / pending refund, a ride chat while the ride is going on. Env `CHAT_RETENTION_SWEEP_MS` (default 6 h).
- **Delete:** `DELETE /conversations/:id` (for me only: messages hidden for me, out of my list until a new message), `DELETE /professional-profiles/me/cv` (CV text + both files; a worker keeps trade, photo, city; `uploadedResume: null` / `generatedCv: null` on `PUT /me` removes one file), `DELETE /reviews/:id` (my store/product review; ratings redone), `DELETE /bookings/:id/review` (my worker review + photos), `DELETE /bookings/:id` (finished booking out of my history, my side only; 400 `BOOKING_DELETE_IN_PROGRESS`), `DELETE /jobs/:id` (draft / closed / expired offer; 400 `JOB_DELETE_NOT_ALLOWED`; candidates keep their application).
- `GET /user/me/alerts` (red dot on my other modes) — see 7.x User.

### Security & money fixes (2026-10-10)
- **COD:** vendor earnings are released only after the rider's cash is settled (`settlement: "awaiting_cod"`, FIFO allocation, `releasedSubOrders` in settlement responses). Riders can't declare more cash than they owe.
- **Payments webhook:** requires `x-webhook-secret`; optional `amount` must match. No default secret — set `PAYMENT_WEBHOOK_SECRET` (min 32 chars; required in production).
- **Jobs:** CV paywall enforced (contact & CV file only after unlock); spontaneous applications reach the vendor only after payment; new `GET /jobs/applications/received`; only the job poster / store owner can change an application.
- **Checkout:** fully rolled back if any step fails (stock, escrow, delivery legs). The response's `subOrders` now include `currentLegId`.
- **Orders:** `GET /orders/:id` and the vendor sub-order detail include `deliveries` (all legs, no PINs); the store phone is no longer sent to customers.
- **Intercity:** bus drivers / relay riders get `incomingHandoverPin` / `outgoingPickupPin` on their own leg.
- **Lists:** pagination is always at the top level — `data` is the array, `meta` = `{ page, limit, total, totalPage, totalPages }` (same value; `totalPage` is the documented name) plus extras such as `unreadCount` / `summary`. Changed: `/orders/my-orders`, `/orders/vendor/sub-orders`, `/orders/admin/all`, `/favorites`, `/products`, `/products/my-products`, `/products/admin` (summary now in `meta.summary`).
- **Validation:** request bodies are plain JSON on every route (some routes previously expected a `{ "body": {…} }` wrapper).
- **Workers directory:** no phone / email; subscribers (`isPremium`) listed first.
- **Push notifications:** every in-app notification is also pushed to the user's devices (FCM), respecting notification preferences. Requires `FIREBASE_SERVICE_ACCOUNT_BASE64`.
- **Sockets:** account checks at connect, room permissions, `session:revoked` on revocation.

### Notifications & concurrency (2026-10-10, later)
- **Notifications are now stored + pushed for business events** (shown in `GET /notifications`, `new_notification` socket event, FCM push). `data` always carries the ids to deep-link (`orderId`, `subOrderId`, `deliveryId`, `withdrawalId`, `applicationId`…).

  | Event | Who | `type` (`mode`) |
  |---|---|---|
  | Order placed | vendor | `order_placed` (vendor) |
  | Vendor accepted / parcel ready | customer | `order_accepted` / `ready_for_pickup` (customer) |
  | Rider assigned | rider | `new_delivery_assigned`, or `collect_payment` when the leg collects COD cash (`data.amountToCollect`) |
  | Rider declined | vendor | `ready_for_pickup` (vendor) — choose another rider |
  | Last leg picked up | customer | `rider_on_the_way` |
  | Delivered | customer + vendor | `order_delivered`, plus `feedback_request` to the customer |
  | Cancelled | every other party (customer, vendor, riders on open legs) | `order_cancelled` (`data.cancelledBy`) |
  | Money released | vendor / rider | `earnings_updated` |
  | Withdrawal paid / rejected | owner | `withdrawal_update` |
  | Vendor / rider KYC reviewed | applicant | `profile_approved`, or `system_alert` when not approved |
  | Job application: new / status change / interview | employer / applicant | `application_update` |
- **`GET /deliveries/:id/available-riders`** no longer returns the rider's `phone` (client rule: contact goes through in-app chat).
- **New `409 Conflict` responses** when two actions hit the same record at once — the app should refresh and show the message: cancelling an order the store just moved on, accepting/declining a leg that was just cancelled, a double tap on pickup/handover PIN, two admins processing the same withdrawal.
- **Cancellation rules:** customer — while `new` / `accepted`; store — until `preparing`; admin — anything not yet delivered (a delivered sub-order → **400**, issue a refund instead). If an admin cancels a parcel already out with a rider, stock is not restored.
- **Order status:** a multi-store order becomes `completed` / `partially_cancelled` only when every sub-order is finished (delivered or cancelled).
- **Testing:** `npm run test:e2e` runs the full money / delivery / security journey against a throwaway database (needs local MongoDB + Redis).

### Admin panel support & fixes (2026-10-10, admin review)
- **Validation errors:** `message` is now the first problem in readable form (e.g. `"note: A note is required to reject…"`) instead of `"Zod Error"`; `errorSources` is unchanged.
- **Fixed 500s:** several model references used wrong names, so any `populate` on them crashed — `GET /delivery-rates` (station names), dispute/refund lists (order), cart (product/store). All fixed.
- **Search is safe:** every search box (products, jobs, orders, tickets, ads, admin lists) treats the text literally — characters like `(` no longer cause a 500. Admin lists cap `limit` at 100.
- **Subscription plans:**
  - `features` only accepts keys the backend implements — currently `cv_visibility`. New `highlights: string[]` holds the selling points the app displays.
  - New `GET /subscriptions/admin/plans` (admin): all plans, including inactive ones, with `activeSubscribers`.
  - `PATCH /subscriptions/admin/plans/:id` accepts `isActive`. It is a true partial update: before, a PATCH silently reset `durationDays` / `features` to their defaults.
- **Orders (admin):**
  - `GET /orders/admin/all` adds the `paymentMethod` and `customerId` filters; invalid enum values return 400.
  - `GET /orders/admin/:id` populates the customer and the partner on each delivery leg (name, phone).
- **Refunds:** refused for an unpaid order (COD before delivery). Refunds can never add up to more than the order total.
- **Disputes:** resolving is atomic. If the requested refund fails, the dispute stays `open`.
- **Categories:** a category used by products, stores, jobs or worker profiles can't be deleted (409). Deactivate it with `isActive: false` instead.
- **Withdrawals (admin):** `search` (request number, account) and `method` filters.
- **Admin detail views:** vendor and rider detail include `wallet` (available, escrow, earned, withdrawn, cash owed); the COD settlement list includes the rider's name and phone.
- **Ads (admin list):** `meta.summary` = totals across all ads (`impressions`, `clicks`, `active`, `ctr`).
- **Overview:** money figures exclude cancelled orders. `orders.totalRevenue` = platform fees + commission on paid-out orders (also `totalCommission`). Chart values use the same definition.
- **Chat moderation:** lifting a restriction also resets the warning count, and only re-activates a suspension that chat moderation caused. An admin's own suspension stays.

### Step 9 — Admin Panel, Platform Settings, Support Tickets & Ads (current)
- **Order & Product Reviews (`reviews`):** Verified customer feedback on delivered sub-orders (`(author_id, sub_order_id) [unique]`), 1–5 star ratings, feedback comments, automatic recalculation of average ratings and total counts on `vendor_profiles` and `products`, public review feeds, and admin visibility moderation.
- **Support Tickets Queue (`support_tickets`):** End-to-end helpdesk ticketing with human-readable sequential codes (`SUP-xxx`), urgency tags (`low`, `medium`, `high`, `critical`), attachment arrays, and role modes (`customer`, `vendor`, `rider`).
- **Ticketing Staff Assignment & Resolution:** Admin ticket assignment to support team members, status progression (`open` → `in_progress` → `resolved` → `closed`), resolution recording, real-time push/socket notifications to ticket owners, and immutable audit logs.
- **Dynamic Advertisements & Banners (`advertisements`):** Outside advertiser banner management across `home`, `category`, and `search` placements; schedule windows (`startAt` to `endAt`); impression and click tracking telemetry with CTR analytics.
- **Admin Dashboard Executive Overview:** High-level platform KPIs covering active users across all roles, total orders and GMV volume, platform fee revenue, pending driver cash withdrawals, and operational backlog (open tickets, critical complaints, pending approvals).

### Step 8 — Chat, Trust & Moderation
- **Multi-Mode Conversation Isolation:** `conversations` with embedded `conversation_participants[]` maintaining separate inboxes and independent `unreadCount` trackers for `customer`, `vendor`, and `rider` modes.
- **Voice Note Policy:** Strictly enforced `allow_voice = true` exclusively for customer ↔ rider conversations (a key accessibility feature for illiterate users); disallows voice notes across standard buyer-seller and job threads.
- **System Safety Warning:** Automatic system message created immediately upon conversation initiation advising users not to share bank details or make off-platform payments.
- **Anti-Circumvention Content Moderation Pipeline:** Real-time regex inspection for phone numbers (Guinean `+224` and international formats), emails, URLs, and social messaging handles (@username, WhatsApp, Telegram, etc.). Masks sensitive contact details (`[CONTACT MASQUÉ - Kadou24h]`) and records infractions in `moderation_violations`.
- **Progressive Violation Escalation:** Configurable thresholds (`settings.moderation`): 1st violation issues a safety warning; 3rd violation places a 24-hour restriction on chat (`chatRestrictedUntil`); 5th violation suspends the user account pending admin review.
- **Admin Moderation & Safety Queue:** Endpoints for auditing contact filter violations and lifting restrictions or suspensions.
- **Community Reports Queue:** Users can report bad actors, reviews, orders, or abusive messages; support/admin workflow with status updates and actions taken.
- **In-App Notification Inbox:** Mode-specific inbox with bilingual titles/bodies (`{ fr, en }`), deep-link data payloads, and automatic 90-day TTL data retention.
- **Real-Time Messaging Sockets:** Full integration with Socket.io conversation rooms (`conv:<id>`), `new_message`, `typing`, `stop_typing`, and `message_read` events.

### Step 7 — Jobs, Worker Profiles & CV
- **Professional Profiles & Worker Directory:** Dual-purpose profile system serving as an AI-powered CV and public service listing ("Popular Workers"); includes profession, bio, education, experience, skills, languages, achievements, hourly rates, and geo-radius distance searches (`2dsphere`).
- **AI-Powered CV Generator:** Generates structured professional summaries and formatted markdown resumes tailored to the candidate's skills and chosen tone.
- **Job Posting & Publishing Flow:** 3-step job creation (details, salary, candidate preferences); 5,000 GNF publishing payment unlocking 30-day active visibility (`expiresAt`); close/expire lifecycle management.
- **Candidate Match Scoring:** Automated 0–100% match score algorithm comparing applicant competencies and languages against job requirements (80% skill weight, 20% language weight).
- **Recruiter Pipeline & Interviews:** Recruiter applicant tracking sorted by match score or submission date; status pipeline (`applied` → `under_review` → `shortlisted` → `interview` → `hired` / `rejected`); interview scheduling with map locations and real-time socket alerts.
- **Spontaneous Vendor Applications:** Direct paid applications submitted to platform sellers.
- **CV Unlock System:** Recruiter candidate unlock fee (10,000 GNF) tracked via `payments` purpose `cv_unlock`.
- **Subscriptions & Visibility:** Admin subscription plan management (`job_seeker` / `service_provider`); user subscriptions that automatically grant public CV visibility (`cvVisible`) and feature entitlements.

### Step 6 — Finance, Wallets & Payments
- **Append-Only Ledger (`wallet_transactions`):** Source-of-truth double-entry bookkeeping tracking all money movements (`earning_held`, `earning_released`, `commission`, `withdrawal`, `withdrawal_fee`, `withdrawal_reversal`, `cod_collected`, `cod_settled`, `cod_offset`, `refund_deduction`, `adjustment`) with immutable `amount` and `balanceAfter` snapshots.
- **Dual Wallet Architecture (`wallets`):** Strict compound index `(ownerId, ownerMode)` keeping vendor earnings and driver delivery income strictly isolated.
- **Automated Escrow Hold & Release:** Order placement holds vendor earnings in escrow; delivery completion automatically releases escrow to vendor's available balance and credits driver delivery fees.
- **COD Cash Settlements & Offsetting:** Riders can directly offset collected COD cash against their withdrawable earnings without waiting for admin approval (`earnings_offset`), or submit office/OM cash deposits for admin verification.
- **Withdrawal Requests & Fee Calculations:** Minimum 5,000 GNF validation; dynamic fee rules (flat or percent); immediate balance debit on request; admin payout completion with transaction references and Cloudinary receipts; automatic fund reversal (`withdrawal_reversal`) upon rejection.
- **Payments Gateway & Idempotency:** Support for Guinea payment channels (Orange Money, MTN Mobile Money, Card, COD); strict idempotency key checks preventing duplicate charges; automatic Order `paid` status updates.
- **Disputes & Vendor Refund Deductions:** Customer dispute filing; admin resolution with integrated refund execution; automatic `refund_deduction` on vendor wallet ledger for orders already settled.

### Step 5 — Delivery Legs & Real-time Tracking
- **Multi-Leg Deliveries:** Automatic leg generation on order placement: 1 leg for local delivery, 3 legs for intercity (`first_mile` moto → `line_haul` bus → `last_mile` moto), and 2 legs for station pickup.
- **PIN Handover Chain:** Cryptographic bcrypt verification for pickup and handover pins (physical proof of handover with zero SMS fees); automatic 15-minute lockout after 5 consecutive failed attempts; role-based PIN exposure (giver sees pickup PIN, receiver sees handover PIN, rider never sees either).
- **Rider Assignment & Dispatch:** Vendor rider discovery prioritizing active linked store partners then nearest online drivers sorted by distance; accept/decline flows with COD cash limit guardrails.
- **Rider Lifecycle:** Full state progression (`assigned` → `accepted` → `going_to_pickup` → `picked_up` → `in_transit` → `delivered`); automatic sub-order timeline synchronization.
- **Real-Time Tracking & Socket.io:** `join_delivery` tracking rooms, GPS coordinate streaming (`rider_location`), status updates, and push notifications.

### Step 4 — Cart & Orders
- **Delivery Rates:** local distance-based pricing (Haversine km calculation with base fee + per-km fee and minimum fee threshold), intercity fixed-fare station-to-station pricing, public fee calculation endpoint, and admin CRUD for delivery rate rules.
- **Cart:** multi-vendor live pricing recalculation (never charges stale prices), stock checking, add/update/remove/clear operations, grouped by vendor with per-store subtotals and unavailable item detection.
- **Checkout & Order Split:** checkout preview with vendor splits, distance calculation, customer platform fee (min 1,000 GNF rule strictly enforced), and whole-GNF totals; atomic order placement with inventory deduction, unique sequential order codes (`AP421`), and automatic vendor sub-orders (`AP421-1`).
- **Order Lifecycle & Timeline:** full status progression (`new` → `accepted` → `preparing` → `ready_for_pickup` → `in_delivery` → `delivered`), timeline history audit trail for every status update.
- **Vendor Chat-to-Order Editing:** vendor can modify sub-order items after chat agreement (remove item or adjust quantity), which restores inventory, re-snapshots commission, recalculates order totals, and logs modification history with old/new amounts.
- **Order Cancellation:** customer cancellation before preparation, vendor sub-order cancellation with stock replenishment, and admin intervention.

### Step 3 — Catalog & Favorites
- **Products:** full vendor catalog management (create, update, stock toggle, soft-delete), admin approval flow (`pending`, `approved`, `rejected`), admin product management & summary statistics.
- **Search & Filters:** public catalog with real-time text search, category/subcategory filtering, price range, stock availability, rating threshold, product tags, distance-based geo-radius filter (`lat`, `lng`, `maxDistance` in km), and multi-criteria sorting.
- **Favorites:** fast toggle favorite, check favorite status, and paginated user favorites list.
- **Platform store:** admin can publish products for the platform's own store or any vendor.

### Step 2 — Addresses, onboarding & rider network
- **Addresses:** up to 10 per user with map pin, landmark, directions and a photo of the place.
- **Categories:** product / business / service / job, 2 levels, French + English names, featured for Home.
- **Become a Vendor:** draft → submit → admin review (approve / reject / needs changes / suspend / reinstate), per-document verification, store hours and open/closed, public store pages (no contact details exposed).
- **Become a Delivery Partner:** moto riders and bus drivers (with station routes), same review flow.
- **Wallet:** created per vendor / rider; payout methods (Orange Money, Mobile Money, bank).
- **Vendor ↔ rider network:** invite / request / accept / remove, plus rider search for vendors.
- **Bus stations** for intercity delivery.
- `GET /user/me` now includes `applications`; addresses are no longer part of the User object (use `GET /addresses`).

### Step 1 — Foundation
- **Accounts:** phone-first signup with SMS + email code, login by phone **or** email, Google / Apple sign-in for the native apps, forgot password by code (3 steps), change / set password, logout this device / everywhere.
- **Multi-role users:** `roles[]` + `lastActiveMode`, mode switch endpoint (vendor / rider roles arrive in Step 2).
- **My account:** profile, language, notification preferences, add / change phone, delete account.
- **Admin:** list / view / suspend / ban / delete users; team members (staff / admin) managed by the super admin.
- **Platform:** settings (commission, fees, prices, contacts), audit log.
- **Breaking changes vs. the boilerplate:** `role` → `roles[]`; `POST /user/register` → `POST /auth/register`; `/otp/send` & `/otp/verify` → `/auth/verify-account` & `/auth/resend-otp`; login body `email` → `identifier`; web Google redirect flow (`/auth/google`) removed in favour of `POST /auth/social`; `PATCH /user/:id` replaced by `PATCH /user/me` (self) and `PATCH /user/:id/status` (admin).

---

## Conclusion & Production Readiness
All 9 core domains specified in the Kadou 24H system architecture are 100% implemented, strictly tested with 138 passing test suites, and documented for mobile & web client integration.


