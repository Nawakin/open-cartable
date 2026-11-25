# Open Cartable

ENT libre et auto-hébergé pour le premier degré, sous licence GPLv3.
Le dépôt contient le socle de développement Expo/React Native et Fastify.
Il peut être utilisé avec des données fictives uniquement.

## Développement

Utiliser Node.js 24 et npm. Depuis la racine du dépôt :

```sh
npm ci
npm test
npm run build:mobile
```

Dans deux terminaux :

```sh
npm run dev:api
npm run dev:mobile
```

L'API répond sur `http://127.0.0.1:3000/healthz`. Metro démarre en local pour le développement Expo. L'export web permet de vérifier la compilation de l'écran de départ sans SDK natif. Pour un appareil physique, utiliser une machine de développement pouvant communiquer avec l'appareil.

Consulter le [plan de développement](docs/developpement.md) et [les exigences de sécurité et de confidentialité](docs/securite.md) avant d'implémenter les fonctionnalités.

Ce dépôt est public. Utiliser des exemples entièrement fictifs, garder les secrets et exports hors du dépôt et examiner le diff indexé avant chaque commit. Les signalements de sécurité passent par le canal privé décrit dans [SECURITY.md](SECURITY.md).
