import React, { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { NoteCard, liaisonStyles, useLiaisonTask } from './ui';

export function ParentLiaison({ child, request, onBack, onExpired }) {
  const path = '/children/' + encodeURIComponent(child.id) + '/liaison';
  const [page, setPage] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const { busy, problem, run } = useLiaisonTask(onExpired);

  function load(before) {
    void run(async () => {
      setNotice('');
      if (!before) setPage(null);
      const result = await request(path + (before ? '?before=' + encodeURIComponent(before) : ''));
      setPage((current) => before ? { ...result, notes: [...current.notes, ...result.notes] } : result);
    });
  }

  function reply() {
    if (!editing.body.trim()) return;
    void run(async () => {
      const replyPath = path + '/' + encodeURIComponent(editing.id) + '/reply';
      const result = await request(replyPath, { method: 'PUT', body: { body: editing.body } });
      setPage((current) => ({
        ...current, notes: current.notes.map((note) => note.id === editing.id ? { ...note, reply: result } : note),
      }));
      setEditing(null);
      setNotice('Réponse enregistrée.');
    });
  }

  useEffect(() => {
    load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => subscription.remove();
  }, [path]);

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Cahier de liaison</Text>
      <Text style={styles.body}>{child.displayName}</Text>
      <View style={styles.actions}>
        <Button label="Retour" icon="arrow-back-outline" onPress={onBack} busy={busy} secondary />
        <Button label="Actualiser" icon="refresh-outline" onPress={() => load()} busy={busy} secondary />
      </View>
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text> : null}
      {!page && busy && <Text style={styles.body}>Chargement des mots de la classe…</Text>}
      {page?.notes.length === 0 && <Text style={styles.body}>Aucun mot de liaison pour le moment.</Text>}
      {page?.notes.map((note) => (
        <NoteCard key={note.id} note={note}>
          {editing?.id === note.id ? (
            <View style={liaisonStyles.group}>
              <Field label="Votre réponse" value={editing.body} onChangeText={(body) => setEditing({ id: note.id, body })}
                style={[styles.input, liaisonStyles.editor]} multiline editable={!busy} maxLength={500} />
              <View style={styles.actions}>
                <Button label="Enregistrer la réponse" icon="send-outline" onPress={reply} busy={busy || !editing.body.trim()} />
                <Button label="Annuler" onPress={() => setEditing(null)} busy={busy} secondary />
              </View>
            </View>
          ) : (
            <View style={liaisonStyles.group}>
              {note.reply && <View style={liaisonStyles.reply}>
                <Text style={styles.label}>Votre réponse</Text>
                <Text selectable style={[styles.body, liaisonStyles.text]}>{note.reply.body}</Text>
              </View>}
              <View style={styles.actions}>
                <Button label={note.reply ? 'Modifier ma réponse' : 'Répondre'} icon="chatbubble-outline"
                  onPress={() => { setNotice(''); setEditing({ id: note.id, body: note.reply?.body ?? '' }); }}
                  busy={busy} secondary />
              </View>
            </View>
          )}
        </NoteCard>
      ))}
      {page?.nextCursor && <Button label="Afficher les mots précédents" onPress={() => load(page.nextCursor)} busy={busy} secondary />}
    </View>
  );
}
