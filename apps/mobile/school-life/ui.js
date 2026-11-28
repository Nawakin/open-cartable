import React from 'react';
import { Text } from 'react-native';
import { styles } from '../parent/ui';
import { useLiaisonTask } from '../liaison/ui';

const paris = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const displayTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short',
});

export function schoolDateTime(value) {
  return value ? paris.format(new Date(value)).replace('T', ' ') : '';
}

export function schoolInstant(value) {
  const cleaned = value.trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cleaned)) return null;
  const utc = Date.parse(cleaned.replace(' ', 'T') + ':00Z');
  if (!Number.isFinite(utc)) return null;
  for (const offset of [2, 1]) {
    const candidate = new Date(utc - offset * 3_600_000).toISOString();
    if (schoolDateTime(candidate) === cleaned) return candidate;
  }
  return null;
}

export function schoolTimeLabel(value) {
  return displayTime.format(new Date(value));
}

const messages = {
  0: 'Connexion interrompue. Actualisez avant de réessayer.',
  400: 'Vérifiez les champs, les dates et les destinataires.',
  403: 'Cette action est réservée aux comptes autorisés.',
  404: 'Cet élément a changé ou n’est plus accessible. Actualisez.',
  409: 'Cette action entre en conflit avec une modification récente. Actualisez et vérifiez les informations.',
  413: 'Le fichier dépasse la taille autorisée.',
  415: 'Choisissez un PDF ou une image compatible.',
  422: 'Choisissez une date comprise entre aujourd’hui et les 90 prochains jours.',
};
export const useSchoolTask = (onExpired) => useLiaisonTask(onExpired,
  ({ status }) => messages[status] ?? 'L’opération a échoué. Réessayez dans un instant.');

export function Problem({ value }) {
  return value ? <Text accessibilityRole="alert" style={styles.error}>{value}</Text> : null;
}

export const activityLabels = { announcement: 'Annonce', invitation: 'Invitation', slot: 'Rendez-vous' };
