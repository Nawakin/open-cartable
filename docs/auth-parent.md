# Parcours parent en développement

## Démarrage local

Préparer une base PostgreSQL 16 dédiée au développement, accessible depuis la machine où tourne l’API. Renseigner `DATABASE_URL` avec sa chaîne de connexion. Générer séparément `AUTH_SIGNING_KEY` et `AUTH_INVITE_KEY` avec `openssl rand -hex 32`. Conserver ces trois valeurs hors Git, par exemple dans un fichier `.local/auth.env` protégé en mode 0600. Charger le fichier dans chaque terminal nécessaire.

```sh
npm ci

set -a
. .local/auth.env
set +a

npm run auth:admin -- migrate
npm run auth:admin -- seed-demo
```

Sans ces variables, seul le point de contrôle du socle est activé. Le serveur de développement écoute sur l’interface de bouclage en HTTP. Les essais de ce parcours utilisent exclusivement les comptes et élèves fictifs du jeu de démonstration.

Dans un autre terminal avec les variables chargées, générer le code du premier tuteur fictif. Le code est affiché une seule fois. Éviter de le copier dans les journaux, tickets ou captures d’écran.

```sh
npm run --silent auth:admin -- invite ECOLE-DEMO 40000000-0000-4000-8000-000000000001
```

La commande `replace`, avec les mêmes arguments, révoque toutes les sessions actives du tuteur et remplace ses invitations en attente. La commande `invite` remplace les invitations en attente et conserve les sessions actives. En cas d’incident lié à un appareil, utiliser `replace`. Pour retirer les identifiants expirés et les sessions révoquées ainsi que leurs jetons associés, lancer `npm run auth:admin -- purge-expired`.

## Parcours web

Après avoir appliqué les migrations et chargé la configuration d’authentification, générer le site et démarrer l’API avec l’origine exacte du navigateur.

```sh
npm run build:web
WEB_ORIGIN=http://127.0.0.1:3000 npm run dev:api
```

Ouvrir `http://127.0.0.1:3000/`, puis saisir `ECOLE-DEMO` et l’invitation générée. La session du navigateur dure au maximum 30 jours. Le cookie `__Host-open-cartable` est `HttpOnly`, `Secure`, `SameSite=Strict` et limité à l’hôte. Le serveur vérifie l’origine de chaque connexion ou déconnexion web et révoque la session lors de la déconnexion. Le cookie reste `Secure` sur l’origine de test de bouclage, que les navigateurs récents traitent comme un contexte de confiance. Se déconnecter sur un appareil partagé.

Pour un déploiement derrière un proxy TLS, fixer `WEB_ORIGIN` à l’origine HTTPS publique de l’école, sans barre finale. Le proxy sert le site et l’API via la même origine et transmet l’en-tête `Origin`. Utiliser une invitation par appareil ou navigateur à activer. Un code déjà utilisé ne peut pas servir sur un autre appareil.

## Parcours iOS et Android

Démarrer l’API avec `npm run dev:api` si le serveur web ci-dessus est arrêté. Dans un second terminal, lancer Metro avec `npm run dev:mobile` et ouvrir un client Expo compatible avec le SDK du projet et Expo SecureStore. Saisir l’origine HTTPS de l’école, le code école et une invitation. L’app conserve le JWT d’accès en mémoire et le jeton de renouvellement dans Keychain ou Keystore. Pour tester depuis un appareil, le serveur doit être joignable via une origine HTTPS dont le certificat est reconnu par l’appareil. L’adresse de bouclage de la machine qui exécute Fastify est réservée au test web local.

## Contrat HTTP

Préfixe `/api/v1/parent`. Les réponses d’authentification et de consultation portent `Cache-Control: no-store`.

| Méthode et chemin | Entrée | Résultat |
| --- | --- | --- |
| `POST /auth/invitations/redeem` | JSON `schoolCode`, `code` en majuscules, avec les tirets du code | `200` avec `accessToken`, `refreshToken` et `expiresIn` en secondes. L’invitation dure sept jours et est consommée à la première utilisation. |
| `POST /auth/refresh` | JSON `refreshToken` courant | `200` avec la même structure et un nouveau jeton de renouvellement. |
| `GET /children` | En-tête `Authorization: Bearer <accessToken>` ou cookie de session du navigateur | `200` avec `children` contenant `id`, `displayName` et `className`, limités aux liens du tuteur actif. |
| `POST /auth/logout` | En-tête `Authorization: Bearer <accessToken>`, ou JSON `refreshToken` | `204`. La session est révoquée immédiatement. |
| `POST /web/auth/login` | Origine configurée et JSON `schoolCode`, `code` | `204` avec cookie de session. |
| `POST /web/auth/logout` | Origine configurée et cookie éventuel | `204`. Révoque la session et efface le cookie. |

Les codes inconnus, expirés, consommés ou révoqués donnent la même réponse `401`. Ce choix évite d’exposer publiquement l’état des invitations. Un format invalide donne `400`. Les demandes de connexion et de renouvellement sont limitées par IP dans le processus API, respectivement à 10 et 30 par minute, avec réponse `429` et en-tête `Retry-After`.

Le JWT d’accès expire au bout de 15 minutes au plus. Chaque session a une durée totale de 30 jours à partir de sa création. Le jeton de renouvellement est à usage unique. Le client doit sérialiser les renouvellements, remplacer l’ancien jeton à la réception d’un nouveau et revenir à la connexion si le résultat est perdu ou si la session est révoquée. Il doit garder le JWT d’accès en mémoire et utiliser Keychain ou Keystore pour le jeton de renouvellement.

## Vérification et périmètre

```sh
TEST_DATABASE_URL="$DATABASE_URL" npm test
```

Les tests utilisent un schéma temporaire dans la base de test et le suppriment à la fin. Le rôle PostgreSQL doit pouvoir créer un schéma. Sans `TEST_DATABASE_URL`, la suite PostgreSQL est déclarée ignorée.

Les comptes du personnel et l’interface d’administration restent à développer. Avant tout déploiement avec des données réelles, ajouter le journal d’audit, la configuration TLS et des proxies de confiance, le nettoyage planifié des identifiants et les protections réseau détaillées dans [les exigences de sécurité](securite.md). Valider les seuils de blocage en tenant compte des connexions partagées entre familles.
