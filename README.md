# Open Cartable

ENT libre et auto-hébergé pour le premier degré, sous licence GPLv3.
Le dépôt contient le socle de développement Expo/React Native et Fastify.
Il peut être utilisé avec des données fictives uniquement.

## Installation

Installez Docker avec Compose, puis ouvrez le lanceur de votre système. Open Cartable démarre le serveur et l’application web. L’assistant crée la première école dans le navigateur.

- Windows · `Installer-Windows.cmd`
- macOS · `Installer.command`
- Linux · `./installer.sh`

Le [tutoriel d’installation](docs/installation.md) couvre la configuration initiale, la web-app, l’accès mobile et les mises à jour.

## Développement

Utiliser Node.js 24 et npm. Depuis la racine du dépôt :

```sh
npm ci
npm test
npm run build:web
```

Dans deux terminaux :

```sh
npm run dev:api
npm run dev:mobile
```

L'API répond sur `http://127.0.0.1:3000/healthz`. Metro démarre en local pour le développement Expo. L'export web produit le site dans `apps/mobile/dist` sans SDK natif. Pour un appareil physique, utiliser une machine de développement pouvant communiquer avec l'appareil.

Consulter le [plan de développement](docs/developpement.md) et [les exigences de sécurité et de confidentialité](docs/securite.md) avant d'implémenter les fonctionnalités.

Ce dépôt est public. Utiliser des exemples entièrement fictifs, garder les secrets et exports hors du dépôt et examiner le diff indexé avant chaque commit. Les signalements de sécurité passent par le canal privé décrit dans [SECURITY.md](SECURITY.md).

## Authentification parent

Le parcours parent permet de se connecter avec un code d’invitation, de consulter ses enfants et de se déconnecter. Les écrans Expo sont partagés entre web, iOS et Android. PostgreSQL persiste les invitations, les sessions et les liens de tutelle. Le [guide du parcours parent](docs/auth-parent.md) décrit le démarrage web et mobile avec des données fictives et les tests d’intégration.

## Cahier de texte

Le parent peut consulter les publications de la classe de ses enfants depuis l’app. La direction publie depuis la web-app et peut déléguer la publication aux enseignants par affectation de classe. Le [guide du cahier de texte](docs/cahier-texte.md) décrit ces parcours avec des données fictives.

## Agenda

La direction publie les événements de l’école et les enseignants ceux de leurs classes affectées. Les familles les consultent dans l’espace parent. Le [guide de l’agenda](docs/agenda.md) décrit la publication et l’export web.
