# Cahier de texte

Le tuteur ouvre le cahier de l’un de ses enfants depuis l’écran « Vos enfants ». Il consulte les entrées de la classe actuelle par jour, semaine ou mois. Les filtres « Tout », « Devoirs » et « Notes de classe » se combinent avec le champ Domaine. L’accueil regroupe jusqu’à douze devoirs à rendre au cours des deux prochaines semaines. Sélectionnez une échéance pour ouvrir le cahier de l’enfant à la date du devoir.

## Publication sur le web et sur mobile

Ouvrez « Accès pour l’équipe → Direction » depuis la connexion commune. Sélectionnez la classe, choisissez « Note de classe » ou « Devoir à rendre », puis renseignez la date, le titre, le domaine et la description. Pour un devoir, la date correspond à l’échéance. La liste des publications est organisée par mois. « Modifier » permet de corriger une entrée ou de reclasser un ancien devoir. Les anciennes entrées apparaissent comme des notes de classe à la mise à jour. [Tutoriel d’installation et de configuration](installation.md)

La direction peut créer des comptes enseignants depuis « École », puis « Enseignants ». Après activation, l’enseignant publie, modifie et retire les entrées de ses classes affectées. Le serveur vérifie l’affectation à chaque lecture et écriture. Une affectation retirée prend effet à la prochaine requête, y compris pour une session déjà ouverte. [Création et activation d’un compte enseignant](installation.md#créer-un-accès-enseignant)

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

La commande renvoie l’identifiant de l’entrée. Ajoutez `"kind": "assignment"` pour publier un devoir à rendre. Utilisez `update CODE_ECOLE UUID_CLASSE UUID_ENTREE` avec le même format JSON pour modifier l’entrée et `delete CODE_ECOLE UUID_CLASSE UUID_ENTREE` pour la supprimer.

La date doit être réelle et au format `AAAA-MM-JJ`. Le titre, le domaine et la description sont obligatoires et limités respectivement à 120, 80 et 2 500 caractères. Les entrées sont en texte brut. Les commandes d’écriture nécessitent un accès direct à PostgreSQL et sont destinées à l’administration locale de la base de développement.

## API parent

`GET /api/v1/parent/children/{childId}/homework` requiert une session parent valide. Les paramètres `from` et `to` délimitent une période inclusive de 31 jours maximum. Les filtres `domain` et `kind` (`notebook` ou `assignment`) sont facultatifs. Passez le `nextCursor` retourné par la dernière réponse dans `cursor` avec les mêmes filtres pour obtenir la suite. `GET /api/v1/parent/assignments/next` fournit les échéances de l’accueil.

La réponse contient `child` avec la classe actuelle, `entries` et `nextCursor`. Chaque entrée comporte `id`, `date`, `title`, `domain` et `description`. Le serveur vérifie la session et le rattachement actuel du tuteur à l’enfant dans la même requête que la lecture des entrées. L’accès à un enfant hors périmètre renvoie `404`, comme pour un identifiant inconnu. Les réponses portent `Cache-Control: no-store`.

Pour ajouter un PDF ou une photo, publiez l’entrée puis cliquez sur « Joindre un document ». Les familles de la classe peuvent le télécharger depuis cette entrée. La direction peut encore le retrouver dans les archives après la bascule. [Clôture de l’année scolaire](cloture-annee.md)
