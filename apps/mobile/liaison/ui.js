import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from '../parent/ui';

const dayLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });

export function formatLiaisonDay(day) {
  return dayLabel.format(new Date(day + 'T12:00:00Z'));
}

export function useLiaisonTask(onExpired, explain) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function run(action) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem('');
    try {
      await action();
    } catch (error) {
      if (error.status === 401) onExpired();
      else if (explain) setProblem(explain(error));
      else if (error.status === 404) setProblem('Ce cahier ou ce mot n’est plus accessible. Actualisez pour vérifier.');
      else if (error.status === 409) setProblem('La journée a changé. Actualisez le cahier avant de publier.');
      else if (error.status === 400) setProblem('Vérifiez le texte et sa longueur.');
      else setProblem('L’opération a échoué. Réessayez dans un instant.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return { busy, problem, run };
}

export function NoteCard({ note, children }) {
  return (
    <View style={liaisonStyles.note}>
      <View style={liaisonStyles.date}>
        <Ionicons name="calendar-outline" size={18} color="#225344" accessible={false} aria-hidden />
        <Text accessibilityRole="header" style={styles.label}>{formatLiaisonDay(note.day)}</Text>
      </View>
      <Text selectable style={[styles.body, liaisonStyles.text]}>{note.body}</Text>
      {children}
    </View>
  );
}

export const liaisonStyles = StyleSheet.create({
  group: { gap: 16, minWidth: 0 },
  note: { backgroundColor: '#f0f4eb', borderColor: '#d7e0d2', borderWidth: 1, borderRadius: 14, padding: 14, gap: 12, minWidth: 0 },
  date: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { ...Platform.select({ web: { overflowWrap: 'anywhere' } }) },
  reply: { backgroundColor: '#fffdf6', borderColor: '#d7e0d2', borderWidth: 1, borderRadius: 11, padding: 12, gap: 8 },
  editor: { minHeight: 96, textAlignVertical: 'top' },
});
