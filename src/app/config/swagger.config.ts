import path from "path";
import swaggerJsdoc from "swagger-jsdoc";
import { configs } from "./index";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Kadou24h Backend API",
      version: "1.0.0",
      description:
        "Kadou24h marketplace, delivery & jobs API. Full guide: docs/API_DOCUMENTATION.md",
    },
    servers: [
      { url: "/api/v1", description: "Current Server (Auto-detect domain & port)" },
      { url: `http://localhost:${configs.port}/api/v1`, description: `Local development (port ${configs.port})` },
      { url: "https://pagla7000.ilmifygroup.com/api/v1", description: "Staging / Live Server" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token from /auth/login, /auth/verify-account or /auth/social",
        },
      },
      parameters: {
        id: { in: "path", name: "id", required: true, schema: { type: "string" }, description: "MongoDB ObjectId" },
        page: { in: "query", name: "page", schema: { type: "integer", default: 1 } },
        limit: { in: "query", name: "limit", schema: { type: "integer", default: 10 } },
        sort: { in: "query", name: "sort", schema: { type: "string", default: "-createdAt" }, description: "Field name, prefix with - for descending" },
        searchTerm: { in: "query", name: "searchTerm", schema: { type: "string" } },
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            statusCode: { type: "integer", example: 200 },
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Operation successful" },
            data: { type: "object" },
            meta: { $ref: "#/components/schemas/PaginationMeta" },
          },
        },
        PaginationMeta: {
          type: "object",
          properties: {
            page: { type: "integer", example: 1 },
            limit: { type: "integer", example: 10 },
            total: { type: "integer", example: 57 },
            totalPage: { type: "integer", example: 6 },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Something went wrong" },
            errorSources: {
              type: "array",
              items: {
                type: "object",
                properties: { path: { type: "string" }, message: { type: "string" } },
              },
            },
          },
        },
        ValidationError: { $ref: "#/components/schemas/ErrorResponse" },
        NotificationPrefs: {
          type: "object",
          properties: {
            orderUpdates: { type: "boolean" },
            messages: { type: "boolean" },
            deliveryUpdates: { type: "boolean" },
            offers: { type: "boolean" },
            jobPosts: { type: "boolean" },
            accountAlerts: { type: "boolean" },
          },
        },
        User: {
          type: "object",
          properties: {
            _id: { type: "string", example: "64a1b2c3d4e5f6a7b8c9d0e1" },
            name: { type: "string", example: "Mamadou Diallo" },
            phone: { type: "string", example: "+224620123456" },
            email: { type: "string", format: "email", example: "diallo@gmail.com" },
            avatar: {
              type: "object",
              properties: { url: { type: "string" }, publicId: { type: "string" } },
            },
            roles: {
              type: "array",
              items: { type: "string", enum: ["customer", "vendor", "rider", "staff", "admin", "super_admin"] },
              example: ["customer"],
            },
            lastActiveMode: { type: "string", enum: ["customer", "vendor", "rider"], example: "customer" },
            isPhoneVerified: { type: "boolean", example: true },
            isEmailVerified: { type: "boolean", example: false },
            language: { type: "string", enum: ["fr", "en"], example: "fr" },
            country: { type: "string", example: "GN" },
            status: { type: "string", enum: ["active", "inactive", "suspended", "banned"], example: "active" },
            statusReason: { type: "string" },
            notificationPrefs: { $ref: "#/components/schemas/NotificationPrefs" },
            referralCode: { type: "string", example: "K7QX2M9P" },
            lastLoginAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        RegisterRequest: {
          type: "object",
          required: ["name", "phone", "password"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 50, example: "Mamadou Diallo" },
            phone: { type: "string", example: "+224620123456", description: "International format" },
            email: { type: "string", format: "email", example: "diallo@gmail.com" },
            password: { type: "string", minLength: 8, example: "kadou2026", description: "Min 8 chars, at least 1 letter and 1 number" },
            language: { type: "string", enum: ["fr", "en"], default: "fr" },
            referralCode: { type: "string", example: "K7QX2M9P" },
          },
        },
        OtpSentResponse: {
          type: "object",
          properties: {
            phone: { type: "string", example: "+224 ••• •• 56" },
            email: { type: "string", example: "di•••@gmail.com" },
            expiresIn: { type: "integer", example: 300, description: "Seconds the code is valid" },
            resendIn: { type: "integer", example: 60, description: "Seconds before /auth/resend-otp is allowed" },
          },
        },
        VerifyAccountRequest: {
          type: "object",
          required: ["phone", "otp"],
          properties: {
            phone: { type: "string", example: "+224620123456" },
            otp: { type: "string", example: "123456" },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["identifier", "password"],
          properties: {
            identifier: { type: "string", example: "+224620123456", description: "Phone or email" },
            password: { type: "string", example: "kadou2026" },
          },
        },
        SocialLoginRequest: {
          type: "object",
          required: ["provider", "idToken"],
          properties: {
            provider: { type: "string", enum: ["google", "apple"] },
            idToken: { type: "string", description: "ID token from the Google / Apple native SDK" },
            name: { type: "string", description: "Apple: pass the name from the first sign-in" },
            language: { type: "string", enum: ["fr", "en"] },
          },
        },
        AuthSessionResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Logged in successfully!" },
            data: {
              type: "object",
              properties: {
                user: { $ref: "#/components/schemas/User" },
                accessToken: { type: "string" },
                refreshToken: { type: "string" },
                requiresPhone: { type: "boolean", description: "Social login only" },
                requiresVerification: { type: "boolean", description: "Login only — no tokens; show the OTP screen" },
              },
            },
          },
        },
        ChangePasswordRequest: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          properties: {
            oldPassword: { type: "string", example: "kadou2026" },
            newPassword: { type: "string", example: "kadou2027" },
          },
        },
        UpdateMeRequest: {
          type: "object",
          properties: {
            name: { type: "string", example: "Mamadou Diallo" },
            avatar: {
              type: "object",
              properties: { url: { type: "string" }, publicId: { type: "string" } },
              description: "Upload with POST /upload first",
            },
            language: { type: "string", enum: ["fr", "en"] },
            country: { type: "string", example: "GN" },
          },
        },
        CreateTeamMemberRequest: {
          type: "object",
          required: ["name", "email", "password", "role"],
          properties: {
            name: { type: "string", example: "Fatoumata Camara" },
            email: { type: "string", format: "email", example: "fatoumata@kadou.com" },
            phone: { type: "string", example: "+224620000001" },
            password: { type: "string", example: "kadouStaff1" },
            role: { type: "string", enum: ["staff", "admin"] },
          },
        },
        UpdateSettingsRequest: {
          type: "object",
          description: "Any subset of fields. Nested objects are merged, not replaced.",
          properties: {
            platformName: { type: "string" },
            supportEmail: { type: "string" },
            contactNumber: { type: "string" },
            whatsappSupportNumber: { type: "string" },
            commission: {
              type: "object",
              properties: { rate: { type: "number", example: 10 }, min: { type: "integer", example: 1000 } },
            },
            platformFee: { type: "integer", example: 1000 },
            taxRate: { type: "number", example: 0 },
            riderCashLimitDefault: { type: "integer", example: 1000000 },
            pricing: {
              type: "object",
              properties: {
                jobPublishFee: { type: "integer", example: 5000 },
                cvUnlockFee: { type: "integer", example: 5000 },
                spontaneousApplicationFee: { type: "integer", example: 5000 },
              },
            },
          },
        },
        LatLng: {
          type: "object",
          required: ["lat", "lng"],
          properties: {
            lat: { type: "number", example: 9.5092 },
            lng: { type: "number", example: -13.7122 },
          },
        },
        FileRef: {
          type: "object",
          properties: { url: { type: "string" }, publicId: { type: "string" } },
          description: "Returned by POST /upload",
        },
        AddressRequest: {
          type: "object",
          required: ["fullName", "phone", "city", "location"],
          properties: {
            label: { type: "string", enum: ["home", "office", "other"] },
            customLabel: { type: "string", example: "Mum's house" },
            fullName: { type: "string", example: "Maher Kashan" },
            phone: { type: "string", example: "+224623457821" },
            region: { type: "string", example: "Conakry" },
            city: { type: "string", example: "Kaloum" },
            commune: { type: "string", example: "Kaloum" },
            neighborhood: { type: "string", example: "Almamya" },
            landmark: { type: "string", example: "Next to BICIGUI Bank, 3rd floor office" },
            directions: { type: "string" },
            location: { $ref: "#/components/schemas/LatLng" },
            placePhoto: { $ref: "#/components/schemas/FileRef" },
            isDefault: { type: "boolean" },
          },
        },
        Address: {
          allOf: [
            { $ref: "#/components/schemas/AddressRequest" },
            { type: "object", properties: { _id: { type: "string" }, isDefault: { type: "boolean" } } },
          ],
        },
        CategoryRequest: {
          type: "object",
          required: ["name", "type"],
          properties: {
            name: {
              type: "object",
              properties: { fr: { type: "string", example: "Électronique" }, en: { type: "string", example: "Electronics" } },
            },
            type: { type: "string", enum: ["product", "business", "service", "job"] },
            parentId: { type: "string", nullable: true, description: "Set to create a subcategory (same type)" },
            image: { $ref: "#/components/schemas/FileRef" },
            isFeatured: { type: "boolean" },
            sortOrder: { type: "integer" },
            isActive: { type: "boolean" },
          },
        },
        ApprovalStatus: {
          type: "string",
          enum: ["draft", "pending", "approved", "rejected", "needs_changes", "suspended"],
        },
        VerificationDocument: {
          type: "object",
          properties: {
            _id: { type: "string" },
            type: { type: "string" },
            file: { $ref: "#/components/schemas/FileRef" },
            status: { type: "string", enum: ["pending", "verified", "rejected"] },
            note: { type: "string" },
          },
        },
        VendorApplicationRequest: {
          type: "object",
          description: "Any subset — send what each onboarding screen collects",
          properties: {
            storeName: { type: "string", example: "TechHub Store" },
            businessCategoryId: { type: "string", description: "Category of type business" },
            marketName: { type: "string", example: "Marché Madina" },
            businessPhone: { type: "string", example: "+224620000000" },
            businessEmail: { type: "string" },
            logo: { $ref: "#/components/schemas/FileRef" },
            address: {
              type: "object",
              properties: {
                text: { type: "string", example: "Kaloum Market Street" },
                city: { type: "string", example: "Conakry" },
                country: { type: "string", example: "GN" },
                location: { $ref: "#/components/schemas/LatLng" },
              },
            },
            documents: {
              type: "array",
              description: "Replaces the list. business_license is optional.",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["business_license", "national_id"] },
                  file: { $ref: "#/components/schemas/FileRef" },
                },
              },
            },
          },
        },
        VendorProfile: {
          type: "object",
          properties: {
            _id: { type: "string" },
            userId: { type: "string" },
            storeName: { type: "string" },
            logo: { $ref: "#/components/schemas/FileRef" },
            businessCategoryId: { type: "string" },
            marketName: { type: "string" },
            businessPhone: { type: "string" },
            businessEmail: { type: "string" },
            address: {
              type: "object",
              properties: {
                text: { type: "string" },
                city: { type: "string" },
                country: { type: "string" },
                location: { $ref: "#/components/schemas/LatLng" },
              },
            },
            documents: { type: "array", items: { $ref: "#/components/schemas/VerificationDocument" } },
            approvalStatus: { $ref: "#/components/schemas/ApprovalStatus" },
            reviewNote: { type: "string", description: "Admin message on reject / needs_changes / suspend" },
            isOpen: { type: "boolean" },
            availability: {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                days: { type: "array", items: { type: "string" } },
                openTime: { type: "string", example: "08:00" },
                closeTime: { type: "string", example: "20:00" },
              },
            },
            stats: { type: "object" },
          },
        },
        RiderApplicationRequest: {
          type: "object",
          description: "Any subset — send what each onboarding screen collects",
          properties: {
            partnerType: { type: "string", enum: ["moto", "transit"], description: "transit = bus driver" },
            vehicle: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["motorbike", "bicycle", "car", "bus", "minibus"] },
                color: { type: "string", example: "Red" },
                brand: { type: "string", example: "Yamaha" },
                plateNumber: { type: "string", example: "GN-4587-KD" },
              },
            },
            vestNumber: { type: "string", example: "V-1024" },
            cityArea: { type: "string", example: "Kipé, Conakry" },
            nationalIdNumber: { type: "string", example: "53345-6646547-1" },
            transitRoutes: {
              type: "array",
              description: "Bus drivers only (station ids from GET /transit-stations)",
              items: {
                type: "object",
                properties: { fromStationId: { type: "string" }, toStationId: { type: "string" } },
              },
            },
            documents: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["driver_license", "national_id", "vehicle_registration"] },
                  file: { $ref: "#/components/schemas/FileRef" },
                },
              },
            },
          },
        },
        RiderProfile: {
          allOf: [
            { $ref: "#/components/schemas/RiderApplicationRequest" },
            {
              type: "object",
              properties: {
                _id: { type: "string" },
                userId: { type: "string" },
                approvalStatus: { $ref: "#/components/schemas/ApprovalStatus" },
                reviewNote: { type: "string" },
                isOnline: { type: "boolean" },
                stats: { type: "object" },
              },
            },
          ],
        },
        ReviewApplicationRequest: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["approve", "reject", "needs_changes", "suspend", "reinstate"] },
            note: { type: "string", description: "Required for reject / needs_changes / suspend — shown to the applicant" },
          },
        },
        ReviewDocumentRequest: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["verified", "rejected"] },
            note: { type: "string", description: "Required when rejected" },
          },
        },
        PayoutMethodRequest: {
          type: "object",
          required: ["mode", "type", "accountName", "accountNumber"],
          properties: {
            mode: { type: "string", enum: ["vendor", "rider"] },
            type: { type: "string", enum: ["orange_money", "mobile_money", "bank"] },
            accountName: { type: "string", example: "Anthony Jack" },
            accountNumber: { type: "string", example: "+224623447788", description: "Phone number for mobile money" },
            bankName: { type: "string", description: "Required for bank" },
            isDefault: { type: "boolean" },
          },
        },
        DeviceTokenRequest: {
          type: "object",
          required: ["token", "platform"],
          properties: {
            token: { type: "string", example: "fcm-device-token-here" },
            platform: { type: "string", enum: ["android", "ios", "web"], example: "android" },
          },
        },
        UploadResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "File(s) uploaded successfully" },
            data: {
              oneOf: [
                {
                  type: "object",
                  properties: { url: { type: "string" }, publicId: { type: "string" } },
                },
                {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { url: { type: "string" }, publicId: { type: "string" } },
                  },
                },
              ],
            },
          },
        },
      },
    },
    tags: [
      // ── Persona 0: Authentication & Session ──
      {
        name: "Auth",
        description: "Screens: Sign In, Sign Up, Verify OTP (6 digits), Forgot Password, Reset Password",
      },
      // ── Persona 1: Customer (Buyer) ──
      {
        name: "User",
        description: "[Customer / Common] Screens: My Profile, Edit Profile, Switch Mode (Customer/Vendor/Rider), Phone Change",
      },
      {
        name: "Address",
        description: "[Customer] Screens: Saved Delivery Addresses, Checkout Address Selector",
      },
      {
        name: "Category",
        description: "[Customer & Public] Screens: Home Categories, Browse Products by Category",
      },
      {
        name: "Product",
        description: "[Customer & Vendor] Screens: Home Discovery, Search & Filters, Product Details, Vendor Product CRUD",
      },
      {
        name: "Cart",
        description: "[Customer] Screen: Shopping Cart, Quantity Stepper, Subtotal Calculation",
      },
      {
        name: "Order",
        description: "[Customer & Vendor] Screens: Checkout Summary, Place Order, Customer Order History, Vendor Sub-Orders",
      },
      {
        name: "Delivery",
        description: "[Customer & Rider] Screens: Live Order Tracking Timeline, Rider Duty, Turn-by-Turn Leg Navigation & PIN Verification",
      },
      {
        name: "Favorite",
        description: "[Customer] Screen: Wishlist / Favorited Products",
      },
      {
        name: "Review",
        description: "[Customer] Screens: Product Reviews, Star Ratings & Store Feedback",
      },
      // ── Persona 2: Vendor (Merchant) ──
      {
        name: "Vendor",
        description: "[Vendor] Screens: Become a Vendor Wizard, Store Profile & Hours, Public Store View",
      },
      {
        name: "Vendor–Rider Link",
        description: "[Vendor & Rider] Screen: Store's Rider Network, Search & Invite Local Riders",
      },
      // ── Persona 3: Rider (Delivery Partner) ──
      {
        name: "Rider",
        description: "[Rider] Screens: Become a Delivery Partner Wizard (Moto/Transit), Rider Profile & Vehicle Info",
      },
      {
        name: "Transit Station",
        description: "[Rider & Customer] Screens: Bus Stations for Intercity Transit Delivery",
      },
      // ── Finances & Wallet ──
      {
        name: "Wallet",
        description: "[Vendor & Rider] Screens: Wallet Balance, Payout Methods (Orange Money, Bank), Withdrawal Requests & COD Settlements",
      },
      // ── Communication & Alerts ──
      {
        name: "Chat",
        description: "[Common] Screens: In-App Messaging (Customer ↔ Vendor ↔ Rider)",
      },
      {
        name: "Notification",
        description: "[Common] Screens: Push Notifications & Activity Center",
      },
      // ── Persona 4: Admin Panel ──
      {
        name: "Admin Dashboard",
        description: "[Admin] Screen: Overview Analytics, Revenue Charts, Orders Status Donut, Platform Growth",
      },
      {
        name: "Vendor — Admin",
        description: "[Admin] Screens: Store Applications Review & License Document Verification",
      },
      {
        name: "Rider — Admin",
        description: "[Admin] Screens: Rider Applications Review & Driver License Verification",
      },
      {
        name: "User — Admin",
        description: "[Admin] Screens: All Users Management (Suspend/Ban) & Admin Team Members (Super Admin)",
      },
      {
        name: "Settings",
        description: "[Admin] Screen: Platform Commission %, Delivery Base Fees, Support Contacts",
      },
      {
        name: "Audit Log",
        description: "[Admin] Screen: Security Audit Trail & Financial Logs",
      },
      // ── Utilities & Infrastructure ──
      {
        name: "Upload",
        description: "[Utilities] Screen: File & Image Uploads via Cloudinary",
      },
      {
        name: "Device Token",
        description: "[Utilities] Screen: FCM / APNs Mobile Push Notification Token Registration",
      },
    ],
  },
  // Glob patterns need forward slashes — path.join gives backslashes on Windows
  apis: [path.join(__dirname, "../modules/**/*.route.*").split(path.sep).join("/")],
};

export const swaggerSpec = swaggerJsdoc(options);
