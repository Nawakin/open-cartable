# Agenda

## Publier un événement

1. Ouvrez « Agenda » dans l’espace direction ou enseignant de la web-app.
2. Choisissez la classe. La direction peut aussi choisir « École entière ». Un enseignant publie pour ses classes affectées.
3. Saisissez le titre, les dates et heures de début et de fin, puis le lieu et la description si besoin. Cliquez sur « Publier l’événement ».
4. Utilisez « Modifier » ou « Retirer » sur un événement de la liste pour le corriger ou le supprimer.

Saisissez les horaires dans le fuseau de votre appareil. L’application enregistre les instants en UTC et les affiche dans le fuseau de l’appareil qui consulte l’agenda. La fin doit être postérieure au début.

## Fixer un rendez-vous individuel

1. Dans le menu parent, ouvrez « Compte », puis « Afficher ma référence tuteur ». Transmettez cette référence à l’école en privé pour le rendez-vous.
2. Dans l’espace direction ou enseignant, ouvrez « Agenda », choisissez la classe de l’élève, puis « Rendez-vous individuels ».
3. Sélectionnez l’élève, collez la référence reçue et renseignez les horaires. Cliquez sur « Créer le rendez-vous ». Le serveur vérifie que le tuteur est actif et lié à cet élève.

Le rendez-vous apparaît uniquement dans l’agenda de l’enfant pour le tuteur destinataire, même si plusieurs tuteurs sont liés au même enfant. Le tuteur peut télécharger son fichier `.ics` marqué privé depuis la web-app. La direction et l’enseignant qui a créé le rendez-vous peuvent le modifier ou le retirer. L’enseignant conserve cet accès tant qu’il est affecté à la classe et que l’élève y est inscrit. Pour changer le destinataire, retirez le rendez-vous et créez-en un nouveau.

Si l’élève change de classe, le rendez-vous cesse d’apparaître dans l’agenda du tuteur et de l’enseignant. La direction peut le retirer depuis la classe d’origine. Si le lien de tutelle est supprimé, le rendez-vous associé est supprimé.

## Consulter et exporter

Dans l’accueil parent, choisissez « Agenda » sous l’enfant. Les événements de sa classe actuelle et ceux de son école sont affichés par semaine ou par mois. La liste comprend les événements qui chevauchent la période affichée.

Dans la web-app, « Télécharger le fichier .ics » exporte l’événement choisi pour l’importer dans un calendrier. Ce fichier constitue une copie de l’événement au moment du téléchargement. Il faudra l’importer de nouveau si l’horaire change après téléchargement. L’export applique les mêmes contrôles de tutelle, d’école et de classe que la consultation.

## Rappels d’agenda

L’accueil parent affiche les événements à venir jusqu’à la fin du lendemain, avec les mentions « Aujourd’hui » et « Demain » selon l’heure de Paris. Les rappels sont recalculés à l’ouverture de l’accueil et via « Actualiser ». Un événement commun à plusieurs enfants apparaît une seule fois. Un rendez-vous individuel suit les droits de son tuteur destinataire.

Choisissez « Ouvrir l’agenda » sur un rappel pour consulter la semaine de l’événement. Les rappels sont calculés par le serveur de l’école et affichés dans l’application web ou mobile.

## API

- Les parents consultent `GET /api/v1/parent/children/{childId}/agenda` et téléchargent un événement avec `GET /api/v1/parent/children/{childId}/agenda/{eventId}/ical`.
- La direction gère les événements généraux sous `/api/v1/direction/agenda`. La direction et les enseignants gèrent les événements de classe sous `/api/v1/{role}/classes/{classId}/agenda`.
- La liste reçoit `from` et `until` au format UTC ISO 8601 avec millisecondes. La borne de fin est exclusive. Une réponse contient au plus 30 événements. Passer `nextCursor` dans `cursor` avec les mêmes bornes pour lire la suite.
- Une écriture reçoit `startsAt`, `endsAt`, `title`, `location` et `description`. Les instants sont exprimés à la seconde dans le même format, par exemple `2026-11-25T09:00:00.000Z`. Le lieu et la description peuvent être vides.
- Un parent obtient sa référence via `GET /api/v1/parent/tutor-reference`, avec sa session. Les rendez-vous se gèrent sous `/api/v1/{role}/classes/{classId}/appointments`. `GET .../appointments/students` liste les élèves de cette classe ayant un tuteur actif. La création reçoit `studentId`, `guardianReference` et `event`, avec les champs horaires et descriptifs ci-dessus. La référence sert à désigner un destinataire dans une opération authentifiée.
- `GET /api/v1/parent/agenda/reminders` retourne jusqu’à 30 rappels de l’accueil parent. Passez `nextCursor` comme paramètre `cursor` pour lire la suite.

## Activer les rappels web

Dans l’espace parent, ouvrez « Compte → Paramètres de notification ». Activez les alertes, puis choisissez « Nouveaux événements », « Rappels d’agenda » ou les deux. Le premier réglage concerne les publications à leur création. Le second envoie un rappel pour les événements saisis à l’avance, 24 heures avant leur début. Une modification d’horaire recalcule le rappel et une suppression l’annule.

Pour une absence toujours à justifier, l’alerte est programmée le lendemain à 9 h, heure de Paris. Elle est suspendue pendant l’examen du justificatif. Vous pouvez couper les alertes du week-end et choisir les catégories séparément. Les choix s’appliquent à ce navigateur. Une notification ouverte mène à la rubrique concernée après vérification de la session.

L’export iCalendar depuis l’application native figure dans la feuille de route. [État des parcours natifs](developpement.md)
