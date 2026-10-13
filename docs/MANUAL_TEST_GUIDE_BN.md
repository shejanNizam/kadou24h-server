# Kadou24h — Manual Testing Guide (A to Z)

- **Admin-এর কাজ** → live **Admin Dashboard**-এ (কোন page, কোন tab, কোন button)
- **App-এর role (Customer / Vendor / Rider / Bus driver)** → **Swagger**-এ

ধাপগুলো ক্রম অনুযায়ী সাজানো। আগের ধাপের ID পরের ধাপে লাগবে, তাই ক্রম ভাঙবেন না।

---

## ০. প্রস্তুতি

### ০.১ Link
| কী | কোথায় |
|---|---|
| Swagger | `https://pagla7000.ilmifygroup.com/api/docs` |
| Swagger-এ server | উপরের **Servers** dropdown থেকে "Current Server" বা "Staging / Live Server" বাছুন |
| Admin Dashboard | আপনার live dashboard URL |

### ০.২ Test account (আগে থেকে ঠিক করে রাখুন)
প্রতিটা account-এর **আলাদা phone আর আলাদা email** লাগবে। Gmail-এর `+` alias ব্যবহার করলে সব OTP একটাই inbox-এ আসবে।

| নাম | Phone | Email | Password |
|---|---|---|---|
| Customer (C) | `+224620000001` | `you+cust@gmail.com` | `kadou2026` |
| Vendor (V) | `+224620000002` | `you+vendor@gmail.com` | `kadou2026` |
| Rider (R) | `+224620000003` | `you+rider@gmail.com` | `kadou2026` |
| Bus driver (B) | `+224620000004` | `you+bus@gmail.com` | `kadou2026` |
| Stranger (X) | `+224620000005` | `you+x@gmail.com` | `kadou2026` |

> **OTP কোথায় পাবেন:** register করার সময় **email অবশ্যই দেবেন**। SMS এখনো আসল provider-এ যুক্ত হয়নি। Production mode-এ SMS কাজ করে না, তখন OTP শুধু email-এ আসে। Dev mode-এ OTP server-এর log-এও print হয় (`[SMS:log] to +224...`)।

### ০.৩ Swagger-এ token বদলানো
1. Login করলে response-এ `data.accessToken` আসে। সেটা copy করুন।
2. উপরে ডানদিকের **Authorize** বাটনে চাপুন, token paste করুন, তারপর **Authorize** চাপুন।
3. অন্য role-এ যেতে হলে **Logout** করে অন্য token দিন।

> **পরামর্শ:** একটা notepad খুলে সব token আর ID লিখে রাখুন: `C_TOKEN`, `V_TOKEN`, `R_TOKEN`, `B_TOKEN`, `X_TOKEN`, `C_USER_ID`, `V_USER_ID`, `vendorId`, `riderId`, `busId`, `productId`, `orderId`, `subOrderId`, `legId`, `addressId`।

### ০.৪ যা Swagger-এ নেই: Payment webhook
Orange Money / Mobile Money / Card-এর আসল gateway এখনো যুক্ত হয়নি, তাই payment `pending` অবস্থায় থাকে। "Payment success" করাতে webhook হাতে call করতে হবে। এটা Swagger-এ নেই, তাই PowerShell থেকে করবেন:

```powershell
curl.exe -X POST "https://pagla7000.ilmifygroup.com/api/v1/payments/webhook" `
  -H "Content-Type: application/json" `
  -H "x-webhook-secret: <SERVER-এর PAYMENT_WEBHOOK_SECRET>" `
  -d '{\"paymentId\":\"<PAYMENT_ID>\",\"status\":\"success\"}'
