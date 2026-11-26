# Blog de classe

## Préparer et publier un article

1. Dans l’espace enseignant de la web-app, ouvrez « Vie de classe », puis « Blog de classe », et choisissez une classe qui vous est affectée.
2. Choisissez « Nouvel article ». Saisissez un titre de 120 caractères maximum. Le texte est facultatif si l’article contient des photos. Il peut contenir jusqu’à 8 000 caractères.
3. Choisissez « Enregistrer le brouillon » pour reprendre la rédaction plus tard ou « Prévisualiser » pour enregistrer le texte et voir le rendu côté familles.
4. Dans l’aperçu, choisissez « Publier cet article ». Le texte devient visible dans le fil de la classe.

Le filtre « Brouillons » permet de retrouver les articles en préparation. Si quelqu’un a enregistré ou publié une autre version de l’article entre-temps, rechargez l’article avant de poursuivre.

## Ajouter plusieurs photos

1. Après avoir saisi le titre, cliquez sur « Ajouter des photos » et sélectionnez vos images. Un article accepte jusqu’à 12 fichiers JPEG, PNG ou WebP statiques de 10 Mo et 26 mégapixels chacun.
2. Ouvrez les vignettes pour inspecter les images en grand. Choisissez « Vérifier la photo ». Indiquez si des élèves sont reconnaissables et, dans ce cas, sélectionnez-les tous. Le registre doit contenir une autorisation valable pour chacun. Ajoutez une description si elle facilite la compréhension de l’image. Si une autorisation manque, vous pouvez masquer les zones concernées dans le brouillon.
3. Dans « Options », utilisez « Mettre en couverture » pour placer une photo en premier. Prévisualisez l’article, puis publiez-le après avoir validé toutes les photos.

### Masquer une zone sur une photo

Dans l’outil de masquage, « Repérer les visages » propose des rectangles à vérifier. Le repérage se déroule dans le navigateur de l’enseignant et traite uniquement la photo ouverte. Contrôlez chaque proposition, ajoutez les zones oubliées et appliquez les masques. L’autorisation de publication reste une vérification manuelle.

1. Dans le brouillon de la web-app, ouvrez les « Options » de la photo, puis « Masquer une zone ».
2. Tracez un rectangle à la souris ou au doigt sur chaque élément à cacher. Couvrez toute la zone qui permet d’identifier l’élève. Au clavier, placez le focus sur la photo, déplacez le curseur avec les flèches et utilisez Entrée pour poser chaque coin. « Annuler le dernier tracé » retire le dernier rectangle de l’aperçu.
3. Choisissez « Appliquer les masques ». La photo et sa vignette sont remplacées par les versions avec les rectangles opaques. Les anciens liens de la photo expirent immédiatement et l’opération est définitive dans le brouillon.
4. Ouvrez « Vérifier la photo ». Relisez aussi la description et renseignez les élèves encore reconnaissables. Validez la photo, puis vérifiez le résultat dans l’aperçu avant publication.

Pour une photo déjà publiée, retirez d’abord l’article de la publication. Les anciennes copies téléchargées ou sauvegardées restent soumises aux procédures de conservation de l’école.

## Renseigner les autorisations

La direction ouvre « École », puis « Autorisations photo ». Après avoir choisi la classe et l’élève, elle enregistre la décision recueillie auprès de la famille. Les statuts disponibles sont « À renseigner », « Autorisée » et « Refusée ». Le tuteur peut consulter le registre de ses enfants dans « Compte », puis « Autorisations photo ».

Une photo associée à un élève disparaît du fil des familles dès le prochain chargement quand son autorisation est retirée. Sans texte ni autre photo visible, l’article disparaît lui aussi. Si l’école enregistre ensuite une nouvelle autorisation, l’enseignant doit vérifier la photo en brouillon et la republier. La sélection des élèves se fait manuellement.

Les photos publiées avant l’ajout du registre conservent leur validation précédente. Pour associer une photo existante à des élèves, remettez l’article en brouillon, vérifiez les photos puis republiez. Les retraits automatiques s’appliquent aux photos vérifiées avec le registre.

## Corriger ou retirer un article

Ouvrez l’article publié et choisissez « Retirer de la publication », puis confirmez. Il disparaît du fil des familles et revient en brouillon. Modifiez le texte et repassez par l’aperçu pour republier. Un brouillon peut être supprimé depuis son éditeur.

## Lire les articles

Dans l’accueil parent, ouvrez « Vie de classe », puis « Blog de classe » sous le nom de l’enfant. Le fil affiche les articles publiés de sa classe actuelle, du plus récent au plus ancien. La première photo apparaît en grand. La vignette `+X` indique le nombre d’autres photos et ouvre le carrousel à la deuxième image. Utilisez les flèches, un glissement horizontal ou les touches droite et gauche. Si le fil était déjà ouvert lors d’une publication ou d’un retrait, utilisez « Actualiser ».

Dans l’espace direction, ouvrez « École → Clôture d’année → PDF du blog » pour télécharger les articles publiés d’une classe et leurs galeries autorisées. [Export annuel du blog](cloture-annee.md#exporter-le-blog-en-pdf)

## Ajouter une vidéo

Enregistrez le brouillon puis choisissez « Ajouter une vidéo ». Sélectionnez un fichier MP4 ou WebM de 24 Mo maximum et vérifiez qu’aucun élève n’est identifiable à l’image ou au son. L’ENT limite chaque vidéo à deux minutes et deux vidéos par article. Lancez la prévisualisation avant de publier. Le PDF conserve le texte et les galeries photo.

## Stockage et conservation

Le serveur convertit les images en JPEG haute résolution et en vignettes, enlève les métadonnées et chiffre les deux versions dans PostgreSQL. Les originaux sont écartés après conversion. Les téléchargements exigent une session autorisée. Le quota du blog est de 5 Gio par école.

Une photo de brouillon expire un an après le dépôt. Une photo publiée expire un an après sa première publication. Les fichiers expirés cessent d’être servis et la purge les efface au plus tard au prochain passage horaire. Si un article était composé uniquement de photos, la purge le retire du fil quand la dernière photo expire.

Docker Compose génère la clé de chiffrement dans le volume `app-secrets`. Pour restaurer une sauvegarde du blog, conservez la clé correspondante séparément de la base. Une installation manuelle peut fournir `BLOG_MEDIA_KEY_FILE` qui pointe vers un fichier privé contenant 64 caractères hexadécimaux.
