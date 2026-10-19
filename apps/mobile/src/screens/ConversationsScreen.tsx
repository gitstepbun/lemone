import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { RootStack } from '../../App';
import { api, ApiError } from '../lib/api';
import { loadTokens, logout } from '../lib/auth';

interface Conv { id: string; type: string; title: string; verified: boolean; unread: number; lastMessage: { body: string | null } | null }

export function ConversationsScreen({ navigation, onLogout }: NativeStackScreenProps<RootStack, 'Conversations'> & { onLogout: () => void }) {
  const [items, setItems] = useState<Conv[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api<Conv[]>('/chat/conversations')); setError(null); }
    catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { await logout(await loadTokens()); onLogout(); return; }
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [onLogout]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    navigation.setOptions({ headerRight: () => <Pressable onPress={async () => { await logout(await loadTokens()); onLogout(); }}><Text style={{ color: '#B3261E' }}>Keluar</Text></Pressable> });
  }, [navigation, onLogout]);
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {error ? <Text style={{ color: '#B3261E', padding: 12 }}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={{ padding: 16, color: '#6B7280' }}>Belum ada percakapan. Tarik untuk memuat ulang.</Text> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('Conversation', { id: item.id, title: item.title })} style={{ padding: 14, borderBottomWidth: 1, borderColor: '#eee', flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }}>{item.title}{item.verified ? ' ✓' : ''}</Text>
              <Text numberOfLines={1} style={{ color: '#6B7280' }}>{item.lastMessage?.body ?? ''}</Text>
            </View>
            {item.unread > 0 ? <View style={{ backgroundColor: '#FFCC00', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontSize: 12 }}>{item.unread}</Text></View> : null}
          </Pressable>
        )}
      />
    </View>
  );
}
