import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from './ui';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
const parisDay = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Europe/Paris' });
const views = [{ id: 'day', label: 'Jour' }, { id: 'week', label: 'Semaine' }, { id: 'month', label: 'Mois' }];

function asDate(value) {
  return new Date(value + 'T00:00:00Z');
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = asDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDay(value);
}

export function dayInSchoolCalendar(now = new Date()) {
  return parisDay.format(now);
}

export function periodRange(anchor, view) {
  const date = asDate(anchor);
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const from = addDays(anchor, -((date.getUTCDay() + 6) % 7));
    return { from, to: addDays(from, 6) };
  }

  date.setUTCDate(1);
  const from = isoDay(date);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { from, to: isoDay(date) };
}

export function movePeriod(anchor, view, direction) {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  const month = asDate(periodRange(anchor, view).from);
  month.setUTCMonth(month.getUTCMonth() + direction);
  return isoDay(month);
}

function formatDate(value) {
  return dateFormat.format(asDate(value));
}

export function Homework({ notebook, onChange, onMore, onBack, onLogout, busy, error, onDocument }) {
  const [domainInput, setDomainInput] = useState(notebook.domain);
  const { child, anchor, view, domain, entries, nextCursor, entryKind } = notebook;
  const { from, to } = periodRange(anchor, view);
  const update = (changes) => onChange({ ...notebook, focusId: undefined, ...changes });
  const filter = () => update({ domain: domainInput.trim() });
  const clearFilter = () => {
    setDomainInput('');
    update({ domain: '' });
  };

  return (
    <View style={styles.panel}>
      <View style={styles.actions}>
        <Button label="Vos enfants" onPress={onBack} busy={busy} secondary />
        <Button label="Se déconnecter" onPress={onLogout} busy={busy} secondary />
      </View>
      <Text accessibilityRole="header" style={styles.title}>Cahier de texte</Text>
      <Text style={styles.body}>{child.displayName} · {child.className}</Text>
      <View style={styles.actions}>
        {[[undefined, 'Tout'], ['assignment', 'Devoirs'], ['notebook', 'Notes de classe']].map(([value, label]) =>
          <Button key={label} label={label} selected={entryKind === value} secondary={entryKind !== value} busy={busy}
            onPress={() => update({ entryKind: value })} />)}
      </View>
      <View style={styles.actions}>
        {views.map(({ id, label }) => (
          <Button key={id} label={label} onPress={() => update({ view: id })} busy={busy} secondary={view !== id} />
        ))}
      </View>
      <Text style={bookStyles.period}>{from === to ? formatDate(from) : `Du ${formatDate(from)} au ${formatDate(to)}`}</Text>
      <View style={styles.actions}>
        <Button label="Précédent" accessibilityLabel="Période précédente" onPress={() => update({ anchor: movePeriod(anchor, view, -1) })} busy={busy} secondary />
        <Button label="Aujourd’hui" onPress={() => update({ anchor: dayInSchoolCalendar() })} busy={busy} secondary />
        <Button label="Suivant" accessibilityLabel="Période suivante" onPress={() => update({ anchor: movePeriod(anchor, view, 1) })} busy={busy} secondary />
      </View>
      <Field
        label="Domaine"
        placeholder="Ex. Mathématiques"
        value={domainInput}
        onChangeText={setDomainInput}
        onSubmitEditing={filter}
        returnKeyType="search"
        maxLength={80}
        editable={!busy}
      />
      <View style={styles.actions}>
        <Button label="Filtrer" onPress={filter} busy={busy} secondary />
        {Boolean(domain || domainInput) && <Button label="Effacer le filtre" onPress={clearFilter} busy={busy} secondary />}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {Boolean(error) && <Button label="Réessayer" onPress={() => update({})} busy={busy} secondary />}
      {busy && entries.length === 0 && <Text accessibilityLiveRegion="polite" style={styles.body}>Chargement du cahier…</Text>}
      {!busy && !error && entries.length === 0 && <Text style={styles.body}>Aucune entrée pour cette période.</Text>}
      {entries.map((entry) => (
        <View key={entry.id} style={bookStyles.entry}>
          <Text style={bookStyles.metadata}>{entry.kind === 'assignment' ? 'À rendre le ' : ''}{formatDate(entry.date)} · {entry.domain}</Text>
          <Text accessibilityRole="header" style={bookStyles.title}>{entry.title}</Text>
          <Text style={styles.body}>{entry.description}</Text>
          {entry.hasDocument && <Button label="Télécharger le document" icon="download-outline"
            secondary busy={busy} onPress={() => onDocument(entry.id)} />}
        </View>
      ))}
      {nextCursor && <Button label="Afficher la suite" onPress={onMore} busy={busy} secondary />}
    </View>
  );
}

const bookStyles = StyleSheet.create({
  period: { color: '#17372d', fontSize: 17, fontWeight: '700' },
  entry: { backgroundColor: '#eef1e9', borderRadius: 12, padding: 16, gap: 6 },
  metadata: { color: '#39584a', fontSize: 14, fontWeight: '600' },
  title: { color: '#132d25', fontSize: 19, fontWeight: '700' },
});
