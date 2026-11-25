import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { defaultBanner, SchoolBanner } from './banner';

const colorPattern = /^#[0-9a-f]{6}$/i;

function luminance(color) {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function hasReadableContrast(text, background) {
  const first = luminance(text);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) >= 4.5;
}

function equivalent(left, right) {
  return left.title.trim() === right.title && left.textColor.toLowerCase() === right.textColor
    && left.backgroundColor.toLowerCase() === right.backgroundColor;
}

function ColorField({ label, value, onChange, busy }) {
  if (Platform.OS !== 'web') {
    return <Field label={label} value={value} onChangeText={onChange} maxLength={7} editable={!busy} autoCapitalize="none" />;
  }
  return (
    <View style={ui.colorField}>
      <Text style={styles.label}>{label}</Text>
      <View style={ui.swatch}>
        <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={busy}
          style={{ width: 60, height: 44, padding: 3, border: '1px solid #929e91', borderRadius: 8, backgroundColor: '#fff', cursor: 'pointer' }} />
        <Text style={styles.body}>{value.toUpperCase()}</Text>
      </View>
    </View>
  );
}

export function BannerSettings({ request, run, busy, onSaved }) {
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState(null);
  const [draft, setDraft] = useState(defaultBanner);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const colorsValid = colorPattern.test(draft.textColor) && colorPattern.test(draft.backgroundColor);
  const readable = colorsValid && hasReadableContrast(draft.textColor, draft.backgroundColor);
  const changed = !equivalent(draft, current ?? defaultBanner);
  const isDefault = equivalent(draft, defaultBanner);

  function useResult(banner) {
    setCurrent(banner);
    setDraft(banner ?? defaultBanner);
    setConflict(false);
    setLoaded(true);
    onSaved(banner);
  }

  function load() {
    void run(async () => {
      setNotice('');
      const result = await request('/school-banner');
      useResult(result.banner);
    });
  }

  useEffect(() => { load(); }, []);

  function save() {
    void run(async () => {
      setNotice('');
      const revision = current?.revision ?? null;
      try {
        const result = await request('/school-banner', isDefault
          ? { method: 'DELETE', body: { revision } }
          : { method: 'PUT', body: {
            title: draft.title.trim(), textColor: draft.textColor, backgroundColor: draft.backgroundColor, revision,
          } });
        useResult(result.banner);
        setNotice(result.banner ? 'Bandeau enregistré.' : 'Bandeau par défaut rétabli.');
      } catch (error) {
        if (error.status !== 409) throw error;
        setConflict(true);
      }
    });
  }

  return <View style={ui.group}>
    <Text accessibilityRole="header" style={styles.title}>Bandeau d’en-tête</Text>
    {!loaded && (busy ? <Text style={styles.body}>Chargement des réglages…</Text>
      : <Button label="Réessayer" onPress={load} secondary />)}
    {loaded && <>
      <Text style={styles.label}>Aperçu</Text>
      <SchoolBanner banner={{
        title: draft.title.trim() || defaultBanner.title,
        textColor: colorsValid ? draft.textColor : defaultBanner.textColor,
        backgroundColor: colorsValid ? draft.backgroundColor : defaultBanner.backgroundColor,
      }} />
      <Field label="Texte du bandeau" value={draft.title} maxLength={64} editable={!busy}
        onChangeText={(title) => { setDraft({ ...draft, title }); setNotice(''); }} />
      <View style={ui.colors}>
        <ColorField label="Couleur du texte" value={draft.textColor} busy={busy}
          onChange={(textColor) => { setDraft({ ...draft, textColor }); setNotice(''); }} />
        <ColorField label="Couleur du fond" value={draft.backgroundColor} busy={busy}
          onChange={(backgroundColor) => { setDraft({ ...draft, backgroundColor }); setNotice(''); }} />
      </View>
      {!readable && <Text accessibilityRole="alert" style={styles.error}>Choisissez un texte et un fond plus contrastés.</Text>}
      {conflict && <View style={ui.group}>
        <Text accessibilityRole="alert" style={styles.error}>Ce bandeau a été modifié dans une autre session.</Text>
        <View style={styles.actions}>
          <Button label="Charger la version enregistrée" icon="refresh-outline" onPress={load} busy={busy} secondary />
        </View>
      </View>}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text> : null}
      <View style={styles.actions}>
        <Button label="Enregistrer le bandeau" icon="checkmark-outline" onPress={save}
          busy={busy || !changed || !draft.title.trim() || !readable || conflict} />
        {!isDefault && <Button label="Valeurs par défaut" onPress={() => { setDraft(defaultBanner); setNotice(''); }}
          secondary busy={busy} />}
      </View>
    </>}
  </View>;
}

const ui = StyleSheet.create({
  group: { gap: 14 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  colorField: { flexGrow: 1, flexBasis: 140, gap: 7 },
  swatch: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
