import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

const images = {
  cartable: require('./assets/illustrations/cartable.png'),
  homework: require('./assets/illustrations/homework.png'),
  agenda: require('./assets/illustrations/agenda.png'),
  messages: require('./assets/illustrations/messages.png'),
  school: require('./assets/illustrations/school.png'),
  'class-life': require('./assets/illustrations/class-life.png'),
  account: require('./assets/illustrations/account.png'),
  home: require('./assets/illustrations/home.png'),
  directory: require('./assets/illustrations/directory.png'),
  'photo-authorizations': require('./assets/illustrations/photo-authorizations.png'),
  banner: require('./assets/illustrations/banner.png'),
  attendance: require('./assets/illustrations/attendance.png'),
  'year-transition': require('./assets/illustrations/year-transition.png'),
  security: require('./assets/illustrations/security.png'),
  liaison: require('./assets/illustrations/liaison.png'),
  blog: require('./assets/illustrations/blog.png'),
};

export function Illustration({ name, size = 60 }) {
  return <Image source={images[name]} resizeMode="contain" accessible={false} aria-hidden
    style={{ width: size, height: size, flexShrink: 0 }} />;
}

export function IllustratedMenu({ items, busy, compact = false }) {
  const { width, fontScale } = useWindowDimensions();
  const columns = compact ? 2 : width / fontScale >= 1050 ? 3 : width / fontScale >= 660 ? 2 : 1;
  const column = columns === 3 ? cards.third : columns === 2 ? cards.half : cards.full;
  return <View style={cards.grid}>
    {items.map(({ id, art, label, accessibilityLabel, detail, onPress, expanded }) =>
      <Pressable key={id} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={detail} aria-expanded={expanded} disabled={busy} onPress={onPress}
        style={({ pressed }) => [cards.tile, column, compact && cards.compact,
          expanded && cards.expanded, pressed && cards.pressed]}>
        <Illustration name={art ?? id} size={compact ? 38 : columns === 1 ? 59 : 70} />
        <View style={cards.copy}>
          <Text style={[cards.title, compact && cards.smallTitle]}>{label}</Text>
          {detail && <Text style={cards.detail}>{detail}</Text>}
        </View>
        {(!compact || expanded !== undefined) && <Ionicons name={expanded === undefined ? 'chevron-forward-outline'
          : expanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={compact ? 15 : 18}
          color="#527065" accessible={false} aria-hidden />}
      </Pressable>)}
  </View>;
}

const cards = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '2%', rowGap: 12 },
  full: { flexBasis: '100%' },
  half: { flexBasis: '49%' },
  third: { flexBasis: '32%' },
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, minHeight: 84,
    borderWidth: 1, borderColor: '#e3dac8', borderRadius: 13, backgroundColor: '#fffdf8',
    boxShadow: '0px 3px 8px #5942210e',
  },
  compact: { paddingHorizontal: 7, paddingVertical: 7, gap: 5, minHeight: 55 },
  expanded: { backgroundColor: '#edf2e6', borderColor: '#b3c4b2' },
  pressed: { backgroundColor: '#edf2e6' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: '#182d26', fontWeight: '700', fontSize: 16 },
  smallTitle: { fontSize: 13 },
  detail: { color: '#4a574d', fontSize: 14, lineHeight: 19 },
});
