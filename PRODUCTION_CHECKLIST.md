# ✅ Checklist de mise en production Railway

## 📋 Prérequis avant le déploiement

### 1. Variables d'environnement requises

#### **Variables Shopify (obligatoires)**
- [ ] `SHOPIFY_API_KEY` - Clé API de votre app Shopify
- [ ] `SHOPIFY_API_SECRET` - Secret API de votre app Shopify  
- [ ] `SHOPIFY_APP_URL` - URL publique de votre app (ex: `https://venizia-partnership.railway.app`)
- [ ] `SCOPES` - Scopes Shopify (ex: `read_customers,read_orders,write_discounts,write_orders`)

#### **Variables Base de données (obligatoires)**
- [ ] `DATABASE_URL` - URL de connexion PostgreSQL (fournie automatiquement par Railway si vous créez un service PostgreSQL)

#### **Variables Session (obligatoires)**
- [ ] `SESSION_SECRET` - Secret pour les sessions (générez une chaîne aléatoire de 32+ caractères)

#### **Variables Shopify Store (optionnelles mais recommandées)**
- [ ] `SHOPIFY_STORE_DOMAIN` - Domaine de votre boutique (ex: `venizia-photo.myshopify.com`)
  - Alternative: `SHOPIFY_STORE_URL` ou `SHOPIFY_SHOP_DOMAIN`

#### **Variables optionnelles**
- [ ] `SHOP_CUSTOM_DOMAIN` - Domaine personnalisé (si applicable)
- [ ] `SHOPIFY_REFUND_GATEWAY` - Gateway de remboursement (défaut: `store-credit`)

### 2. Configuration Railway

#### **Créer un projet Railway**
- [ ] Créer un nouveau projet sur [railway.app](https://railway.app)
- [ ] Créer un service PostgreSQL (Railway générera automatiquement `DATABASE_URL`)
- [ ] Créer un service pour votre application (à partir du repo GitHub ou Dockerfile)

#### **Configurer les variables d'environnement dans Railway**
- [ ] Dans votre service Railway → Variables
- [ ] Ajouter toutes les variables obligatoires listées ci-dessus
- [ ] **Important**: Vérifier que `DATABASE_URL` pointe bien vers votre service PostgreSQL

#### **Webhooks Shopify**
- [ ] Mettre à jour `shopify.app.toml` avec l'URL de production
- [ ] Mettre à jour les URLs de callback dans le dashboard Shopify Partner
- [ ] Vérifier que les webhooks pointent vers: `https://votre-app.railway.app/webhooks/...`

### 3. Base de données

- [ ] La migration PostgreSQL initiale est créée (`prisma/migrations/20251102215836_init_postgresql/`)
- [ ] Le script `setup` dans `package.json` exécute `prisma migrate deploy` (automatique au démarrage)
- [ ] Vérifier que `migration_lock.toml` indique `provider = "postgresql"`

### 4. Scripts et build

- [ ] `npm run build` - Fonctionne correctement
- [ ] `npm run setup` - Exécute `prisma generate && prisma migrate deploy`
- [ ] `npm run start` - Démarre l'application avec `remix-serve`
- [ ] `npm run docker-start` - Exécute setup puis start (utilisé par Railway)

### 5. Configuration Shopify App

- [ ] Dans le Shopify Partner Dashboard:
  - [ ] Mettre à jour l'URL de l'app avec l'URL Railway
  - [ ] Vérifier les redirect URLs incluent votre domaine Railway
  - [ ] Configurer les webhooks:
    - `app/scopes_update` → `https://votre-app.railway.app/webhooks/app/scopes_update`
    - `app/uninstalled` → `https://votre-app.railway.app/webhooks/app/uninstalled`
    - `orders/paid` → `https://votre-app.railway.app/webhooks/orders/paid`

### 6. Tests avant mise en production

#### **Tests locaux avec PostgreSQL**
- [ ] Tester la connexion à la base de données PostgreSQL locale
- [ ] Vérifier que les migrations s'appliquent correctement
- [ ] Tester l'authentification Shopify
- [ ] Tester la création d'un code de parrainage
- [ ] Tester le webhook `orders/paid`

#### **Tests de production (après déploiement)**
- [ ] Vérifier que l'application démarre sans erreur
- [ ] Vérifier que les migrations sont appliquées (logs Railway)
- [ ] Tester l'authentification avec votre boutique Shopify
- [ ] Vérifier que les webhooks fonctionnent (dashboard Shopify → Webhooks → voir les événements)
- [ ] Tester la création d'un code de parrainage
- [ ] Vérifier l'interface admin

### 7. Sécurité

- [ ] Toutes les clés secrètes sont dans les variables d'environnement Railway (pas hardcodées)
- [ ] `SESSION_SECRET` est une chaîne aléatoire sécurisée
- [ ] Le fichier `.env` est dans `.gitignore` (déjà fait)
- [ ] Les credentials de base de données ne sont pas exposés dans les logs

### 8. Monitoring

- [ ] Activer les logs Railway pour surveiller les erreurs
- [ ] Configurer des alertes pour les erreurs critiques (optionnel)
- [ ] Vérifier régulièrement les logs de l'application

## 🚀 Déploiement

1. **Pousser le code sur la branche principale** (si connecté à GitHub)
   ```bash
   git push origin main
   ```

2. **Ou déployer manuellement via Railway CLI:**
   ```bash
   railway up
   ```

3. **Vérifier les logs:**
   - Dans Railway → Service → Logs
   - Chercher des erreurs lors du build
   - Vérifier que `npm run setup` s'exécute correctement
   - Vérifier que l'application démarre

4. **Vérifier la base de données:**
   - Dans Railway → Service PostgreSQL → Data
   - Vérifier que les tables sont créées

## 🔧 Résolution de problèmes

### L'application ne démarre pas
- Vérifier les logs Railway pour les erreurs
- Vérifier que toutes les variables d'environnement sont définies
- Vérifier que `DATABASE_URL` est correcte

### Les migrations échouent
- Vérifier la connexion à PostgreSQL
- Vérifier que `migration_lock.toml` indique `postgresql`
- Essayer de réinitialiser les migrations si nécessaire

### Les webhooks ne fonctionnent pas
- Vérifier les URLs dans le dashboard Shopify
- Vérifier que l'application est accessible publiquement
- Vérifier les logs pour les erreurs de webhook

## 📝 Notes

- Les migrations SQLite existantes sont sauvegardées dans `prisma/migrations_sqlite_backup/`
- La nouvelle migration PostgreSQL est dans `prisma/migrations/20251102215836_init_postgresql/`
- Le Dockerfile utilise `npm run docker-start` qui exécute `npm run setup && npm run start`

