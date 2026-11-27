# Installer Open Cartable

Ce tutoriel démarre PostgreSQL, l’API et l’application web sur votre ordinateur. L’assistant web crée l’école, sa première classe et son premier accès parent. Pour découvrir le projet, utilisez le bouton « Remplir un exemple fictif ».

## 1. Préparer la machine

| Système | Prérequis |
| --- | --- |
| Windows | [Docker Desktop pour Windows](https://docs.docker.com/desktop/setup/install/windows-install/) démarré en mode conteneurs Linux, avec WSL 2 activé selon sa documentation. |
| macOS | [Docker Desktop pour macOS](https://docs.docker.com/desktop/setup/install/mac-install/) démarré. Choisir la version Apple Silicon ou Intel de la machine. |
| Linux | [Docker Engine et le plugin Compose](https://docs.docker.com/engine/install/) en service, ou Docker Desktop. Le compte doit pouvoir exécuter les commandes Docker. |

Utilisez Docker Compose v2 récent. Vérifiez sa disponibilité avec `docker compose version` et l’accès au moteur avec `docker info`. Le premier démarrage utilise Internet pour récupérer les images et les dépendances verrouillées du projet. L’hôte n’a besoin ni de Node.js ni de PostgreSQL pour installer le serveur.

Téléchargez le dépôt en ZIP, puis extrayez-le dans un dossier local. Vous pouvez aussi utiliser Git.

```sh
git clone https://github.com/Nawakin/open-cartable.git
cd open-cartable
```

## 2. Lancer l’installation

- **Windows** — Double-cliquez sur `Installer-Windows.cmd` depuis l’Explorateur.
- **macOS** — Ouvrez `Installer.command` depuis le Finder. Si le fichier a perdu son droit d’exécution pendant l’extraction, lancez `sh installer.sh` dans le Terminal depuis le dossier du projet.
- **Linux** — Exécutez `./installer.sh` depuis le dossier du projet. Sur les bureaux qui permettent de lancer les scripts exécutables, vous pouvez ouvrir ce fichier depuis le gestionnaire de fichiers. `sh installer.sh` fonctionne aussi après une extraction sans droits d’exécution.

Le lanceur attend le démarrage des services et ouvre le site dans le navigateur. Le premier assemblage peut prendre quelques minutes. PostgreSQL, ses mots de passe et les clés de session sont préparés automatiquement. Le site et l’API sont servis à `http://127.0.0.1:3000` sur l’ordinateur qui héberge Docker.

Sur une machine sans navigateur, le lanceur Unix affiche le lien à ouvrir. Vous pouvez aussi lancer les commandes suivantes depuis le dossier du projet, quel que soit le système.

```sh
docker compose up -d --build --wait --wait-timeout 180
docker compose exec -T api node deploy/installation-link.mjs
```

Si l’école est encore à configurer, le lien contient le code d’installation dans son fragment. Gardez ce lien privé. L’app le retire de la barre d’adresse dès son ouverture.

## 3. Configurer l’école dans le navigateur

1. Sur « Configurer Open Cartable », renseignez le nom et le code de l’école, le nom de la classe et le nom d’affichage du premier élève. Pour un essai, cliquez sur « Remplir un exemple fictif ». Choisissez un mot de passe direction de 15 à 128 caractères et confirmez-le. Gardez-le dans votre gestionnaire de mots de passe.
2. Cliquez sur « Créer l’école ». Conservez le code école et le code d’invitation parent qui s’affichent.
3. Cliquez sur « Aller à la connexion », puis sur « Se connecter ». Le compte affiche l’élève créé. Ouvrez son cahier de texte pour consulter ses publications.

Le code d’invitation est valable sept jours et pour une seule activation. Pour connecter un deuxième appareil, générez une invitation supplémentaire pour le même tuteur. La configuration initiale est enregistrée dans PostgreSQL. Les lancements suivants ouvrent directement l’espace parent.

Si l’assistant vous demande le code d’installation après un rechargement, relancez l’installateur pour ouvrir son lien. Si la création a réussi mais que l’invitation a été perdue, utilisez la procédure de réémission ci-dessous.

## 4. Essayer le cahier de texte et l’accès mobile

### Publier une entrée

1. À la fin de l’installation, choisissez « Ouvrir l’espace direction ». Pour y revenir, ajoutez `/?espace=direction` à l’adresse de la web-app. Saisissez le code école et le mot de passe choisi dans l’assistant.
2. Sélectionnez une classe. Renseignez la date, le titre, le domaine et la description, puis cliquez sur « Publier ».
3. Revenez à « Espace parent » et ouvrez le cahier de texte de l’enfant. Sélectionnez la période de l’entrée. Dans l’espace direction, « Modifier » et « Retirer » permettent de corriger ou supprimer une publication. [Guide du cahier de texte](cahier-texte.md)

### Activer ou réinitialiser le compte direction

Si vous perdez le mot de passe direction, ouvrez un terminal sur l’ordinateur qui héberge Docker et placez-vous dans le dossier Open Cartable. Avec les services démarrés, lancez le menu de maintenance.

```sh
./maintenance.sh
```

Tapez « 1 », choisissez l’école si plusieurs sont configurées, puis saisissez deux fois le nouveau mot de passe de 15 à 128 caractères. Les deux saisies sont masquées. Le menu enregistre le mot de passe et ferme les anciennes sessions direction. Sous Windows, exécutez le script dans un terminal WSL avec accès au même projet Docker Compose.

Si vous perdez aussi l’accès à votre authentificateur, choisissez « 2 » et confirmez l’école. Reconnectez-vous, puis configurez un nouvel authentificateur.

### Configurer la récupération par e-mail

1. Renseignez l’adresse de récupération lors de la création de l’école. Dans une installation existante, ouvrez « École → Sécurité du compte » dans l’espace direction pour l’ajouter ou la modifier.
2. Configurez le relais SMTP de l’école dans un fichier `.env` privé à côté de `compose.yaml`. Renseignez `DIRECTION_SMTP_URL` avec l’adresse du relais et `DIRECTION_SMTP_FROM` avec une adresse d’envoi acceptée par celui-ci. Une URL `smtps://` utilise TLS dès la connexion, généralement sur le port 465. Une URL `smtp://` exige STARTTLS, généralement sur le port 587. Encodez les caractères spéciaux des identifiants dans l’URL.
3. Pour que les liens soient accessibles depuis l’appareil qui lit l’e-mail, utilisez l’origine HTTPS de l’école dans `OPEN_CARTABLE_ORIGIN`. Relancez le lanceur après modification. [Accès depuis un autre appareil](#ouvrir-le-service-depuis-un-autre-appareil)
4. Dans « École → Sécurité du compte », choisissez « Envoyer le lien de vérification ». Ouvrez l’e-mail et confirmez l’adresse. Revenez aux réglages et actualisez leur statut.

Exemple de fichier `.env` à adapter au relais de l’école.

```dotenv
DIRECTION_SMTP_URL=smtps://identifiant:mot-de-passe-encode@relais.example:465
DIRECTION_SMTP_FROM=ent@ecole.example
OPEN_CARTABLE_ORIGIN=https://ent.ecole.example
```

Pour récupérer un mot de passe, choisissez « Mot de passe oublié ? » sur la page de connexion direction et saisissez le code de l’école et l’adresse vérifiée. Le lien reçu est valable 30 minutes. Si la double authentification est activée, la réinitialisation demande aussi le code de l’authentificateur.

### Activer la double authentification

Dans « École → Sécurité du compte », choisissez « Configurer un authentificateur » et saisissez votre mot de passe. Scannez le QR code ou copiez la clé dans une application libre comme Aegis ou FreeOTP, ou dans toute application compatible TOTP. Saisissez les six chiffres de l’application pour activer la protection. Une connexion suivante demande un nouveau code après le mot de passe.

Docker Compose prépare la clé de chiffrement de la double authentification dans le volume `app-secrets`. Conservez ce volume avec vos sauvegardes. Une installation manuelle peut fournir cette clé avec `DIRECTION_TOTP_KEY_FILE` et l’URL SMTP avec `DIRECTION_SMTP_URL_FILE`, à partir de fichiers privés.

### Personnaliser le bandeau de l’école

1. Dans l’espace direction, ouvrez « École », puis « Bandeau d’en-tête ».
2. Saisissez le texte du bandeau et choisissez la couleur du texte et du fond. L’aperçu se met à jour pendant la saisie. L’enregistrement exige un contraste suffisant pour lire le texte.
3. Cliquez sur « Enregistrer le bandeau ». Le bandeau s’affiche dans les espaces connectés de l’école sur le web et sur mobile. Les autres appareils le chargent à l’ouverture ou au retour de l’application au premier plan.
4. Pour revenir à l’apparence d’origine, choisissez « Valeurs par défaut » et enregistrez.

Les écrans de connexion et d’installation affichent le bandeau Open Cartable.

### Créer un accès enseignant

1. Dans « Espace direction », ouvrez « École », puis « Enseignants ». Choisissez un identifiant, affectez une ou plusieurs classes puis cliquez sur « Créer le compte enseignant ».
2. Transmettez en privé le lien vers l’espace enseignant, le code école, l’identifiant et le code d’activation affichés. Le lien se termine par `/?espace=enseignant`. Le code est valable sept jours et s’utilise une seule fois.
3. Dans « Espace enseignant », cliquez sur « Activer mon compte ». Saisissez le code école, l’identifiant et le code d’activation, puis choisissez un mot de passe de 15 à 128 caractères. Après activation, connectez-vous avec le code école, l’identifiant et ce mot de passe.

L’enseignant retrouve le même formulaire de publication que la direction, avec ses seules classes affectées. La direction peut modifier les affectations, réinitialiser l’activation ou retirer le compte. Réinitialiser ou retirer un compte ferme ses sessions. Les publications restent dans le cahier de la classe. [Guide du cahier de texte](cahier-texte.md)

### Utiliser ses comptes parent et enseignant

1. Activez le compte enseignant créé par la direction. Connectez-vous dans un autre onglet de la même web-app avec l’invitation parent remise pour vos propres enfants.
2. Dans l’espace enseignant, ouvrez « Vie de classe → Mes accès ». Vérifiez les prénoms ou noms d’affichage des enfants et saisissez votre mot de passe enseignant pour associer les deux comptes de la même école.
3. Retrouvez « Espace enseignant » dans « Compte » côté parent et « Espace parent » dans « Mes accès » côté enseignant. Si la session de destination a expiré, identifiez-vous à nouveau dans l’espace choisi.

L’association ajoute ces raccourcis. Les enfants suivent leur compte tuteur et les affectations suivent le compte enseignant. Vous pouvez dissocier les comptes depuis l’un ou l’autre espace. Une réinitialisation du compte enseignant dissocie aussi les comptes.

### Publier dans l’agenda

Dans « Agenda », la direction peut publier pour l’école entière ou une classe. Un enseignant peut publier pour ses classes affectées. Dans l’espace parent, ouvrez l’agenda de l’enfant pour consulter les événements ou télécharger un fichier `.ics` depuis la web-app. [Guide de l’agenda](agenda.md)

Pour un rendez-vous individuel, demandez au tuteur sa référence depuis « Compte », puis créez le rendez-vous dans l’onglet de la classe. [Procédure de prise de rendez-vous](agenda.md#fixer-un-rendez-vous-individuel)

Pour essayer les rappels, publiez un événement qui commence plus tard aujourd’hui ou demain, puis ouvrez ou actualisez l’accueil parent. [Rappels d’agenda](agenda.md#rappels-dagenda)

### Essayer la messagerie

Dans le menu parent, ouvrez « Messagerie », puis « Nouveau message ». Sélectionnez un enfant et choisissez « Direction » ou un enseignant de sa classe dont le compte est activé. Envoyez un message fictif, puis ouvrez « Messagerie » dans l’espace destinataire de la web-app pour répondre. Le compteur indique les conversations à lire. Si la conversation est déjà ouverte côté parent, utilisez « Actualiser » pour afficher la réponse. [Guide de la messagerie](messagerie.md)

### Essayer le cahier de liaison

Connectez-vous à l’espace enseignant dans la web-app, ouvrez « Vie de classe », puis « Cahier de liaison », et publiez un mot fictif pour votre classe. Dans l’accueil parent, ouvrez « Vie de classe » sous le nom de l’enfant, puis « Cahier de liaison », et choisissez « Répondre ». De retour dans l’espace enseignant, utilisez « Voir les réponses », puis « Répondre en privé » pour ouvrir la messagerie avec le destinataire déjà renseigné. [Guide du cahier de liaison](cahier-liaison.md)

### Essayer le blog de classe

Dans l’espace enseignant, ouvrez « Vie de classe », puis « Blog de classe », et créez un article fictif. Ajoutez deux photos d’objets et validez-les dans le brouillon. Choisissez « Prévisualiser », puis « Publier cet article ». Dans l’espace parent, ouvrez « Vie de classe », puis « Blog de classe » sous le nom de l’enfant et sélectionnez `+1` pour ouvrir le carrousel. [Guide du blog de classe](blog-de-classe.md)

Pour essayer le masquage, ouvrez les « Options » d’une photo du brouillon, puis « Masquer une zone ». Tracez un rectangle autour d’un objet, appliquez le masque et vérifiez de nouveau la photo. Ouvrez l’article côté parent après publication pour contrôler le résultat. [Tutoriel du masquage](blog-de-classe.md#masquer-une-zone-sur-une-photo)

Pour vérifier le registre avec les données fictives de l’assistant, ouvrez « École », puis « Autorisations photo » dans l’espace direction. Renseignez un statut pour l’élève fictif. Dans l’espace parent, retrouvez le statut dans « Compte », puis « Autorisations photo ».

### Essayer l’appel et le suivi des absences

1. Dans l’espace enseignant, ouvrez « Vie de classe », puis « Faire l’appel ». Ouvrez la ligne de l’élève fictif, choisissez « Absent » et enregistrez l’appel.
2. Dans l’espace parent, ouvrez « Absences » sous son nom et vérifiez que l’absence est affichée.
3. Cliquez sur « Envoyer un justificatif » et sélectionnez un PDF fictif ou une photo sans donnée personnelle.
4. Dans l’espace direction, ouvrez « École », puis « Suivi des absences ». Ouvrez la ligne de l’élève, téléchargez le justificatif et acceptez-le. Actualisez l’historique parent pour voir la nouvelle mention. [Guide de l’appel et des absences](absences.md)

### Préparer une rentrée fictive

1. Dans l’espace direction, ouvrez « École », puis « Clôture d’année » et choisissez « Préparer la rentrée ».
2. Ajoutez une classe de rentrée de niveau « CE2 ». Dans « Passages », enregistrez « CE1 » comme niveau de la classe fictive actuelle.
3. Ouvrez la ligne de l’élève fictif et validez la proposition. Dans « Ouverture », préparez les affectations et vérifiez le récapitulatif.
4. Sur l’école fictive, confirmez l’ouverture en saisissant l’année demandée. Retrouvez l’ancienne classe dans « Archives » et contrôlez les nouvelles affectations dans les espaces parent et enseignant. [Guide de la clôture d’année](cloture-annee.md)

### Télécharger le blog fictif en PDF

Après avoir publié l’article de démonstration, ouvrez « École → Clôture d’année → PDF du blog » dans l’espace direction. Choisissez sa classe, affichez l’aperçu et téléchargez le PDF. Ouvrez le fichier pour contrôler la couverture, le texte et les photos. [Guide de l’export](cloture-annee.md#exporter-le-blog-en-pdf)

### Générer une invitation supplémentaire

1. Ouvrez « École → Classes et familles » dans l’espace direction. Créez ou ouvrez une classe, puis ajoutez une fiche élève.
2. Dans « Tuteurs », associez le compte responsable à l’enfant. Dans « Invitations », sélectionnez un ou plusieurs tuteurs et générez les codes.
3. Remettez les codes séparément à chaque famille par un canal privé. Le CSV est proposé pour la préparation. En cas de perte d’un appareil, choisissez aussi de révoquer les anciennes sessions.

### Publier un livret d’essai

1. Dans l’espace enseignant, ouvrez « Vie de classe → Livret scolaire ». Choisissez la classe, l’élève et le trimestre.
2. Renseignez les domaines et les appréciations. Enregistrez le brouillon et vérifiez le contenu avant publication.
3. Dans l’espace parent, ouvrez « Vie de classe → Livret scolaire » sous le nom de l’enfant. Ouvrez le bilan publié et téléchargez le PDF.

Pour préparer un fichier d’import LSU, complétez les éléments de programme côté enseignant puis ouvrez « École → Livrets scolaires → Exporter vers le LSU » avec le compte direction. [Tutoriel LSU](lsu.md)

### Partager une ressource et activer les notifications web

1. Dans l’espace enseignant, ouvrez « Vie de classe → Médiathèque ». Ajoutez un PDF fictif, donnez-lui un titre et choisissez une matière dans le champ de dossier. La famille le retrouve dans sa médiathèque de classe. Les dossiers, la recherche, l’aperçu et le téléchargement se font dans le navigateur.
2. Pour voir une vidéo du blog, enregistrez d’abord un brouillon et ajoutez un court MP4 ou WebM. Vérifiez la prévisualisation, puis publiez l’article et ouvrez-le avec le compte parent. [Guide du blog](blog-de-classe.md#ajouter-une-vidéo)
3. Sur l’instance HTTPS, ouvrez « Compte → Notifications » dans l’espace parent, puis « Activer les notifications ». Autorisez l’affichage dans le navigateur. Choisissez les rubriques souhaitées et décidez si les alertes doivent arriver le week-end. Sur iOS, utilisez la web-app ajoutée à l’écran d’accueil avec un système compatible Web Push.
4. Depuis le compte enseignant, publiez un devoir fictif. Ouvrez l’alerte et vérifiez que le cahier de texte s’affiche après connexion. Pour essayer les rappels, créez un événement fictif à plus de 24 heures ou enregistrez une absence fictive. [Horaires des rappels](agenda.md#activer-les-rappels-web)

Compose génère la clé Web Push lors de l’installation. Le service de notification du navigateur reçoit le type d’alerte. Les noms, titres d’événements, dates et messages se consultent après connexion à l’ENT. Le quota de la médiathèque est réglable avec `CLASS_MEDIA_QUOTA_MIB`, dont la valeur par défaut est `5120`.

Les notifications dans l’application parent compilée utilisent Firebase sur Android et APNs sur iOS. Configurez uniquement les fournisseurs de vos applications signées. [Tutoriel du push natif](push-natif.md)

### Ouvrir les documents dans l’application parent

Dans l’application iOS ou Android, connectez-vous à l’adresse HTTPS de l’école. Depuis la médiathèque, utilisez « Ouvrir » pour les images et « Lire » pour les vidéos et les audios. « Ouvrir ou enregistrer » ouvre le menu système, notamment pour les PDF. Pour joindre un document à un message ou à une absence, choisissez un fichier depuis le sélecteur de l’appareil. Les boutons de téléchargement restent disponibles dans le cahier de texte et le livret.

### Ouvrir le service depuis un autre appareil

L’installation de départ n’écoute que sur la boucle locale. Pour un essai sur un autre appareil, préparez une origine HTTPS accessible depuis cet appareil, par exemple via un VPN et un proxy TLS sur l’hôte. Le certificat doit être reconnu par le navigateur et le système mobile.

1. Configurez le proxy HTTPS sur l’hôte pour transmettre le site et l’API à `127.0.0.1:3000`. Transmettez l’en-tête `Origin` du navigateur. Pour un nom DNS valide et un certificat géré par Caddy sur l’hôte, le fichier de configuration peut contenir le bloc suivant, avec le domaine remplacé par le vôtre.

   ```caddyfile
   ent.ecole.example {
       reverse_proxy 127.0.0.1:3000
   }
   ```

2. Créez un fichier `.env` à la racine du projet et définissez `OPEN_CARTABLE_ORIGIN=https://ent.ecole.example` avec votre origine exacte, sans barre finale. Relancez l’installateur. L’adresse du navigateur doit correspondre à cette origine.
3. Pour la web-app, ouvrez cette même adresse dans le navigateur de l’appareil. Pour le client natif de développement, installez Node.js 24 et exécutez `npm ci` puis `npm run dev:mobile:lan` depuis le dépôt. Ouvrez le projet dans un client Expo compatible avec le SDK 54 et Expo SecureStore. Dans l’app, saisissez l’origine HTTPS, le code école et une nouvelle invitation. Le téléphone doit aussi pouvoir joindre Metro pendant le développement.

Les binaires mobiles distribués via les stores et les autres fonctions de gestion de l’école font partie des lots suivants. Limitez cette installation aux données fictives jusqu’aux validations décrites dans les [exigences de sécurité](securite.md).

## 5. Redémarrer, mettre à jour et diagnostiquer

- Relancez le même lanceur pour redémarrer. Il réutilise les volumes de la base et des clés. Pour suspendre les services, exécutez `docker compose stop`.
- Pour mettre à jour, conservez le même dossier et le même nom de projet Compose. Sauvegardez PostgreSQL et les volumes de secrets, sur un support chiffré hors du dépôt. Remplacez le code par la version souhaitée puis relancez le lanceur pour reconstruire l’image et appliquer les migrations.
- Si le port 3000 est occupé, par exemple par `npm run dev:api`, ajoutez `OPEN_CARTABLE_PORT=3090` au fichier `.env` et relancez. Mettez également à jour la cible du proxy si vous en utilisez un. Metro et le serveur de développement sont facultatifs pour utiliser la web-app Docker.
- Si le proxy de votre organisation utilise sa propre autorité de certification, indiquez le chemin absolu du fichier PEM dans la variable d’environnement `OPEN_CARTABLE_BUILD_CA` avant de lancer l’installateur. Compose transmet ce fichier aux étapes d’installation npm pendant la construction de l’image.
- Consultez l’état et les journaux avec `docker compose ps` et `docker compose logs api postgres database-role secrets`. Exécutez ces commandes depuis le dossier du projet. Retirez les identifiants avant de transmettre des journaux.
- Si `secrets` s’arrête pendant l’installation, consultez `docker compose logs --tail=40 secrets` depuis ce même dossier. Pour l’erreur `Cannot find module '/generate-secrets.mjs'` d’une ancienne version, mettez le dépôt à jour et relancez l’installateur. Les volumes existants sont réutilisés.
- Évitez `docker compose down --volumes` sur une installation à conserver. Cette commande efface la base et les clés du projet.
