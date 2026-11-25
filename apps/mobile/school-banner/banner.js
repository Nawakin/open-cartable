import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

export const defaultBanner = {
  title: 'Open Cartable', textColor: '#fff7df', backgroundColor: '#17372d',
};

export function SchoolBanner({ banner, onLogout, busy }) {
  const { title, textColor, backgroundColor } = banner ?? defaultBanner;
  const classic = textColor === defaultBanner.textColor && backgroundColor === defaultBanner.backgroundColor;

  return (
    <View style={[styles.bar, { backgroundColor }]}>
      <Ionicons name="book-outline" size={24} color={classic ? '#ffdd9b' : textColor} accessible={false} aria-hidden />
      <Text numberOfLines={2} style={[styles.title, { color: textColor }]}>{title}</Text>
      {onLogout && <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" disabled={busy}
        accessibilityState={{ disabled: busy }} onPress={onLogout}
        style={({ pressed }) => [styles.logout, { backgroundColor: classic ? '#2b4f41' : textColor + '19' },
          (pressed || busy) && styles.dimmed]}>
        <Ionicons name="log-out-outline" size={23} color={textColor} accessible={false} aria-hidden />
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 5, minHeight: 54, borderRadius: 16 },
  title: { flex: 1, minWidth: 0, fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  logout: { height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  dimmed: { opacity: 0.72 },
});
