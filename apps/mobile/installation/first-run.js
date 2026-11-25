import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { RequestError } from '../parent/http';

const endpoint = '/api/v1/installation';
const empty = { schoolName: '', schoolCode: '', className: '', studentName: '' };
const example = { schoolName: 'École de démonstration', schoolCode: 'ECOLE-DEMO', className: 'Classe fictive A', studentName: 'Élève fictif A' };
const fields = [
  { key: 'schoolName', label: 'Nom de l’école', maxLength: 100 },
  { key: 'schoolCode', label: 'Code de l’école', maxLength: 32 },
  { key: 'className', label: 'Nom de la classe', maxLength: 100 },
  { key: 'studentName', label: 'Nom d’affichage du premier élève', maxLength: 100 },
];

export function consumeInstallationLink() {
  if (Platform.OS !== 'web') return '';
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has('installation')) return '';
  const token = params.get('installation');
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return /^[0-9a-f]{64}$/.test(token) ? token : '';
}

async function request(options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(endpoint, {
      ...options, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
    });
  } catch {
    throw new RequestError(0);
  } finally {
    clearTimeout(timeout);
  }
}

export async function needsInstallation() {
  if (Platform.OS !== 'web') return false;
  const response = await request();
  if (response.status === 404) return false;
  if (!response.ok) throw new RequestError(response.status);
  return !(await response.json()).installed;
}

export function FirstRun({ token, onComplete }) {
  const [form, setForm] = useState(empty);
  const [manualToken, setManualToken] = useState('');
  const [directionPassword, setDirectionPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const [alreadyInstalled, setAlreadyInstalled] = useState(false);
  const [problem, setProblem] = useState('');
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current || alreadyInstalled) return;
    const setupToken = token || manualToken.trim().toLowerCase();
    setProblem('');
    if (!/^[0-9a-f]{64}$/.test(setupToken)) {
      setProblem('Saisissez le code du lanceur ou rouvrez le site depuis le lanceur.');
      return;
    }
    const values = Object.fromEntries(fields.map(({ key }) => [key, form[key].trim()]));
    values.schoolCode = values.schoolCode.toUpperCase();
    if (!Object.values(values).every(Boolean) || !/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(values.schoolCode)) {
      setProblem('Renseignez les quatre champs. Le code de l’école contient 2 à 32 lettres, chiffres ou tirets.');
      return;
    }
    if (!directionPassword.trim() || [...directionPassword].length < 15
      || [...directionPassword].length > 128 || confirmation !== directionPassword) {
      setProblem('Choisissez un mot de passe direction de 15 à 128 caractères et confirmez-le.');
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const response = await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, token: setupToken, directionPassword }),
      });
      if (response.status === 409) {
        setAlreadyInstalled(true);
      } else if (response.status === 403) {
        setProblem('Le lien d’installation ne correspond pas à ce serveur. Rouvrez le site depuis le lanceur.');
      } else if (response.ok) {
        setResult(await response.json());
        setManualToken('');
        setDirectionPassword('');
        setConfirmation('');
      } else {
        setProblem('Vérifiez les champs ou réessayez après avoir consulté le journal du serveur.');
      }
    } catch {
      setProblem('Le serveur a interrompu la connexion. Réessayez ou rouvrez le lanceur.');
    } finally {
      setPending(false);
      submitting.current = false;
    }
  }

  if (result) {
    return (
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>École configurée</Text>
        <Text style={styles.body}>Ce premier code ouvre un compte parent. Il est utilisable une seule fois et expire dans sept jours.</Text>
        <View style={setupStyles.credentials}>
          <Text style={styles.label}>Code de l’école</Text>
          <Text selectable style={setupStyles.value}>{result.schoolCode}</Text>
          <Text style={styles.label}>Invitation parent</Text>
          <Text selectable style={setupStyles.value}>{result.code}</Text>
        </View>
        <Button label="Aller à la connexion" onPress={() => onComplete(result)} />
      </View>
    );
  }

  if (alreadyInstalled) {
    return (
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>École déjà configurée</Text>
        <Button label="Aller à la connexion" onPress={() => onComplete()} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Configurer Open Cartable</Text>
      <Text style={styles.body}>Créez votre école, une première classe et les accès direction et parent.</Text>
      <Button label="Remplir un exemple fictif" busy={pending} secondary onPress={() => setForm(example)} />
      {!token && (
        <Field label="Code d’installation" value={manualToken} onChangeText={setManualToken}
          secureTextEntry autoCapitalize="none" maxLength={64} editable={!pending} />
      )}
      {fields.map(({ key, label, maxLength }) => (
        <Field key={key} label={label} maxLength={maxLength} value={form[key]}
          autoCapitalize={key === 'schoolCode' ? 'characters' : 'sentences'}
          onChangeText={(value) => setForm((previous) => ({ ...previous, [key]: value }))}
          editable={!pending} />
      ))}
      <Field label="Mot de passe direction" value={directionPassword} onChangeText={setDirectionPassword}
        secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={256} editable={!pending} />
      <Field label="Confirmer le mot de passe direction" value={confirmation} onChangeText={setConfirmation}
        secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={256} editable={!pending} />
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      <Button label={pending ? 'Configuration…' : 'Créer l’école'} busy={pending} onPress={submit} />
    </View>
  );
}

const setupStyles = StyleSheet.create({
  credentials: { backgroundColor: '#eef1e9', padding: 16, gap: 8, borderRadius: 12 },
  value: { color: '#132d25', fontSize: 20, fontWeight: '700' },
});