```
Secret-টা live server-এর `.env` থেকে নেবেন। পরে এই command-কে **"WEBHOOK"** বলবো।

---

## ধাপ ১ — Admin: প্ল্যাটফর্ম setup (Dashboard)

Dashboard-এ super admin দিয়ে login করুন।

| # | Page (sidebar) | কী করবেন | কী দেখবেন |
|---|---|---|---|
| 1.1 | **Settings → Platform** | Platform-এর নাম, support email/phone/WhatsApp দিন, তারপর **Save profile** | সফল হলে message আসবে |
| 1.2 | **Settings → Fees & limits** | Commission 10%, minimum 1000; Platform fee per order 1000; Default cash limit; Withdrawal fees (**Add fee**), তারপর **Save fees** | page reload করলেও মান থেকে যাবে |
| 1.3 | **Settings → Jobs & chat safety** | Publish a job offer, Unlock a candidate (5000), Send a spontaneous application; chat restriction-এর নিয়ম। তারপর **Save** | |
| 1.4 | **Categories → Store types** tab | **New category**: FR "Magasin", EN "Store" | vendor আবেদনে এই category লাগবে |
| 1.5 | **Categories → Products** tab | **New category**: "Épicerie" / "Groceries"। চাইলে "Add subcategory"-ও করুন | |
| 1.6 | **Categories → Job categories** আর **Worker professions** | একটা করে বানান | ধাপ ৯-এ লাগবে |
| 1.7 | **Delivery rates** | **New rate**, ধরন "Local": City "Conakry", Motorbike, Base 4000, Per km 800, Min 6000 | তালিকায় "5 km example" কলামে হিসাব দেখাবে |
| 1.8 | **Transit stations** | **New station** ×2: "Gare Madina" (Conakry, lat 9.515, lng -13.705) আর "Gare Labé" (Labé, lat 11.31, lng -12.28) | |
| 1.9 | **Delivery rates** | **New rate**, ধরন "Intercity (bus)": From Gare Madina → To Gare Labé, Fare 60000, Travel time 12 | |
| 1.10 | **Subscriptions** | **New plan**: "Pro", For job_seeker, Price 50000, 30 days, unlock "cv_visibility" | |
| 1.11 | **Settings → Team** | **Add member**: একজন Staff বানান | পরে সেই staff দিয়ে login করে দেখুন Settings-এ fee বদলানো যায় না |

Swagger থেকে Category ID আর Station ID লাগবে: `GET /categories` আর `GET /transit-stations` (login লাগে না)। `bizCatId`, `prodCatId`, `stationA`, `stationB` লিখে রাখুন।

---

## ধাপ ২ — সবার account তৈরি (Swagger)

প্রতিটা account (C, V, R, B, X)-এর জন্য:

**২.১ `POST /auth/register`**
```json
{ "name": "Customer One", "phone": "+224620000001", "email": "you+cust@gmail.com", "password": "kadou2026" }
```
**২.২ `POST /auth/verify-account`**: email-এ আসা OTP দিয়ে
```json
{ "phone": "+224620000001", "otp": "123456" }
```
✅ Response-এ `accessToken` আর `user._id` আসবে। দুটোই লিখে রাখুন।

**আরও যা test করবেন (যেকোনো একটা account দিয়ে):**
- `POST /auth/login` → `{ "identifier": "+224620000001", "password": "kadou2026" }`। Email দিয়েও login করে দেখুন।
- `POST /auth/resend-otp`: ৬০ সেকেন্ডের আগে আবার পাঠালে আটকানো উচিত।
- Forgot password-এর ৩টা ধাপ: `/auth/forgot-password`, `/auth/verify-reset-otp`, তারপর `/auth/reset-password` (`resetToken` Authorize-এ দিয়ে)।
- ভুল OTP দিলে error আসবে।

🔎 **Dashboard → Users:** নতুন ৫ জন user তালিকায় দেখা যাবে। Admin বা staff এখানে দেখাবে না।

---

## ধাপ ৩ — Vendor হওয়া

**Swagger (V_TOKEN):**

3.1 `PUT /vendors/me/application`
```json
{
  "storeName": "TechHub", "businessCategoryId": "<bizCatId>", "businessPhone": "+224620000111",
  "address": { "text": "Kaloum", "city": "Conakry", "location": { "lat": 9.51, "lng": -13.71 } }
}
```
3.2 `POST /wallets/me/payout-methods`
```json
{ "mode": "vendor", "type": "orange_money", "accountName": "Vendor Store", "accountNumber": "+224620000111" }
```
3.3 `POST /vendors/me/application/submit` → response-এর `_id` হলো **vendorId**।
> Negative test: 3.2 বাদ দিয়ে submit করলে আটকানো উচিত, কারণ কমপক্ষে একটা payout method লাগে।

**Dashboard → Vendors:**

3.4 **Pending** tab-এ "TechHub" দেখা যাবে। সেটা খুলুন।
- **Profile** tab-এ দোকানের তথ্য দেখুন। Documents থাকলে প্রতিটাকে **Verify** করুন।
- একবার **Request changes** দিয়ে দেখুন। Vendor-এর `GET /vendors/me`-তে status বদলাবে আর notification যাবে।
- Vendor আবার submit করবে (3.3), তারপর **Approve**।

**Swagger (V_TOKEN):**

3.5 `PATCH /vendors/me/availability` → `{ "isOpen": true }`
3.6 `GET /notifications?mode=vendor`: একটা `profile_approved` notification থাকবে।

🔎 Dashboard → Vendors → **Approved** tab-এ দোকান দেখাবে, "Open now" চালু থাকবে। Overview-তে vendor সংখ্যা ১ বাড়বে।

---

## ধাপ ৪ — Product

**Swagger (V_TOKEN):** `POST /products`
```json
{ "name": "Rice 25kg", "categoryId": "<prodCatId>", "price": 100000, "stockQty": 50 }
```
→ এটা **productId**। এই অবস্থায় `GET /products` (public)-এ product দেখা **যাবে না**, কারণ এখনো approve হয়নি।

**Dashboard → Products:** "Waiting for approval" অবস্থায় আছে। **Approve** করুন।
- আরেকটা product বানিয়ে সেটাকে **Reject** করুন (কারণ লিখে)।
- **New product** দিয়ে admin নিজে একটা product বানান: Store-এ "TechHub" বা "Kadou platform store" বাছুন, ছবি upload করুন, sale price দিন।

**Swagger:** `GET /products?searchTerm=Rice`-এ এখন product দেখা যাবে।

---

## ধাপ ৫ — Rider (moto) হওয়া

**Swagger (R_TOKEN):**

5.1 `PUT /riders/me/application`
```json
{ "partnerType": "moto", "vehicle": { "type": "motorbike" }, "cityArea": "Kaloum", "nationalIdNumber": "1234-5" }
```
5.2 `POST /riders/me/application/submit` → এটা **riderId**।

**Dashboard → Delivery partners:** **Pending** tab থেকে খুলুন, তারপর **Approve**। "Moto riders" filter দিয়ে খুঁজে দেখুন।

**Swagger (R_TOKEN):**

5.3 `PATCH /deliveries/rider/online-status` → `{ "isOnline": true }`
5.4 `PATCH /deliveries/rider/location` → `{ "lat": 9.512, "lng": -13.712 }`

🔎 Dashboard → Delivery partners-এ "Online now" দেখাবে।

---

## ধাপ ৬ — Customer: Local COD order (পুরো delivery)

**Swagger (C_TOKEN):**

6.1 `POST /addresses`
```json
{ "fullName": "Customer One", "phone": "+224620000001", "city": "Conakry", "location": { "lat": 9.53, "lng": -13.68 } }
```
→ এটা **addressId**।

6.2 Cart: `POST /cart/items` → `{ "productId": "<productId>", "qty": 2 }`, তারপর `GET /cart`
6.3 `POST /orders/checkout-summary` → `{ "addressId": "<addressId>", "deliveryType": "local", "paymentMethod": "cod" }`। Subtotal, delivery fee, platform fee আর total দেখুন। Order এখনো তৈরি হয়নি।
6.4 `POST /orders`
```json
{ "items": [{ "productId": "<productId>", "qty": 2 }], "addressId": "<addressId>", "deliveryType": "local", "paymentMethod": "cod" }
```
✅ Response-এ `order._id` আর `subOrders[0]._id` আছে। এগুলো **orderId** আর **subOrderId**।

**Swagger (V_TOKEN):**

6.5 `GET /wallets/me?mode=vendor` → `heldBalance` = vendorEarning, `availableBalance` = 0 (**escrow held**)
6.6 `PATCH /orders/vendor/sub-orders/<subOrderId>/status` তিনবার, ক্রমানুসারে:
`{ "status": "accepted" }` → `{ "status": "preparing" }` → `{ "status": "ready_for_pickup" }`
> Negative test: এরপর সরাসরি `"delivered"` দিলে আটকানো উচিত।

6.7 `GET /orders/vendor/sub-orders/<subOrderId>` → `subOrder.currentLegId` হলো **legId**
6.8 `GET /deliveries/<legId>/available-riders`: rider-এর নাম আর দূরত্ব দেখাবে, **phone দেখাবে না**।
6.9 `POST /deliveries/<legId>/assign` → `{ "riderId": "<riderId>" }`

**Swagger (R_TOKEN):**

6.10 `GET /deliveries/rider/my-deliveries`-এ delivery-টা দেখা যাবে, সাথে COD amount to collect।
6.11 `POST /deliveries/<legId>/accept`, তারপর `POST /deliveries/<legId>/going-to-pickup`

**Pickup PIN:** V_TOKEN দিয়ে `GET /deliveries/<legId>/track`-এ **pickupPin** পাবেন।
6.12 R_TOKEN দিয়ে `POST /deliveries/<legId>/verify-pickup` → `{ "pin": "<pickupPin>" }`
> Negative test: ভুল PIN দিলে আটকাবে। R_TOKEN দিয়ে track করলে কোনো PIN দেখা **যাবে না**।

**Handover PIN:** C_TOKEN দিয়ে `GET /deliveries/<legId>/track`-এ **handoverPin** পাবেন।
6.13 R_TOKEN দিয়ে `POST /deliveries/<legId>/verify-handover` → `{ "pin": "<handoverPin>" }`। দ্বিতীয়বার চাপলে error আসবে।

**যাচাই করুন:**
- C: `GET /orders/<orderId>` → delivered; `GET /notifications?mode=customer`-এ accepted, ready, rider on the way, delivered, feedback আছে।
- V: `GET /orders/vendor/sub-orders/<subOrderId>` → `settlement: "awaiting_cod"`; wallet-এ **এখনো available 0**, কারণ rider-এর কাছে cash আছে।
- R: `GET /wallets/me?mode=rider` → `cashOwed` = COD amount, `availableBalance` = delivery fee।

🔎 **Dashboard → Orders:** order খুলুন (**View order**)। Items subtotal, Delivery fee, Platform fee, Store earning আর Cash to collect মিলিয়ে দেখুন। Leg-এ rider-এর নাম থাকবে।

---

## ধাপ ৭ — COD cash জমা দেওয়া আর Withdraw

**Swagger (R_TOKEN):** `POST /wallets/me/cod-settlements`
```json
{ "amount": <cashOwed>, "method": "orange_money", "reference": "OM123" }
```
> Negative test: cashOwed-এর চেয়ে ১ বেশি দিলে 400 আসবে। একই cash দুইবার declare করলেও 400 আসবে।

**Dashboard → Payments → "COD cash"** tab: declaration-টা দেখা যাবে, সেটাকে **Confirm** করুন। একটাকে **Reject** করেও দেখতে পারেন।

**যাচাই করুন:**
- V wallet: `availableBalance` = earning, `heldBalance` = 0
- R wallet: `cashOwed` = 0

**Withdraw (V_TOKEN):** আগে `GET /wallets/me?mode=vendor` থেকে `payoutMethods[0]._id` নিন।
`POST /wallets/me/withdrawals`
```json
{ "mode": "vendor", "amount": 10000, "payoutMethodId": "<id>" }
```
**Dashboard → Withdrawals** ("Stores" tab):
- একটা request **Reject withdrawal** করুন (কারণ লিখে)। টাকা vendor-এর wallet-এ একবারই ফেরত আসবে।
- আরেকটা request করুন। এবার **Mark as paid** দিন: Transfer reference আর Receipt image দিয়ে।
- V: `GET /wallets/me/withdrawals`-এ status completed দেখাবে, receipt-ও থাকবে।

Rider-এর জন্যও একই কাজ করুন (`mode: "rider"`)। আগে payout method যোগ করতে হবে। cashOwed > 0 থাকলে withdraw আটকানো উচিত।

---

## ধাপ ৮ — Online payment, Cancel, Refund, Dispute

**৮.১ Orange Money order (C_TOKEN)**
- `POST /orders` (আগের মতোই, শুধু `"paymentMethod": "orange_money"`)
- `POST /payments/initiate` → `{ "purpose": "order", "refId": "<orderId>", "method": "orange_money" }`। Status `pending` থাকবে। response-এর `_id` হলো paymentId।
- **WEBHOOK** চালান। এরপর order `paid` হবে।
  - Negative test: ভুল secret দিলে 401। ভুল `amount` দিলে 400 আসবে।
- ধাপ ৬-এর মতো delivery শেষ করুন। Prepaid order-এ vendor delivery-র সাথে সাথেই টাকা পাবে।

🔎 **Dashboard → Payments → Payments** tab: transaction দেখা যাবে।

**৮.২ Cancel**
- Customer: নতুন order দিন, তারপর `POST /orders/<orderId>/cancel` → `{ "reason": "Changed my mind" }`। Product-এর stock আর vendor-এর held টাকা ফেরত আসবে।
- Vendor: `POST /orders/vendor/sub-orders/<id>/cancel` → `{ "reason": "Out of stock" }`
- Admin: **Dashboard → Orders**-এ order খুলুন, তারপর **Cancel order**। Delivered হয়ে যাওয়া order cancel করা যায় না, তখন refund দিতে হয়।

**৮.৩ Order modify (vendor):** `PATCH /orders/vendor/sub-orders/<id>/modify` দিয়ে একটা item কমান। Total আর escrow কমবে।

**৮.৪ Refund আর Dispute**
- **Dashboard → Payments → Refunds → Issue refund**: paid order-এ partial refund দিন। Unpaid order-এ refund আটকাবে।
- C: `POST /payments/disputes` → `{ "orderId": "<orderId>", "reason": "Item arrived damaged" }`
- **Dashboard → Payments → Disputes**: dispute খুলুন, তারপর Decision বাছুন, কারণ লিখুন, চাইলে refund দিন, তারপর **Save decision**।

---

## ধাপ ৯ — Intercity (৩টা leg)

**Bus driver (B_TOKEN):**
```json
PUT /riders/me/application
{ "partnerType": "transit", "vehicle": { "type": "bus" }, "cityArea": "Conakry", "nationalIdNumber": "9999-1",
  "transitRoutes": [{ "fromStationId": "<stationA>", "toStationId": "<stationB>" }] }
