# Agenda

## Publier un événement

1. Ouvrez « Agenda » dans l’espace direction ou enseignant de la web-app.
2. Choisissez la classe. La direction peut aussi choisir « École entière ». Un enseignant publie pour ses classes affectées.
3. Saisissez le titre, les dates et heures de début et de fin, puis le lieu et la description si besoin. Cliquez sur « Publier l’événement ».
4. Utilisez « Modifier » ou « Retirer » sur un événement de la liste pour le corriger ou le supprimer.

Saisissez les horaires dans le fuseau de votre appareil. L’application enregistre les instants en UTC et les affiche dans le fuseau de l’appareil qui consulte l’agenda. La fin doit être postérieure au début.

## Consulter et exporter

Dans l’espace parent, choisissez « Consulter l’agenda » sous l’enfant. Les événements de sa classe actuelle et ceux de son école sont affichés par semaine ou par mois. La liste comprend les événements qui chevauchent la période affichée.

Dans la web-app, « Télécharger le fichier .ics » exporte l’événement choisi pour l’importer dans un calendrier. Ce fichier constitue une copie de l’événement au moment du téléchargement. Il faudra l’importer de nouveau si l’horaire change après téléchargement. L’export applique les mêmes contrôles de tutelle, d’école et de classe que la consultation.

## API

- Les parents consultent `GET /api/v1/parent/children/{childId}/agenda` et téléchargent un événement avec `GET /api/v1/parent/children/{childId}/agenda/{eventId}/ical`.
- La direction gère les événements généraux sous `/api/v1/direction/agenda`. La direction et les enseignants gèrent les événements de classe sous `/api/v1/{role}/classes/{classId}/agenda`.
- La liste reçoit `from` et `until` au format UTC ISO 8601 avec millisecondes. La borne de fin est exclusive. Une réponse contient au plus 30 événements. Passer `nextCursor` dans `cursor` avec les mêmes bornes pour lire la suite.
- Une écriture reçoit `startsAt`, `endsAt`, `title`, `location` et `description`. Les instants sont exprimés à la seconde dans le même format, par exemple `2026-11-25T09:00:00.000Z`. Le lieu et la description peuvent être vides.

Les rendez-vous individuels, les rappels et l’export depuis l’application native restent à développer.
