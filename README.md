# Kadou24h Server

A production-ready REST API backend for **Kadou24h** built with **Node.js**, **Express**, **TypeScript**, and **MongoDB**. Features role-based access control (RBAC), Google OAuth, Cloudinary media uploads, Redis caching, OTP-based email verification, and Socket.io real-time communication.

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
| Authentication | JWT (access, refresh & reset tokens), Passport.js (Google OAuth) |
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
    ├── config/                # App config, Redis, Cloudinary, Multer, Passport, Swagger
    │   ├── index.ts
    │   ├── cloudinary.config.ts
    │   ├── multer.config.ts
    │   ├── passport.ts
    │   ├── redis.config.ts
    │   └── swagger.config.ts
    ├── constants.ts
    ├── errorHelpers/          # AppError class
    ├── helpers/               # Error normalizers (Mongoose cast, duplicate, validation, Zod)
    ├── interfaces/            # Type definitions & Express request augmentation
    ├── middlewares/           # checkAuth, validateRequest, rateLimiter, requestId, globalErrorHandler
    ├── routes/                # Route aggregator (/api/v1)
    ├── modules/
    │   ├── auth/              # Login, logout, refresh token, password management, Google OAuth
    │   ├── auth_identity/     # OAuth and credential identity mappings
    │   ├── user/              # User registration, profile management, admin actions
    │   ├── otp/               # OTP generation, Redis caching, and email dispatch
    │   ├── device_token/      # Push notification device tokens
    │   ├── upload/            # Cloudinary single and multiple image uploads
    │   └── health/            # Liveness and readiness health check probes
    └── utils/                 # Email templates, JWT helpers, QueryBuilder, Seeding, Winston logger
```

---

## API Endpoints

All core API endpoints are prefixed with `/api/v1`.

### Health & Documentation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Root server status |
| GET | `/health/live` | Lightweight liveness probe |
| GET | `/health` | Detailed health check (MongoDB & Redis status, memory, uptime) |
| GET | `/api/docs` | Swagger UI documentation (non-production) |
| GET | `/api/docs.json` | OpenAPI JSON specification (non-production) |

### Auth — `/api/v1/auth`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/login` | Public | Log in with email and password |
| POST | `/refresh-token` | Public | Obtain new access token via refresh token |
| POST | `/logout` | Public | Log out and clear cookies |
| POST | `/change-password` | Authenticated | Change current password |
| POST | `/set-password` | Authenticated | Set initial password (for OAuth users) |
| POST | `/forgot-password` | Public | Send password reset link to email |
| POST | `/reset-password` | Reset Token | Reset password using reset token |
| GET | `/google` | Public | Initiate Google OAuth flow |
| GET | `/google/callback` | Public | Google OAuth callback URL |

### User — `/api/v1/user`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/register` | Public | Register a new user |
| GET | `/me` | Authenticated | Retrieve current user's profile |
| PATCH | `/me` | Authenticated | Update current user's profile |
| GET | `/all-users` | Admin, Super Admin | Paginated list of all users |
| GET | `/:id` | Admin, Super Admin | Get single user by ID |
| PATCH | `/:id` | Admin, Super Admin | Update user details or role |
| DELETE | `/:id` | Admin, Super Admin | Soft delete a user |

### OTP — `/api/v1/otp`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/send-otp` | Public | Generate and send 6-digit OTP to email |
| POST | `/verify-otp` | Public | Verify OTP code |

### Device Token — `/api/v1/device-token`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/` | Authenticated | Register/update FCM device token |

### Upload — `/api/v1/upload`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/single` | Authenticated | Upload a single file to Cloudinary |
| POST | `/multiple` | Authenticated | Upload multiple files to Cloudinary |

---

## User Roles

| Role | Access Level |
|------|-------------|
| `super_admin` | Full system access, management of all users and admins |
| `admin` | Administrative dashboard access and user management |
| `user` | Standard customer access |

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

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:7000/api/v1/auth/google/callback

# Session
EXPRESS_SESSION_SECRET=your_express_session_secret

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
