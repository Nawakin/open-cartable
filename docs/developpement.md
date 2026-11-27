# Plan de développement

## État de la feuille de route

| Phase | Déjà disponible | Reste à faire |
| --- | --- | --- |
| v0.1 · Socle | Configuration web depuis les lanceurs Docker, comptes direction et enseignant, récupération et TOTP, pièces jointes au cahier de texte et à la messagerie, alertes web et [push natif optionnel](push-natif.md) avec catégories, rappels et liens vers les rubriques | Recette push sur appareils signés et clés des fournisseurs, profils et QR d’école, rôles restreints du personnel. |
| v0.2 · Vie de classe | Cahier de liaison, blog avec galeries et vidéos, registre des autorisations, repérage local des visages, médiathèque avec dossiers, recherche, quota et archives, lecture et téléchargement dans l’application parent | Publications transversales à l’échelle de l’école et recette des parcours médias sur appareils iOS et Android. |
| v0.3 · Suivi et administration | Annuaire des classes, élèves et tuteurs, invitations groupées, appel, justificatifs photo/PDF, livrets par trimestre et PDF, [export LSU des bilans périodiques](lsu.md), [bascule de rentrée et archives](cloture-annee.md) | Recette d’import LSU en académie, bilans de fin de cycle, réglages de conservation, statistiques générales et journal d’audit étendu. |
| v0.4 · Exploitation et RGPD | Contrôles d’accès, conservation automatique des messages et des mots de liaison, point de contrôle de l’API | Sauvegardes chiffrées et restaurations, chiffrement au repos, procédure TLS et supervision, export et effacement des données d’un élève, mentions d’information, registre, AIPD et procédures d’incident. |
| v1.0 · Publication | Code Expo partagé et export web livré avec Compose | Valider l’installation sur Windows et macOS, les usages sur appareils iOS et Android, les performances, l’accessibilité et les mises à jour. Préparer la bêta et les publications sur les stores. |

