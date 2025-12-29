import React, { useState } from 'react';
import { Alert, Button, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/Themed';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

function isValidHttpUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function AddScreen() {
  const { session } = useSession();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function onAdd() {
    const userId = session?.user.id;
    if (!userId) {
      Alert.alert('エラー', 'ログイン状態を確認できませんでした。');
      return;
    }
    const input = url.trim();
    if (!isValidHttpUrl(input)) {
      Alert.alert('入力エラー', 'http/https のURLを入力してください。');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('articles')
        .insert({
          user_id: userId,
          url: input,
          status: 'unread',
          extract_status: 'queued',
        })
        .select('id')
        .single();

      if (error) {
        Alert.alert('保存失敗', error.message);
        return;
      }

      // Phase 2: Edge Function（extract-article）が用意されていれば抽出を開始
      if (data?.id) {
        supabase.functions
          .invoke('extract-article', { body: { articleId: data.id, url: input } })
          .catch(() => {
            // 未デプロイ等は非致命（本棚に queued のまま残す）
          });
      }

      setUrl('');
      // まずは本棚へ戻す（抽出はPhase2で）
      router.replace('/(tabs)');
      // すぐ読む場合はReaderへ
      if (data?.id) router.push(`/reader/${data.id}`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>URLを追加</Text>
      <Text style={styles.help}>
        ブラウザ共有からの追加（Phase 1）にも対応予定です。まずはURLを貼り付けて保存できます。
      </Text>

      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://example.com/article"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
      />

      <Button title={isLoading ? '保存中…' : '保存'} onPress={onAdd} disabled={isLoading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  help: { opacity: 0.7 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
});

