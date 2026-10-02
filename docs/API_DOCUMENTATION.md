# Kadou24h API Documentation

> **Audience:** mobile app (customer / vendor / rider) and admin panel developers.
> **Status:** grows step by step with the backend. See [Changelog](#changelog) for what is available now.
> **Live explorer:** Swagger UI at `GET /api/docs` (non-production only); raw spec at `/api/docs.json`.

---

## Table of contents

1. [Getting started](#1-getting-started)
2. [Authentication & sessions](#2-authentication--sessions)
3. [Request & response format](#3-request--response-format)
4. [Conventions](#4-conventions)
5. [Enums](#5-enums)
6. [Flows (screen by screen)](#6-flows-screen-by-screen)
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
| Local | `http://localhost:5000/api/v1` |
| Production | `https://<your-domain>/api/v1` |

- Every endpoint below is relative to the base URL (e.g. `POST /auth/login` → `POST http://localhost:5000/api/v1/auth/login`).
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

**Validation error (400)** — one entry per invalid field; show `message` under the matching input:

```json
{
  "success": false,
  "message": "Zod Error",
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
| `vehicle` | `{ type?, color?, brand?, plateNumber? }` | type must match the partner type; plate is upper-cased |
| `vestNumber` | string | |
| `cityArea` | string | |
| `nationalIdNumber` | string | never shown to vendors |
| `transitRoutes` | `[{ fromStationId, toStationId }]` | bus drivers; two different stations |
| `documents` | `[{ type: driver_license \| national_id \| vehicle_registration, file }]` | replaces the list |

#### `POST /riders/me/application/submit` — Signed-in
**200** `pending` · **400** missing fields listed.

#### `PATCH /riders/me` — Rider
After approval: `vehicle` (color / brand / plate), `vestNumber`, `cityArea`, `transitRoutes` (bus drivers). Partner type, vehicle type, national id and documents are locked.

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

#### `POST /wallets/me/payout-methods` — Signed-in
`{ mode, type: orange_money | mobile_money | bank, accountName, accountNumber, bankName? (required for bank), isDefault? }`. Max 5; the first one is the default. **201** `data: PayoutMethod[]`.

#### `PATCH /wallets/me/payout-methods/:methodId`
Body must include `mode`. **200** `data: PayoutMethod[]`.

#### `DELETE /wallets/me/payout-methods/:methodId?mode=vendor`
**200** `data: PayoutMethod[]`.

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
| `POST /orders/checkout-summary` | Signed-in | preview calculations without placing order: groups vendor splits, calculates vendor delivery fees via distance/station, platform fee (min 1,000 GNF), tax, commission snapshot, and totals |
| `POST /orders` | Signed-in | place order: atomically deducts stock, creates parent `Order` (e.g. `AP421`), splits into `SubOrder`s per vendor (`AP421-1`), snapshots address, clears cart |
| `GET /orders/my-orders` | Signed-in | customer order history with sub-order summaries, status filters, and pagination |
| `GET /orders/:id` | Customer / Admin | full order details with sub-orders, items, vendor info, and status timeline |
| `POST /orders/:id/cancel` | Customer | cancel order before preparation: `{ reason }`, restores product stock, sets status to `cancelled` |

#### Vendor Sub-Orders
| Endpoint | Who | Notes |
|---|---|---|
| `GET /orders/vendor/sub-orders` | Vendor / Admin | list vendor's sub-orders filtered by status (`new`, `accepted`, `preparing`, `ready_for_pickup`, `in_delivery`, `delivered`, `cancelled`) |
| `GET /orders/vendor/sub-orders/:id` | Vendor / Admin | detailed sub-order view with order address, customer info, items, and timeline |
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
| `GET /deliveries/:id/available-riders` | Vendor / Admin | lists online delivery partners: active linked riders appear first, followed by nearest online riders sorted by distance |
| `POST /deliveries/:id/assign` | Vendor / Admin | assign delivery leg to partner: `{ riderId }`; sends real-time push/socket alert |
| `GET /deliveries/:id/track` | Signed-in | live delivery tracking; **secure PIN visibility**: shows `pickupPin` only to giver (vendor/station), shows `handoverPin` only to receiver (customer/station) |

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
- Chat rooms: emit `join_conversation` / `leave_conversation` with a conversation id; `typing` / `stop_typing` with `{ conversationId }`.
- Delivery tracking rooms: emit `join_delivery` / `leave_delivery` with `{ deliveryId }`.
- Rider location stream: rider emits `rider_location` with `{ deliveryId, lat, lng, heading }`.
- Events available now:

| Event | Payload | When |
|---|---|---|
| `application:reviewed` | `{ kind: "vendor" \| "rider", status, note }` | the admin decided on my application → refresh `GET /user/me` |
| `rider_link:updated` | `{ linkId, status }` | a store / rider invited, accepted, declined or removed me |
| `delivery:assigned` | `{ deliveryId, subOrderId, legType, fee, fromName, toName, collectsCash }` | sent to rider when vendor assigns a delivery leg |
| `delivery:status_changed` | `{ status, riderId?, proofPhoto? }` | emitted to `delivery:<id>` room on every lifecycle change |
| `delivery:declined` | `{ deliveryId, subOrderId, reason }` | sent to vendor when rider declines a job |
| `rider:location_updated` | `{ deliveryId, lat, lng, heading }` | broadcast to tracking room as rider travels |

---

## Changelog

### Step 5 — Delivery Legs & Real-time Tracking (current)
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

### Next
- **Step 6:** Finance & Wallets (escrow release on delivery, COD cash settlements, withdrawal requests & admin payouts, transaction ledger).
