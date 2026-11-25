import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

export function Button({ label, accessibilityLabel, onPress, busy, icon, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, (pressed || busy) && styles.dimmed]}
    >
      {icon && <Ionicons name={icon} size={19} color={secondary ? '#17372d' : '#fff'} accessible={false} aria-hidden />}
      <Text style={secondary ? styles.secondaryLabel : styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCorrect={false}
        autoComplete="off"
        placeholderTextColor="#536158"
        style={styles.input}
        {...props}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  panel: { borderColor: '#dddaca', borderWidth: 1, borderRadius: 18, padding: 24, backgroundColor: '#fffdf6', gap: 16 },
  title: { color: '#132d25', fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  body: { color: '#3a4d43', fontSize: 16, lineHeight: 23 },
  field: { gap: 6 },
  label: { color: '#17372d', fontSize: 15, fontWeight: '700' },
  input: { color: '#132d25', fontSize: 16, minHeight: 48, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#929e91', backgroundColor: '#fff' },
  button: { minHeight: 48, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#225344' },
  buttonLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: { backgroundColor: '#e7ede4' },
  secondaryLabel: { color: '#17372d', fontSize: 16, fontWeight: '700' },
  dimmed: { opacity: 0.65 },
  error: { color: '#862929', fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
