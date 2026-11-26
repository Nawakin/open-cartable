import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { ClassesForNextYear } from './classes';
import { Passages } from './passages';
import { BlogExport } from './blog-export';
import { layout } from './ui';

const path = '/year-transition';
const emptyDraft = { revision: null, classes: [], sourceLevels: [], overrides: [], assignments: [] };
const uiYear = (year) => year + '–' + (year + 1);

export function YearTransition({ classes, request, onExpired }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('classes');
  const [exporting, setExporting] = useState(false);
  const [year, setYear] = useState('');
  const [editingYear, setEditingYear] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const plan = data?.plan;
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 9998;

  async function run(operation) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      setData(result);
      setYear(String(result.plan?.startYear ?? result.suggestedStartYear));
      return true;
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else if (failure.status === 409) setError('Le brouillon ou les effectifs ont changé. Actualisez pour reprendre la vérification.');
      else if (failure.status === 400) setError('Vérifiez les années, les niveaux et les noms des classes. Chaque classe de rentrée doit avoir un nom distinct.');
      else setError('Le brouillon est indisponible. Réessayez dans un instant.');
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function load() {
    void run(() => request(path));
  }

  useEffect(load, []);

  async function save(changed) {
    if (!await run(() => request(path, { method: 'PUT', body: { ...(plan ?? emptyDraft), ...changed } }))) return false;
    setNotice('Brouillon enregistré.');
    return true;
  }

  async function saveYears() {
    if (await save({ startYear: Number(year) })) setEditingYear(false);
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Clôture d’année</Text>
    {busy && !data && <Text style={styles.body}>Chargement de la préparation…</Text>}
    {!exporting && error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!exporting && error && <View style={styles.actions}><Button label="Actualiser" icon="refresh-outline" busy={busy} secondary onPress={load} /></View>}
    {!exporting && notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
    {data && <>
      <View style={styles.actions}>
        <Button label="Préparation" icon="calendar-outline" selected={!exporting} secondary={exporting}
          busy={busy} onPress={() => setExporting(false)} />
        <Button label="PDF du blog" icon="document-outline" selected={exporting} secondary={!exporting}
          busy={busy} onPress={() => setExporting(true)} />
      </View>
      {exporting ? <BlogExport classes={classes} startYear={plan?.startYear ?? data.suggestedStartYear}
        request={request} onExpired={onExpired} /> : (!plan || editingYear) ? <View style={layout.card}>
        <Field label="Année de début à clôturer" value={year} maxLength={4} keyboardType="number-pad" editable={!busy}
          onChangeText={setYear} />
        {validYear && <Text style={styles.body}>Année à clôturer {uiYear(Number(year))} · Rentrée {uiYear(Number(year) + 1)}</Text>}
        <View style={styles.actions}>
          <Button label={plan ? 'Enregistrer les années' : 'Préparer la rentrée'} icon="calendar-outline"
            busy={busy || !validYear} onPress={() => void saveYears()} />
          {plan && <Button label="Annuler" secondary busy={busy} onPress={() => {
            setYear(String(plan.startYear)); setEditingYear(false);
          }} />}
        </View>
      </View> : <>
        <View style={[layout.card, layout.cardHeader]}>
          <View style={layout.details}>
            <Text style={styles.label}>Préparation {uiYear(plan.startYear + 1)}</Text>
            <Text style={styles.body}>Année à clôturer {uiYear(plan.startYear)} · Brouillon</Text>
          </View>
          <Button label="Modifier" accessibilityLabel="Modifier les années" icon="create-outline"
            secondary busy={busy} onPress={() => setEditingYear(true)} />
        </View>
        <View style={styles.actions}>
          <Button label="Classes" selected={tab === 'classes'} secondary={tab !== 'classes'}
            busy={busy} onPress={() => setTab('classes')} />
          <Button label="Passages" selected={tab === 'students'} secondary={tab !== 'students'}
            busy={busy} onPress={() => setTab('students')} />
        </View>
        {tab === 'classes' ? <ClassesForNextYear plan={plan} levels={data.levels} sources={data.sources}
          save={save} busy={busy} onReview={() => setTab('students')} />
          : <Passages sources={data.sources} plan={plan} levels={data.levels} save={save} busy={busy} />}
      </>}
    </>}
  </View>;
}
