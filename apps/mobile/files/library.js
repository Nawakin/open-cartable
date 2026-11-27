import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { useAttendanceTask } from '../attendance/ui';
import { layout, Select } from '../year-transition/ui';
import { downloadDocument, encodedFile, FileButton } from './documents';
import { MediaPreview } from './media-preview';

const formats = { pdf: 'PDF', image: 'Image', video: 'Vidéo', audio: 'Audio' };
const accepts = 'application/pdf,image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,.mp3,.wav';
const empty = { title: '', folder: '', permitted: false, file: null };

function kindOf(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(mp3|wav)$/i.test(file.name)) return 'audio';
  return 'pdf';
}

function MediaCard({ entry, path, role, request, remove, task, onExpired }) {
  const [open, setOpen] = useState(false);
  const url = path + '/' + encodeURIComponent(entry.id);
  const media = entry.kind === 'video' || entry.kind === 'audio';
  const src = '/api/v1/' + role + url;
  const isWeb = Platform.OS === 'web';
  return <View style={layout.card}>
    <Text style={styles.label}>{entry.title}</Text>
    <Text style={layout.status}>{formats[entry.kind]}{entry.folder ? ' · ' + entry.folder : ''}</Text>
    {open && <MediaPreview entry={entry} source={src} path={url} request={request} onExpired={onExpired} />}
    <View style={styles.actions}>
      {(isWeb || entry.kind !== 'pdf') && <Button label={open ? 'Fermer l’aperçu' : media ? 'Lire' : 'Ouvrir'}
        icon={media ? 'play-outline' : 'eye-outline'} busy={task.busy} secondary onPress={() => setOpen(!open)} />}
      <Button label={isWeb ? 'Télécharger' : 'Ouvrir ou enregistrer'} icon="download-outline" busy={task.busy} secondary onPress={() =>
        void task.run(async () => downloadDocument(await request(url + '?download=1', { responseType: 'attachment' }), 'ressource-classe'))} />
      {remove && <Button label="Retirer" accessibilityLabel={'Retirer ' + entry.title} busy={task.busy} secondary onPress={() => remove(entry.id)} />}
    </View>
  </View>;
}

