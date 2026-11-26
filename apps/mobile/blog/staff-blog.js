import React, { useEffect, useState } from 'react';
import { BlogVideos } from '../files/library';
import { Text, View } from 'react-native';
import { useScrollToTop } from '../navigation';
import { Button, Field, styles } from '../parent/ui';
import { RequestError } from '../parent/http';
import { ArticleContent, ArticleRow, blog, useBlogTask } from './ui';
import { GalleryPreview, PhotoCarousel } from './gallery';
import { DraftGallery, PhotoPicker } from './photo-editor';

const statusOptions = [
  { id: 'all', label: 'Tous' },
  { id: 'draft', label: 'Brouillons' },
  { id: 'published', label: 'Publiés' },
];
const emptyDraft = { title: '', body: '' };
const maxPhotos = 12;
const maxPhotoBytes = 10 * 1024 * 1024;

function classPath(id) {
  return '/classes/' + encodeURIComponent(id) + '/blog';
}

function articlePath(classId, articleId) {
  return classPath(classId) + '/' + encodeURIComponent(articleId);
}

export function StaffBlog({ classes, request, onExpired }) {
  const [classId, setClassId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(null);
  const [view, setView] = useState('list');
  const [article, setArticle] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [confirmation, setConfirmation] = useState(null);
  const [notice, setNotice] = useState('');
  const [photoIndex, setPhotoIndex] = useState(null);
  const [students, setStudents] = useState(null);
  const { busy, problem, run } = useBlogTask(onExpired);
  const scrollToTop = useScrollToTop();
  const selected = classes.some(({ id }) => id === classId);
  const valid = Boolean(draft.title.trim());
  const photos = article?.photos ?? [];
  const missingReview = photos.filter((photo) => !photo.publishable).length;
  const maskedPhotos = photos.filter((photo) => photo.reviewBasis !== 'legacy' && !photo.publishable).length;
  const canPublish = Boolean(article?.body || photos.length || article?.videoCount) && !missingReview;
  const dirty = draft.title !== (article?.title ?? '') || draft.body !== (article?.body ?? '');

  async function loadList(id, status, cursor) {
    const query = new URLSearchParams({ status });
    if (cursor) query.set('cursor', cursor);
    const result = await request(classPath(id) + '?' + query.toString());
    setPage((before) => cursor ? { ...result, articles: [...before.articles, ...result.articles] } : result);
  }

  function list(id, status = filter, cursor) {
    void run(async () => {
      setNotice('');
      if (!cursor) {
        setClassId(id);
        setStudents(null);
        setFilter(status);
        setPage(null);
        setView('list');
        scrollToTop();
      }
      await loadList(id, status, cursor);
    });
  }

  function show(current) {
    setArticle(current);
    setDraft({ title: current.title, body: current.body });
    setView(current.publishedAt ? 'published' : 'edit');
    setConfirmation(null);
    setPhotoIndex(null);
    scrollToTop();
  }

  function open(id) {
    void run(async () => {
      setNotice('');
      const result = await request(articlePath(classId, id));
      show(result);
    });
  }

  function start() {
    setNotice('');
    setFilter('all');
    setArticle(null);
    setDraft(emptyDraft);
    setPhotoIndex(null);
    setView('edit');
    scrollToTop();
  }

  function backToList() {
    if (view === 'edit' && dirty && confirmation !== 'leave') {
      setConfirmation('leave');
      return;
    }
    setConfirmation(null);
    list(classId);
  }

  async function saveDraft() {
    if (article && !dirty) return article;
    const current = await request(article ? articlePath(classId, article.id) : classPath(classId), {
      method: article ? 'PUT' : 'POST',
      body: article ? { ...draft, version: article.version } : draft,
    });
    setArticle(current);
    setDraft({ title: current.title, body: current.body });
    return current;
  }

  function save(preview) {
    void run(async () => {
      await saveDraft();
      setNotice(preview ? '' : 'Brouillon enregistré.');
      setConfirmation(null);
      if (preview) {
        setView('preview');
        scrollToTop();
      }
    });
  }

  function upload(files) {
    void run(async () => {
      setNotice('');
      if (files.length + photos.length > maxPhotos) throw new RequestError(422);
      if (files.some((file) => file.size > maxPhotoBytes)) throw new RequestError(413);
      let current = await saveDraft();
      const endpoint = articlePath(classId, current.id) + '/photos';
      for (const [index, file] of files.entries()) {
        setNotice(`Envoi de la photo ${index + 1} sur ${files.length}…`);
        try {
          current = await request(endpoint + '?version=' + current.version, { method: 'POST', body: file, binary: true });
          setArticle(current);
        } catch (error) {
          setNotice(index ? `${index} ${index === 1 ? 'photo ajoutée' : 'photos ajoutées'}.` : '');
          throw error;
        }
      }
      setNotice(files.length === 1 ? 'Photo ajoutée au brouillon.' : `${files.length} photos ajoutées au brouillon.`);
    });
  }

  function changePhoto(id, action, options, onSuccess) {
    void run(async () => {
      const endpoint = articlePath(classId, article.id) + '/photos/' + encodeURIComponent(id) + action;
      const updated = await request(endpoint, { ...options, body: { ...options.body, version: article.version } });
      setArticle(updated);
      setNotice(action === '/masks' ? 'Photo masquée. Vérifiez-la avant de publier.' : 'Galerie mise à jour.');
      onSuccess();
    });
  }

  function loadAuthorizations() {
    void run(async () => {
      setStudents(null);
      const path = '/classes/' + encodeURIComponent(classId) + '/photo-authorizations';
      const result = await request(path);
      setStudents(result.students);
    });
  }

  function publish(published) {
    void run(async () => {
      const current = await request(articlePath(classId, article.id) + '/publication', {
        method: 'PUT', body: { published, version: article.version },
      });
      show(current);
      setNotice(published ? 'Article publié.' : 'Article retiré du fil des familles.');
    });
  }

  function remove() {
    void run(async () => {
      await request(articlePath(classId, article.id), { method: 'DELETE', body: { version: article.version } });
      setView('list');
      setArticle(null);
      setDraft(emptyDraft);
      setPhotoIndex(null);
      setStudents(null);
      setConfirmation(null);
      setPage(null);
      scrollToTop();
      await loadList(classId, filter);
      setNotice('Brouillon supprimé.');
    });
  }

  useEffect(() => {
    if (classId && !selected) {
      setClassId(null);
      setArticle(null);
      setPage(null);
      setDraft(emptyDraft);
      setConfirmation(null);
      setView('list');
    } else if (!classId && !busy && classes.length === 1) {
      list(classes[0].id);
    }
  }, [classId, classes, selected, busy]);

  const gallery = photos.length > 0 && <GalleryPreview article={article} articlePath={articlePath(classId, article.id)}
    role="teacher" request={request} onOpen={setPhotoIndex} busy={busy} />;

  return (
    <View style={blog.layout}>
      <Text accessibilityRole="header" style={styles.title}>Blog de classe</Text>
      {!classes.length && <Text style={styles.body}>Aucune classe ne vous est affectée.</Text>}
      {(!selected || view === 'list') && classes.length > 0 && <View style={styles.actions}>
        {classes.map(({ id, name }) => <Button key={id} label={name} icon="school-outline" selected={id === classId}
          secondary={id !== classId} onPress={() => list(id)} busy={busy} />)}
      </View>}
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text> : null}
      {busy && !page && view === 'list' && <Text style={styles.body}>Chargement des articles…</Text>}

      {selected && view === 'list' && <>
        <View style={styles.actions}>
          <Button label="Nouvel article" icon="create-outline" onPress={start} busy={busy} />
          <Button label="Actualiser" icon="refresh-outline" onPress={() => list(classId)} busy={busy} secondary />
        </View>
        <View style={styles.actions}>
          {statusOptions.map(({ id, label }) => <Button key={id} label={label} selected={id === filter}
            secondary={id !== filter} onPress={() => list(classId, id)} busy={busy} />)}
        </View>
        {page?.articles.length === 0 && <Text style={styles.body}>Aucun article dans cette liste.</Text>}
        {page?.articles.map((entry) => <ArticleRow key={entry.id} article={entry} onPress={() => open(entry.id)} busy={busy} staff />)}
        {page?.nextCursor && <Button label="Afficher la suite" onPress={() => list(classId, filter, page.nextCursor)} busy={busy} secondary />}
      </>}

      {selected && view !== 'list' && <>
        <View style={styles.actions}>
          <Button label="Retour au blog" icon="arrow-back-outline" onPress={backToList} busy={busy} secondary />
          {article && view !== 'preview' && <Button label="Recharger l’article" icon="refresh-outline"
            onPress={() => open(article.id)} busy={busy} secondary />}
        </View>
        {confirmation === 'leave' && <View style={blog.empty}>
          <Text style={styles.body}>Quitter l’article sans enregistrer les modifications ?</Text>
          <View style={styles.actions}>
            <Button label="Quitter sans enregistrer" onPress={backToList} busy={busy} />
            <Button label="Poursuivre la saisie" onPress={() => setConfirmation(null)} secondary busy={busy} />
          </View>
        </View>}
      </>}

      {selected && view === 'edit' && <>
        <Text accessibilityRole="header" style={blog.heading}>{article ? 'Modifier le brouillon' : 'Nouvel article'}</Text>
        <Field label="Titre" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })}
          maxLength={120} editable={!busy} />
        <Text accessibilityRole="header" style={blog.heading}>Photos</Text>
        <PhotoPicker onPick={upload} busy={busy || !valid || photos.length >= maxPhotos} />
        <Text style={styles.body}>JPEG, PNG ou WebP · 10 Mo par photo · {photos.length} sur {maxPhotos}</Text>
        {article && <DraftGallery photos={photos} articlePath={articlePath(classId, article.id)}
          request={request} onChange={changePhoto} onOpen={setPhotoIndex} busy={busy}
          students={students} onLoadAuthorizations={loadAuthorizations} />}
        {article && <BlogVideos article={article} subjectId={classId} role="teacher" request={request}
          onExpired={onExpired} onChange={async () => setArticle(await request(articlePath(classId, article.id)))} />}
        <Field label="Texte de l’article (facultatif)" value={draft.body} onChangeText={(body) => setDraft({ ...draft, body })}
          maxLength={8000} multiline editable={!busy} style={[styles.input, blog.editor]} />
        <View style={styles.actions}>
          <Button label="Enregistrer le brouillon" icon="save-outline" onPress={() => save(false)} busy={busy || !valid} secondary />
          <Button label="Prévisualiser" icon="eye-outline" onPress={() => save(true)} busy={busy || !valid} />
        </View>
        {article && (confirmation === 'delete' ? <View style={blog.empty}>
          <Text style={styles.body}>Supprimer définitivement ce brouillon ?</Text>
          <View style={styles.actions}>
            <Button label="Confirmer la suppression" onPress={remove} busy={busy} />
            <Button label="Annuler" onPress={() => setConfirmation(null)} busy={busy} secondary />
          </View>
        </View> : <View style={styles.actions}>
          <Button label="Supprimer le brouillon" icon="trash-outline" onPress={() => setConfirmation('delete')} busy={busy} secondary />
        </View>)}
      </>}

      {selected && view === 'preview' && article && <>
        <Text accessibilityRole="header" style={blog.heading}>Aperçu côté familles</Text>
        <ArticleContent article={article} gallery={gallery} />
        {article.videoCount > 0 && <BlogVideos article={article} subjectId={classId} role="teacher" request={request} onExpired={onExpired} readOnly />}
        {missingReview > 0 && <Text style={styles.body}>Revenez au brouillon pour vérifier les photos avant de publier.</Text>}
        {!article.body && !photos.length && !article.videoCount && <Text style={styles.body}>Ajoutez une photo, une vidéo ou un texte avant de publier.</Text>}
        <View style={styles.actions}>
          <Button label="Publier cet article" icon="paper-plane-outline" onPress={() => publish(true)} busy={busy || !canPublish} />
          <Button label="Revenir au brouillon" icon="create-outline" onPress={() => show(article)} busy={busy} secondary />
          {problem && <Button label="Recharger l’article" icon="refresh-outline" onPress={() => open(article.id)} busy={busy} secondary />}
        </View>
      </>}

      {selected && view === 'published' && article && <>
        <Text accessibilityRole="header" style={blog.heading}>Article publié</Text>
        {maskedPhotos > 0 && <Text style={styles.body}>{maskedPhotos === 1
          ? 'Une photo est masquée dans le fil des familles.'
          : `${maskedPhotos} photos sont masquées dans le fil des familles.`}</Text>}
        <ArticleContent article={article} gallery={gallery} />
        {article.videoCount > 0 && <BlogVideos article={article} subjectId={classId} role="teacher" request={request} onExpired={onExpired} readOnly />}
        {confirmation === 'withdraw' ? <View style={blog.empty}>
          <Text style={styles.body}>L’article sera retiré du fil des familles et reviendra en brouillon.</Text>
          <View style={styles.actions}>
            <Button label="Confirmer le retrait" onPress={() => publish(false)} busy={busy} />
            <Button label="Annuler" onPress={() => setConfirmation(null)} busy={busy} secondary />
          </View>
        </View> : <View style={styles.actions}>
          <Button label="Retirer de la publication" icon="eye-off-outline" onPress={() => setConfirmation('withdraw')} busy={busy} secondary />
        </View>}
      </>}
      {article && selected && <PhotoCarousel article={article} articlePath={articlePath(classId, article.id)} index={photoIndex}
        role="teacher" request={request} onChange={setPhotoIndex} onClose={() => setPhotoIndex(null)} />}
    </View>
  );
}
