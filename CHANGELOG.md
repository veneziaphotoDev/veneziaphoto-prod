# @shopify/shopify-app-template-remix

## 2025.11.02

### Added
- Ajout de la notion de workshop (produit) aux systèmes de parrainage
- Ajout des champs `workshopProductId` et `workshopProductTitle` aux modèles Code, Referral et Reward
- Le webhook orders/paid récupère maintenant automatiquement les informations du produit workshop
- Affichage des informations de workshop dans les interfaces utilisateur :
  - Liste des codes de parrainage (avec le workshop associé)
  - Liste des filleuls/referrals (avec le workshop acheté par le filleul)
  - Tableau de bord (dernier workshop acheté par chaque parrain)
  - Liste des parrains (dernier workshop acheté)
- Support des achats multiples : un nouveau code est généré à chaque nouveau workshop acheté par un parrain
- Nouvelle page "Workshops" avec liste groupée des participants par workshop
- Export CSV des participants pour chaque workshop avec BOM UTF-8 pour Excel
- Navigation mise à jour avec l'onglet "Workshops"

### Changed
- Configuration du webhook `orders/paid` déplacée dans `shopify.app.toml` pour une gestion automatique par Shopify CLI
- Suppression de l'enregistrement manuel du webhook dans le loader `app.tsx`
- Suppression du fichier `registerOrdersPaid.ts` devenu inutile

### Fixed
- Élimination de l'erreur "Address for this topic has already been taken" qui apparaissait en boucle au démarrage
- Correction du refund Shopify : récupération automatique du `parent_id` de la transaction pour créer un refund direct sur la commande
  - Fallback sur store-credit si aucune transaction n'est trouvée

## 2025.07.07
- [#1103](https://github.com/Shopify/shopify-app-template-remix/pull/1086) Remove deprecated .npmrc config values

## 2025.06.12
- [#1075](https://github.com/Shopify/shopify-app-template-remix/pull/1075) Add Shopify MCP to [VSCode configs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_enable-mcp-support-in-vs-code)

## 2025.06.12
-[#1082](https://github.com/Shopify/shopify-app-template-remix/pull/1082) Remove local Shopify CLI from the template. Developers should use the Shopify CLI [installed globally](https://shopify.dev/docs/api/shopify-cli#installation).
## 2025.03.18
-[#998](https://github.com/Shopify/shopify-app-template-remix/pull/998) Update to Vite 6

## 2025.03.01
- [#982](https://github.com/Shopify/shopify-app-template-remix/pull/982) Add Shopify Dev Assistant extension to the VSCode extension recommendations

## 2025.01.31
- [#952](https://github.com/Shopify/shopify-app-template-remix/pull/952) Update to Shopify App API v2025-01

## 2025.01.23

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Update `@shopify/shopify-app-session-storage-prisma` to v6.0.0

## 2025.01.8

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Enable GraphQL autocomplete for Javascript

## 2024.12.19

- [#904](https://github.com/Shopify/shopify-app-template-remix/pull/904) bump `@shopify/app-bridge-react` to latest
-
## 2024.12.18

- [875](https://github.com/Shopify/shopify-app-template-remix/pull/875) Add Scopes Update Webhook
## 2024.12.05

- [#910](https://github.com/Shopify/shopify-app-template-remix/pull/910) Install `openssl` in Docker image to fix Prisma (see [#25817](https://github.com/prisma/prisma/issues/25817#issuecomment-2538544254))
- [#907](https://github.com/Shopify/shopify-app-template-remix/pull/907) Move `@remix-run/fs-routes` to `dependencies` to fix Docker image build
- [#899](https://github.com/Shopify/shopify-app-template-remix/pull/899) Disable v3_singleFetch flag
- [#898](https://github.com/Shopify/shopify-app-template-remix/pull/898) Enable the `removeRest` future flag so new apps aren't tempted to use the REST Admin API.

## 2024.12.04

- [#891](https://github.com/Shopify/shopify-app-template-remix/pull/891) Enable remix future flags.

## 2024.11.26
- [888](https://github.com/Shopify/shopify-app-template-remix/pull/888) Update restResources version to 2024-10

## 2024.11.06

- [881](https://github.com/Shopify/shopify-app-template-remix/pull/881) Update to the productCreate mutation to use the new ProductCreateInput type

## 2024.10.29

- [876](https://github.com/Shopify/shopify-app-template-remix/pull/876) Update shopify-app-remix to v3.4.0 and shopify-app-session-storage-prisma to v5.1.5

## 2024.10.02

- [863](https://github.com/Shopify/shopify-app-template-remix/pull/863) Update to Shopify App API v2024-10 and shopify-app-remix v3.3.2

## 2024.09.18

- [850](https://github.com/Shopify/shopify-app-template-remix/pull/850) Removed "~" import alias

## 2024.09.17

- [842](https://github.com/Shopify/shopify-app-template-remix/pull/842) Move webhook processing to individual routes

## 2024.08.19

Replaced deprecated `productVariantUpdate` with `productVariantsBulkUpdate`

## v2024.08.06

Allow `SHOP_REDACT` webhook to process without admin context

## v2024.07.16

Started tracking changes and releases using calver