function Contents({ path, role, request, onExpired, archive, article, onChange }) {
  const [page, setPage] = useState(null);
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [folder, setFolder] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [deleting, setDeleting] = useState(null);
  const task = useAttendanceTask(onExpired);
  const canManage = role !== 'parent' && !archive && (!article || !article.publishedAt);
  const filter = article ? { articleId: article.id } : { folder, search: appliedSearch };

  async function load(cursor, changes = {}) {
    const query = { ...filter, ...changes };
    const result = await request(path + '?' + new URLSearchParams(cursor ? { ...query, cursor } : query));
    setPage((current) => cursor ? { ...result, items: [...current.items, ...result.items] } : result);
  }
  useEffect(() => { void task.run(() => load()); }, [path, article?.id]);

  function save() {
    void task.run(async () => {
      const kind = kindOf(draft.file);
      const result = await request(path, { method: 'POST', timeoutMs: 65_000, body: {
        title: draft.title, folder: draft.folder, kind, permitted: draft.permitted,
        content: await encodedFile(draft.file, kind === 'audio' || kind === 'video' ? 24 * 1024 * 1024 : undefined),
        ...(article ? { articleId: article.id, version: article.version } : {}),
      } });
      setDraft(empty);
      setEditing(false);
      await load();
      await onChange?.(result);
    });
  }

  function remove(id) {
    if (deleting !== id) { setDeleting(id); return; }
    void task.run(async () => {
      const result = await request(path + '/' + encodeURIComponent(id) + (article ? '?version=' + article.version : ''),
        { method: 'DELETE' });
      setDeleting(null);
      await load();
      await onChange?.(result);
    });
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={layout.heading}>{article ? 'Vidéos' : 'Ressources de la classe'}</Text>
    {task.error && <Text accessibilityRole="alert" style={styles.error}>{task.error}</Text>}
    {task.error && <Button label="Actualiser" secondary busy={task.busy} onPress={() => void task.run(() => load())} />}
    {!article && page && <>
      {!!page.folders.length && <Select label="Dossier" value={folder} disabled={task.busy}
        choices={[{ value: '', label: 'Tous les dossiers' }, ...page.folders.map((name) => ({ value: name, label: name }))]}
        onChange={(value) => void task.run(async () => { await load(null, { folder: value }); setFolder(value); })} />}
      <Field label="Rechercher par titre" value={search} onChangeText={setSearch} maxLength={120} editable={!task.busy}
        onSubmitEditing={() => void task.run(async () => { await load(null, { search }); setAppliedSearch(search); })} />
      <View style={styles.actions}><Button label="Rechercher" icon="search-outline" secondary busy={task.busy}
        onPress={() => void task.run(async () => { await load(null, { search }); setAppliedSearch(search); })} /></View>
    </>}
    {page && !page.items.length && <Text style={styles.body}>{article ? 'Aucune vidéo.' : 'Aucune ressource dans cette sélection.'}</Text>}
    {page?.items.map((entry) => <View key={entry.id} style={layout.group}>
      <MediaCard entry={entry} path={path} role={role} request={request} remove={canManage ? remove : undefined} task={task} onExpired={onExpired} />
      {deleting === entry.id && <View style={styles.actions}>
        <Button label="Confirmer le retrait" busy={task.busy} onPress={() => remove(entry.id)} />
        <Button label="Annuler" secondary busy={task.busy} onPress={() => setDeleting(null)} />
      </View>}
    </View>)}
    {page?.nextCursor && <Button label="Afficher la suite" secondary busy={task.busy} onPress={() => void task.run(() => load(page.nextCursor))} />}
    {canManage && Platform.OS === 'web' && (editing ? <View style={layout.card}>
      <Field label="Titre de la ressource" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} maxLength={120} />
      {!article && <Field label="Dossier ou matière" value={draft.folder} onChangeText={(value) => setDraft({ ...draft, folder: value })} maxLength={80} />}
      <FileButton label="Choisir le fichier" busy={task.busy} accept={article ? 'video/mp4,video/webm,.mp4,.webm' : accepts}
        onFile={(file) => setDraft({ ...draft, file, permitted: false, title: draft.title || file.name.slice(0, 120) })} />
      {draft.file && <Text style={styles.body}>{draft.file.name}</Text>}
      <Text style={styles.body}>Photos et PDF jusqu’à 5 Mo. Vidéos et audios jusqu’à 24 Mo, exportés sur deux minutes maximum.</Text>
      <Button label={draft.file && kindOf(draft.file) !== 'pdf'
        ? 'Je confirme qu’aucun élève n’est identifiable' : 'Confirmer le partage avec cette classe'}
        selected={draft.permitted} secondary={!draft.permitted} busy={task.busy}
        onPress={() => setDraft({ ...draft, permitted: !draft.permitted })} />
      <View style={styles.actions}>
        <Button label={article ? 'Ajouter au brouillon' : 'Publier la ressource'} busy={task.busy || !draft.file || !draft.title.trim() || !draft.permitted}
          onPress={save} />
        <Button label="Annuler" secondary busy={task.busy} onPress={() => { setEditing(false); setDraft(empty); }} />
      </View>
    </View> : <View style={styles.actions}><Button label={article ? 'Ajouter une vidéo' : 'Ajouter une ressource'}
      icon="add-outline" secondary busy={task.busy} onPress={() => setEditing(true)} /></View>)}
  </View>;
}

export function StaffLibrary({ classes, request, onExpired, role, archive = false }) {
  const [classId, setClassId] = useState(classes.length === 1 ? classes[0].id : '');
  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Médiathèque</Text>
    {classes.length > 1 && <Select label="Classe" value={classId} onChange={setClassId}
      choices={[{ value: '', label: 'Choisir une classe' }, ...classes.map(({ id, name }) => ({ value: id, label: name }))]} />}
    {classes.length === 0 && <Text style={styles.body}>Aucune classe disponible.</Text>}
    {classId && <Contents key={classId} path={'/classes/' + encodeURIComponent(classId) + '/library'}
      request={request} onExpired={onExpired} role={role} archive={archive} />}
  </View>;
}

export function ParentLibrary({ child, request, onExpired, onBack }) {
  return <View style={styles.panel}>
    <View style={styles.actions}><Button label="Retour" icon="arrow-back-outline" secondary onPress={onBack} /></View>
    <Text accessibilityRole="header" style={styles.title}>Médiathèque</Text>
    <Text style={styles.body}>{child.displayName}</Text>
    <Contents path={'/children/' + encodeURIComponent(child.id) + '/library'} request={request} onExpired={onExpired} role="parent" />
  </View>;
}

export function BlogVideos({ article, subjectId, role, request, onExpired, onChange, readOnly = false }) {
  const endpoint = (role === 'parent' ? '/children/' : '/classes/') + encodeURIComponent(subjectId) + '/library';
  return <Contents path={endpoint} article={article} role={role} request={request}
    onExpired={onExpired} onChange={onChange} archive={readOnly} />;
}
