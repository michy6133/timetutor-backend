# TimeTutor — Backend

> API REST + WebSocket — Node.js 20 / Express 4 / PostgreSQL 16 / Redis 7

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Base de données | PostgreSQL 16 (driver `pg`) |
| Cache / Verrous | Redis 7 |
| Temps réel | Socket.io 4 |
| Auth | JWT (access 7j + refresh 30j rotatif) + Magic Token ULID (72h) |
| Paiements | FedaPay SDK (MTN MoMo, Moov Money, carte) |
| Validation | Zod |
| Email | Nodemailer (SMTP Gmail / Resend) |
| PDF | PDFKit |
| SMS / WhatsApp | Twilio (optionnel) |
| Sécurité | Helmet + express-rate-limit |
| Typage | TypeScript strict |

---

## Prérequis

- Node.js >= 20
- npm >= 9
- Docker + Docker Compose (PostgreSQL + Redis en local)

---

## Installation locale

```bash
cd timetutor-backend

cp .env.example .env
# Éditer .env : DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, SMTP_*, FEDAPAY_*

# Démarrer PostgreSQL + Redis
npm run db:up

npm install

# Appliquer toutes les migrations SQL
npm run migrate

npm run dev
# → http://localhost:3001
```

Health check : `GET http://localhost:3001/api/v1/health`

---

## Variables d'environnement requises

| Variable | Description | Exemple |
|---|---|---|
| `PORT` | Port HTTP | `3001` |
| `DATABASE_URL` | Connexion PostgreSQL | `postgresql://...` |
| `REDIS_URL` | Connexion Redis | `redis://localhost:6379` |
| `JWT_SECRET` | Clé access token (≥ 32 chars) | — |
| `JWT_REFRESH_SECRET` | Clé refresh token (≥ 32 chars) | — |
| `JWT_EXPIRES_IN` | Durée access token | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | Durée refresh token | `30d` |
| `SMTP_HOST` | Serveur SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | Port SMTP | `587` |
| `SMTP_USER` | Email expéditeur | `ton@email.com` |
| `SMTP_PASS` | App Password | — |
| `SMTP_FROM` | Nom + email affiché | `TimeTutor <noreply@...>` |
| `FRONTEND_URL` | URL frontend (CORS + emails) | `http://localhost:4200` |
| `MAGIC_LINK_BASE_URL` | Base des liens magiques | `http://localhost:4200/teacher` |
| `FEDAPAY_SECRET_KEY` | Clé secrète FedaPay | `sk_sandbox_...` |
| `FEDAPAY_PUBLIC_KEY` | Clé publique FedaPay | `pk_sandbox_...` |
| `FEDAPAY_ENV` | Mode FedaPay | `sandbox` / `live` |

Voir `.env.example` pour la liste complète.

---

## Migrations SQL

Les migrations sont dans `migrations/` et appliquées **dans l'ordre** par `npm run migrate` :

| Fichier | Contenu |
|---|---|
| `001_initial.sql` | Tables core : users, schools, sessions, time_slots, teachers, subjects |
| `002_teacher_role.sql` | Rôle enseignant + teacher_subjects |
| `003_auth_subscriptions.sql` | Refresh tokens, school_subscriptions, plan_definitions |
| `004_roster_payments_exchanges.sql` | contact_requests, payment_transactions, teacher_roster |
| `005_school_classes_gdpr.sql` | school_classes, RGPD (data_export_requests) |
| `006_preset_subjects.sql` | Matières prédéfinies (seed) |
| `007_slot_negotiations.sql` | slot_negotiations, slot_negotiation_participants |
| `008_admin_seed_plan_features.sql` | Seed plans (standard/pro/premium) + super admin test |

> `npm run migrate` est idempotent : il n'applique que les migrations pas encore enregistrées dans `schema_migrations`.

---

## Structure du projet

