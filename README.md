# TimeTutor — Backend

> API REST + WebSocket — Node.js / Express / PostgreSQL / Redis

## Stack technique

- **Node.js 20 + Express** — API REST + WebSocket server
- **PostgreSQL 16** — Base principale (sessions, slots, users, schools)
- **Redis 7** — Verrous optimistes créneaux temps réel
- **Socket.io** — Synchronisation multi-users en temps réel
- **JWT + ULID tokens** — Auth directeur + liens magiques enseignants
- **Resend / Nodemailer** — Emails transactionnels

## Prérequis

- Node.js >= 20
- npm >= 9
- Docker + Docker Compose (pour PostgreSQL et Redis en local)

## Installation

```bash
git clone https://github.com/TON_USERNAME/timetutor-backend.git
cd timetutor-backend
npm install
cp .env.example .env     # puis remplir les variables

# Démarrer PostgreSQL + Redis via Docker
npm run db:up

# Lancer le serveur en mode dev
npm run dev
```

L'API tourne sur `http://localhost:3000`
Health check : `GET http://localhost:3000/health`

## Structure du projet

```
src/
├── config/          # Configuration DB, Redis, env
├── controllers/     # Logique métier des routes
├── middleware/      # Auth, validation, error handler
├── models/          # Modèles de données (requêtes SQL)
├── routes/          # Déclaration des endpoints
├── services/        # Services métier (email, slot-lock, etc.)
├── utils/           # Helpers (ulid, jwt, etc.)
├── types/           # Types TypeScript partagés
├── db/
│   └── migrations/  # Scripts SQL de migration
├── app.ts           # Config Express
└── index.ts         # Entrée + Socket.io
tests/
├── unit/
└── integration/
```

## Endpoints prévus (MVP)

```
POST   /api/auth/login              → Auth directeur (JWT)
POST   /api/auth/register           → Inscription école

GET    /api/sessions                → Liste sessions d'une école
POST   /api/sessions                → Créer une session
GET    /api/sessions/:id            → Détail session
PATCH  /api/sessions/:id            → Modifier session

POST   /api/sessions/:id/slots      → Créer des créneaux
GET    /api/sessions/:id/slots      → Lister créneaux + état
PATCH  /api/slots/:id               → Modifier un créneau
DELETE /api/slots/:id               → Supprimer un créneau

POST   /api/sessions/:id/teachers   → Importer enseignants (CSV / JSON)
POST   /api/teachers/:id/invite     → Envoyer lien magique

GET    /api/t/:token                → Page enseignant (via magic link)
POST   /api/t/:token/select         → Sélectionner un créneau
DELETE /api/t/:token/select/:slotId → Désélectionner

POST   /api/slots/:id/validate      → Valider un créneau (directeur)
GET    /api/sessions/:id/export     → Export PDF/Excel emploi du temps
```

## Workflow Git — Règles fondamentales

### ⚠️ On ne commit JAMAIS directement sur `main`

`main` = branche stable, fonctionnelle, déployable en production.

### Cycle de travail

```bash
# 1. Se mettre à jour
git checkout main
git pull origin main

# 2. Créer sa branche de travail
git checkout -b feature/nom-de-la-feature

# 3. Développer + commits réguliers
git add .
git commit -m "feat: description claire"

# 4. Envoyer sa branche
git push origin feature/nom-de-la-feature

# 5. Ouvrir une Pull Request sur GitHub → vers main
```

### Nommage des branches

| Type | Exemple |
|------|---------|
| Nouvelle fonctionnalité | `feature/auth-jwt` |
| Correction de bug | `fix/slot-lock-redis` |
| Refactoring | `refactor/email-service` |
| Migration DB | `db/add-schools-table` |
| Tests | `test/slot-selection-integration` |

### Convention de commits

```
feat: génération liens magiques ULID avec expiry
fix: correction verrou Redis créneau concurrent
refactor: découpage service email en modules
db: migration ajout table slots
test: tests intégration sélection créneaux
chore: mise à jour dépendances
```

### Mise à jour de sa branche avec main

```bash
git checkout feature/ma-feature
git fetch origin
git rebase origin/main
# Résoudre les conflits si besoin → git add . → git rebase --continue
```

## CI/CD — Pipeline

Le pipeline GitHub Actions (`.github/workflows/ci.yml`) se déclenche à chaque push et PR.

**Ce qu'il vérifie :**
- ✅ Lint TypeScript (`npm run lint`)
- ✅ Build (`npm run build`)
- ✅ Services Docker (PostgreSQL + Redis) disponibles
- 🔜 Tests d'intégration (à activer au fil du développement)
- 🔜 Déploiement automatique sur staging (Railway/Render — S4)

**Règle :** Une PR ne peut être mergée que si le pipeline est ✅ vert.

## Fonctionnalités à développer (branches à créer)

```
feature/auth-directeur-jwt
feature/school-registration
feature/sessions-crud
feature/slots-crud
feature/teacher-import-csv
feature/magic-link-generation
feature/email-invitations
feature/slot-selection-api
feature/redis-slot-lock
feature/websocket-realtime
feature/director-dashboard-api
feature/conflict-engine
feature/validation-api
feature/export-pdf-excel
feature/automated-reminders
feature/super-admin-api
```

## Scripts disponibles

```bash
npm run dev      # Dev local avec hot-reload
npm run build    # Compile TypeScript → dist/
npm start        # Démarrer la version compilée
npm run lint     # ESLint check
npm test         # Tests Jest
npm run db:up    # Démarrer PostgreSQL + Redis (Docker)
npm run db:down  # Arrêter les conteneurs
```
