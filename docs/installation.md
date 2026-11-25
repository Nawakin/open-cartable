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

1. Ouvrez « Espace direction » dans la web-app. Saisissez le code école et le mot de passe choisi dans l’assistant.
2. Sélectionnez une classe. Renseignez la date, le titre, le domaine et la description, puis cliquez sur « Publier ».
3. Revenez à « Espace parent » et ouvrez le cahier de texte de l’enfant. Sélectionnez la période de l’entrée. Dans l’espace direction, « Modifier » et « Retirer » permettent de corriger ou supprimer une publication. [Guide du cahier de texte](cahier-texte.md)

### Activer ou réinitialiser le compte direction

Après la mise à jour d’une installation existante, relancez le lanceur pour appliquer la migration. Exécutez ensuite la commande ci-dessous avec votre code école. Utilisez la même commande si vous perdez le mot de passe direction.

```sh
docker compose exec -T api npm run --silent direction:admin -- CODE_ECOLE
```

La commande affiche un nouveau mot de passe dans le terminal et ferme les sessions direction de cette école. Conservez le mot de passe dans un gestionnaire et gardez le terminal privé. Les invitations et sessions parent suivent leur propre procédure de réémission.

### Créer un accès enseignant

1. Dans « Espace direction », ouvrez « Comptes enseignants ». Choisissez un identifiant, affectez une ou plusieurs classes puis cliquez sur « Créer le compte enseignant ».
2. Transmettez en privé le code école, l’identifiant et le code d’activation affiché. Le code est valable sept jours et s’utilise une seule fois.
3. Dans « Espace enseignant », cliquez sur « Activer mon compte ». Saisissez le code école, l’identifiant et le code d’activation, puis choisissez un mot de passe de 15 à 128 caractères. Après activation, connectez-vous avec le code école, l’identifiant et ce mot de passe.

L’enseignant retrouve le même formulaire de publication que la direction, avec ses seules classes affectées. La direction peut modifier les affectations, réinitialiser l’activation ou retirer le compte. Réinitialiser ou retirer un compte ferme ses sessions. Les publications restent dans le cahier de la classe. [Guide du cahier de texte](cahier-texte.md)

### Publier dans l’agenda

Dans « Agenda », la direction peut publier pour l’école entière ou une classe. Un enseignant peut publier pour ses classes affectées. Dans l’espace parent, ouvrez l’agenda de l’enfant pour consulter les événements ou télécharger un fichier `.ics` depuis la web-app. [Guide de l’agenda](agenda.md)

Pour un rendez-vous individuel, demandez au tuteur sa référence depuis « Vos enfants », puis créez le rendez-vous dans l’onglet de la classe. [Procédure de prise de rendez-vous](agenda.md#fixer-un-rendez-vous-individuel)

Pour essayer les rappels, publiez un événement qui commence plus tard aujourd’hui ou demain, puis ouvrez ou actualisez l’accueil parent. [Rappels d’agenda](agenda.md#rappels-dagenda)

### Générer une invitation supplémentaire

```sh
docker compose exec -T postgres psql -U postgres -d open_cartable -c "SELECT s.code AS ecole, g.id AS tuteur FROM guardians g JOIN schools s ON s.id = g.school_id"
docker compose exec -T api npm run --silent auth:admin -- invite CODE_ECOLE UUID_TUTEUR
```

Le second ordre affiche l’invitation dans le terminal. Transmettez-la par un canal privé. Pour une perte d’appareil, utilisez `replace` avec les mêmes arguments. Cette commande révoque les sessions existantes du tuteur.

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
- Si le port 3000 est occupé, ajoutez `OPEN_CARTABLE_PORT=3090` au fichier `.env` et relancez. Mettez également à jour la cible du proxy si vous en utilisez un.
- Si le proxy de votre organisation utilise sa propre autorité de certification, indiquez le chemin absolu du fichier PEM dans la variable d’environnement `OPEN_CARTABLE_BUILD_CA` avant de lancer l’installateur. Compose transmet ce fichier aux étapes d’installation npm pendant la construction de l’image.
- Consultez l’état et les journaux avec `docker compose ps` et `docker compose logs api postgres database-role secrets`. Exécutez ces commandes depuis le dossier du projet. Retirez les identifiants avant de transmettre des journaux.
- Évitez `docker compose down --volumes` sur une installation à conserver. Cette commande efface la base et les clés du projet.
