import React, { useEffect, useState } from 'react';
import { notificationIds, NotificationOptions } from './options';

const path = '/web/notifications';

async function supportsDestinations(worker) {
  if (!worker) return false;
  const channel = new MessageChannel();
  try {
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 900);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timeout);
        resolve(data === 2);
      };
      worker.postMessage('notification-version', [channel.port2]);
    });
  } finally {
    channel.port1.close();
  }
}

async function saveSubscription(request, registration, subscription) {
  const { endpoint, keys: { p256dh, auth } } = subscription.toJSON();
  const supportsLinks = await supportsDestinations(registration.active);
  await request(path, { method: 'PUT', body: { endpoint, p256dh, auth, ...(supportsLinks ? { payloadVersion: 2 } : {}) } });
  return supportsLinks ? 2 : 1;
}

export function PushSettings({ request, onExpired }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const available = globalThis.isSecureContext && 'Notification' in globalThis
    && 'PushManager' in globalThis && 'serviceWorker' in navigator;

  useEffect(() => {
    if (!available) return;
    let current = true;
    request(path).then(async (result) => {
      if (!current) return;
      setSettings(result);
      if (result.enabled && result.payloadVersion === 1) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (!await supportsDestinations(registration?.active) || !current) return;
        const { payloadVersion } = await request(path, { method: 'PATCH', body: { payloadVersion: 2 } });
        if (current) setSettings((old) => old?.enabled ? { ...old, payloadVersion } : old);
      }
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
        setSettings({ ...settings, enabled: false, categories: notificationIds, weekends: true, payloadVersion: 2 });
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
      const registration = await navigator.serviceWorker.ready;
      const { pushManager } = registration;
      const subscription = await pushManager.getSubscription() ?? await pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: settings.publicKey,
      });
      let payloadVersion;
      try {
        payloadVersion = await saveSubscription(request, registration, subscription);
      } catch (error) {
        await subscription.unsubscribe().catch(() => {});
        throw error;
      }
      setSettings({ ...settings, enabled: true, payloadVersion });
    } catch (error) {
      if (error.status === 401) onExpired();
      else setProblem('Impossible de modifier les notifications sur ce navigateur. Réessayez dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  async function save(update) {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      const next = await request(path, { method: 'PATCH',
        body: { categories: settings.categories, weekends: settings.weekends, ...update } });
      setSettings((current) => ({ ...current, ...next }));
    } catch (error) {
      if (error.status === 401) onExpired();
      else setProblem('Les préférences n’ont pas été enregistrées. Réessayez dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  return <NotificationOptions settings={settings} busy={busy} problem={problem} change={change} save={save} />;
}
