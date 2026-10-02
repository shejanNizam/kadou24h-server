# Kadou24h Server

A production-ready REST API backend for **Kadou24h** built with **Node.js**, **Express**, **TypeScript**, and **MongoDB**. Multi-role accounts (customer / vendor / rider + admin team), phone-first signup with SMS & email OTP, Google / Apple sign-in, Cloudinary uploads, Redis, and Socket.io real-time communication.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v18+) |
| Framework | Express.js v5 |
| Language | TypeScript |
| Database | MongoDB + Mongoose |
| Cache & Real-time Adapter | Redis + `@socket.io/redis-adapter` |
| Real-time Communication | Socket.io |
| Authentication | JWT (access, refresh & reset tokens) with token versioning, Google / Apple ID-token sign-in |
| File Uploads | Multer + Cloudinary |
| Email Service | Nodemailer (SMTP) + EJS templates |
| Validation | Zod |
| API Documentation | Swagger (OpenAPI 3.0) + Swagger UI |
| Logging | Winston + Morgan |
| Security | Helmet, CORS, Express Rate Limit, Mongo Sanitize, XSS Sanitizer, Bcrypt |
| Testing | Jest + Supertest |

---

## Project Structure

```
src/
├── __tests__/                 # Jest tests & test setup
│   ├── app.test.ts
│   └── setup.ts
├── app.ts                     # Express application configuration & middlewares
├── server.ts                  # Server entry point (DB, Redis, Socket.io, admin seeding)
├── socket/                    # Socket.io handlers & Redis horizontal scaling adapter
│   └── socket.ts
└── app/
    ├── config/                # App config, Redis, Cloudinary, Multer, Swagger
    │   ├── index.ts
    │   ├── cloudinary.config.ts
    │   ├── multer.config.ts
    │   ├── redis.config.ts
    │   └── swagger.config.ts
    ├── constants.ts
    ├── errorHelpers/          # AppError class
    ├── helpers/               # Error normalizers (Mongoose cast, duplicate, validation, Zod)
    ├── interfaces/            # Type definitions & Express request augmentation
    ├── middlewares/           # checkAuth, validateRequest, rateLimiter, requestId, globalErrorHandler
    ├── routes/                # Route aggregator (/api/v1)
    ├── modules/
    │   ├── auth/              # Signup, OTP verification, login (phone/email), Google/Apple, passwords
    │   ├── auth_identity/     # OAuth and credential identity mappings
    │   ├── user/              # My profile, mode switch, phone change, admin user & team management
    │   ├── otp/               # OTP engine (Redis): SMS + email delivery, cooldown, attempts
    │   ├── settings/          # Platform settings singleton (commission, fees, prices)
    │   ├── audit_log/         # Admin & money action history
    │   ├── counter/           # Human-readable sequences (AP421, WD-10245)
    │   ├── device_token/      # Push notification device tokens
    │   ├── upload/            # Cloudinary single and multiple image uploads
    │   └── health/            # Liveness and readiness health check probes
    └── utils/                 # Email templates, JWT helpers, QueryBuilder, Seeding, Winston logger
```

---

## API Endpoints

All endpoints are prefixed with `/api/v1`. The full reference — flows, request/response examples, errors and enums — is in **[docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)**. Swagger UI is served at `/api/docs` outside production.

Database design: [docs/kadou24h.dbml](docs/kadou24h.dbml) (schema) and [docs/DB_DESIGN.md](docs/DB_DESIGN.md) (guide).

---

## User Roles

| Role | Access Level |
|------|-------------|
| `customer` | Every app user — shopping, orders, jobs, chat |
| `vendor` | Added after admin approval — store, products, orders, earnings |
| `rider` | Added after admin approval — deliveries, earnings |
| `staff` | Admin panel, read-mostly |
| `admin` | Admin panel — user management, settings |
| `super_admin` | Everything, including admin team members |

A user holds several app roles at once (`roles[]`) and switches between them with `PATCH /user/me/mode`. Admin roles are never mixed with app roles.

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Server
PORT=7000
DATABASE_URL=mongodb://localhost:27017/kadou24h-server
NODE_ENV=development

# JWT Secrets
JWT_ACCESS_SECRET=your_jwt_access_secret_min_8_chars
JWT_ACCESS_EXPIRES=1d
JWT_REFRESH_SECRET=your_jwt_refresh_secret_min_8_chars
JWT_REFRESH_EXPIRES=30d
JWT_RESET_SECRET=your_jwt_reset_secret_min_8_chars

# Password Hashing
BCRYPT_SALT_ROUND=10

# Super Admin & Admin Auto-seed
SUPER_ADMIN_EMAIL=super_admin@example.com
SUPER_ADMIN_PASSWORD=SuperAdminPass123!
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=AdminPass123!

# Google / Apple sign-in (mobile native SDK ID tokens), comma-separated client IDs
GOOGLE_CLIENT_IDS=android_client_id.apps.googleusercontent.com,ios_client_id.apps.googleusercontent.com
APPLE_CLIENT_IDS=com.kadou24h.app

# SMS (OTP). "log" prints codes to the server log — development only
SMS_PROVIDER=log
SMS_SENDER_ID=Kadou24h

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000

# Stripe (Optional)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# SMTP Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=default
REDIS_PASSWORD=
```

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- MongoDB running locally or MongoDB Atlas connection string
- Redis running locally or managed Redis instance

### Installation

```bash
# 1. Navigate to project root
cd kadou24h-server

# 2. Install dependencies
npm install

# 3. Configure environment
# Copy .env.example or create .env with required keys

# 4. Start in development mode
npm run dev

# 5. Build for production
npm run build

# 6. Run production server
npm start
```

### Running with Docker

```bash
docker compose up -d
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run server with tsx hot-reloading |
| `npm run dev:local` | Run server with tsx using `.env` file explicitly |
| `npm run build` | Compile TypeScript and copy email templates to `dist/` |
| `npm start` | Run compiled JavaScript server in production |
| `npm run lint` | Run ESLint checks across `./src` |
| `npm test` | Run Jest test suite |
| `npm run test:watch` | Run Jest in watch mode |
| `npm run test:coverage` | Run Jest with code coverage report |
