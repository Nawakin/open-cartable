import React, { createContext, useCallback, useContext, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SchoolBanner } from './school-banner/banner';

const ScrollToTop = createContext(() => {});

export function useScrollToTop() {
  return useContext(ScrollToTop);
}

export function AppFrame({ menu, scrollKey, onLogout, busy, banner, wide = false, children }) {
  const content = [nav.content, wide && nav.wide];
  const scroll = useRef(null);
  const scrollToTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  return (
    <SafeAreaView style={nav.safeArea}>
      <View style={nav.headerArea}>
        <View style={content}>
          <SchoolBanner banner={banner} onLogout={onLogout} busy={busy} />
          {menu}
        </View>
      </View>
      <ScrollView ref={scroll} key={scrollKey} keyboardShouldPersistTaps="handled" contentContainerStyle={nav.scroll}>
        <ScrollToTop.Provider value={scrollToTop}><View style={content}>{children}</View></ScrollToTop.Provider>
      </ScrollView>
    </SafeAreaView>
  );
}

export function SectionNav({ label, items, active, busy }) {
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = items.length === 4 && width < 360 * fontScale;
  return (
    <View accessibilityRole="navigation" accessibilityLabel={label} style={nav.container}>
      {items.map(({ id, icon, label: title, onPress, unreadCount = 0 }) => {
        const selected = active === id;
        const color = selected ? '#fff' : '#244439';
        const navLabel = unreadCount > 0
          ? `${title}, ${unreadCount} ${unreadCount === 1 ? 'conversation non lue' : 'conversations non lues'}` : title;
        return (
          <Pressable key={id} accessibilityRole="button" accessibilityLabel={navLabel}
            accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={onPress}
            style={({ pressed }) => [nav.item, twoColumns && nav.half,
              selected && nav.selected, (pressed || busy) && nav.dimmed]}>
            <View style={nav.iconRow}>
              <Ionicons name={icon} color={color} size={21} accessible={false} aria-hidden />
              {unreadCount > 0 && <Text style={nav.badge} accessible={false} aria-hidden>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>}
            </View>
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
  iconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  badge: { color: '#402b09', backgroundColor: '#ffdd9b', borderRadius: 12, minWidth: 20,
    paddingVertical: 1, paddingHorizontal: 4, textAlign: 'center', fontSize: 12, fontWeight: '800' },
  dimmed: { opacity: 0.72 },
});
