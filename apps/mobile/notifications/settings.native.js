import React, { useEffect, useRef, useState } from 'react';
import { notificationIds, NotificationOptions } from './options';
import { pushPath, requestDeviceToken } from './device';

export function PushSettings({ request, onExpired }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!pushPath) return;
    mounted.current = true;
    request(pushPath).then((value) => {
      if (mounted.current) setSettings(value);
    }).catch((error) => {
      if (mounted.current && error.status === 401) onExpired();
    });
    return () => { mounted.current = false; };
  }, [request]);

  async function run(operation, message) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem('');
    try {
      await operation();
    } catch (error) {
      if (mounted.current) {
        if (error.status === 401) onExpired();
        else setProblem(message);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function change() {
    return run(async () => {
      if (settings.enabled) {
        await request(pushPath, { method: 'DELETE' });
        setSettings({ ...settings, enabled: false, categories: notificationIds, weekends: true });
        return;
      }
      const token = await requestDeviceToken();
      if (!mounted.current) return;
      if (!token) {
        setProblem('Autorisez les notifications d’Open Cartable dans les réglages de l’appareil.');
        return;
      }
      await request(pushPath, { method: 'PUT', body: { token } });
      setSettings({ ...settings, enabled: true });
    }, 'Impossible de modifier les notifications sur cet appareil. Réessayez dans un instant.');
  }

  function save(update) {
    return run(async () => {
      const next = await request(pushPath, { method: 'PATCH', body: { categories: settings.categories, weekends: settings.weekends, ...update } });
      setSettings((current) => ({ ...current, ...next }));
    }, 'Les préférences n’ont pas été enregistrées. Réessayez dans un instant.');
  }

  return <NotificationOptions settings={settings} busy={busy} problem={problem} change={change} save={save} />;
}
