import React, { useEffect, useState } from 'react';
import { notificationIds, NotificationOptions } from './options';

const path = '/web/notifications';

async function supportsDestinations(worker) {
  if (!worker) return 1;
  const channel = new MessageChannel();
  try {
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(1), 900);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timeout);
        resolve([2, 3].includes(data) ? data : 1);
      };
      worker.postMessage('notification-version', [channel.port2]);
    });
  } finally {
    channel.port1.close();
  }
}

async function saveSubscription(request, registration, subscription) {
  const { endpoint, keys: { p256dh, auth } } = subscription.toJSON();
  const payloadVersion = await supportsDestinations(registration.active);
  await request(path, { method: 'PUT', body: { endpoint, p256dh, auth, ...(payloadVersion > 1 ? { payloadVersion } : {}) } });
  return payloadVersion;
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
      if (result.enabled && result.payloadVersion < 3) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const payloadVersion = await supportsDestinations(registration?.active);
        if (payloadVersion <= result.payloadVersion || !current) return;
        const saved = await request(path, { method: 'PATCH', body: { payloadVersion } });
        if (current) setSettings((old) => old?.enabled ? { ...old, payloadVersion: saved.payloadVersion } : old);
      }
    }).catch((error) => {
      if (!current) return;
      if (error.status === 401) onExpired();
      else setProblem(error.status === 404 ? 'Les notifications web ne sont pas activées par votre école.'
        : 'Les réglages n’ont pas pu être chargés. Revenez dans ce menu pour réessayer.');
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
        setSettings({ ...settings, enabled: false, categories: notificationIds, weekends: true, payloadVersion: 3 });
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

  return <NotificationOptions settings={settings} busy={busy}
    problem={available ? problem : 'Ce navigateur ne prend pas en charge les notifications de l’ENT.'} change={change} save={save} />;
}
