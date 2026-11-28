import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout } from '../year-transition/ui';
import { Problem, schoolTimeLabel, useSchoolTask } from '../school-life/ui';

export function DeviceSettings({ request, onExpired }) {
  const [data, setData] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState(null);
  const { busy, problem, run } = useSchoolTask(onExpired);

  async function load() { setData(await request('/devices')); }
  useEffect(() => { void run(load); }, []);

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Mes appareils</Text>
    <Problem value={problem} />
    {data?.pairingAvailable && !pairing && <View style={styles.actions}>
      <Button label="Lier un appareil" icon="link-outline" busy={busy} onPress={() => void run(async () =>
        setPairing(await request('/devices/pair', { method: 'POST' })))} />
    </View>}
    {pairing && <View style={layout.card}>
      <Text style={styles.label}>Code de l’école · {data.schoolCode}</Text>
      <Text selectable style={layout.heading}>{pairing.code}</Text>
      <Text style={styles.body}>Saisissez ces codes sur l’écran de connexion du nouvel appareil. Gardez-les pour vous.</Text>
      <Text style={layout.status}>Valable jusqu’au {schoolTimeLabel(pairing.expiresAt)}</Text>
      <Button label="Masquer le code" secondary onPress={() => setPairing(null)} />
    </View>}
    {data?.devices.map((device) => <View key={device.id} style={layout.card}>
      <Text style={layout.heading}>{device.name || (device.current ? 'Cet appareil' : device.type || 'Appareil')}</Text>
      {device.name && device.current && <Text style={styles.label}>Cet appareil</Text>}
      <Text style={layout.status}>{[device.os, device.type].filter(Boolean).join(' · ') || 'Type et système à déterminer'}</Text>
      <Text style={layout.status}>{device.lastSeen ? 'Dernière connexion · ' + schoolTimeLabel(device.lastSeen) : 'Dernière connexion inconnue'}</Text>
      {renaming === device.id ? <>
        <Field label="Nom de l’appareil" value={name} onChangeText={setName} maxLength={60} editable={!busy} />
        <View style={styles.actions}>
          <Button label="Enregistrer le nom" busy={busy || !name.trim()} onPress={() => void run(async () => {
            await request('/devices/' + device.id, { method: 'PUT', body: { name } });
            setRenaming(null);
            await load();
          })} />
          <Button label="Annuler" secondary busy={busy} onPress={() => setRenaming(null)} />
        </View>
      </> : <View style={styles.actions}>
        <Button label="Nommer" secondary busy={busy} onPress={() => { setRenaming(device.id); setName(device.name ?? ''); }} />
        {!device.current && <Button label={removing === device.id ? 'Confirmer la révocation' : 'Révoquer'}
          secondary busy={busy} onPress={() => {
            if (removing !== device.id) return setRemoving(device.id);
            void run(async () => {
              await request('/devices/' + device.id, { method: 'DELETE' });
              setRemoving(null);
              await load();
            });
          }} />}
        {removing === device.id && <Button label="Annuler" secondary busy={busy} onPress={() => setRemoving(null)} />}
      </View>}
    </View>)}
  </View>;
}
