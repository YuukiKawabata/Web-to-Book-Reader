import React, { useState } from 'react';
import { Alert, Button, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const { session } = useSession();
  const [isLoading, setIsLoading] = useState(false);

  async function onSignOut() {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) Alert.alert('ログアウト失敗', error.message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>設定</Text>
      <Text style={styles.meta}>ログイン中：{session?.user.email ?? '（不明）'}</Text>

      <View style={styles.box}>
        <Text style={styles.boxTitle}>読書設定</Text>
        <Text style={styles.boxText}>フォント/行間/テーマはPhase 3で実装します。</Text>
      </View>

      <Button title={isLoading ? '処理中…' : 'ログアウト'} onPress={onSignOut} disabled={isLoading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  meta: { opacity: 0.7 },
  box: { borderWidth: 1, borderColor: '#0000001a', borderRadius: 10, padding: 12, gap: 6 },
  boxTitle: { fontWeight: '700' },
  boxText: { opacity: 0.7 },
});