```
src/
├── config/
│   ├── env.ts            # Validation variables d'env (Zod)
│   ├── database.ts       # Pool PostgreSQL
│   ├── redis.ts          # Client Redis
│   └── migrate.ts        # Runner migrations SQL
├── middleware/
│   ├── auth.ts           # authenticateJWT + requireRole + authenticateMagicToken
│   ├── errorHandler.ts
│   └── rateLimiter.ts
├── routes/
│   ├── auth.routes.ts
│   ├── sessions.routes.ts
│   ├── slots.routes.ts
│   ├── teachers.routes.ts
│   └── admin.routes.ts
├── controllers/
│   ├── auth.controller.ts
│   ├── sessions.controller.ts   # Export PDF/JPG
│   ├── slots.controller.ts      # Générateur, duplication, contact, négociations
│   ├── teachers.controller.ts   # Import CSV, invitations, magic tokens
│   └── admin.controller.ts      # Stats, écoles, plans, users
├── services/
│   ├── email.service.ts
│   ├── slotLock.service.ts      # Verrous Redis (30s TTL)
│   ├── subscription.service.ts  # Feature gating (assertFeatureEnabled)
│   ├── token.service.ts         # JWT access + refresh
│   └── notification.service.ts
├── socket/
│   └── handler.ts
├── types/index.ts
├── app.ts                       # Express app
└── index.ts                     # Entrée : HTTP + Socket.io
migrations/
├── 001_initial.sql … 008_admin_seed_plan_features.sql
docker-compose.yml
.env.example
```

---

## Endpoints API (v1)

Base URL : `/api/v1`

### Auth

```
POST  /auth/register              Créer compte directeur + école
POST  /auth/register-teacher      Créer compte enseignant
POST  /auth/login                 Connexion (retourne access + refresh tokens)
POST  /auth/refresh               Rafraîchir access token
POST  /auth/logout                Révoquer refresh token
GET   /auth/me                    Profil connecté
PUT   /auth/me                    Modifier profil
POST  /auth/forgot-password       Demander reset par email
POST  /auth/reset-password        Valider reset
GET   /auth/me/export             Export RGPD (JSON)
```

### Sessions

```
GET    /sessions                  Liste sessions de l'école
POST   /sessions                  Créer une session
GET    /sessions/:id              Détail + stats
PUT    /sessions/:id              Modifier (nom, deadline, classe…)
PUT    /sessions/:id/status       Changer statut (draft/open/closed/published)
DELETE /sessions/:id              Supprimer
GET    /sessions/:id/export/pdf   Export PDF emploi du temps
GET    /sessions/:id/export/jpg   Export JPG (image haute résolution)
```

### Créneaux

```
GET    /sessions/:sid/slots                    Liste créneaux
POST   /sessions/:sid/slots                    Créer créneau
POST   /sessions/:sid/slots/batch              Créer en lot
POST   /sessions/:sid/slots/generate           Générateur automatique (jours/heures/durée/pause)
POST   /sessions/:sid/slots/duplicate-from     Dupliquer depuis une autre session
DELETE /sessions/:sid/slots/:id                Supprimer
POST   /sessions/:sid/slots/:id/validate       Valider (directeur)
POST   /sessions/:sid/slots/:id/unvalidate     Invalider

# Enseignant (magic token)
GET    /teachers/verify/:token
GET    /sessions/:sid/slots/teacher/:token
POST   /sessions/:sid/slots/:id/select/:token
DELETE /sessions/:sid/slots/:id/select/:token
POST   /sessions/:sid/slots/:id/contact/:token          Demande d'échange
GET    /sessions/:sid/slots/contact-requests/:token     Historique demandes
POST   /sessions/:sid/slots/contact-requests/:id/accept/:token
POST   /sessions/:sid/slots/contact-requests/:id/reject/:token

# Négociations (résolution conflits)
GET    /sessions/:sid/slots/negotiations/:token
POST   /sessions/:sid/slots/negotiations/:nid/choose/:token
GET    /sessions/:sid/slots/negotiations               (directeur)
```

### Enseignants

```
GET    /sessions/:sid/teachers              Liste enseignants de la session
POST   /sessions/:sid/teachers              Ajouter un enseignant
POST   /sessions/:sid/teachers/import       Import CSV
DELETE /sessions/:sid/teachers/:id          Supprimer
PUT    /sessions/:sid/teachers/:id          Modifier
POST   /sessions/:sid/teachers/:id/invite   Envoyer lien magique
POST   /sessions/:sid/teachers/:id/remind   Relancer
GET    /teachers/my-sessions                Sessions de l'enseignant connecté
GET    /teachers/my-schedule/:token         Calendrier global multi-écoles
```

