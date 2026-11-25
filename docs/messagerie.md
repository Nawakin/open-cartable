# Messagerie privée

## Écrire à l’école

1. Connectez-vous à l’espace parent sur le web ou sur mobile.
2. Ouvrez « Messagerie », puis « Nouveau message ».
3. Sélectionnez l’enfant concerné. Choisissez « Direction » ou un enseignant dont le compte est activé et affecté à la classe actuelle de l’enfant. Les enseignants apparaissent avec leur identifiant d’école.
4. Saisissez un objet de 120 caractères maximum et un message de 4 000 caractères maximum, puis choisissez « Envoyer ».
5. Ouvrez la conversation depuis la liste. Pour consulter les réponses après l’ouverture, utilisez « Actualiser ». Pour remonter dans une conversation longue, utilisez « Afficher les anciens messages ».

## Répondre à une famille

1. Connectez-vous à l’espace direction ou enseignant dans la web-app. Ouvrez « Messagerie ».
2. Choisissez une conversation. Le nom de l’enfant et la référence du tuteur s’affichent au-dessus des messages.
3. Saisissez votre réponse, puis choisissez « Envoyer la réponse ».

## Écrire à un tuteur depuis l’espace enseignant

1. Demandez au tuteur de vous transmettre sa référence depuis « Compte », puis « Afficher ma référence tuteur ».
2. Dans « Messagerie », ouvrez « Nouveau message ». Choisissez la classe et l’élève, puis collez la référence du tuteur destinataire.
3. Saisissez l’objet et le message, puis choisissez « Envoyer ». Le serveur vérifie le lien entre le tuteur et l’élève et votre affectation à sa classe.

## Repérer les nouvelles réponses

Le menu « Messagerie » affiche le nombre de conversations non lues. Dans la liste, chaque conversation affiche un aperçu du dernier message et, si nécessaire, la mention « Non lue ». Le compteur se rafraîchit toutes les 30 secondes lorsque l’application est au premier plan. Le bouton « Actualiser » recharge la liste ou la conversation ouverte.

Ouvrir une conversation confirme la lecture jusqu’au dernier message chargé. L’état de lecture est partagé entre les appareils connectés au même compte. Pour la direction, il est commun aux personnes qui utilisent le compte direction de l’école. Après la mise à jour, les conversations qui contiennent déjà des messages reçus apparaissent comme non lues lors du premier accès.

## Accès et conservation

Chaque conversation est accessible au tuteur et à son interlocuteur, direction ou enseignant. Les tuteurs d’un même élève disposent chacun de leurs conversations. Deux enseignants d’une même classe ont chacun leurs échanges avec les familles.

L’accès enseignant suit l’affectation à la classe actuelle de l’élève. En cas de perte d’accès, le tuteur peut consulter l’historique en lecture seule. Une nouvelle affectation du même compte à la classe rétablit l’échange. Le retrait du lien de tutelle supprime les conversations associées à ce lien.

Les messages sont enregistrés en texte dans PostgreSQL sur le serveur de l’école. L’API cesse d’afficher un message un an après son envoi. La purge s’exécute au démarrage puis toutes les heures et supprime aussi les conversations sans message depuis un an. Les copies de sauvegarde suivent leur propre durée de conservation.
