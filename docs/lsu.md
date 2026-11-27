# Exporter les bilans périodiques du premier degré vers le LSU

L’espace direction peut télécharger un XML pour une classe et un trimestre. Le parcours couvre les bilans périodiques du CP au CM2, y compris ceux des classes archivées qui sont encore disponibles. Le fichier regroupe les élèves sélectionnés et reprend les données de leurs bilans publiés.

## Préparer les bilans côté enseignant

1. Ouvrez « Vie de classe → Livret scolaire » et sélectionnez l’élève et le trimestre.
2. Renseignez l’appréciation générale, avec un maximum de 1 500 caractères pour le LSU.
3. Évaluez au moins trois domaines. Pour chaque domaine évalué, saisissez les éléments réellement travaillés dans « Éléments de programme pour le LSU », à raison d’un libellé par ligne. Conservez « Non renseigné » pour les domaines qui n’ont pas été évalués.
4. Publiez le bilan ou mettez à jour le bilan publié.

## Télécharger le XML côté direction

1. Ouvrez « École → Livrets scolaires → Exporter vers le LSU ». Sélectionnez une classe et son trimestre.
2. Remédiez aux éléments de complétude signalés avec l’enseignant. Pour inclure un élève, saisissez son INE ONDE et vérifiez son niveau sur le bilan. Si sa scolarité dans cette classe a commencé après le début du trimestre, renseignez une date du trimestre où il y était inscrit.
3. Saisissez le code UAI de l’école, l’identifiant ONDE de la classe, les dates du trimestre telles qu’elles figurent dans LSU, la date de création des bilans et les identités de la direction et des enseignants concernés.
4. Vérifiez la correspondance de l’échelle d’Open Cartable avec les positionnements LSU. « Langues vivantes » correspond à LV1. Choisissez la version XSD attendue par votre instance LSU. Open Cartable propose 10.0 par défaut, avec une option 9.0.
5. Téléchargez le fichier `import-lsun-…xml`. Importez-le avec le compte autorisé dans le LSU du ministère, puis vérifiez le compte rendu avant toute diffusion.

Les INE saisis servent à fabriquer le fichier et sont effacés du formulaire après le téléchargement. Le fichier local contient les INE et les évaluations des élèves sélectionnés. Conservez-le dans l’espace de travail autorisé de l’école.

## Références et validation

Les règles de complétude, d’identification et de période suivent le dossier ministériel *Format import LSU 1er degré*, version documentaire 1.22, sections 2.3.8, 2.3.20, 2.4.1 et 2.4.3. La version du contrat métier et celle du schéma XML sont deux références distinctes.

Les tests valident la structure avec les XSD 9.0 et 10.0 distribués dans la copie publique de SACoche du 27 septembre 2026. Le contrat XSD 10.0 accepte aussi les fichiers marqués 9.0. Les correspondances de domaines par cycle s’appuient sur la nomenclature de cette même révision. [XSD 10.0](https://github.com/Stef-33560/sacoche/blob/476294f9d7663841fd8c89d856b5491291494975/_xsd/livret-scolaire_1d_schema_10.0.xsd) · [XSD 9.0](https://github.com/Stef-33560/sacoche/blob/476294f9d7663841fd8c89d856b5491291494975/_xsd/livret-scolaire_1d_schema_9.0.xsd) · [Nomenclature](https://github.com/Stef-33560/sacoche/blob/476294f9d7663841fd8c89d856b5491291494975/_sql/structure/sacoche_livret_rubrique.sql)

Pour rejouer la validation XSD avec des élèves fictifs, placez les deux fichiers sous leur nom d’origine dans un dossier de test, puis lancez `TEST_LSU_XSD_DIR=/chemin/vers/les/xsd npm test` avec Python et lxml disponibles. Le test contrôle leur empreinte et vérifie chaque export hors réseau. La recette d’import dans l’instance LSU de l’académie valide la nomenclature annuelle et la correspondance avec les données ONDE locales.