### Admin / Abonnement

```
GET   /admin/me/subscription       Abonnement école courante (directeur)
POST  /admin/me/checkout           Initier/confirmer paiement FedaPay
GET   /admin/stats                 Stats globales (super_admin)
GET   /admin/schools               Liste écoles (super_admin)
PUT   /admin/schools/:id/toggle    Activer/désactiver école
PUT   /admin/schools/:id/subscription  Changer plan
GET   /admin/plans                 Liste plans
PUT   /admin/plans/:code           Modifier plan (features, limites)
GET   /admin/users                 Liste utilisateurs (super_admin)
POST  /admin/users                 Créer super_admin
DELETE /admin/users/:id            Supprimer utilisateur
GET   /admin/notifications         Notifications directeur
```

### Autres

```
GET   /school-classes              Liste classes de l'école
POST  /school-classes              Créer classe
PUT   /school-classes/:id          Modifier
DELETE /school-classes/:id         Supprimer
GET   /subjects                    Liste matières
POST  /subjects                    Créer matière
PUT   /subjects/:id                Modifier
DELETE /subjects/:id               Supprimer
```

### WebSocket Events

```
Client → Serveur : join-session { sessionId }

Serveur → Client :
  slot-selected         { slotId, teacherName, status }
  slot-released         { slotId }
  slot-validated        { slotId }
  slot-locked           { slotId }
  contact-request       { slotId, requesterName }
  negotiation-updated   { sessionId, negotiationId }
  contact-requests-changed
```

---

## Logique gestion des conflits de créneaux

### 1. Demandes de contact (échange direct)
Déclencheur : Prof A envoie une demande sur le créneau de Prof B.
- Crée `contact_requests` (status `pending`)
- Envoie un email à B avec le message de A
- B peut **Accepter** (swap atomique : le créneau passe à A, B est libéré) ou **Refuser**

### 2. Négociations (résolution multi-participants)
Créée automatiquement en même temps que la demande de contact.
- Tous les profs en conflit sur ce créneau voient les créneaux libres alternatifs
- Chacun choisit un créneau libre → il quitte le créneau disputé
- Quand tous ont résolu → statut `locked`, créneau disputé verrouillé
- Le **directeur valide** le créneau depuis la grille → statut final `validated`

**Les deux mécanismes sont complémentaires :**
- Accepter la demande = résolution rapide 1-1
- Choisir un créneau libre = résolution algorithmique quand l'acceptation directe n'est pas possible

---

## Feature gating

Chaque fonctionnalité premium est contrôlée par `assertFeatureEnabled(schoolId, featureKey)` avant d'être exécutée. Les features sont stockées en `JSONB` dans `plan_definitions.features_json` :

| Clé | Description | Standard | Pro | Premium |
|-----|-------------|---------|-----|---------|
| `pdfExport` | Export PDF | ✓ | ✓ | ✓ |
| `jpgExport` | Export JPG | ✗ | ✓ | ✓ |
| `csvImport` | Import CSV enseignants | ✓ | ✓ | ✓ |
| `slotGenerator` | Générateur de grille | ✓ | ✓ | ✓ |
| `gridDuplicate` | Duplication de grille | ✓ | ✓ | ✓ |
| `slotNegotiations` | Négociations / échanges | ✗ | ✓ | ✓ |
| `whatsappNotifications` | Partage WhatsApp | ✗ | ✓ | ✓ |

---

## Scripts disponibles

```bash
npm run dev      # Dev local avec hot-reload (ts-node / tsx)
npm run build    # Compile TypeScript → dist/
npm start        # Démarrer la version compilée (dist/index.js)
npm run migrate  # Appliquer les migrations SQL en attente
npm run db:up    # Démarrer PostgreSQL + Redis (Docker)
npm run db:down  # Arrêter les conteneurs
```
