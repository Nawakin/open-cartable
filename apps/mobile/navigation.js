import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';

export function AppFrame({ menu, scrollKey, onLogout, busy, wide = false, children }) {
  const content = [nav.content, wide && nav.wide];
  return (
    <SafeAreaView style={nav.safeArea}>
      <View style={nav.headerArea}>
        <View style={content}>
          <View style={nav.brandBar}>
            <Ionicons name="book-outline" size={24} color="#ffdd9b" accessible={false} aria-hidden />
            <Text style={nav.brand}>Open Cartable</Text>
            {onLogout && <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" disabled={busy}
              accessibilityState={{ disabled: busy }} onPress={onLogout}
              style={({ pressed }) => [nav.logout, (pressed || busy) && nav.dimmed]}>
              <Ionicons name="log-out-outline" size={23} color="#fff7df" accessible={false} aria-hidden />
            </Pressable>}
          </View>
          {menu}
        </View>
      </View>
      <ScrollView key={scrollKey} keyboardShouldPersistTaps="handled" contentContainerStyle={nav.scroll}>
        <View style={content}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function SectionNav({ label, items, active, busy }) {
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = items.length === 4 && width < 360 * fontScale;
  return (
    <View accessibilityRole="navigation" accessibilityLabel={label} style={nav.container}>
      {items.map(({ id, icon, label: title, onPress }) => {
        const selected = active === id;
        const color = selected ? '#fff' : '#244439';
        return (
          <Pressable key={id} accessibilityRole="button" accessibilityLabel={title}
            accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={onPress}
            style={({ pressed }) => [nav.item, twoColumns && nav.half, selected && nav.selected, (pressed || busy) && nav.dimmed]}>
            <Ionicons name={icon} color={color} size={21} accessible={false} aria-hidden />
            <Text style={[nav.label, { color }]}>{title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const nav = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f3f0e5' },
  headerArea: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 16 },
  content: { width: '100%', maxWidth: 560, gap: 12 },
  wide: { maxWidth: 680 },
  brandBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#17372d',
    paddingHorizontal: 18, minHeight: 54, borderRadius: 16,
  },
  brand: { flex: 1, color: '#fff7df', fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  logout: { height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#2b4f41' },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28 },
  container: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 6, borderWidth: 1,
    borderColor: '#d8ded2', borderRadius: 16, backgroundColor: '#f8faf4',
  },
  item: {
    flexGrow: 1, flexBasis: 66, minHeight: 54, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 5, paddingVertical: 7, gap: 3, borderRadius: 11,
  },
  selected: { backgroundColor: '#225344' },
  half: { flexBasis: '44%' },
  label: { textAlign: 'center', fontSize: 13, fontWeight: '700' },
  dimmed: { opacity: 0.72 },
});
