# Sécurité et protection des données

## Identités et autorisations

- Modéliser les comptes, invitations, sessions, affectations et liens tuteur–élève séparément. Donner à chaque tuteur son propre compte et une invitation liée aux élèves autorisés. Une invitation porte une portée, une date d'expiration et un état de consommation. Générer les codes avec une source aléatoire cryptographique, les conserver sous forme d'empreinte protégée par une clé serveur et les consommer dans la transaction de création de session.
- Le jeton d’accès parent natif dure 15 minutes au plus. L’appareil dispose d’une session renouvelable et le serveur peut la révoquer à tout moment. Stocker l'empreinte du jeton de renouvellement côté serveur, effectuer sa rotation et invalider la famille de jetons si un ancien jeton est réutilisé. Utiliser Keychain ou Keystore sur le mobile. Lors d'une révocation, vérifier l'état de la session sur les routes protégées et couper les connexions temps réel associées.
- Refuser par défaut. Vérifier l'école, les affectations actives, le rôle et la relation avec la ressource à chaque lecture, modification, téléchargement, export et abonnement. Un identifiant fourni par le client ne donne aucun droit. Les permissions du personnel sont accordées explicitement par la direction et les droits de lecture des conversations restent limités à leurs participants.
- L’adresse de récupération direction est utilisable après validation par e-mail. Les liens expirent après 30 minutes. Le serveur conserve leur empreinte et les valide une seule fois. Un changement de mot de passe révoque les sessions direction.
- L’authentification TOTP de la direction suit RFC 6238. La clé est chiffrée côté serveur et le code d’un créneau déjà accepté est refusé. Si TOTP est activé, la récupération par e-mail exige aussi un code. Le menu de secours s’exécute sur l’hôte Docker et ferme les anciennes sessions de l’école sélectionnée.
- Combiner des budgets de tentatives par IP et par contexte d'invitation, avec réponse publique uniforme et quotas sur les créations et réinitialisations. Tester les réseaux partagés et le risque de verrouillage provoqué par un tiers avant de mettre en œuvre les seuils du cahier des charges. N'accepter les en-têtes d'origine que depuis les proxies configurés.

## Exposition, abus et appareils

- Compose publie par défaut l’API sur la boucle locale. Le mode LAN publie la passerelle HTTPS sur l’IPv4 privée choisie. PostgreSQL reste sur le réseau interne Docker. Vérifier le pare-feu, le NAT et les ports du serveur avant la mise en ligne. [Tutoriel d’installation](installation.md)
- La création initiale exige le lien privé du lanceur et l’origine exacte du navigateur. Le compte direction active ensuite TOTP avant d’accéder au tableau de bord. Une URL déclarée à l’installation reste affichée comme texte, et le client refuse les redirections lors des appels authentifiés.
- L’installation, la connexion, le jumelage et l’envoi de messages sont limités en fréquence. Les compteurs TOTP du compte direction limitent aussi les tentatives sur plusieurs appareils. Les annonces et les messages sont rendus en texte, et le jumelage ne déclenche aucun e-mail ni SMS.
- Le jumelage crée un nouveau jeton après vérification d’un code valable cinq minutes. Le serveur conserve une empreinte protégée du code et exige un appareil source encore actif. La direction présente en plus un TOTP frais. La révocation serveur ferme les requêtes suivantes du périphérique révoqué.
- Les tests vérifient l’origine des écritures, les rattachements, la concurrence de réservation et la consommation du jumelage. Un examen des dépendances et une recette sur le réseau réel restent nécessaires à chaque livraison. [État des dépendances](developpement.md#état-des-dépendances-du-socle)

## Fichiers, journaux et exploitation

- Contrôler la taille en flux, le format réel et les formats autorisés, puis mettre en quarantaine les pièces jointes avant diffusion. Appliquer les plafonds par usage, contrôler aussi la taille décodée des images et générer des identifiants de stockage côté serveur. Les fichiers sont servis après autorisation, sans accès direct au volume.
- Utiliser LUKS sur le serveur. Pour le chiffrement applicatif AES-256-GCM, utiliser des clés séparées des données, des nonces uniques par clé et une vérification d'intégrité avant diffusion. Stocker la sauvegarde chiffrée sur un support distinct et tester la restauration, y compris la réapplication des suppressions intervenues depuis la sauvegarde. Tester la rotation et la récupération des clés.
- Collecter le minimum dans l'audit. Écarter codes, jetons, contenu des messages et justificatifs. Séparer les droits de lecture et d'écriture des journaux, protéger les traces contre l'altération et valider la conservation des IP avec le DPO.
- Prévoir des certificats propres à chaque installation et une procédure de rotation avec chevauchement des clés si l'épinglage est retenu. Pour la vérification des serveurs découverts via QR, valider l'origine HTTPS et éviter de transmettre les codes ou jetons lors d'une redirection vers une autre origine.
- Documenter les durées et les événements qui les déclenchent. Tester les purges sur base, stockage, caches et exports, ainsi que les délais de disparition dans les sauvegardes. Valider les motifs de conservation obligatoires avant un effacement demandé.
- Prévoir un exercice d'incident avec le responsable du traitement. Pour une violation présentant un risque, organiser la notification à l'autorité compétente dans les délais applicables, si possible sous 72 heures. En cas de risque élevé, prévoir aussi l'information des personnes concernées.

## Vérifications avant la première école

Faire passer les tests d'isolation sur toutes les routes, y compris pièces jointes et notifications. Tester concurrence et révocation des invitations, purge des données, restauration sur une autre machine, rotation TLS et uploads de formats refusés. Exécuter les tests avec des fixtures fictives. Identifier les accès privilégiés et faire relire les protections avant toute mise en service.
