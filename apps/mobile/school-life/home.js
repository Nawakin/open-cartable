import React from 'react';
import { Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';
import { layout, Select } from '../year-transition/ui';
import { activityLabels, Problem, schoolTimeLabel } from './ui';
import { formatLiaisonDay } from '../liaison/ui';

function Summary({ title, items, subtitle, open, busy }) {
  if (!items.length) return null;
  return <View style={layout.group}>
    <Text accessibilityRole="header" style={layout.heading}>{title}</Text>
    {items.map((item) => <View key={item.id + '/' + (item.child?.id ?? '')} style={[layout.card, layout.cardHeader]}>
      <View style={layout.details}>
        <Text style={styles.label}>{item.title ?? item.subject}</Text>
        <Text style={layout.status}>{subtitle(item)}</Text>
      </View>
      <Button label="Ouvrir" accessibilityLabel={'Ouvrir ' + (item.title ?? item.subject)
        + (item.child ? ' · ' + item.child.displayName : '')} secondary busy={busy} onPress={() => open(item)} />
    </View>)}
  </View>;
}

export function FamilyHome({ children, selected, onSelect, data, busy, problem, onActivity, onAssignment, onEvent, onMessage }) {
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.title}>À faire et à venir</Text>
    {children.length > 1 && <Select label="Filtrer par enfant" value={selected} disabled={busy}
      choices={[{ value: '', label: 'Tous mes enfants' }, ...children.map(({ id, displayName }) => ({ value: id, label: displayName }))]}
      onChange={onSelect} />}
    <View style={styles.actions}><Button label="Annonces et invitations" icon="megaphone-outline" secondary
      busy={busy} onPress={() => onActivity()} /></View>
    <Problem value={problem} />
    {data && <>
      <Summary title="Réponses attendues" items={data.actions} open={onActivity} busy={busy} subtitle={(item) =>
        [activityLabels[item.kind], item.hasDocument ? 'Document joint' : '', item.startsAt ? schoolTimeLabel(item.startsAt) : '']
          .filter(Boolean).join(' · ')} />
      <Summary title="Messages non lus" items={data.messages} open={onMessage} busy={busy}
        subtitle={(item) => item.studentName + ' · ' + schoolTimeLabel(item.lastMessageAt)} />
      <Summary title="Devoirs à rendre" items={data.assignments} open={onAssignment} busy={busy}
        subtitle={(item) => formatLiaisonDay(item.date) + ' · ' + item.child.displayName} />
      <Summary title="Agenda à venir" items={data.events} open={onEvent} busy={busy}
        subtitle={(item) => schoolTimeLabel(item.startsAt) + ' · ' + item.child.displayName} />
      {!busy && Object.values(data).every((items) => !items.length)
        && <Text style={styles.body}>Rien à traiter pour les prochains jours.</Text>}
    </>}
  </View>;
}