Le repérage des visages s’exécute dans le navigateur avec une API locale ou BlazeFace distribué avec l’ENT. L’enseignant vérifie les zones, puis le serveur remplace la photo et la vignette par les versions masquées. [Guide du blog](blog-de-classe.md#masquer-une-zone-sur-une-photo)

L’export LSU des bilans périodiques applique les règles de complétude du dossier ministériel et se valide contre les schémas 9.0 et 10.0 du premier degré. L’école vérifie le compte rendu d’import dans son LSU. [Parcours et références LSU](lsu.md)

### Interface et personnalisation

La rubrique « École » de la direction regroupe les comptes enseignants, les autorisations photo et le bandeau. Le texte, sa couleur et le fond du bandeau sont modifiables avec aperçu, contrôle de contraste et retour aux valeurs par défaut. « Vie de classe » regroupe le blog et le cahier de liaison dans l’espace enseignant. [Tutoriel d’installation](installation.md#personnaliser-le-bandeau-de-lécole)

Les menus principaux et les raccourcis par enfant utilisent des cartes illustrées. L’association vérifiée des comptes parent et enseignant donne accès aux raccourcis entre ces espaces depuis leurs réglages respectifs. [Association des comptes](installation.md#utiliser-ses-comptes-parent-et-enseignant)

Il reste à simplifier les écrans les plus chargés. Regrouper les actions liées, rendre l’action suivante évidente et afficher les réglages secondaires au moment où ils deviennent utiles. Vérifier sur téléphone et ordinateur que les utilisateurs trouvent où consulter, publier ou gérer une autorisation sans tutoriel.

## Architecture cible

Une instance par école. React Native avec Expo et la nouvelle architecture, navigation React Navigation et état local limité. API REST Fastify avec schémas de validation, migrations PostgreSQL 16 et contrôle d'accès côté serveur. Pour les traitements différés, prévoir un worker local reprenant ses tâches de manière idempotente après redémarrage. Le futur Compose reliera Nginx, API, PostgreSQL et worker sur un réseau privé. Seul Nginx publiera un port. Valider les images et la restauration sur amd64 et arm64.

Le socle choisit Expo SDK 54 et React Native 0.81. Le minimum iOS indiqué pour ce SDK est 15.1. Valider ce changement par rapport à iOS 14 et confirmer les exigences des stores et des binaires natifs avant de figer la matrice. Tester Android API 26 sur appareil ou émulateur, vérifier les modules caméra et floutage avec des builds de développement, puis mesurer le poids réel des téléchargements par plateforme.

## Ordre de réalisation et critères d'acceptation

| Lot | Périmètre | Validation |
| --- | --- | --- |
| 0 | Identités, classes, élèves, liens de tutelle, personnel, invitations et sessions (AUTH, SEC, sous-ensemble ADM) | Invitation consommée une seule fois sous concurrence. Révocation après perte du téléphone. Deux familles et deux classes fictives servent à vérifier les refus d'accès. |
| 1 | Cahier de texte puis agenda (CT, AG) | L'enseignant publie pour sa classe. Un parent voit les entrées et événements autorisés. Un rendez-vous individuel reste privé, y compris dans l'export iCal. |
| 2 | Messagerie (MES) et notifications internes (NOT) | Seuls les participants autorisés lisent les messages et pièces jointes. Les liens ouvrent une ressource après contrôle d'accès. La purge traite aussi les fichiers. |
| 3 | Blog, consentement, floutage, liaison et médiathèque (BL, CL, MED) | Un brouillon reste inaccessible aux familles. Seul le fichier final expurgé est diffusé. Les quotas et durées sont vérifiés. |
| 4 | Absences, livret, administration avancée (ABS, LIV, ADM) | Justificatifs à accès restreint, exports et statistiques autorisés. Valider le format LSU sur des exemples fictifs et une spécification officielle. |
| 5 | Clôture d’année scolaire | Prévisualiser les effectifs, valider les passages et les exceptions, exporter le blog en PDF et ouvrir l’année suivante en conservant l’historique. [Parcours et critères](cloture-annee.md) |
| 6 | Exploitation et publication | Tester restauration, contrôle d'accès, accessibilité VoiceOver/TalkBack, réseau dégradé, migrations et mises à jour. Préparer les documents RGPD avec le DPO, le guide et la procédure d'incident. |

Le chiffrement, les sauvegardes restaurables et les règles de conservation sont requis avant le premier pilote avec des données réelles, même si l'interface d'administration correspondante arrive plus tard.

## Arbitrages avant le pilote

- **Autonomie de l'école** — Par défaut, aucune télémétrie ni dépendance à un service externe en exploitation. Utiliser les notifications dans l'application. APNs, FCM, EAS Update, tunnels gérés et relais e-mail nécessitent une décision distincte sur les flux, acteurs et métadonnées. Retenir un accès distant maîtrisé par l'école, avec validation du réseau et du certificat.
- **Démarrage en production** — Prévoir une livraison vérifiable et versionnée, un bootstrap local de la direction à durée limitée et une procédure TLS avec rotation. Le QR d'école contient l'URL et l'identifiant de configuration. Les codes d'invitation sont délivrés séparément.
- **Photographies** — La détection repère des visages. Elle n'établit pas l'identité d'un élève. L'enseignant vérifie manuellement les personnes et les autorisations avant publication. En cas de doute, masquer la zone de manière opaque ou écarter la photo. Tester les faux négatifs, les EXIF et l'accessibilité des originaux.
- **Données et droit** — Faire valider par le responsable du traitement et le DPO la base légale, les publics destinataires, les durées du cahier des charges, les droits applicables, l'AIPD et les modèles de documents avant collecte.

## État des dépendances du socle

L'audit npm du verrou initial signale encore 12 alertes transitives de la chaîne Expo, dont une élevée dans `image-size` (utilisé par Metro). PostCSS est épinglé à une version corrigée via une surcharge ciblée. Réévaluer le SDK et refaire l'audit et les builds natifs avant le pilote. Exécuter les outils de compilation en local avec des sources et ressources de confiance.