```
তারপর `POST /riders/me/application/submit`। **Dashboard → Delivery partners → "Bus drivers"**-এ গিয়ে **Approve** করুন (Routes দেখা যাবে)। এরপর B online হবে (5.3)। এই ধাপের response থেকে **busId** লিখে রাখুন।

**Order (C_TOKEN):** `POST /orders` → `"deliveryType": "intercity", "destinationStationId": "<stationB>"`

**Vendor:** 6.6-এর মতো ৩টা status দিন। এরপর `GET /orders/vendor/sub-orders/<id>`-এ `deliveries` তালিকায় **৩টা leg** দেখা যাবে (leg1, leg2, leg3)।

| ধাপ | কে | API |
|---|---|---|
| a | V | `POST /deliveries/<leg1>/assign` → `{ "riderId": "<riderId>" }` |
| b | R | `POST /deliveries/<leg1>/accept`, তারপর V-এর track থেকে pickupPin নিয়ে `verify-pickup` |
| c | V | `POST /deliveries/<leg2>/assign` → `{ "riderId": "<busId>" }` |
| d | B | `POST /deliveries/<leg2>/accept`, তারপর `GET /deliveries/<leg2>/track` থেকে **incomingHandoverPin** নিন |
| e | R | `POST /deliveries/<leg1>/verify-handover` → `{ "pin": "<incomingHandoverPin>" }` (station-এ bus driver-কে মাল দেওয়া হলো) |
| f | R | `GET /deliveries/<leg1>/track` থেকে **outgoingPickupPin** নিন |
| g | B | `POST /deliveries/<leg2>/verify-pickup` → `{ "pin": "<outgoingPickupPin>" }` |
| h | — | Leg3-এর জন্য একই প্রক্রিয়া: Labé station থেকে একজন moto rider customer-এর কাছে যাবে, শেষে customer-এর handoverPin |

> Negative test: X_TOKEN দিয়ে leg2 track করলে 403 আসবে।

🔎 Dashboard → Orders-এ order খুললে ৩টা leg আর প্রতিটার partner-এর নাম দেখা যাবে।

---

## ধাপ ১০ — Job, CV, Subscription

**Job seeker (C_TOKEN):**
- `PUT /professional-profiles/me` → `{ "profession": "Cashier", "summary": "...", "city": "Conakry", "skills": ["Excel"] }`
- `PATCH /professional-profiles/me/worker-listing` → `{ "isWorkerListed": true, "hourlyRate": 20000 }`
- `GET /professional-profiles/workers` (public): তালিকায় **phone বা email দেখাবে না**।
- `GET /subscriptions/plans`, তারপর `POST /subscriptions/subscribe` → `{ "planId": "<id>", "paymentMethod": "orange_money" }`, তারপর **WEBHOOK**, তারপর `GET /subscriptions/me` active দেখাবে।

**Recruiter (V_TOKEN বা যেকোনো user):**
- `POST /jobs`
```json
{ "organizationName": "TechHub", "title": "Shop assistant", "jobType": "full_time", "workplace": "on_site",
  "city": "Conakry", "about": "We need a shop assistant for our store." }
