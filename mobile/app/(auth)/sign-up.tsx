import React, { useState } from 'react';
import { Alert, Button, StyleSheet, TextInput, View } from 'react-native';
import { Link, router } from 'expo-router';

import { Text } from '@/components/Themed';
import { supabase } from '@/lib/supabase';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function onSignUp() {
    if (!email || !password) {
      Alert.alert('入力エラー', 'メールアドレスとパスワードを入力してください。');
      return;
    }
    if (password.length < 8) {
      Alert.alert('入力エラー', 'パスワードは8文字以上を推奨します。');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        Alert.alert('登録失敗', error.message);
        return;
      }
      Alert.alert('登録完了', '確認メールが届く設定の場合はメールを確認してください。');
      router.replace('/(tabs)');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>新規登録</Text>

      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="メールアドレス"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        autoCapitalize="none"
        placeholder="パスワード"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      <Button title={isLoading ? '処理中…' : '登録'} onPress={onSignUp} disabled={isLoading} />

      <View style={styles.footer}>
        <Text>すでにアカウントがある場合：</Text>
        <Link href="/(auth)/sign-in">ログイン</Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  footer: { marginTop: 12, alignItems: 'center', gap: 6 },
});

