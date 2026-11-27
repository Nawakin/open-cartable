# Activer le push dans l’application parent

Le serveur d’Open Cartable envoie les alertes Android à Firebase Cloud Messaging (FCM) et les alertes iOS à Apple Push Notification service (APNs). Dans l’espace parent, ouvrez « Compte → Paramètres de notification » pour régler les alertes de chaque appareil. Vous pouvez choisir les messages, les notes du cahier de texte, les devoirs, les livrets, les événements et rappels d’agenda, les absences, la liaison, le blog et la médiathèque, ainsi que les alertes du week-end. Les alertes contiennent une rubrique et un libellé générique. L’ouverture de la rubrique passe par la session parent.

## Préparer l’application Android

1. Dans Firebase, créez une application Android avec l’identifiant de paquet que vous utiliserez pour signer Open Cartable.
2. Téléchargez le fichier client `google-services.json`. Activez FCM HTTP v1 et préparez un compte de service autorisé à envoyer des messages pour ce projet. Gardez son fichier JSON côté serveur.
3. Pour générer l’application native, renseignez `OPEN_CARTABLE_ANDROID_PACKAGE` et `OPEN_CARTABLE_GOOGLE_SERVICES_FILE` dans l’environnement de compilation. Le fichier client doit correspondre au même paquet et au même projet que le compte de service.

## Préparer l’application iOS

1. Créez l’identifiant de votre application dans Apple Developer et activez la capacité Push Notifications sur son profil de signature.
2. Téléchargez une clé APNs `.p8` et notez son identifiant ainsi que celui de l’équipe Apple. Gardez la clé côté serveur.
3. Renseignez `OPEN_CARTABLE_IOS_BUNDLE_ID` et `OPEN_CARTABLE_APNS_MODE` dans l’environnement de compilation. Utilisez `development` avec un profil de développement et le serveur APNs `sandbox`. Utilisez `production` avec un profil de distribution, y compris TestFlight, et le serveur APNs `production`.

Générez et signez l’application avec la chaîne Expo de votre plateforme. Pour un essai local, lancez `npx expo run:android` ou, sur macOS avec Xcode, `npx expo run:ios` depuis `apps/mobile`. Utilisez une application native compilée avec sa propre configuration Firebase ou Apple. Expo Go permet de tester les écrans parent et la médiathèque.

## Relier le serveur aux deux fournisseurs

Rangez les clés dans un répertoire privé hors du dépôt. Créez un fichier local `compose.override.yaml` à côté de `compose.yaml`. L’exemple configure les deux plateformes. Pour une seule plateforme, gardez ses variables et ses entrées dans les deux sections `secrets`. Les chemins hôtes pointent vers des fichiers lisibles par le conteneur via Compose.

```yaml
services:
  api:
    environment:
      FCM_SERVICE_ACCOUNT_FILE: /run/secrets/fcm_account
      APNS_KEY_FILE: /run/secrets/apns_key
      APNS_TEAM_ID: "${OPEN_CARTABLE_APNS_TEAM_ID}"
      APNS_KEY_ID: "${OPEN_CARTABLE_APNS_KEY_ID}"
      APNS_BUNDLE_ID: "${OPEN_CARTABLE_IOS_BUNDLE_ID}"
      APNS_ENVIRONMENT: "${OPEN_CARTABLE_APNS_ENVIRONMENT:-production}"
    secrets:
      - fcm_account
      - apns_key

secrets:
  fcm_account:
    file: "${OPEN_CARTABLE_FCM_ACCOUNT_PATH}"
  apns_key:
    file: "${OPEN_CARTABLE_APNS_PRIVATE_KEY_PATH}"
```

Définissez les chemins et les identifiants dans votre `.env` local ou dans l’environnement du lanceur. Relancez l’installateur habituel. Le serveur réutilise la clé de chiffrement des abonnements générée par Compose. Si votre serveur filtre le trafic sortant, prévoyez HTTPS vers `oauth2.googleapis.com` et `fcm.googleapis.com` pour Android ainsi que HTTP/2 sur TLS vers `api.push.apple.com` ou `api.sandbox.push.apple.com` pour iOS.

## Vérifier sur un appareil de test

1. Installez le binaire signé et connectez un compte parent fictif à l’adresse HTTPS de l’école.
2. Ouvrez « Compte → Paramètres de notification », activez les alertes et accordez la permission système. Activez la rubrique « Devoirs à rendre » et gardez les alertes du week-end pour un essai effectué ces jours-là.
3. Fermez l’application et publiez un devoir fictif dans la classe de l’enfant en sélectionnant le type « Devoir à rendre ». Ouvrez l’alerte et vérifiez le retour aux devoirs de l’enfant.
4. Désactivez les alertes dans « Compte » ou déconnectez le compte. Publiez un second devoir d’essai et vérifiez le comportement de l’appareil.
