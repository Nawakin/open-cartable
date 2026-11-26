import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { movePeriod } from '../parent/homework';
import { Button, styles } from '../parent/ui';

const schoolCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});
const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'UTC' });

export const statuses = {
  present: { label: 'Présent', icon: 'checkmark-circle-outline' },
  absent: { label: 'Absent', icon: 'alert-circle-outline' },
  late: { label: 'Retard', icon: 'time-outline' },
  left: { label: 'Sortie', icon: 'exit-outline' },
};

export function schoolDay() {
  const parts = schoolCalendar.formatToParts();
  return ['year', 'month', 'day'].map((unit) => parts.find(({ type }) => type === unit).value).join('-');
}

export function formatDay(day) {
  return dayLabel.format(new Date(day + 'T00:00:00Z'));
}

export function classAttendancePath(id) {
  return '/classes/' + encodeURIComponent(id) + '/attendance';
}

export function useAttendanceTask(onExpired) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(operation) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else if (failure.status === 409) setError('Les données ont changé. Actualisez avant de réessayer.');
      else if (failure.status === 404) setError('Cette classe, cet élève ou cette date n’est plus accessible.');
      else if (failure.status === 0) setError('Connexion interrompue. Actualisez pour vérifier l’enregistrement.');
      else setError('L’opération a échoué. Réessayez dans un instant.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return { run, busy, error };
}

export function ClassPicker({ classes, classId, onSelect, busy }) {
  if (!classes.length) return <Text style={styles.body}>Aucune classe disponible.</Text>;
  if (classes.length === 1) return <Text style={styles.label}>{classes[0].name}</Text>;
  return <View style={styles.actions}>
    {classes.map(({ id, name }) => <Button key={id} label={name} icon="school-outline" selected={id === classId}
      secondary={id !== classId} busy={busy} onPress={() => onSelect(id)} />)}
  </View>;
}

export function MonthPicker({ month, onChange, busy }) {
  const anchor = month + '-01';
  return <View style={attendance.month}>
    <Text accessibilityRole="header" style={attendance.monthLabel}>{monthLabel.format(new Date(anchor + 'T00:00:00Z'))}</Text>
    <View style={styles.actions}>
      <Button label="Précédent" accessibilityLabel="Mois précédent" icon="chevron-back-outline" busy={busy}
        secondary onPress={() => onChange(movePeriod(anchor, 'month', -1).slice(0, 7))} />
      <Button label="Suivant" accessibilityLabel="Mois suivant" icon="chevron-forward-outline"
        busy={busy || month >= schoolDay().slice(0, 7)} secondary
        onPress={() => onChange(movePeriod(anchor, 'month', 1).slice(0, 7))} />
    </View>
  </View>;
}

export function AttendanceRow({ title, detail, icon, selected, busy, onPress, children }) {
  const content = <>
    <View style={attendance.badge}>
      <Ionicons name={icon} size={22} color="#225344" accessible={false} aria-hidden />
    </View>
    <View style={attendance.info}>
      <Text style={styles.label}>{title}</Text>
      {detail && <Text style={styles.body}>{detail}</Text>}
    </View>
    {onPress && <Ionicons name={selected ? 'chevron-up-outline' : 'chevron-down-outline'} size={18}
      color="#225344" accessible={false} aria-hidden />}
  </>;
  return <View style={attendance.card}>
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title + ' · ' + detail}
      aria-expanded={selected} disabled={busy} onPress={onPress}
      style={({ pressed }) => [attendance.row, pressed && attendance.pressed]}>{content}</Pressable>
      : <View style={attendance.row}>{content}</View>}
    {children}
  </View>;
}

export const attendance = StyleSheet.create({
  list: { gap: 9 },
  card: { backgroundColor: '#f0f4eb', borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 58, padding: 10, gap: 10 },
  pressed: { opacity: 0.7 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dce8da' },
  info: { flex: 1, minWidth: 0 },
  controls: { paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
  month: { gap: 8 },
  monthLabel: { color: '#17372d', fontSize: 19, fontWeight: '700' },
  alert: { color: '#612e1b', backgroundColor: '#f8ead7', padding: 12, borderRadius: 10, fontSize: 15, lineHeight: 21 },
});
