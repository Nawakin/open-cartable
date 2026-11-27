import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import QRCode from 'qrcode/lib/browser';
import { Button, Field, styles } from '../parent/ui';
import { AuthenticatorField, EmailField, validCode, validEmail, validPassword } from './fields';

export function EnrollmentQr({ uri }) {
  const canvas = useRef(null);
  const [ready, setReady] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    void QRCode.toCanvas(canvas.current, uri, { width: 164, margin: 3, errorCorrectionLevel: 'M' })
      .catch(() => setReady(false));
  }, [uri]);
  return ready && Platform.OS === 'web' ? <canvas ref={canvas} role="img" aria-label="QR code pour configurer l’authentificateur" /> : null;
}

const failureMessage = (status) => ({
  400: 'Vérifiez les champs saisis.',
  409: 'Cette étape a expiré ou a changé. Fermez-la et rechargez les réglages.',
  422: 'Vérifiez le mot de passe ou le code de l’authentificateur.',
  429: 'Attendez une minute avant de renouveler la demande.',
  503: 'Le service est indisponible. Vérifiez la configuration du serveur.',
})[status] ?? 'L’opération a échoué. Réessayez dans un instant.';

export function DirectionSecurity({ request, onExpired }) {
  const [status, setStatus] = useState(null);
  const [panel, setPanel] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function run(task) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else setError(failureMessage(failure.status));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function load() {
    void run(async () => setStatus(await request('/security')));
  }
  useEffect(load, []);

  function show(next) {
    setPanel(next);
    setPassword('');
    setCode('');
    setEnrollment(null);
    setEmail(status?.email ?? '');
    setError('');
    setNotice('');
  }

  function update(path, method, body, message) {
    void run(async () => {
      const result = await request('/security' + path, { method, body });
      show(null);
      setStatus(result);
      setNotice(message);
    });
  }

  function begin() {
    void run(async () => {
      const result = await request('/security/totp', { method: 'POST', body: { password } });
      setPassword('');
      setCode('');
      setPanel('confirm');
      setEnrollment(result);
    });
  }

  function sendVerification() {
    void run(async () => {
      await request('/security/email/verify', { method: 'POST' });
      setNotice('Lien de vérification envoyé. Ouvrez-le pour confirmer votre adresse.');
    });
  }

  const passwordField = <Field label="Mot de passe direction actuel" value={password} onChangeText={setPassword}
    secureTextEntry editable={!busy} autoComplete="current-password" maxLength={256} />;
  const codeField = <AuthenticatorField value={code} onChangeText={setCode} editable={!busy} />;
  const cancel = <Button label="Annuler" secondary busy={busy} onPress={() => show(null)} />;

  return <View style={security.group}>
    <Text accessibilityRole="header" style={styles.title}>Sécurité du compte</Text>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
    {busy && !status && <Text style={styles.body}>Chargement des réglages…</Text>}
    {!busy && !status && error && <Button label="Réessayer" secondary onPress={load} />}
    {status && <>
      <View style={security.card}>
        <Text accessibilityRole="header" style={styles.label}>Récupération par e-mail</Text>
        <Text style={styles.body}>{status.email ? status.email + (status.verified ? ' · Vérifiée' : ' · À vérifier') : 'Adresse à renseigner'}</Text>
        {!status.mailAvailable && <Text style={styles.body}>Configurez le relais SMTP du serveur pour envoyer les liens.</Text>}
        {panel === 'email' ? <>
          <EmailField value={email} onChangeText={setEmail} editable={!busy} />
          {passwordField}
          {status.totpEnabled && codeField}
          <View style={styles.actions}>
            <Button label="Enregistrer l’adresse" icon="checkmark-outline"
              busy={busy || !validEmail(email) || !validPassword(password) || (status.totpEnabled && !validCode(code))}
              onPress={() => update('/email', 'PUT', { email: email.trim(), password, ...(code ? { code } : {}) }, 'Adresse enregistrée.')} />
            {cancel}
          </View>
        </> : !panel && <View style={styles.actions}>
          {status.email && !status.verified && status.mailAvailable && <Button label="Envoyer le lien de vérification"
            icon="mail-outline" busy={busy} onPress={sendVerification} />}
          <Button label={status.email ? 'Modifier l’adresse' : 'Ajouter une adresse'} secondary busy={busy} onPress={() => show('email')} />
          {status.email && !status.verified && status.mailAvailable && <Button label="Actualiser le statut"
            icon="refresh-outline" secondary busy={busy} onPress={load} />}
        </View>}
      </View>
      <View style={security.card}>
        <Text accessibilityRole="header" style={styles.label}>Double authentification</Text>
        <Text style={styles.body}>{status.totpEnabled ? 'Activée par authentificateur'
          : status.totpAvailable ? 'Disponible via un authentificateur TOTP' : 'Clé de double authentification à configurer sur le serveur'}</Text>
        {panel === 'begin' && <>
          {passwordField}
          <View style={styles.actions}>
            <Button label="Continuer" busy={busy || !validPassword(password)} onPress={begin} />
            {cancel}
          </View>
        </>}
        {panel === 'confirm' && enrollment && <>
          <Text style={styles.body}>Scannez le QR code avec votre application TOTP, ou saisissez la clé manuellement.</Text>
          <EnrollmentQr uri={enrollment.uri} />
          <Text style={styles.label}>Clé manuelle</Text>
          <Text selectable style={styles.body}>{enrollment.secret}</Text>
          {codeField}
          <View style={styles.actions}>
            <Button label="Activer la double authentification" icon="shield-checkmark-outline"
              busy={busy || !validCode(code)} onPress={() => update('/totp', 'PUT', { code }, 'Double authentification activée.')} />
            {cancel}
          </View>
        </>}
        {panel === 'disable' && <>
          {passwordField}
          {codeField}
          <View style={styles.actions}>
            <Button label="Confirmer la désactivation" busy={busy || !validPassword(password) || !validCode(code)}
              onPress={() => update('/totp', 'DELETE', { password, code }, 'Double authentification désactivée.')} />
            {cancel}
          </View>
        </>}
        {status.totpRequired && <Text style={styles.body}>La double authentification est obligatoire pour la direction.</Text>}
        {!panel && status.totpAvailable && !status.totpRequired && <View style={styles.actions}>
          <Button label={status.totpEnabled ? 'Désactiver' : 'Configurer un authentificateur'} icon="shield-checkmark-outline"
            secondary={status.totpEnabled} busy={busy} onPress={() => show(status.totpEnabled ? 'disable' : 'begin')} />
        </View>}
      </View>
    </>}
  </View>;
}

const security = StyleSheet.create({
  group: { gap: 14 },
  card: { backgroundColor: '#eef1e9', padding: 14, gap: 12, borderRadius: 12 },
});
