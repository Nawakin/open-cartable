import { registerRootComponent } from 'expo';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

function App() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Open Cartable</Text>
      <Text style={styles.description}>Espace numérique de travail pour le premier degré.</Text>
      <Text style={styles.description}>Version de développement. La connexion à une école sera disponible après la mise en place des comptes.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: '#f4f6ef' },
  title: { fontSize: 34, fontWeight: '700', color: '#142b25' },
  description: { fontSize: 17, color: '#294139', maxWidth: 440 },
});

registerRootComponent(App);
