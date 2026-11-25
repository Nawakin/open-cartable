# Messagerie privée

## Écrire à la direction

1. Connectez-vous à l’espace parent sur le web ou sur mobile.
2. Ouvrez « Messagerie », puis « Nouveau message ».
3. Sélectionnez l’enfant concerné. Saisissez un objet de 120 caractères maximum et un message de 4 000 caractères maximum, puis choisissez « Envoyer ».
4. Ouvrez la conversation depuis la liste. Pour consulter les réponses après l’ouverture, utilisez « Actualiser ». Pour remonter dans une conversation longue, utilisez « Afficher les anciens messages ».

## Répondre à une famille

1. Connectez-vous à l’espace direction dans la web-app. Ouvrez « Messagerie ».
2. Choisissez une conversation. Le nom de l’enfant et la référence du tuteur s’affichent au-dessus des messages.
3. Saisissez votre réponse, puis choisissez « Envoyer la réponse ».

## Accès et conservation

Le tuteur qui a ouvert la conversation et la direction de l’école peuvent la lire. Chaque tuteur dispose de ses propres conversations, y compris lorsque plusieurs tuteurs sont liés au même élève. Le retrait du lien de tutelle supprime les conversations associées à ce lien.

Les messages sont enregistrés en texte dans PostgreSQL sur le serveur de l’école. L’API cesse d’afficher un message un an après son envoi. La purge s’exécute au démarrage puis toutes les heures et supprime aussi les conversations sans message depuis un an. Les copies de sauvegarde suivent leur propre durée de conservation.
