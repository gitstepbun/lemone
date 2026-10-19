import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { RootStack } from '../../App';
import { api } from '../lib/api';

interface Msg { id: string; seq: number; sender_name: string; via_username: string | null; kind: string; body: string | null; payload: Record<string, unknown>; created_at: string; pending?: boolean; clientMsgId?: string }

export function ConversationScreen({ route }: NativeStackScreenProps<RootStack, 'Conversation'>) {
  const { id } = route.params;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const load = useCallback(async () => setMsgs(await api<Msg[]>(`/chat/conversations/${id}/messages?limit=100`)), [id]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const send = async (body: string, clientMsgId = Crypto.randomUUID()) => {
    setText('');
    setMsgs((m) => [...m.filter((x) => x.clientMsgId !== clientMsgId), { id: clientMsgId, clientMsgId, seq: 0, sender_name: 'Saya', via_username: null, kind: 'TEXT', body, payload: {}, created_at: new Date().toISOString(), pending: true }]);
    try {
      await api(`/chat/conversations/${id}/messages`, { method: 'POST', json: { clientMsgId, body } });
      await load();
    } catch {
      setMsgs((m) => m.map((x) => (x.clientMsgId === clientMsgId ? { ...x, pending: true, body: `${body}` } : x)));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <FlatList
        data={[...msgs].reverse()}
        inverted
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <View style={{ padding: 10, marginHorizontal: 12, marginVertical: 4, borderRadius: 14, backgroundColor: item.kind === 'CARD' ? '#FFFCF7' : '#F3F4F6', borderWidth: item.kind === 'CARD' ? 1 : 0, borderColor: '#FFCC00' }}>
            <Text style={{ fontSize: 12, color: '#6B7280' }}>{item.via_username ? `@${item.via_username} · ` : ''}{item.sender_name}</Text>
            {item.kind === 'CARD' ? (
              <View>
                <Text style={{ fontWeight: '600' }}>{String(item.payload.typeLabel ?? item.body ?? '')}</Text>
                {item.payload.dateLabel ? <Text>{String(item.payload.dateLabel)}</Text> : null}
                {item.payload.statusLabel ? <Text style={{ color: '#B07A00' }}>{String(item.payload.statusLabel)}</Text> : null}
                {item.payload.erpSyncLabel ? <Text style={{ color: '#6B7280' }}>{String(item.payload.erpSyncLabel)}</Text> : null}
              </View>
            ) : <Text>{item.body}</Text>}
            {item.pending ? <Pressable onPress={() => send(item.body ?? '', item.clientMsgId)}><Text style={{ color: '#B3261E', fontSize: 12 }}>Belum terkirim. Ketuk untuk kirim ulang</Text></Pressable> : null}
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', padding: 10, borderTopWidth: 1, borderColor: '#eee' }}>
        <TextInput value={text} onChangeText={setText} placeholder="Tulis pesan" style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 10 }} />
        <Pressable onPress={() => text.trim() && send(text.trim())} style={{ backgroundColor: '#FFCC00', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', marginLeft: 8 }}><Text style={{ fontWeight: '600' }}>Kirim</Text></Pressable>
      </View>
    </View>
  );
}