```
- `POST /jobs/<jobId>/publish` → `{ "paymentMethod": "orange_money" }`, তারপর **WEBHOOK**। এরপর job live হবে, `GET /jobs`-এ দেখা যাবে।
- C: `POST /jobs/apply` → `{ "jobId": "<jobId>", "coverNote": "Hello" }`
- V: `GET /jobs/<jobId>/applicants`-এ applicant-এর **phone লুকানো** থাকবে। এরপর `POST /jobs/candidates/<C_USER_ID>/unlock-cv` → `{ "paymentMethod": "orange_money" }` (5000), তারপর **WEBHOOK**। এখন phone দেখা যাবে।
- V: `PATCH /jobs/applications/<appId>/status` → `{ "status": "shortlisted" }`, তারপর `POST /jobs/applications/<appId>/interview` → `{ "at": "2026-10-20T10:00:00Z", "location": "Kaloum" }`
- C: `GET /jobs/applications/my`-এ status বদলেছে দেখা যাবে।
- **Spontaneous:** C: `POST /jobs/apply-spontaneous` → `{ "targetVendorId": "<vendorId>", "coverNote": "Hi", "paymentMethod": "orange_money" }`। WEBHOOK চালানোর **আগে** V-এর `GET /jobs/applications/received`-এ কিছু দেখাবে না, **পরে** দেখাবে।

🔎 **Dashboard → Subscriptions:** plan-এ subscriber সংখ্যা দেখা যাবে। **Payments**-এ job, CV আর subscription payment-গুলো থাকবে।

---

## ধাপ ১১ — Chat, Review, Report, Support

**Chat (C_TOKEN):**
- `POST /conversations`
```json
{ "recipientId": "<V_USER_ID>", "recipientMode": "vendor", "myMode": "customer", "type": "order", "orderId": "<orderId>", "subOrderId": "<subOrderId>" }
```
- `POST /conversations/<id>/messages` → `{ "type": "text", "text": "Hello" }` (স্বাভাবিক message)
- **Filter test:** `{ "text": "call me 620 00 00 01" }`, `"my email a@b.com"`, `"wa.me/224..."`। এগুলো **mask বা block** হওয়া উচিত, সাথে warning আসবে। কয়েকবার করলে chat restricted হয়ে যাবে।
- V দিয়ে `GET /conversations` আর `/messages` দেখুন, reply দিন।

🔎 **Dashboard → Moderation:**
- **Chat violations** tab-এ কী ধরা পড়েছে দেখা যাবে।
- **Auto-suspensions** tab থেকে restriction **Lift** করুন।

**Review (C_TOKEN, delivered sub-order-এ):** `POST /reviews` → `{ "subOrderId": "<id>", "rating": 4, "comment": "Good" }`
- V: `POST /reviews/<reviewId>/report`
- **Dashboard → Moderation → Reports**: report দেখুন, তারপর "Hide the review in the app" বা **Dismiss**।

**Report a user (C_TOKEN):** `POST /reports` → `{ "targetType": "user", "targetId": "<R user id>", "reason": "Rude" }`, তারপর Dashboard → Moderation → Reports।

**Support (C_TOKEN):** `POST /support-tickets` → `{ "type": "order_issue", "urgency": "high", "subject": "Late", "description": "My order is late" }`
- **Dashboard → Support**: ticket খুলুন। Assigned to-তে staff বাছুন, Status দিন "Resolved", "Answer to the user" লিখুন।
- C: `GET /support-tickets/me`-এ উত্তর দেখা যাবে।

---

## ধাপ ১২ — Admin: User নিয়ন্ত্রণ আর অন্যান্য page

| Page | Test |
|---|---|
| **Users** | X-কে **Suspend** করুন (কারণ লিখে)। এরপর X-এর token দিয়ে যেকোনো API call করলে আটকাবে। তারপর **Re-activate**। **Ban** আর **Delete account**-ও দেখুন। **View details**-এ X-এর orders দেখা যাবে |
| **Vendors** | Approved store **Suspend** করুন (note ছাড়া আটকাবে)। এরপর V-এর vendor API (যেমন `POST /products`) আটকাবে। তারপর **Reinstate**। **Money** tab-এ wallet দেখুন |
| **Delivery partners** | Suspend আর Reinstate। Rider-এর Cash limit বদলান |
| **Categories** | যে category-তে product আছে সেটা delete করলে আটকাবে (409)। Active বন্ধ করে দেখুন |
| **Advertisements** | **Create Advertisement** (Home Feed Banner, তারিখ দিয়ে)। তারপর `GET /advertisements` (app side)-এ সেটা আসছে কিনা দেখুন |
| **Audit logs** | উপরের সব admin কাজ এখানে log হয়েছে কিনা দেখুন (View) |
| **Reports** | **Generate report**, তারপর **Download** |
| **Settings → My account** | নাম আর password বদলান |
| **Overview** | KPI (users, vendors, riders, orders, revenue) আপনার করা test-এর সাথে মিলছে কিনা দেখুন। Revenue = platform fees + commission। **Pending actions** থেকে প্রতিটা link ঠিক page-এ যায় কিনা দেখুন |

---

## ধাপ ১৩ — Security / Negative checklist

- [ ] Token ছাড়া private API call করলে 401
- [ ] Customer token দিয়ে vendor API (`/orders/vendor/...`) call করলে 403
- [ ] X দিয়ে অন্যের order, delivery track বা application বদলানোর চেষ্টা করলে 403
- [ ] Vendor নিজের দোকান থেকে নিজে order দিলে আটকাবে
- [ ] দোকান বন্ধ (`isOpen:false`) থাকলে order আটকাবে
- [ ] Stock-এর বেশি qty দিলে আটকাবে
- [ ] Rider-এর track response-এ কখনো PIN থাকবে না
- [ ] Public vendor/rider/worker API-তে phone, email বা national ID থাকবে না
- [ ] `POST /auth/logout-all`-এর পর পুরনো token দিয়ে call করলে 401
- [ ] Staff দিয়ে Settings-এ fee বদলানো যায় না

---

## যা চোখে পড়লে লিখে রাখবেন

প্রতিটা bug-এর জন্য এভাবে লিখুন: **ধাপ নম্বর, API বা page, কী পাঠালেন, কী আশা করেছিলেন, কী পেলেন** (response JSON-এর screenshot সহ)।
