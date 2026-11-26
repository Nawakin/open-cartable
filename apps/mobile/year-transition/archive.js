import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';
import { BlogExport } from './blog-export';
import { BlogVideos, StaffLibrary } from '../files/library';
import { downloadDocument } from '../files/documents';
import { layout, Select } from './ui';

const kinds = [
  { value: 'homework', label: 'Cahier de texte' }, { value: 'liaison', label: 'Cahier de liaison' },
  { value: 'agenda', label: 'Agenda de classe' }, { value: 'blog', label: 'Blog' },
  { value: 'library', label: 'Médiathèque' },
];
const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });

export function Archive({ request, onExpired }) {
  const [classes, setClasses] = useState(null);
  const [classId, setClassId] = useState('');
  const [kind, setKind] = useState('homework');
  const [page, setPage] = useState(null);
  const [pdf, setPdf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const classroom = classes?.find(({ id }) => id === classId);

  async function run(operation) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else setError('Impossible de charger les archives. Réessayez dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  function loadClasses() {
    void run(async () => {
      const result = await request('/school-archives');
      setClasses(result.classes);
      if (result.classes.length === 1) setClassId(result.classes[0].id);
    });
  }

  function load(offset) {
    void run(async () => {
      const result = await request('/school-archives/' + encodeURIComponent(classId)
        + '?' + new URLSearchParams({ kind, offset: String(offset ?? 0) }));
      setPage((current) => offset ? { ...result, entries: [...current.entries, ...result.entries] } : result);
    });
  }

  useEffect(loadClasses, []);
  useEffect(() => {
    setPage(null);
    if (classId && !pdf && kind !== 'library') load();
  }, [classId, kind, pdf]);

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={layout.heading}>Archives de classe</Text>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {error && <Button label="Réessayer" secondary busy={busy} onPress={classId && kind !== 'library' ? () => load() : loadClasses} />}
    {classes && !classes.length && <Text style={styles.body}>Aucune année archivée pour cette école.</Text>}
    {classes?.length > 0 && <Select label="Classe archivée" value={classId} disabled={busy}
      onChange={(value) => { setClassId(value); setPdf(false); }}
      choices={[{ value: '', label: 'Choisir une classe' }, ...classes.map(({ id, name, year }) => ({
        value: id, label: year + '–' + (year + 1) + ' · ' + name,
      }))]} />}
    {classroom && (pdf ? <>
      <View style={styles.actions}><Button label="Revenir aux archives" secondary onPress={() => setPdf(false)} /></View>
      <BlogExport classes={[classroom]} startYear={classroom.year} request={request} onExpired={onExpired} />
    </> : <>
      <Select label="Contenu archivé" value={kind} choices={kinds} disabled={busy} onChange={setKind} />
      {kind === 'library' && <StaffLibrary key={classId} role="direction" archive classes={[classroom]}
        request={request} onExpired={onExpired} />}
      {kind === 'blog' && <View style={styles.actions}>
        <Button label="Exporter le blog archivé" icon="download-outline" secondary busy={busy} onPress={() => setPdf(true)} />
      </View>}
      {page && !page.entries.length && <Text style={styles.body}>Aucun contenu dans cette rubrique.</Text>}
      {page?.entries.map(({ id, title, body, date, hasDocument, videoCount }) => <View key={id} style={layout.card}>
        <Text style={styles.label}>{title}</Text>
        <Text style={layout.status}>{dateLabel.format(new Date(date))}</Text>
        {body ? <Text style={styles.body} selectable>{body}</Text> : null}
        {videoCount > 0 && <BlogVideos article={{ id }} subjectId={classId} role="direction" request={request} onExpired={onExpired} readOnly />}
        {hasDocument && <Button label="Télécharger le document" secondary busy={busy} onPress={() => void run(async () => {
          const path = '/classes/' + encodeURIComponent(classId) + '/homework/' + encodeURIComponent(id) + '/document';
          downloadDocument(await request(path, { responseType: 'attachment' }), 'document-cahier-de-texte');
        })} />}
      </View>)}
      {page?.nextOffset !== null && page?.nextOffset !== undefined && <Button label="Afficher la suite"
        secondary busy={busy} onPress={() => load(page.nextOffset)} />}
    </>)}
  </View>;
}
