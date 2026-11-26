import React, { useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { AuthenticatorField, EmailField, validCode, validEmail, validPassword } from './fields';

export function consumeRecoveryLink() {
  if (Platform.OS !== 'web') return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const verify = params.has('verification');
  if (!verify && !params.has('recuperation')) return null;
  const token = params.get(verify ? 'verification' : 'recuperation') ?? '';
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return { phase: verify ? 'verify' : 'reset', token };
}

export function DirectionRecovery({ flow, school, request, onBack }) {
  const [schoolCode, setSchoolCode] = useState(school);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [requireCode, setRequireCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const requestLink = flow.phase === 'request';
  const passwordReset = flow.phase === 'reset';
  const invalidLink = !requestLink && !/^[A-Za-z0-9_-]{43}$/.test(flow.token);
  const heading = requestLink ? 'Mot de passe oublié' : passwordReset ? 'Nouveau mot de passe direction' : 'Vérifier l’adresse de récupération';
  const action = requestLink ? 'Demander un lien' : passwordReset ? 'Enregistrer le mot de passe' : 'Vérifier mon adresse';

  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const body = requestLink ? { schoolCode: schoolCode.trim().toUpperCase(), email: email.trim() }
      : passwordReset ? { token: flow.token, password, ...(code ? { code } : {}) } : { token: flow.token };
    try {
      await request('/recovery/' + flow.phase, { method: 'POST', body });
      setDone(true);
      setPassword('');
      setConfirmation('');
      setCode('');
    } catch (failure) {
      if (failure.status === 428) setRequireCode(true);
      else if (failure.status === 429) setError('Trop de demandes. Réessayez dans une minute.');
      else if (failure.status === 400 && passwordReset && requireCode) {
        setError('Vérifiez le code de l’authentificateur. Si le lien a expiré, demandez-en un nouveau.');
      } else if (failure.status === 400 && !requestLink) setError('Ce lien a expiré ou a déjà été utilisé.');
      else setError('L’opération n’a pas abouti. Réessayez dans un instant.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const valid = requestLink
    ? /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode.trim().toUpperCase()) && validEmail(email)
    : !invalidLink && (!passwordReset || (validPassword(password) && confirmation === password && (!requireCode || validCode(code))));

  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.title}>{heading}</Text>
    {done ? <Text accessibilityLiveRegion="polite" style={styles.body}>{requestLink
      ? 'Si l’adresse correspond à un compte vérifié, un lien de récupération vous sera envoyé.'
      : passwordReset ? 'Mot de passe enregistré. Connectez-vous avec votre nouveau mot de passe.' : 'Adresse de récupération vérifiée.'}</Text>
      : <>
        {invalidLink && <Text accessibilityRole="alert" style={styles.error}>Le lien est incomplet. Ouvrez le lien reçu par e-mail.</Text>}
        {requestLink && <>
          <Field label="Code de l’école" value={schoolCode} onChangeText={setSchoolCode} maxLength={32}
            autoCapitalize="characters" editable={!busy} />
          <EmailField value={email} onChangeText={setEmail} editable={!busy} />
        </>}
        {passwordReset && !invalidLink && <>
          <Field label="Nouveau mot de passe" value={password} onChangeText={setPassword} secureTextEntry
            maxLength={256} editable={!busy} autoComplete="new-password" />
          <Field label="Confirmer le nouveau mot de passe" value={confirmation} onChangeText={setConfirmation}
            secureTextEntry maxLength={256} editable={!busy} autoComplete="new-password" />
          {requireCode && <AuthenticatorField value={code} onChangeText={setCode} editable={!busy} autoFocus />}
          {password && !validPassword(password) && <Text style={styles.body}>Choisissez un mot de passe de 15 à 128 caractères.</Text>}
        </>}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {valid || !invalidLink ? <Button label={action} busy={busy || !valid} onPress={() => void submit()} /> : null}
      </>}
    <Button label="Retour à l’espace direction" secondary busy={busy}
      onPress={() => onBack(done && passwordReset)} />
  </View>;
}
