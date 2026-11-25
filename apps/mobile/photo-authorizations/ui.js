import React from 'react';
import { StyleSheet, Text } from 'react-native';

export const authorizationOptions = [
  { id: 'unrecorded', label: 'À renseigner' },
  { id: 'allowed', label: 'Autorisée' },
  { id: 'refused', label: 'Refusée' },
];

export function authorizationLabel(status) {
  return authorizationOptions.find(({ id }) => id === status)?.label ?? 'À renseigner';
}

export function AuthorizationStatus({ status }) {
  return <Text style={[badge.base, badge[status]]}>{authorizationLabel(status)}</Text>;
}

const badge = StyleSheet.create({
  base: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, fontWeight: '700', color: '#54421d', backgroundColor: '#f9eccf' },
  allowed: { color: '#17372d', backgroundColor: '#dcebd9' },
  refused: { color: '#792d29', backgroundColor: '#f8e0db' },
});
