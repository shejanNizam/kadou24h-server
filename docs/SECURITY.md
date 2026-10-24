# Security — what is in place and what to set in production

Review done on 2026-10-24 (launch hardening 2.2). Each item points to where it lives.

## Requests and accounts
- **Rate limits** (`middlewares/rateLimiter.ts`). Guinean carriers put many phones behind one IP (CGNAT), so:
  - Signed-in requests are counted per account: 900 / 15 min.
  - Anonymous requests per IP: 1500 / 15 min.
  - Login, code checks, refresh and passwords: 10 / 15 min per IP + phone/email, and 300 / 15 min per IP.
  - Code sending (SMS/email): 8 / h per IP + phone/email, and 120 / h per IP.
  - Uploads: 60 / 15 min per account.
- **Account lock** (`auth.service.ts` login). 10 wrong passwords in 15 min, from any IPs, lock the account for 15 min.
  - A password reset ends the lock.
  - Sessions already open keep working.
- **Codes (OTP)** (`otp.service.ts`).
  - 6 digits, valid for 5 min, stored as a keyed hash (HMAC).
  - 5 tries per code. A 60 s resend cooldown, which is atomic so two requests at once can't both pass.
  - 10 codes a day per number, or 3 for a number outside Guinea (+224).
  - **SMS budget** per day: `OTP_SMS_DAILY_CAP` (3000), and `OTP_SMS_DAILY_CAP_ABROAD` (100) for foreign numbers. Once it is spent, codes go by email only, or the request gets a 503, and the server logs an error. This stops "SMS pumping" bills.
- **Sessions.** Every request re-reads the user, so suspensions, role changes and "log out everywhere" (`tokenVersion`) apply at once. Sockets check the same at connect.

## Data access
- **Every route was listed and checked.** The scratch script walked the Express router.
  - The 32 public routes are the intended ones: sign-in, catalog, public profiles, webhooks, ad counters.
  - Each `:id` route owned by a user filters by owner: address, wallet, orders, deliveries, bookings, rides, chats, payments, jobs.
- **Phones and emails** are never in public answers.
  - Workers: only after the booking is accepted.
  - Applicants: only after the recruiter pays to unlock them.
  - Admin lists show them.
- **Inputs.** Zod validates request bodies and drops unknown fields. Mongo operators and XSS are stripped, and search terms are regex-escaped.
- **List size.** `QueryBuilder` caps lists at 100 per page, and `fields=` accepts only plain field names.
- **Device tokens** need a real token (before this, an empty body could move another phone's token).
- **Reviews** count one report per person.
- **Sockets.** Rooms are joined only by participants. Typing and "read" events are relayed only from a room the socket joined. A rider can broadcast a location only for their own delivery, and the coordinates are checked.

## Files
- **`config/multer.config.ts`** accepts only photos (JPG, PNG, WebP, HEIC, GIF), voice notes and PDF.
  - The declared type and the extension must agree.
  - 10 MB per file and 10 files per request.
  - Cloudinary stores them as image/video, never "raw", so the bucket can't host pages or programs.

## Errors and logs
- **5xx answers** are logged with the request id (`X-Request-Id`). In production, the answer never contains the internal message or stack.
- **Status codes.**
  - Broken JSON: 400.
  - A body or file that is too large: 413.
  - A wrong file type: 415.

## Payments
- **Webhooks.**
  - `POST /payments/webhook` needs the `x-webhook-secret` header (constant-time check).
  - `POST /payments/webhook/:provider` needs the aggregator's signature, checked on the raw body by its gateway.
  - The amount must match the payment.
- **dev-confirm** works only in development or with `PAYMENT_MODE=demo`.

## To set in production (`.env`)
| Variable | Why |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET` | 32+ random characters each, all different (the server warns at start otherwise) |
| `FRONTEND_URL` | The dashboard URL(s), not `*` (the server warns otherwise) |
| `TRUST_PROXY` | Number of proxies in front: nginx = 1, Cloudflare + nginx = 2. Wrong = clients can fake their IP in rate limits |
| `PAYMENT_WEBHOOK_SECRET` | Required in production |
| `JWT_ACCESS_EXPIRES` | Shorter is safer (e.g. `1h`); the app refreshes on 401 (API calls and uploads) |
| `OTP_SMS_DAILY_CAP`, `OTP_SMS_DAILY_CAP_ABROAD` | Daily SMS budget once a real SMS provider is connected |

## Known, accepted
- **Ad counters.** Public impression and click counters can be inflated (only the global limit applies). Fine while ads are not billed per click.
- **Logout.** `/auth/logout` forgets the push token but doesn't revoke the refresh token. "Log out everywhere" does revoke it.
