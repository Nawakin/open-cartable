import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';

const path = '/web/notifications';

export function PushSettings({ request, onExpired }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const available = globalThis.isSecureContext && 'Notification' in globalThis
    && 'PushManager' in globalThis && 'serviceWorker' in navigator;

  useEffect(() => {
    if (!available) return;
    let current = true;
    request(path).then((result) => {
      if (current) setSettings(result);
    }).catch((error) => {
      if (current && error.status === 401) onExpired();
    });
    return () => { current = false; };
  }, [request, available]);

  async function change() {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      if (settings.enabled) {
        await request(path, { method: 'DELETE' });
        setSettings({ ...settings, enabled: false });
        const registration = await navigator.serviceWorker.getRegistration('/');
        await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setProblem('Autorisez les notifications de ce site dans les réglages du navigateur.');
        return;
      }
      await navigator.serviceWorker.register('/open-cartable-sw.js', { scope: '/' });
      const { pushManager } = await navigator.serviceWorker.ready;
      const subscription = await pushManager.getSubscription() ?? await pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: settings.publicKey,
      });
      const { endpoint, keys: { p256dh, auth } } = subscription.toJSON();
      try {
        await request(path, { method: 'PUT', body: { endpoint, p256dh, auth } });
      } catch (error) {
        await subscription.unsubscribe().catch(() => {});
        throw error;
      }
      setSettings({ ...settings, enabled: true });
    } catch (error) {
      if (error.status === 401) onExpired();
      else setProblem('Impossible de modifier les notifications sur ce navigateur. Réessayez dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return null;
  return <View style={styles.field}>
    <Text accessibilityRole="header" style={styles.label}>Notifications</Text>
    <Text style={styles.body}>Recevez une alerte sur cet appareil quand votre école publie une nouveauté ou vous écrit.</Text>
    {problem && <Text accessibilityRole="alert" style={styles.error}>{problem}</Text>}
    <View style={styles.actions}>
      <Button label={settings.enabled ? 'Désactiver les notifications' : 'Activer les notifications'} icon="notifications-outline"
        secondary busy={busy} onPress={() => void change()} />
    </View>
  </View>;
}
