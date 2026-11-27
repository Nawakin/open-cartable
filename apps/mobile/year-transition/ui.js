import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';

export function Select({ label, value, choices, onChange, disabled }) {
  const [expanded, setExpanded] = useState(false);
  const selected = choices.find((choice) => choice.value === value);
  if (Platform.OS !== 'web') return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <Button label={selected?.label ?? label} accessibilityLabel={selected ? label + ' · ' + selected.label : label}
      icon={expanded ? 'chevron-up-outline' : 'chevron-down-outline'} secondary expanded={expanded}
      busy={disabled} onPress={() => setExpanded(!expanded)} />
    {expanded && <ScrollView nestedScrollEnabled style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 6 }}>
      {choices.map((choice) => <Button key={choice.value} label={choice.label} selected={value === choice.value}
        secondary={value !== choice.value} busy={disabled} onPress={() => { setExpanded(false); onChange(choice.value); }} />)}
    </ScrollView>}
  </View>;
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
      style={{ width: '100%', minHeight: 48, padding: '6px 10px', color: '#132d25', background: '#fff',
        border: '1px solid #929e91', fontSize: 16, borderRadius: 10 }}>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  </View>;
}

export function levelChoices(levels, label) {
  return [{ value: '', label }, ...levels.map((level) => ({ value: level, label: level }))];
}

export const layout = StyleSheet.create({
  group: { gap: 12, minWidth: 0 },
  card: { backgroundColor: '#f0f4eb', borderRadius: 12, padding: 13, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  details: { flex: 1, minWidth: 0, gap: 3 },
  heading: { color: '#17372d', fontSize: 18, fontWeight: '700' },
  status: { color: '#43584c', fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
