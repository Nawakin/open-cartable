import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { ClassesForNextYear } from './classes';
import { Passages } from './passages';
import { BlogExport } from './blog-export';
import { Archive } from './archive';
import { ClosingYear } from './closing';
import { layout } from './ui';

const path = '/year-transition';
const emptyDraft = { revision: null, classes: [], sourceLevels: [], overrides: [], assignments: [], teacherAssignments: [] };
const uiYear = (year) => year + '–' + (year + 1);

export function YearTransition({ classes, request, onExpired, onApplied }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('classes');
  const [section, setSection] = useState('preparation');
  const [year, setYear] = useState('');
  const [editingYear, setEditingYear] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const plan = data?.plan;
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 9998;
  const preparing = section === 'preparation';

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

  async function apply(confirmation) {
    if (!await run(() => request(path + '/apply', { method: 'POST', body: { revision: plan.revision, confirmation } }))) return;
    setNotice('Nouvelle année ouverte.');
    setTab('classes');
    onApplied();
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Clôture d’année</Text>
    {busy && !data && <Text style={styles.body}>Chargement de la préparation…</Text>}
    {preparing && error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {preparing && error && <View style={styles.actions}><Button label="Actualiser" icon="refresh-outline" busy={busy} secondary onPress={load} /></View>}
    {preparing && notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
    {data && <>
      <View style={styles.actions}>
        <Button label="Préparation" icon="calendar-outline" selected={preparing} secondary={!preparing}
          busy={busy} onPress={() => setSection('preparation')} />
        <Button label="PDF du blog" icon="document-outline" selected={section === 'pdf'} secondary={section !== 'pdf'}
          busy={busy} onPress={() => setSection('pdf')} />
        <Button label="Archives" icon="archive-outline" selected={section === 'archive'} secondary={section !== 'archive'}
          busy={busy} onPress={() => setSection('archive')} />
      </View>
      {section === 'archive' ? <Archive request={request} onExpired={onExpired} />
        : section === 'pdf' ? <BlogExport classes={classes} startYear={plan?.startYear ?? data.suggestedStartYear}
          request={request} onExpired={onExpired} /> : (!plan || editingYear) ? <View style={layout.card}>
        <Field label="Année de début à clôturer" value={year} maxLength={4} keyboardType="number-pad" editable={!busy && !data.activeStartYear}
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
          {!data.activeStartYear && <Button label="Modifier" accessibilityLabel="Modifier les années" icon="create-outline"
            secondary busy={busy} onPress={() => setEditingYear(true)} />}
        </View>
        <View style={styles.actions}>
          <Button label="Classes" selected={tab === 'classes'} secondary={tab !== 'classes'}
            busy={busy} onPress={() => setTab('classes')} />
          <Button label="Passages" selected={tab === 'students'} secondary={tab !== 'students'}
            busy={busy} onPress={() => setTab('students')} />
          <Button label="Ouverture" selected={tab === 'closing'} secondary={tab !== 'closing'}
            busy={busy} onPress={() => setTab('closing')} />
        </View>
        {tab === 'classes' ? <ClassesForNextYear plan={plan} levels={data.levels} sources={data.sources}
          save={save} busy={busy} onReview={() => setTab('students')} />
          : tab === 'students' ? <Passages sources={data.sources} plan={plan} levels={data.levels} save={save} busy={busy} />
            : <ClosingYear plan={plan} teachers={data.teachers} summary={data.summary} save={save} apply={apply} busy={busy} />}
      </>}
    </>}
  </View>;
}
