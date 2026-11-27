import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { styles } from './ui';
import { layout } from '../year-transition/ui';

const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function UpcomingAssignments({ assignments, busy, onOpen }) {
  if (!assignments.length) return null;
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.title}>Devoirs à rendre</Text>
    {assignments.map((entry) => <Pressable key={entry.child.id + '/' + entry.id} accessibilityRole="button"
      disabled={busy} style={layout.card} onPress={() => onOpen(entry)}>
      <Text style={styles.label}>{entry.title}</Text>
      <Text style={layout.status}>{day.format(new Date(entry.date + 'T00:00:00Z'))} · {entry.domain} · {entry.child.displayName}</Text>
    </Pressable>)}
  </View>;
}
