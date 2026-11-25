import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';
import { AuthorizationStatus } from './ui';

export function FamilyPhotoAuthorizations({ request, run, busy, onExpired }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);

  function load() {
    void run(async () => {
      setChildren(null);
      try {
        const result = await request('/photo-authorizations');
        setChildren(result.children);
      } catch (error) {
        if (error.status !== 401) throw error;
        await onExpired();
      }
    });
  }

  function toggle() {
    if (open) setChildren(null);
    else load();
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => subscription.remove();
  }, [open]);

  return <View style={ui.group}>
    <View style={styles.actions}>
      <Button label={open ? 'Masquer les autorisations photo' : 'Autorisations photo'}
        icon="images-outline" busy={busy} onPress={toggle} secondary />
    </View>
    {open && <>
      {children === null && busy && <Text style={styles.body}>Chargement des autorisations…</Text>}
      {children?.length === 0 && <Text style={styles.body}>Aucun enfant rattaché à ce compte.</Text>}
      {children?.map((child) => <View style={ui.status} key={child.id}>
        <Text style={styles.label}>{child.displayName}</Text>
        <AuthorizationStatus status={child.status} />
      </View>)}
      {children?.length > 0 && <Text style={styles.body}>Contactez l’école pour modifier une autorisation.</Text>}
    </>}
  </View>;
}

const ui = StyleSheet.create({
  group: { gap: 10 },
  status: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', borderRadius: 12,
    padding: 12, backgroundColor: '#f0f4eb' },
});
