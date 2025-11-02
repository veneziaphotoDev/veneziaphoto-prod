# 🎟️ Venezia Referral App

A **Remix-based Shopify app** built for **Venezia Photo**, designed to automate and manage a complete referral system for workshop purchases.  
It connects directly to the **Venezia Photo Shopify store**, providing the team with a dashboard, reward logic, analytics, and referral tracking.

---

## 🧭 Core Concept

The Venezia Referral App introduces a structured referral flow inside the Venezia Photo e-commerce ecosystem:

1. **Referral creation** → After a purchase, a customer automatically receives a **unique referral code**.  
2. **Referral usage** → A new customer can use this code to receive a **discount** (e.g. 10 % off).  
3. **Reward system** → The referrer earns a **cashback (e.g. €20)** for every new referred purchase.  
4. **Dashboard** → Venezia admins can view referrers, referrals, and transactions in real time.  
5. **Legacy customers** → Admins can manually create one-time promo codes.  
6. **Analytics** → The system tracks usage, ROI, and detects potential abuse.

---

## 🧩 Functional Flow

### 1️⃣ Purchase Event
- Customer buys a workshop on Shopify.  
- The Shopify webhook `ORDER_PAID` triggers the app.  
- Automatically generate a **referral code** for the customer and store it.  
- If the order contains a valid referral code → create a reward for the referrer.

### 2️⃣ Referral Code Usage
- Each referral code can be used **once per new customer**, but **many times in total**.  
- Shopify applies the discount through the app (Admin GraphQL API).

### 3️⃣ Cashback Rewards
- Each valid referral → creates a **Reward record**.  
- Cashback amount is configurable (default : €20).  
- Rewards can be **marked as paid** manually or via automation.

### 4️⃣ Admin Dashboard
Admins can:
- See all referrers and rewards.  
- Generate promo codes for legacy users.  
- Adjust cashback / discount settings.  
- View analytics and mark payouts.

---

## 🧱 System Architecture Overview

```mermaid
graph TD
    A[Shopify_Store_Venezia_Photo] -->|Webhook_ORDER_PAID| B[Venezia_Referral_App_Remix]
    B --> C[Referral_Service]
    B --> D[Reward_Service]
    B --> E[Promo_Code_Service]
    B --> F[Analytics_Engine]
    B --> G[PostgreSQL_Railway]
    B --> H[Shopify_Admin_GraphQL_API]
    C --> G
    D --> G
    E --> H
    F --> G
    F --> I[Dashboard_UI]

```

# 🧠 Venezia Referral App — Technical Reference

---

## 🧠 Data Model (Prisma)

### **Referral**
| Field | Type | Description |
|-------|------|-------------|
| id | String (UUID) | Unique referral ID |
| referrerId | String | Shopify ID of referrer |
| refereeId | String | Shopify ID of referred user |
| code | String | Referral code used |
| rewardId | String (optional) | Link to reward transaction |
| createdAt | DateTime | Creation timestamp |

### **Reward**
| Field | Type | Description |
|-------|------|-------------|
| id | String | Reward transaction ID |
| referrerId | String | Linked customer |
| amount | Float | Cashback amount |
| status | Enum (`pending`, `paid`, `failed`) | Payout status |
| createdAt | DateTime | Creation timestamp |

### **Code**
| Field | Type | Description |
|-------|------|-------------|
| id | String | Internal ID |
| code | String | Referral code |
| shopifyDiscountId | String | Shopify discount ID |
| referrerId | String | Owner of this code |
| usageCount | Int | Times used |
| maxUsage | Int | Max allowed |
| active | Boolean | Active or not |
| createdAt | DateTime | Creation timestamp |

---

## ⚙️ Environment Setup (Railway)

| Variable | Description |
|-----------|-------------|
| `APP_URL` | Public Railway URL of the app |
| `SESSION_SECRET` | Random secret for Remix sessions |
| `SHOPIFY_API_KEY` | From Partner Dashboard |
| `SHOPIFY_API_SECRET` | From Partner Dashboard |
| `SHOPIFY_SCOPES` | Shopify access scopes |
| `SHOPIFY_STORE_DOMAIN` | e.g. venezia-photo.myshopify.com |
| `DATABASE_URL` | PostgreSQL connection string (format: `postgresql://user:password@host:port/database?schema=public`) |

### 📦 Configuration de la Base de Données PostgreSQL

L'application utilise **PostgreSQL** pour la production. 

**Pour le développement local :**
```bash
# Installer PostgreSQL et créer une base de données
createdb venizia_partnership

# Construire l'URL de connexion (remplacez user et password par vos identifiants)
# Format : postgresql://user:password@host:port/database?schema=public
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/venizia_partnership?schema=public"
```

**Trouver votre DATABASE_URL :**

**Railway :**
1. Allez dans votre projet Railway
2. Sélectionnez votre service PostgreSQL
3. Onglet "Variables" → `DATABASE_URL` est déjà définie
4. Cliquez sur "Reveal" pour voir la valeur complète
5. Ou via CLI : `railway variables`

**Heroku :**
1. Dashboard Heroku → Votre app → Settings
2. Section "Config Vars" → `DATABASE_URL`
3. Ou via CLI : `heroku config:get DATABASE_URL -a votre-app`

