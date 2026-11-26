import React, { createContext, useCallback, useContext, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SchoolBanner } from './school-banner/banner';
import { Illustration } from './illustrations';

const ScrollToTop = createContext(() => {});

export function useScrollToTop() {
  return useContext(ScrollToTop);
}

export function AppFrame({ menu, scrollKey, onLogout, busy, banner, roleLabel, wide = false, children }) {
  const content = [nav.content, wide && nav.wide];
  const scroll = useRef(null);
  const scrollToTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  return (
    <SafeAreaView style={nav.safeArea}>
      <View style={nav.headerArea}>
        <View style={[nav.content, nav.wide, nav.header]}>
          <SchoolBanner banner={banner} roleLabel={roleLabel} onLogout={onLogout} busy={busy} />
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
  const compact = width < 590;
  return (
    <View accessibilityRole="navigation" accessibilityLabel={label} style={nav.container}>
      {items.map(({ id, art, label: title, onPress, unreadCount = 0 }) => {
        const selected = active === id;
        const color = selected ? '#fff9ec' : '#203c33';
        const navLabel = unreadCount > 0
          ? `${title}, ${unreadCount} ${unreadCount === 1 ? 'conversation non lue' : 'conversations non lues'}` : title;
        return (
          <Pressable key={id} accessibilityRole="button" accessibilityLabel={navLabel}
            aria-current={selected ? 'page' : undefined} accessibilityState={{ selected, disabled: busy }}
            disabled={busy} onPress={onPress}
            style={({ pressed }) => [nav.item, compact && nav.compact, twoColumns && nav.half,
              selected && nav.selected, (pressed || busy) && nav.dimmed]}>
            <View style={nav.iconRow}>
              <Illustration name={art ?? id} size={compact ? (twoColumns ? 30 : 36) : 62} />
              {unreadCount > 0 && <Text style={nav.badge} accessible={false} aria-hidden>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>}
            </View>
            <Text style={[nav.label, compact && nav.smallLabel, { color }]}>{title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const nav = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f1e7' },
  headerArea: { alignItems: 'center', paddingHorizontal: 13, paddingTop: 12 },
  content: { width: '100%', maxWidth: 690, gap: 14 },
  wide: { maxWidth: 1080 },
  header: { gap: 12 },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 13, paddingTop: 15, paddingBottom: 30 },
  container: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: {
    flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 103, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 4, paddingVertical: 6, gap: 4, borderRadius: 13,
    borderWidth: 2, borderColor: '#e4dbc8', backgroundColor: '#fffdf8', boxShadow: '0px 3px 9px #59422116',
  },
  compact: { minHeight: 73, paddingHorizontal: 2, gap: 2 },
  selected: { backgroundColor: '#204a3e', borderColor: '#d8af71' },
  half: { flexBasis: '45%', minHeight: 64 },
  label: { textAlign: 'center', fontSize: 15, fontWeight: '700' },
  smallLabel: { fontSize: 12 },
  iconRow: { alignItems: 'center', justifyContent: 'center' },
  badge: { color: '#402b09', backgroundColor: '#ffdd9b', borderRadius: 12, minWidth: 20,
    position: 'absolute', top: 0, right: -8, paddingVertical: 1, paddingHorizontal: 4,
    textAlign: 'center', fontSize: 12, fontWeight: '800' },
  dimmed: { opacity: 0.72 },
});
