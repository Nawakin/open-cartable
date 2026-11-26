# Clôture de l’année scolaire

Fonctionnalité prévue pour la v0.3 dans « École → Clôture d’année », côté direction.

## Préparer la rentrée

1. **Choisir les deux années.** L’assistant part de l’année active. La direction prépare les classes et leurs niveaux pour la rentrée, ainsi que les affectations des enseignants. Une classe de la nouvelle année peut reprendre le nom d’une ancienne classe.
2. **Proposer les passages.** Pour chaque élève, l’assistant suggère le niveau suivant à partir des niveaux configurés par l’école. Il utilise le niveau de l’élève dans les classes multiniveaux et propose une classe quand une seule destination correspond. Si le niveau reste à préciser, si plusieurs classes conviennent ou si l’élève arrive en fin de cycle, la direction choisit la suite dans la liste « À vérifier ».
3. **Vérifier les effectifs.** La direction voit les effectifs avant et après, par classe et par niveau. Pour chaque élève, elle peut accepter la destination, choisir une autre classe, enregistrer un maintien ou signaler un départ. Elle peut valider en bloc des propositions relues. Les cas encore à vérifier restent visibles jusqu’à leur résolution.
4. **Archiver et confirmer.** Le récapitulatif affiche les classes de départ et d’arrivée, les passages, les maintiens et les départs. La direction peut reprendre sa préparation plus tard et exporter les blogs avant la bascule. Une confirmation explicite applique l’ensemble des changements vérifiés.

La préparation est un brouillon. Si les effectifs ou les destinations changent entre la préparation et la confirmation, l’assistant indique les lignes à revoir et recalcule les totaux.

## Exporter le blog en PDF

La direction choisit une année et une classe. L’aperçu liste les articles publiés et les photos qui peuvent figurer dans l’export. Le PDF, généré sur le serveur de l’école, reprend le nom de la classe et l’année en couverture, puis les articles dans l’ordre chronologique avec leur date, leur texte, leur photo de couverture et leur galerie.

Le serveur applique les règles de visibilité et d’autorisation photo en vigueur à la génération et au téléchargement. Un changement de visibilité invalide le fichier préparé et déclenche son recalcul à la demande. Le PDF contient les images publiées encore autorisées, avec les masques déjà appliqués. Les aperçus et téléchargements exigent une session direction de la même école. Les copies téléchargées suivent la politique de conservation de l’école.

## Ouvrir la nouvelle année

| Élément | Effet de la bascule |
| --- | --- |
| Élèves et familles | Conservation de la fiche élève et du lien avec ses tuteurs lors d’un passage ou d’un maintien. En cas de départ, l’élève sort des listes de présence et des espaces de classe actifs. Les accès aux autres enfants de la famille se poursuivent. |
| Classes et personnel | Activation des nouvelles classes et des affectations confirmées. Les accès à la nouvelle année suivent ces affectations. |
| Contenu de classe | Nouveaux espaces pour le blog, le cahier de texte, le cahier de liaison et l’agenda de classe. Les éléments de l’année passée passent en archive avec leurs droits et échéances de conservation. |
| Suivi scolaire | L’historique des absences et des livrets suit l’élève selon les droits applicables et les durées de conservation prévues. Les statistiques de rentrée démarrent sur la nouvelle période. |
| Messagerie privée | Les conversations restent liées à leurs participants et suivent leur durée de conservation habituelle. |

## Étapes de réalisation et validation

1. **Années et affectations.** Rattacher les classes existantes à une année, conserver les identifiants des élèves et prévoir leur niveau individuel dans une classe multiniveau. Tester deux années ayant chacune une classe du même nom et vérifier que les contenus restent associés à la bonne année.
2. **Assistant de passage.** Tester un passage simple, un niveau partagé entre deux classes, un maintien et un départ dans une famille qui a un autre enfant scolarisé. Vérifier qu’une modification en parallèle est signalée avec les élèves concernés.
3. **PDF de classe.** Tester la mise en page sur un article avec plusieurs photos. Vérifier que l’export contient uniquement les articles et médias admissibles, y compris après un retrait d’autorisation. Vérifier les refus d’accès d’une autre école.
4. **Bascule et reprise.** Appliquer les affectations et l’activation de l’année dans une seule transaction. Vérifier qu’un double clic ou une relance ne crée aucun doublon et qu’un échec conserve l’année active. Journaliser l’opération et tester la restauration à partir d’une sauvegarde chiffrée.
