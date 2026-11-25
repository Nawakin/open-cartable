import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dayInSchoolCalendar, movePeriod, periodRange } from '../parent/homework';
import { Button, Field, styles } from '../parent/ui';
import { classPath, directionRequest } from './api';

const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const emptyPage = { entries: [], nextCursor: null };
const blankEntry = () => ({ date: dayInSchoolCalendar(), title: '', domain: '', description: '' });

function message(error) {
  switch (error.status) {
    case 0: return 'Le serveur est inaccessible. Réessayez dans un instant.';
    case 400: return 'Vérifiez la date et le contenu des champs.';
    case 401: return 'Le code école ou le mot de passe est incorrect.';
    case 404: return 'La classe ou l’entrée n’est plus accessible.';
    case 429: return 'Trop de tentatives. Réessayez dans une minute.';
    default: return 'L’opération n’a pas abouti. Réessayez dans un instant.';
  }
}

export function Direction({ onParent }) {
  const [phase, setPhase] = useState('loading');
  const [desk, setDesk] = useState(null);
  const [school, setSchool] = useState('');
  const [password, setPassword] = useState('');
  const [classId, setClassId] = useState(null);
  const [month, setMonth] = useState(dayInSchoolCalendar);
  const [page, setPage] = useState(emptyPage);
  const [draft, setDraft] = useState(blankEntry);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const inProgress = useRef(false);

  function resetDesk() {
    setDesk(null);
    setClassId(null);
    setPage(emptyPage);
    setEditing(null);
    setRemoving(null);
    setDraft(blankEntry());
    setPassword('');
    setPhase('login');
  }

  async function run(operation) {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    setProblem('');
    setNotice('');
    try {
      await operation();
    } catch (error) {
      if (error.status === 401 && phase === 'desk') {
        resetDesk();
        setProblem('Votre session a expiré. Reconnectez-vous.');
      } else {
        setProblem(message(error));
      }
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  async function restore() {
    try {
      setDesk(await directionRequest('/classes'));
      setPhase('desk');
    } catch (error) {
      if (error.status === 401) {
        resetDesk();
        return;
      }
      setPhase('unavailable');
      throw error;
    }
  }

  useEffect(() => {
    void run(restore);
  }, []);

  function login() {
    void run(async () => {
      const schoolCode = school.trim().toUpperCase();
      const length = [...password].length;
      if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode) || !password.trim() || length < 15 || length > 128) {
        setProblem('Renseignez le code de l’école et le mot de passe direction.');
        return;
      }
      await directionRequest('/auth/login', { method: 'POST', body: { schoolCode, password } });
      setPassword('');
      await restore();
    });
  }

  async function list(id, anchor, cursor) {
    const search = new URLSearchParams(periodRange(anchor, 'month'));
    if (cursor) search.set('cursor', cursor);
    const result = await directionRequest(`${classPath(id)}?${search}`);
    if (!cursor) {
      setPage(result);
      return;
    }
    setPage((before) => ({
      entries: Array.from(new Map([...before.entries, ...result.entries].map((entry) => [entry.id, entry])).values()),
      nextCursor: result.nextCursor,
    }));
  }

  function choose(id) {
    void run(async () => {
      setClassId(id);
      setEditing(null);
      setRemoving(null);
      setDraft(blankEntry());
      setPage(emptyPage);
      await list(id, month);
    });
  }

  function shift(offset) {
    void run(async () => {
      const target = movePeriod(month, 'month', offset);
      setMonth(target);
      setPage(emptyPage);
      setRemoving(null);
      await list(classId, target);
    });
  }

  function edit(entry) {
    const { id, date, title, domain, description } = entry;
    setEditing(id);
    setRemoving(null);
    setDraft({ date, title, domain, description });
  }

  function save() {
    void run(async () => {
      const target = editing ? `${classPath(classId)}/${editing}` : classPath(classId);
      await directionRequest(target, { method: editing ? 'PUT' : 'POST', body: draft });
      const savedDate = draft.date;
      setMonth(savedDate);
      setNotice(editing ? 'Modification enregistrée.' : 'Entrée publiée.');
      setEditing(null);
      setDraft(blankEntry());
      setRemoving(null);
      setPage(emptyPage);
      await list(classId, savedDate);
    });
  }

  function remove(entryId) {
    void run(async () => {
      await directionRequest(`${classPath(classId)}/${entryId}`, { method: 'DELETE' });
      setRemoving(null);
      if (editing === entryId) {
        setEditing(null);
        setDraft(blankEntry());
      }
      setPage((before) => ({ ...before, entries: before.entries.filter(({ id }) => id !== entryId) }));
      setNotice('Entrée retirée.');
      await list(classId, month);
    });
  }

  function logout() {
    void run(async () => {
      await directionRequest('/auth/logout', { method: 'POST' });
      resetDesk();
    });
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Espace direction</Text>
      <View style={styles.actions}>
        <Button label="Espace parent" onPress={onParent} busy={busy} secondary />
        {phase === 'desk' && <Button label="Se déconnecter" onPress={logout} busy={busy} secondary />}
      </View>
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
      {phase === 'loading' && <Text style={styles.body}>Chargement de l’espace direction…</Text>}
      {phase === 'unavailable' && <Button label="Réessayer" onPress={() => void run(restore)} busy={busy} />}
      {phase === 'login' && (
        <>
          <Field label="Code de l’école" value={school} onChangeText={setSchool}
            autoCapitalize="characters" maxLength={32} editable={!busy} />
          <Field label="Mot de passe direction" value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete="current-password"
            maxLength={256} editable={!busy} onSubmitEditing={login} />
          <Button label="Se connecter à la direction" onPress={login} busy={busy} />
        </>
      )}
      {phase === 'desk' && (
        <>
          <Text style={directionStyles.heading}>{desk.schoolName}</Text>
          {desk.classes.length === 0 && <Text style={styles.body}>Aucune classe n’est configurée.</Text>}
          {desk.classes.length > 0 && <Text style={styles.label}>Classe</Text>}
          <View style={styles.actions}>
            {desk.classes.map(({ id, name }) => (
              <Button key={id} label={name} busy={busy} secondary={id !== classId} onPress={() => choose(id)} />
            ))}
          </View>
          {classId && (
            <>
              <Text accessibilityRole="header" style={directionStyles.heading}>{editing ? 'Modifier l’entrée' : 'Publier une entrée'}</Text>
              <Field label="Date" value={draft.date} onChangeText={(date) => setDraft({ ...draft, date })} placeholder="AAAA-MM-JJ" maxLength={10} editable={!busy} />
              <Field label="Titre" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} maxLength={120} editable={!busy} />
              <Field label="Domaine" value={draft.domain} onChangeText={(domain) => setDraft({ ...draft, domain })} maxLength={80} editable={!busy} />
              <Field label="Description" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })}
                maxLength={2500} multiline style={[styles.input, directionStyles.description]} editable={!busy} />
              <View style={styles.actions}>
                <Button label={editing ? 'Enregistrer' : 'Publier'} onPress={save} busy={busy} />
                {editing && <Button label="Annuler la modification" onPress={() => { setEditing(null); setDraft(blankEntry()); }} busy={busy} secondary />}
              </View>

              <Text accessibilityRole="header" style={directionStyles.heading}>Publications · {monthLabel.format(new Date(month + 'T00:00:00Z'))}</Text>
              <View style={styles.actions}>
                <Button label="Mois précédent" onPress={() => shift(-1)} busy={busy} secondary />
                <Button label="Mois suivant" onPress={() => shift(1)} busy={busy} secondary />
                <Button label="Actualiser" onPress={() => void run(() => list(classId, month))} busy={busy} secondary />
              </View>
              {!busy && page.entries.length === 0 && <Text style={styles.body}>Aucune publication pour ce mois.</Text>}
              {page.entries.map((entry) => (
                <View key={entry.id} style={directionStyles.entry}>
                  <Text style={styles.body}>{entry.date} · {entry.domain}</Text>
                  <Text accessibilityRole="header" style={directionStyles.heading}>{entry.title}</Text>
                  <Text style={styles.body}>{entry.description}</Text>
                  <View style={styles.actions}>
                    {removing === entry.id ? (
                      <>
                        <Button label="Confirmer le retrait" busy={busy} onPress={() => remove(entry.id)} />
                        <Button label="Annuler le retrait" onPress={() => setRemoving(null)} busy={busy} secondary />
                      </>
                    ) : (
                      <>
                        <Button label="Modifier" accessibilityLabel={`Modifier ${entry.title}`} busy={busy} onPress={() => edit(entry)} secondary />
                        <Button label="Retirer" accessibilityLabel={`Retirer ${entry.title}`} busy={busy} onPress={() => setRemoving(entry.id)} secondary />
                      </>
                    )}
                  </View>
                </View>
              ))}
              {page.nextCursor && <Button label="Afficher la suite" onPress={() => void run(() => list(classId, month, page.nextCursor))} busy={busy} secondary />}
            </>
          )}
        </>
      )}
    </View>
  );
}

const directionStyles = StyleSheet.create({
  heading: { color: '#132d25', fontSize: 19, fontWeight: '700' },
  description: { minHeight: 110, textAlignVertical: 'top' },
  entry: { padding: 16, borderRadius: 12, backgroundColor: '#eef1e9', gap: 8 },
});
