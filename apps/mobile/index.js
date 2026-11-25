import { registerRootComponent } from 'expo';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage, parseSchoolAddress } from './parent/http';
import { listChildren, needsSchoolAddress, signIn, signOut } from './parent/session';

function Button({ label, onPress, busy, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, (pressed || busy) && styles.dimmed]}
    >
      <Text style={secondary ? styles.secondaryLabel : styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCorrect={false}
        autoComplete="off"
        placeholderTextColor="#536158"
        style={styles.input}
        {...props}
      />
    </View>
  );
}

function ParentApp() {
  const [phase, setPhase] = useState('loading');
  const [children, setChildren] = useState([]);
  const [address, setAddress] = useState('');
  const [school, setSchool] = useState('');
  const [invitation, setInvitation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);

  async function run(operation) {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  async function load(requireSession = false) {
    setPhase('loading');
    setChildren([]);
    try {
      const roster = await listChildren();
      if (roster === null) {
        setPhase('login');
        if (requireSession) setError('La session n’a pas pu être ouverte. Contactez votre école pour obtenir un nouveau code.');
      } else {
        setChildren(roster);
        setPhase('children');
      }
    } catch (failure) {
      setPhase('unavailable');
      throw failure;
    }
  }

  useEffect(() => {
    void run(load);
  }, []);

  useEffect(() => {
    if (phase !== 'children') return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run(load);
    });
    return () => subscription.remove();
  }, [phase]);

  function submit() {
    void run(async () => {
      const origin = needsSchoolAddress ? parseSchoolAddress(address) : undefined;
      if (needsSchoolAddress && !origin) {
        setError('Saisissez l’adresse HTTPS de votre école, sans chemin.');
        return;
      }
      const schoolCode = school.trim().toUpperCase();
      const letters = invitation.toUpperCase().replaceAll(/[\s-]/g, '');
      if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode) || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(letters)) {
        setError('Vérifiez le code de l’école et le code d’invitation à 12 caractères.');
        return;
      }
      const code = letters.match(/.{4}/g).join('-');
      await signIn({ origin, schoolCode, code });
      setInvitation('');
      await load(true);
    });
  }

  function logout() {
    void run(async () => {
      await signOut();
      setChildren([]);
      setInvitation('');
      setPhase('login');
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.brand}>Open Cartable</Text>
          </View>

          {phase === 'loading' && (
            <View style={styles.panel}>
              <ActivityIndicator accessibilityLabel="Chargement" color="#225344" />
              <Text style={styles.body}>Chargement de votre espace…</Text>
            </View>
          )}

          {phase === 'login' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.title}>Connexion parent</Text>
              <Text style={styles.body}>Saisissez les codes remis par votre école.</Text>
              {needsSchoolAddress && (
                <Field
                  label="Adresse de l’école"
                  value={address}
                  onChangeText={setAddress}
                  autoCapitalize="none"
                  keyboardType="url"
                  placeholder="https://ent.ecole.example"
                  maxLength={512}
                  editable={!busy}
                />
              )}
              <Field label="Code de l’école" value={school} onChangeText={setSchool} autoCapitalize="characters" maxLength={32} editable={!busy} />
              <Field
                label="Code d’invitation"
                value={invitation}
                onChangeText={setInvitation}
                autoCapitalize="characters"
                secureTextEntry
                maxLength={24}
                onSubmitEditing={submit}
                returnKeyType="go"
                editable={!busy}
              />
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <Button label={busy ? 'Connexion…' : 'Se connecter'} busy={busy} onPress={submit} />
            </View>
          )}

          {phase === 'children' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.title}>Vos enfants</Text>
              {children.length === 0 && <Text style={styles.body}>Aucun enfant n’est rattaché à votre compte. Contactez votre école.</Text>}
              {children.map((child) => (
                <View key={child.id} style={styles.child}>
                  <Text style={styles.childName}>{child.displayName}</Text>
                  <Text style={styles.body}>{child.className}</Text>
                </View>
              ))}
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button label="Actualiser" busy={busy} onPress={() => void run(load)} secondary />
                <Button label={busy ? 'Déconnexion…' : 'Se déconnecter'} busy={busy} onPress={logout} secondary />
              </View>
            </View>
          )}

          {phase === 'unavailable' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.title}>Votre espace est indisponible</Text>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button label="Réessayer" busy={busy} onPress={() => void run(load)} />
                <Button label="Se déconnecter" busy={busy} onPress={logout} secondary />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function App() {
  return <SafeAreaProvider><ParentApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f3f0e5' },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 36 },
  content: { width: '100%', maxWidth: 560, gap: 18 },
  header: { backgroundColor: '#17372d', paddingHorizontal: 24, paddingVertical: 18, borderRadius: 18 },
  brand: { color: '#fff7df', fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  panel: { borderColor: '#dddaca', borderWidth: 1, borderRadius: 18, padding: 24, backgroundColor: '#fffdf6', gap: 16 },
  title: { color: '#132d25', fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  body: { color: '#3a4d43', fontSize: 16, lineHeight: 23 },
  field: { gap: 6 },
  label: { color: '#17372d', fontSize: 15, fontWeight: '700' },
  input: { color: '#132d25', fontSize: 16, minHeight: 48, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#929e91', backgroundColor: '#fff' },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#225344' },
  buttonLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: { backgroundColor: '#e7ede4' },
  secondaryLabel: { color: '#17372d', fontSize: 16, fontWeight: '700' },
  dimmed: { opacity: 0.65 },
  error: { color: '#862929', fontSize: 15, lineHeight: 21 },
  child: { paddingVertical: 13, paddingHorizontal: 16, backgroundColor: '#eef1e9', borderRadius: 12, gap: 4 },
  childName: { color: '#132d25', fontSize: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});

registerRootComponent(App);
