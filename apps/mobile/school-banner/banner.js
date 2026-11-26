import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Illustration } from '../illustrations';

export const defaultBanner = {
  title: 'Open Cartable', textColor: '#fff7df', backgroundColor: '#17372d',
};

export function SchoolBanner({ banner, roleLabel, onLogout, busy }) {
  const { title, textColor, backgroundColor } = banner ?? defaultBanner;
  const { width } = useWindowDimensions();

  return (
    <View style={[styles.bar, { backgroundColor }]}>
      <Illustration name="cartable" size={width < 550 ? 38 : 46} />
      <Text numberOfLines={2} style={[styles.title, { color: textColor }]}>{title}</Text>
      {roleLabel && width >= 650 && <Text style={[styles.role, { color: textColor, borderColor: textColor + '55' }]}>
        {roleLabel}
      </Text>}
      {onLogout && <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" disabled={busy}
        accessibilityState={{ disabled: busy }} onPress={onLogout}
        style={({ pressed }) => [styles.logout, { borderColor: textColor + '55' },
          (pressed || busy) && styles.dimmed]}>
        <Ionicons name="log-out-outline" size={23} color={textColor} accessible={false} aria-hidden />
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6,
    minHeight: 62, borderRadius: 15, boxShadow: '0px 4px 14px #49381e25' },
  title: { flex: 1, minWidth: 0, fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  role: { fontSize: 13, fontWeight: '700', paddingVertical: 5, paddingHorizontal: 9, borderWidth: 1, borderRadius: 9 },
  logout: { height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1 },
  dimmed: { opacity: 0.72 },
});