**Autre plateforme (Supabase, Neon, etc.) :**
- Consultez la section "Connection String" ou "Database URL" dans votre dashboard
- Format général : `postgresql://user:password@host:port/database?schema=public`

**Base de données locale :**
- Si vous avez créé une base avec `createdb venizia_partnership`
- Utilisateur par défaut : `postgres` (ou votre utilisateur PostgreSQL)
- Mot de passe : celui défini lors de l'installation
- Format : `postgresql://postgres:password@localhost:5432/venizia_partnership?schema=public`

**Pour la production :**
- `DATABASE_URL` est généralement fournie automatiquement par la plateforme
- Les migrations sont appliquées automatiquement lors du déploiement via `npm run setup`

**Appliquer les migrations :**
```bash
# Générer le client Prisma
npx prisma generate

# Appliquer les migrations
npx prisma migrate deploy
```

**Note :** Les migrations SQLite existantes ne sont pas compatibles avec PostgreSQL. 

**Migration depuis SQLite vers PostgreSQL :**

Si vous avez déjà des données en SQLite à migrer :

1. **Créer la structure PostgreSQL :**
   ```bash
   # Avec DATABASE_URL pointant vers PostgreSQL
   npx prisma migrate dev --name init_postgresql
   ```

2. **Exporter les données SQLite :**
   ```bash
   # Option 1 : Utiliser prisma db pull et adapter
   # Option 2 : Exporter manuellement via SQL
   ```

3. **Importer dans PostgreSQL :**
   - Utiliser un outil d'export/import ou créer un script de migration personnalisé
   - Attention aux différences de types entre SQLite et PostgreSQL

Pour un nouveau déploiement en production, créez simplement une nouvelle base PostgreSQL et appliquez les migrations :
```bash
npx prisma migrate deploy
```

---

## 🔄 Event Flow

| Event | Trigger | Action |
|--------|----------|--------|
| `ORDER_PAID` | Shopify webhook | Creates referral + reward + code generation |
| `REFUNDS/CREATE` | Shopify webhook | Handles refund processing |
| `REWARD_PENDING` | Internal | Awaits payout |
| `REWARD_PAID` | Admin action | Marks payout done |
| `CODE_CREATED` | Post-purchase | Generates new code for referrer |

---

## 🧩 Business Rules

- Referral code usable only by **new customers**.  
- Referrer can earn **unlimited rewards**.  
- Reward and discount values are **configurable**.  
- Cashback requires **admin validation** (manual mark or automation).  
- **Fraud detection** on duplicate emails or IPs.  
- **One referral = one reward transaction.**  
- Rewards stored and exportable for **accounting**.

---

## 🧠 Technical Decisions

| Layer | Choice | Reason |
|-------|--------|--------|
| **Framework** | Remix | Server + client rendering, API routes, SSR |
| **ORM** | Prisma | Strong typing, migrations |
| **Hosting** | Railway | Simplified infra + DB |
| **API** | Shopify Admin GraphQL | Modern, flexible |
| **Auth** | Shopify OAuth | Secure integration |
| **Styling** | Tailwind + Polaris | Consistent with Shopify UI |
| **Charts** | Recharts | Lightweight visualization |
| **Emails** | Resend | Simple transactional setup |
| **Monitoring** | Railway Logs | Built-in monitoring |

---

## 🧰 CI/CD Pipeline

| Branch | Env | Workflow |
|--------|------|-----------|
| `main` | Production | `.github/workflows/deploy-prod.yml` |
| `dev` | Staging | `.github/workflows/deploy-dev.yml` |

### **Déploiement Railway**

1. **Connecter le repository GitHub à Railway**
   - Railway → New Project → Deploy from GitHub repo
   - Sélectionner le repository `venizia-partnership`

2. **Créer un service PostgreSQL**
   - Railway → Add Service → PostgreSQL
   - Railway génère automatiquement `DATABASE_URL`

3. **Configurer les variables d'environnement**
   - Voir `PRODUCTION_CHECKLIST.md` pour la liste complète
   - Variables obligatoires : `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `SESSION_SECRET`, `DATABASE_URL`

4. **Mise à jour des URLs Shopify**
   - Une fois déployé, Railway fournit une URL (ex: `https://venizia-partnership.railway.app`)
   - Mettre à jour `shopify.app.toml` avec cette URL
   - Mettre à jour les redirect URLs dans le Shopify Partner Dashboard

**📋 Pour une checklist complète, voir `PRODUCTION_CHECKLIST.md`**

---

## 🧮 Analytics Dashboard KPIs

| Metric | Description |
|---------|-------------|
| **Total Referrals** | Number of unique referral links used |
| **Conversion Rate** | Referred orders / total codes |
| **Cashback Paid** | Total amount paid to referrers |
| **Average Reward** | Mean cashback per referrer |
| **Active Referrers** | Customers with more than 1 referral |
| **Abuse Flags** | Duplicates or suspicious activity detected |

---

## 🗺️ Roadmap

| Phase | Feature | Description |
|-------|----------|-------------|
| 1️⃣ | MVP | Referral + cashback + dashboard |
| 2️⃣ | Analytics | KPIs and conversion tracking |
| 3️⃣ | Friends of Venezia | Loyalty membership system |
| 4️⃣ | Shopify Connect | Automatic reward payouts |

