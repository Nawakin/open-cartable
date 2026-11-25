# Cahier de texte

Le tuteur ouvre le cahier de l’un de ses enfants depuis l’écran « Vos enfants ». Il consulte les entrées de la classe actuelle de l’enfant par jour, semaine ou mois. Le champ Domaine filtre les entrées de la période sans distinction de casse. Le bouton « Afficher la suite » charge la page suivante lorsqu’une période contient plus de 30 entrées.

## Publication dans la web-app

Ouvrez « Espace direction » et connectez-vous avec le code école et votre mot de passe direction. Sélectionnez la classe, renseignez la date, le titre, le domaine et la description, puis cliquez sur « Publier ». La liste des publications est organisée par mois. Sélectionnez « Modifier » pour corriger une entrée, ou « Retirer » puis « Confirmer le retrait » pour la supprimer. Les familles voient les changements à la prochaine consultation. [Tutoriel d’installation et de configuration](installation.md)

La direction peut créer des comptes enseignants depuis « Comptes enseignants ». Après activation, l’enseignant utilise « Espace enseignant » pour publier, modifier et retirer les entrées de ses classes affectées. Le serveur vérifie l’affectation à chaque lecture et écriture. Une affectation retirée prend effet à la prochaine requête, y compris pour une session déjà ouverte. Les sessions direction et enseignant durent au maximum huit heures. Les parents lisent le cahier de la classe de leurs enfants via leur propre session. [Création et activation d’un compte enseignant](installation.md#créer-un-accès-enseignant)

## Administration locale en ligne de commande

Appliquer les migrations, préparer la base fictive et générer une invitation en suivant le [guide du parcours parent](auth-parent.md). Charger `DATABASE_URL` dans le terminal d’administration. Pour publier dans la classe A de l’école fictive, adapter la date à la période à tester.

```sh
npm run --silent homework:admin -- create ECOLE-DEMO 20000000-0000-4000-8000-000000000001 <<'JSON'
{
  "date": "2026-11-25",
  "title": "Lire une histoire",
  "domain": "Français",
  "description": "Relire la fiche fictive en famille."
}
JSON
```

La commande renvoie l’identifiant de l’entrée. Utiliser `update CODE_ECOLE UUID_CLASSE UUID_ENTREE` avec le même format JSON pour remplacer les quatre champs. Utiliser `delete CODE_ECOLE UUID_CLASSE UUID_ENTREE` pour supprimer l’entrée. Les modifications deviennent visibles à la prochaine consultation.

La date doit être réelle et au format `AAAA-MM-JJ`. Le titre, le domaine et la description sont obligatoires et limités respectivement à 120, 80 et 2 500 caractères. Les entrées sont en texte brut. Les commandes d’écriture nécessitent un accès direct à PostgreSQL et sont destinées à l’administration locale de la base de développement.

## API parent

`GET /api/v1/parent/children/{childId}/homework` requiert une session parent valide. Les paramètres `from` et `to` délimitent une période inclusive de 31 jours maximum. `domain` est un filtre facultatif. Passer le `nextCursor` retourné par la dernière réponse dans `cursor` avec les mêmes filtres pour obtenir la suite.

La réponse contient `child` avec la classe actuelle, `entries` et `nextCursor`. Chaque entrée comporte `id`, `date`, `title`, `domain` et `description`. Le serveur vérifie la session et le rattachement actuel du tuteur à l’enfant dans la même requête que la lecture des entrées. L’accès à un enfant hors périmètre renvoie `404`, comme pour un identifiant inconnu. Les réponses portent `Cache-Control: no-store`.

Les pièces jointes, les notifications et l’archivage annuel restent à développer.
