import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { dayInSchoolCalendar } from '../parent/homework';
import { Button, Field, styles } from '../parent/ui';
import { AgendaEvent, CalendarPeriod } from './agenda-view';
import { agendaRange, dateTimeFields, localInstant } from './dates';

const emptyPage = { events: [], nextCursor: null };
const blankEvent = () => {
  const today = dayInSchoolCalendar();
  return { title: '', location: '', description: '', startDate: today, startTime: '09:00', endDate: today, endTime: '10:00' };
};

function url(scope, privateMode) {
  return scope === 'school' ? '/agenda' : `/classes/${encodeURIComponent(scope)}/${privateMode ? 'appointments' : 'agenda'}`;
}

export function StaffAgenda({ classes, isTeacher, request, run, busy }) {
  const [scope, setScope] = useState(isTeacher ? null : 'school');
  const [privateMode, setPrivateMode] = useState(false);
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState(null);
  const [guardianReference, setGuardianReference] = useState('');
  const [anchor, setAnchor] = useState(dayInSchoolCalendar);
  const [view, setView] = useState('month');
  const [page, setPage] = useState(emptyPage);
  const [draft, setDraft] = useState(blankEvent);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');

  async function list(target, date, period, cursor, appointments = privateMode) {
    const search = new URLSearchParams(agendaRange(date, period));
    if (cursor) search.set('cursor', cursor);
    const result = await request(`${url(target, appointments)}?${search}`);
    setPage((before) => cursor ? ({
      events: Array.from(new Map([...before.events, ...result.events].map((event) => [event.id, event])).values()),
      nextCursor: result.nextCursor,
    }) : result);
  }

  useEffect(() => {
    if (!isTeacher) void run(() => list('school', anchor, view));
  }, []);

  useEffect(() => {
    if (scope && scope !== 'school' && !classes.some(({ id }) => id === scope)) {
      setScope(null);
      setPrivateMode(false);
      setStudents([]);
      setPage(emptyPage);
      resetEditor();
    }
  }, [classes, scope]);

  function resetEditor() {
    setDraft(blankEvent());
    setEditing(null);
    setRemoving(null);
    setProblem('');
    setStudentId(null);
    setGuardianReference('');
  }

  function select(target) {
    void run(async () => {
      setScope(target);
      setPrivateMode(false);
      setStudents([]);
      setPage(emptyPage);
      setMessage('');
      resetEditor();
      await list(target, anchor, view, undefined, false);
    });
  }

  async function loadStudents() {
    const result = await request(url(scope, true) + '/students');
    setStudents(result.students);
  }

  function switchMode(appointments) {
    void run(async () => {
      setPrivateMode(appointments);
      setPage(emptyPage);
      setMessage('');
      resetEditor();
      if (appointments) await loadStudents();
      else setStudents([]);
      await list(scope, anchor, view, undefined, appointments);
    });
  }

  function refresh() {
    void run(async () => {
      if (privateMode) await loadStudents();
      await list(scope, anchor, view);
    });
  }

  function changePeriod(date, period) {
    void run(async () => {
      setAnchor(date);
      setView(period);
      setRemoving(null);
      setMessage('');
      setPage(emptyPage);
      await list(scope, date, period);
    });
  }

  function edit(event) {
    const start = dateTimeFields(event.startsAt);
    const end = dateTimeFields(event.endsAt);
    setEditing(event);
    setRemoving(null);
    setMessage('');
    setProblem('');
    setDraft({
      title: event.title, location: event.location, description: event.description,
      startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time,
    });
  }

  function save() {
    void run(async () => {
      setMessage('');
      setProblem('');
      const startsAt = localInstant(draft.startDate, draft.startTime, editing?.startsAt);
      const endsAt = localInstant(draft.endDate, draft.endTime, editing?.endsAt);
      if (!startsAt || !endsAt || endsAt <= startsAt || !draft.title.trim()) {
        setProblem('Renseignez un titre, une date et une heure de fin postérieures au début.');
        return;
      }
      const event = { startsAt, endsAt, title: draft.title, location: draft.location, description: draft.description };
      const reference = guardianReference.trim().toLowerCase();
      if (privateMode && !editing && (!studentId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(reference))) {
        setProblem('Choisissez un élève et saisissez la référence exacte reçue du tuteur.');
        return;
      }
      const collection = url(scope, privateMode);
      const path = editing ? `${collection}/${editing.id}` : collection;
      await request(path, {
        method: editing ? 'PUT' : 'POST',
        body: privateMode && !editing ? { studentId, guardianReference: reference, event } : event,
      });
      setMessage(privateMode ? (editing ? 'Rendez-vous modifié.' : 'Rendez-vous créé.')
        : (editing ? 'Événement modifié.' : 'Événement publié.'));
      setAnchor(draft.startDate);
      resetEditor();
      await list(scope, draft.startDate, view);
    });
  }

  function remove(id) {
    void run(async () => {
      await request(`${url(scope, privateMode)}/${id}`, { method: 'DELETE' });
      if (editing?.id === id) resetEditor();
      setRemoving(null);
      setMessage(privateMode ? 'Rendez-vous retiré.' : 'Événement retiré.');
      setPage((before) => ({ ...before, events: before.events.filter((event) => event.id !== id) }));
      await list(scope, anchor, view);
    });
  }

  function field(key, label, props) {
    return <Field label={label} value={draft[key]} editable={!busy}
      onChangeText={(value) => setDraft((before) => ({ ...before, [key]: value }))} {...props} />;
  }

  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>Agenda</Text>
      <View style={styles.actions}>
        {!isTeacher && <Button label="École entière" secondary={scope !== 'school'} busy={busy} onPress={() => select('school')} />}
        {classes.map(({ id, name }) => (
          <Button key={id} label={name} secondary={scope !== id} busy={busy} onPress={() => select(id)} />
        ))}
      </View>
      {isTeacher && classes.length === 0 && <Text style={styles.body}>Aucune classe ne vous est affectée.</Text>}
      {scope && (
        <>
          {scope !== 'school' && (
            <View style={styles.actions}>
              <Button label="Événements de classe" secondary={privateMode} busy={busy} onPress={() => switchMode(false)} />
              <Button label="Rendez-vous individuels" secondary={!privateMode} busy={busy} onPress={() => switchMode(true)} />
            </View>
          )}
          <Text accessibilityRole="header" style={styles.label}>{privateMode
            ? (editing ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous individuel')
            : (editing ? 'Modifier l’événement' : 'Nouvel événement')}</Text>
          {privateMode && (editing ? (
            <Text style={styles.body}>{editing.studentName} · {editing.guardianReference}</Text>
          ) : (
            <>
              <Text style={styles.body}>Sélectionnez l’élève et saisissez la référence remise par le tuteur destinataire.</Text>
              {students.length === 0 && !busy && <Text style={styles.body}>Aucun élève de cette classe n’a de tuteur actif.</Text>}
              <View style={styles.actions}>
                {students.map(({ id, displayName }) => (
                  <Button key={id} label={displayName} secondary={studentId !== id} busy={busy} onPress={() => setStudentId(id)} />
                ))}
              </View>
              <Field label="Référence du tuteur destinataire" value={guardianReference} onChangeText={setGuardianReference}
                maxLength={36} autoCapitalize="none" editable={!busy} />
            </>
          ))}
          <Text style={styles.body}>Les horaires suivent le fuseau de votre appareil.</Text>
          {field('title', 'Titre de l’événement', { maxLength: 120 })}
          {field('startDate', 'Date de début', { placeholder: 'AAAA-MM-JJ', maxLength: 10 })}
          {field('startTime', 'Heure de début', { placeholder: 'HH:MM', maxLength: 5 })}
          {field('endDate', 'Date de fin', { placeholder: 'AAAA-MM-JJ', maxLength: 10 })}
          {field('endTime', 'Heure de fin', { placeholder: 'HH:MM', maxLength: 5 })}
          {field('location', 'Lieu', { maxLength: 160 })}
          {field('description', 'Description', { multiline: true, maxLength: 2500 })}
          {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
          {message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{message}</Text> : null}
          <View style={styles.actions}>
            <Button label={privateMode ? (editing ? 'Enregistrer le rendez-vous' : 'Créer le rendez-vous')
              : (editing ? 'Enregistrer l’événement' : 'Publier l’événement')} onPress={save} busy={busy} />
            {editing && <Button label="Annuler la modification" onPress={resetEditor} busy={busy} secondary />}
          </View>
          <CalendarPeriod anchor={anchor} view={view} busy={busy} onChange={changePeriod} />
          <Button label="Actualiser l’agenda" onPress={refresh} busy={busy} secondary />
          {!busy && page.events.length === 0 && <Text style={styles.body}>{privateMode ? 'Aucun rendez-vous pour cette période.' : 'Aucun événement pour cette période.'}</Text>}
          {page.events.map((event) => (
            <AgendaEvent key={event.id} event={event}>
              {privateMode && <Text style={styles.body}>{event.studentName} · {event.guardianReference}</Text>}
              <View style={styles.actions}>
                {removing === event.id ? (
                  <>
                    <Button label={privateMode ? 'Confirmer le retrait du rendez-vous' : 'Confirmer le retrait de l’événement'} busy={busy} onPress={() => remove(event.id)} />
                    <Button label="Annuler le retrait" onPress={() => setRemoving(null)} busy={busy} secondary />
                  </>
                ) : (
                  <>
                    <Button label="Modifier" accessibilityLabel={`Modifier ${event.title}`} busy={busy} onPress={() => edit(event)} secondary />
                    <Button label="Retirer" accessibilityLabel={`Retirer ${event.title}`} busy={busy} onPress={() => setRemoving(event.id)} secondary />
                  </>
                )}
              </View>
            </AgendaEvent>
          ))}
          {page.nextCursor && <Button label="Afficher la suite" onPress={() => void run(() => list(scope, anchor, view, page.nextCursor))} busy={busy} secondary />}
        </>
      )}
    </>
  );
}
