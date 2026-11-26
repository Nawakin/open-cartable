import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout, Select } from './ui';

const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });

function monthChoices(year) {
  return [
    { value: '', label: 'Année scolaire entière' },
    ...Array.from({ length: 12 }, (_, index) => {
      const month = new Date(Date.UTC(Number(year), 8 + index, 1));
      return { value: month.toISOString().slice(0, 7), label: monthLabel.format(month) };
    }),
  ];
}

function downloadFile(file, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(file);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

function failureMessage(status) {
  switch (status) {
    case 404: return 'Cette classe n’est plus accessible.';
    case 409: return 'Le contenu a changé ou un export est en cours. Affichez de nouveau l’aperçu puis réessayez.';
    case 413: return 'Cette période est trop volumineuse. Choisissez un mois pour générer un fichier plus léger.';
    case 422: return 'Aucun article exportable sur cette période. Affichez de nouveau l’aperçu.';
    case 429: return 'Trop de demandes. Réessayez dans une minute.';
    case 503: return 'Le serveur ne peut pas charger les photos.';
    default: return 'Le serveur n’a pas pu préparer l’export. Réessayez dans un instant.';
  }
}

function countLabel(count, name) {
  return count + ' ' + name + (count === 1 ? '' : 's');
}

export function BlogExport({ classes, startYear, request, onExpired }) {
  const [classId, setClassId] = useState(classes.length === 1 ? classes[0].id : '');
  const [year, setYear] = useState(String(startYear));
  const [month, setMonth] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 9998;
  const path = '/classes/' + encodeURIComponent(classId) + '/blog-export';
  const query = new URLSearchParams(month ? { year, month } : { year }).toString();

  function clear() {
    setPreview(null);
    setNotice('');
    setError('');
  }

  async function run(step, operation) {
    if (pending.current) return;
    pending.current = true;
    setBusy(step);
    setNotice('');
    setError('');
    try {
      await operation();
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else setError(failureMessage(failure.status));
      if ([404, 409, 413, 422].includes(failure.status)) setPreview(null);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  function showPreview() {
    void run('preview', async () => {
      setPreview(null);
      setPreview(await request(path + '?' + query));
    });
  }

  function download() {
    void run('pdf', async () => {
      const file = await request(path + '/pdf?' + query, { method: 'POST', responseType: 'pdf' });
      downloadFile(file, 'blog-' + (month || year + '-' + (Number(year) + 1)) + '.pdf');
      setNotice('Téléchargement du PDF lancé.');
    });
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={layout.heading}>Exporter le blog en PDF</Text>
    {classes.length === 0 && <Text style={styles.body}>Aucune classe disponible pour l’export.</Text>}
    {classes.length > 0 && <>
      {classes.length === 1 ? <Text style={styles.label}>{classes[0].name}</Text> : <Select label="Classe à exporter"
        value={classId} disabled={Boolean(busy)} choices={[
          { value: '', label: 'Choisir une classe' }, ...classes.map(({ id, name }) => ({ value: id, label: name })),
        ]} onChange={(value) => { setClassId(value); clear(); }} />}
      <Field label="Année de début de la période" value={year} maxLength={4} keyboardType="number-pad" editable={!busy}
        onChangeText={(value) => { setYear(value); setMonth(''); clear(); }} />
      {validYear && <Select label="Période" value={month} choices={monthChoices(year)} disabled={Boolean(busy)}
        onChange={(value) => { setMonth(value); clear(); }} />}
      <View style={styles.actions}>
        <Button label="Afficher l’aperçu" icon="eye-outline" secondary={Boolean(preview) && !preview.tooLarge}
          busy={Boolean(busy) || !classId || !validYear} onPress={showPreview} />
      </View>
    </>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>{busy === 'pdf' ? 'Génération du PDF…' : 'Chargement de l’aperçu…'}</Text>}
    {notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
    {preview && <View style={layout.card}>
      <Text accessibilityRole="header" style={layout.heading}>Aperçu de l’export</Text>
      {!preview.articleCount ? <Text style={styles.body}>Aucun article exportable sur cette période.</Text> : <>
        <Text style={styles.label}>{countLabel(preview.articleCount, 'article')}
          {preview.photoCount !== null && ' · ' + countLabel(preview.photoCount, 'photo')}</Text>
        {preview.tooLarge && <Text style={styles.body}>{failureMessage(413)}</Text>}
        {preview.articles.map(({ id, title, publishedAt, photoCount }) => <View key={id} style={layout.details}>
          <Text style={styles.label}>{title}</Text>
          <Text style={layout.status}>{dateLabel.format(new Date(publishedAt))} · {countLabel(photoCount, 'photo')}</Text>
        </View>)}
        {preview.articleCount > preview.articles.length && <Text style={layout.status}>
          {countLabel(preview.articleCount - preview.articles.length, 'article')} dans la suite de la période
        </Text>}
        {!preview.tooLarge && <View style={styles.actions}>
          <Button label="Télécharger le PDF" icon="download-outline" busy={Boolean(busy)} onPress={download} />
        </View>}
      </>}
    </View>}
  </View>;
}
