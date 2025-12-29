import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: 'ログイン' }} />
      <Stack.Screen name="sign-up" options={{ title: '新規登録' }} />
    </Stack>
  );
}

