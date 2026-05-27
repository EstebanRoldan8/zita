# ZITA — WhatsApp + AI Appointment Management SaaS Platform

![Node.js](https://img.shields.io/badge/Node.js-v24.15.0-green?logo=node.js)
![React](https://img.shields.io/badge/React-19-blue?logo=react)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-336791?logo=postgresql)
![AI](https://img.shields.io/badge/AI-LLM%20Powered-FF6B6B)
![WhatsApp](https://img.shields.io/badge/WhatsApp-Cloud%20API-25D366?logo=whatsapp)
![License](https://img.shields.io/badge/License-MIT-green)

---

## What is ZITA? 📱

**ZITA** is a multi-tenant SaaS platform that automates appointment management through WhatsApp using AI. Designed for barbershops, spas, veterinary clinics, dental practices, and any service-based business that relies on appointments.

### Key Value Proposition:
- ✨ **AI-powered WhatsApp chatbot** handles 80% of customer interactions automatically
- 📅 **Zero-click scheduling** — customers book directly via WhatsApp
- 💼 **Complete business dashboard** — manage appointments, staff, finances, and analytics
- 🚀 **Multi-tenant architecture** — support thousands of businesses
- 🔒 **Enterprise-grade security** — RLS, AES-256 encryption, JWT authentication

---

## Live Demo 🌐

| Environment | URL |
|---|---|
| **Frontend** | https://zita-alpha.vercel.app |
| **Backend API** | https://zita-production-1634.up.railway.app |

**Test account** (development):
- Email: `demo@zita.test`
- Password: `Demo@12345`

---

## Core Features ⚡

### 🤖 WhatsApp Chatbot
- LLM-powered conversational assistant
- Natural interaction in Spanish
- Real-time availability checking
- Automatic appointment creation
- Service and product inquiries
- Loyalty program integration

### 📱 Business Dashboard
- **Appointments**: Create, edit, cancel, reschedule
- **Clients**: Customer profiles with WhatsApp history
- **Services**: Pricing, duration, and employee assignment
- **Employees**: Performance metrics and commission tracking
- **Products**: Inventory management with stock control
- **Cash Flow**: Income/expense tracking with PDF & Excel exports
- **Loyalty Program**: Visit-based rewards system

### 📊 Analytics & Insights
- Customer retention heatmaps
- Appointment trends
- Revenue forecasting
- Peak hours analysis
- Staff performance metrics

### 🔔 Notifications
- WhatsApp reminders before appointments
- Real-time alerts for new bookings
- No-show warnings
- Admin notifications

### 🔐 Security & Compliance
- Multi-tenant isolation via RLS (Row Level Security)
- AES-256 token encryption
- JWT-based authentication
- Rate limiting (1000 req/15min per IP)
- CORS protection
- Helmet security headers

---

## Tech Stack 🛠️

| Layer | Technology | Notes |
|---|---|---|
| **Backend** | Node.js v24 + Express 4.21 | RESTful API with middleware auth |
| **Frontend** | React 19 + Vite + TailwindCSS | Server-side rendering ready |
| **Database** | PostgreSQL via Supabase | RLS policies, real-time subscriptions |
| **AI** | LLM (Large Language Model) | Tool-calling for structured operations |
| **Messaging** | WhatsApp Cloud API (Meta) | Webhook-based message receiving |
| **Authentication** | Supabase Auth + JWT | Role-based access control |
| **Deployment** | Railway (backend) + Vercel (frontend) | Auto-deploy on git push |

---

## Architecture 🏗️

```
┌─────────────────────────────────────────────────────────────────┐
│                     CUSTOMER INTERACTIONS                         │
└────────────┬────────────────────────────────────────────────┬────┘
             │                                                 │
          WhatsApp                                        Web Browser
             │                                                 │
             ▼                                                 ▼
    ┌────────────────┐                            ┌──────────────────┐
    │  Meta Cloud    │                            │   Vercel/Vite    │
    │      API       │                            │   React Frontend  │
    └────────┬───────┘                            └────────┬─────────┘
             │                                             │
             │ Webhook                                     │ API Calls
             │ POST /webhook/whatsapp                      │ (HTTPS)
             ▼                                             ▼
    ┌──────────────────────────────────────────────────────────────┐
    │          Railway Backend (Node.js + Express)                  │
    │  ┌──────────────────────────────────────────────────────┐    │
    │  │  Controllers ─→ Services ─→ Business Logic           │    │
    │  │  - webhook.controller.js                              │    │
    │  │  - chatbot.service.js (Claude Tool Calling)           │    │
    │  │  - appointments, clients, services, analytics         │    │
    │  └──────────────────────────────────────────────────────┘    │
    │                           │                                    │
    │  ┌──────────────────────────────────────────────────────┐    │
    │  │  Middleware Layer                                     │    │
    │  │  - JWT Verification  - Business Context              │    │
    │  │  - Input Sanitization - Rate Limiting                │    │
    │  └──────────────────────────────────────────────────────┘    │
    └──────────────┬───────────────────────────────────────────────┘
                   │
                   │ (supabaseAdmin / User JWT)
                   ▼
    ┌──────────────────────────────────────────────────────────────┐
    │              Supabase (PostgreSQL)                            │
    │  ┌──────────────────────────────────────────────────────┐    │
    │  │  RLS Policies                                         │    │
    │  │  - Businesses table (multi-tenant isolation)          │    │
    │  │  - Appointments, Clients, Services, Income, etc       │    │
    │  │  - Service roles (superadmin bypass)                  │    │
    │  └──────────────────────────────────────────────────────┘    │
    └──────────────────────────────────────────────────────────────┘
```

---

## Getting Started 🚀

### Prerequisites
- Node.js v24.15.0+
- npm v11.12.1+
- PostgreSQL 14+ (or Supabase account)
- Anthropic API key (Claude)
- Meta WhatsApp Cloud API credentials (optional for local dev)

### Local Installation

```bash
# Clone repository
git clone https://github.com/EstebanRoldan8/zita.git
cd zita

# Backend setup
cd backend
npm install
cp .env.example .env.local
# Edit .env.local with your credentials
npm run dev

# Frontend setup (in new terminal)
cd frontend
npm install
npm run dev
```

**Backend** runs on: `http://localhost:3000`
**Frontend** runs on: `http://localhost:5173`

---

## Environment Variables 🔐

### Backend (.env)

```bash
# Server
NODE_ENV=development
PORT=3000

# Frontend URL (CORS)
FRONTEND_URL=http://localhost:5173

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=xxxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxxx

# AI
ANTHROPIC_API_KEY=sk-ant-xxxxxx

# WhatsApp (Meta Cloud API)
WHATSAPP_VERIFY_TOKEN=your_secure_token
WHATSAPP_API_VERSION=v20.0
WHATSAPP_PHONE_NUMBER_ID=xxxxxx
WHATSAPP_BUSINESS_ACCOUNT_ID=xxxxxx
WHATSAPP_ACCESS_TOKEN=xxxxxx

# Security
ENCRYPT_SECRET=your_32_char_secret_for_aes256
SUPERADMIN_EMAIL=esteban.zita.ia@gmail.com
```

### Frontend (.env)

```bash
VITE_API_URL=http://localhost:3000
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxxx
```

---

## Security Practices 🔒

- **Row Level Security (RLS)**: Every tenant's data is isolated via PostgreSQL policies
- **Encryption**: Sensitive tokens encrypted with AES-256
- **Authentication**: JWT tokens with 24-hour expiration
- **Rate Limiting**: 1000 requests per 15 minutes per IP
- **Input Validation**: All inputs sanitized before database operations
- **CORS**: Restricted to frontend domain only
- **Helmet.js**: HTTP security headers configured
- **No Logging**: Sensitive data never logged in production

---

## Business Model 💰

ZITA is a freemium SaaS with tiered pricing:

| Plan | Monthly | Features |
|---|---|---|
| **Free** | $0 | Up to 50 appointments/month, basic analytics |
| **Professional** | $29 COP/month | Unlimited appointments, advanced analytics, email support |
| **Enterprise** | Custom | Custom integrations, dedicated support, SLA |

---

## API Endpoints Overview 📡

### Authentication
- `POST /api/auth/register` — Create business account
- `POST /api/auth/login` — Authenticate user
- `POST /api/auth/refresh` — Refresh JWT token
- `POST /api/auth/logout` — Clear session

### Appointments
- `GET /api/appointments` — List business appointments
- `POST /api/appointments` — Create appointment
- `PUT /api/appointments/:id` — Update appointment
- `DELETE /api/appointments/:id` — Cancel appointment
- `GET /api/appointments/availability` — Check available slots

### WhatsApp Webhook
- `POST /api/webhook/whatsapp` — Receive messages from Meta
- `GET /api/webhook/whatsapp` — Verify webhook (Meta handshake)

### Settings
- `GET/PUT /api/settings/hours` — Business hours
- `GET/PUT /api/settings/profile` — Business info
- `PUT /api/settings/whatsapp` — WhatsApp credentials

See full API documentation in `backend/API.md`

---

## Project Structure 📂

```
zita/
├── backend/
│   ├── src/
│   │   ├── config/          # Supabase, Claude, WhatsApp configs
│   │   ├── controllers/     # Request handlers
│   │   ├── services/        # Business logic (chatbot, etc)
│   │   ├── middlewares/     # Auth, rate limiting, sanitization
│   │   ├── routes/          # API endpoint definitions
│   │   └── utils/           # Helpers (encryption, logger, availability)
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/      # React components (UI, appointments, clients)
│   │   ├── pages/           # Full page layouts
│   │   ├── hooks/           # Custom React hooks
│   │   ├── context/         # Global state (Auth)
│   │   ├── lib/             # API client, Supabase client
│   │   └── styles/          # TailwindCSS + custom styles
│   └── package.json
│
├── supabase/
│   └── migrations/          # Database schema & RLS policies
│
└── README.md                # This file
```

---

## Roadmap 🗺️

### Q2 2026
- [x] Core appointment management
- [x] WhatsApp chatbot integration
- [x] Multi-tenant RLS
- [x] Analytics dashboard
- [ ] SMS notifications (Twilio)

### Q3 2026
- [ ] Video consultation booking
- [ ] Staff scheduling optimization (ML-based)
- [ ] Customer feedback system
- [ ] API marketplace for third-party integrations

### Q4 2026
- [ ] Mobile app (React Native)
- [ ] Google Calendar sync
- [ ] Payment gateway integration (Stripe, PayPal)
- [ ] Inventory forecasting

---

## Known Limitations ⚠️

- Mobile responsive design incomplete (login & sidebar only)
- WhatsApp integration requires active Meta Business Account
- Chatbot date extraction can struggle with informal date formats
- Maximum 10 messages stored in conversation history

---

## Contributing 🤝

This is a portfolio project, but contributions are welcome!

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## License 📜

This project is licensed under the MIT License — see `LICENSE` file for details.

---

## Author 👨‍💻

**Esteban Roldán Jiménez**
- 🎓 Systems Engineering Student @ Universidad del Valle, Cali, Colombia
- 💼 Full-stack developer specializing in SaaS & AI integration
- 🔗 [GitHub](https://github.com/EstebanRoldan8)
- 🔗 [LinkedIn](https://linkedin.com/in/esteban-roldan)
- 📧 esteban.zita.ia@gmail.com

---

## Acknowledgments 🙏

- **Supabase** for PostgreSQL & authentication
- **Meta** for WhatsApp Cloud API
- **Vercel** and **Railway** for deployment platforms

---

## Support 💬

For issues, feature requests, or questions:
- Open an [issue](https://github.com/EstebanRoldan8/zita/issues)
- Email: esteban.zita.ia@gmail.com

---

**Made with ❤️ by Esteban Roldán** — *Automating appointments, one WhatsApp message at a time.*
