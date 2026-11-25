import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { NoteCard, formatLiaisonDay, liaisonStyles, useLiaisonTask } from './ui';

function classPath(id) {
  return '/classes/' + encodeURIComponent(id) + '/liaison';
}

export function StaffLiaison({ classes, request, onReply, onExpired }) {
  const [classId, setClassId] = useState(null);
  const [page, setPage] = useState(null);
  const [draft, setDraft] = useState('');
  const [details, setDetails] = useState(null);
  const [notice, setNotice] = useState('');
  const { busy, problem, run } = useLiaisonTask(onExpired);
  const selectedClass = classes.find(({ id }) => id === classId);
  const dailyNote = page?.notes.find((note) => note.day === page.today);

  function load(id, before) {
    void run(async () => {
      setNotice('');
      if (!before) {
        setClassId(id);
        setPage(null);
        setDetails(null);
      }
      const result = await request(classPath(id) + (before ? '?before=' + encodeURIComponent(before) : ''));
      setPage((current) => before
        ? { ...current, nextCursor: result.nextCursor, notes: [...current.notes, ...result.notes] }
        : result);
      if (!before) setDraft(result.notes.find((note) => note.day === result.today)?.body ?? '');
    });
  }

  function publish() {
    void run(async () => {
      const note = await request(classPath(classId) + '/today', {
        method: 'PUT', body: { day: page.today, body: draft },
      });
      setPage((current) => ({ ...current, notes: [note, ...current.notes.filter(({ id }) => id !== note.id)] }));
      setDraft(note.body);
      setNotice('Mot du jour enregistré.');
    });
  }

  function loadReplies(note, after) {
    void run(async () => {
      setNotice('');
      if (!after) setDetails({ note, replies: null, nextCursor: null });
      const path = classPath(classId) + '/' + encodeURIComponent(note.id) + '/replies';
      const result = await request(path + (after ? '?after=' + encodeURIComponent(after) : ''));
      setDetails((current) => ({
        ...result, note, replies: after ? [...current.replies, ...result.replies] : result.replies,
      }));
    });
  }

  useEffect(() => {
    if (!selectedClass && classes.length === 1) load(classes[0].id);
  }, [classId, classes]);

  return (
    <View style={liaisonStyles.group}>
      <Text accessibilityRole="header" style={styles.title}>Cahier de liaison</Text>
      {!classes.length && <Text style={styles.body}>Aucune classe ne vous est affectée.</Text>}
      {classes.length > 0 && <View style={styles.actions}>
        {classes.map(({ id, name }) => (
          <Button key={id} label={name} icon="school-outline" selected={id === classId} secondary={id !== classId}
            onPress={() => load(id)} busy={busy} />
        ))}
      </View>}
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text> : null}
      {busy && !page && <Text style={styles.body}>Chargement du cahier…</Text>}
      {selectedClass && page && !details && <>
        <Text accessibilityRole="header" style={styles.label}>Mot du jour · {formatLiaisonDay(page.today)}</Text>
        <Field label="Texte du mot" value={draft} onChangeText={setDraft}
          style={[styles.input, liaisonStyles.editor]} multiline maxLength={1000} editable={!busy} />
        <View style={styles.actions}>
          <Button label={dailyNote ? 'Enregistrer les modifications' : 'Publier le mot'} icon="checkmark-outline"
            onPress={publish} busy={busy || !draft.trim() || draft.trim() === dailyNote?.body} />
          <Button label="Actualiser" icon="refresh-outline" onPress={() => load(classId)} busy={busy} secondary />
        </View>
        {page.notes.length === 0 && <Text style={styles.body}>Aucun mot de liaison publié dans cette classe.</Text>}
        {page.notes.map((note) => (
          <NoteCard key={note.id} note={note}>
            <View style={styles.actions}>
              <Button label="Voir les réponses" icon="chatbubbles-outline" onPress={() => loadReplies(note)} busy={busy} secondary />
            </View>
          </NoteCard>
        ))}
        {page.nextCursor && <Button label="Afficher les mots précédents" onPress={() => load(classId, page.nextCursor)} busy={busy} secondary />}
      </>}
      {selectedClass && details && <>
        <View style={styles.actions}>
          <Button label="Retour aux mots" icon="arrow-back-outline" onPress={() => setDetails(null)} busy={busy} secondary />
          <Button label="Actualiser" icon="refresh-outline" onPress={() => loadReplies(details.note)} busy={busy} secondary />
        </View>
        <NoteCard note={details.note} />
        <Text accessibilityRole="header" style={styles.label}>Réponses des familles</Text>
        {busy && !details.replies && <Text style={styles.body}>Chargement des réponses…</Text>}
        {details.replies?.length === 0 && <Text style={styles.body}>Aucune réponse pour ce mot.</Text>}
        {details.replies?.map((reply) => (
          <View key={reply.id} style={liaisonStyles.reply}>
            <Text style={styles.label}>{reply.studentName} · Tuteur {reply.guardianReference.slice(-6)}</Text>
            <Text selectable style={[styles.body, liaisonStyles.text]}>{reply.body}</Text>
            <View style={styles.actions}>
              <Button label="Répondre en privé" icon="chatbubble-ellipses-outline"
                onPress={() => onReply({ childId: reply.childId, studentName: reply.studentName,
                  guardianReference: reply.guardianReference, classId, subject: 'Cahier de liaison · ' + formatLiaisonDay(details.note.day) })}
                busy={busy} secondary />
            </View>
          </View>
        ))}
        {details.nextCursor && <Button label="Afficher plus de réponses"
          onPress={() => loadReplies(details.note, details.nextCursor)} busy={busy} secondary />}
      </>}
    </View>
  );
}
