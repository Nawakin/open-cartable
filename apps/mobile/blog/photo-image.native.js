import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { fromByteArray } from 'base64-js';

export function PhotoImage({ path, label, request, fit = 'cover' }) {
  const [source, setSource] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(null);
    setFailed(false);
    request(path, { responseType: 'bytes' }).then((data) => {
      if (active) setSource({ uri: 'data:image/jpeg;base64,' + fromByteArray(new Uint8Array(data)) });
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [path, request]);

  if (source) return <Image source={source} accessibilityLabel={label} resizeMode={fit} style={StyleSheet.absoluteFill} />;
  return <View style={styles.wait}>
    {failed ? <Text style={styles.error}>Photo indisponible</Text> : <ActivityIndicator color="#819f8c" />}
  </View>;
}

const styles = StyleSheet.create({
  wait: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#43584c', backgroundColor: '#fffdf6', padding: 6 },
});
