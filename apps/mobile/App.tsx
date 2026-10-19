import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { loadTokens, type Tokens } from './src/lib/auth';
import { ConversationScreen } from './src/screens/ConversationScreen';
import { ConversationsScreen } from './src/screens/ConversationsScreen';
import { LoginScreen } from './src/screens/LoginScreen';

export type RootStack = { Login: undefined; Conversations: undefined; Conversation: { id: string; title: string } };
const Stack = createNativeStackNavigator<RootStack>();

export default function App() {
  const [tokens, setTokens] = useState<Tokens | null | undefined>(undefined);
  useEffect(() => { loadTokens().then(setTokens); }, []);
  if (tokens === undefined) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerTintColor: '#1A1A1A' }}>
        {tokens ? (
          <>
            <Stack.Screen name="Conversations" options={{ title: 'Lemone Chat' }}>{(p) => <ConversationsScreen {...p} onLogout={() => setTokens(null)} />}</Stack.Screen>
            <Stack.Screen name="Conversation" component={ConversationScreen} options={({ route }) => ({ title: route.params.title })} />
          </>
        ) : (
          <Stack.Screen name="Login" options={{ headerShown: false }}>{() => <LoginScreen onLoggedIn={setTokens} />}</Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
