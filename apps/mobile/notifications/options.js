import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';

const categories = [
  ['messages', 'Messages'], ['homework', 'Cahier de texte'], ['assignments', 'Devoirs à rendre'],
  ['reports', 'Livrets scolaires'], ['agenda', 'Nouveaux événements'], ['agenda-reminder', 'Rappels d’agenda'],
  ['attendance', 'Rappels d’absence'], ['liaison', 'Cahier de liaison'], ['blog', 'Blog de classe'], ['library', 'Médiathèque'],
];
export const notificationIds = categories.map(([id]) => id);

export function NotificationOptions({ settings, busy, problem, change, save }) {
  if (!settings) return problem
    ? <Text accessibilityRole="alert" style={styles.body}>{problem}</Text>
    : <Text style={styles.body}>Chargement des réglages…</Text>;
  return <View style={styles.field}>
    <Text style={styles.body}>Recevez une alerte sur cet appareil quand votre école publie une nouveauté ou vous écrit.</Text>
    {problem && <Text accessibilityRole="alert" style={styles.error}>{problem}</Text>}
    <View style={styles.actions}>
      <Button label={settings.enabled ? 'Désactiver les notifications' : 'Activer les notifications'} icon="notifications-outline"
        secondary busy={busy} onPress={() => void change()} />
    </View>
    {settings.enabled && <View style={styles.field}>
      {categories.map(([id, label]) => <View key={id} style={notificationStyles.option}>
        <Switch accessibilityLabel={label} disabled={busy} value={settings.categories.includes(id)}
          onValueChange={(selected) => void save({ categories: selected
            ? [...settings.categories, id] : settings.categories.filter((category) => category !== id) })} />
        <Text style={styles.body}>{label}</Text>
      </View>)}
      <View style={notificationStyles.option}>
        <Switch accessibilityLabel="Recevoir des alertes le week-end" disabled={busy} value={settings.weekends}
          onValueChange={(weekends) => void save({ weekends })} />
        <Text style={styles.body}>Recevoir des alertes le week-end</Text>
      </View>
    </View>}
  </View>;
}

const notificationStyles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
});
