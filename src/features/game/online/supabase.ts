import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Message, Transport, TransportHandlers } from './transport';

/**
 * Supabase Realtime transport.
 *
 * Uses broadcast channels only — no database tables, no rows, no auth. A match
 * is an ephemeral channel named after its room code, and the game lives in the
 * two clients' memory. That keeps the free tier comfortable and means there is
 * no stored personal data to look after.
 *
 * The client library is loaded on demand, not at startup: it is ~57KB gzipped
 * and most visitors only browse cards. Everything below the type imports is
 * behind a dynamic import, so the cost falls only on players who go online.
 *
 * Credentials come from the environment; the publishable (anon) key is designed
 * to be public and is baked into the bundle at build time either way. The
 * service_role key must never appear here.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isOnlineConfigured(): boolean {
  return Boolean(url && anonKey);
}

/** Human-readable reason online play is unavailable, or null if it is. */
export function onlineConfigProblem(): string | null {
  if (!url && !anonKey) return 'Online play is not configured — no Supabase credentials.';
  if (!url) return 'VITE_SUPABASE_URL is missing.';
  if (!anonKey) return 'VITE_SUPABASE_ANON_KEY is missing.';
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) {
    return `VITE_SUPABASE_URL does not look like a Supabase project URL: ${url}`;
  }
  return null;
}

let client: SupabaseClient | null = null;

async function getClient(): Promise<SupabaseClient> {
  if (!url || !anonKey) throw new Error(onlineConfigProblem() ?? 'Online play is not configured.');
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(url, anonKey, {
      auth: { persistSession: false },
      // One message per player action; no need for high throughput.
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}

export function createSupabaseTransport(
  roomCode: string,
  selfId: string,
  handlers: TransportHandlers,
): Transport {
  let channel: RealtimeChannel | null = null;

  return {
    async connect() {
      const supabase = await getClient();
      channel = supabase.channel(`riftforge:${roomCode}`, {
        config: {
          broadcast: { self: false, ack: true },
          presence: { key: selfId },
        },
      });

      channel
        .on('broadcast', { event: 'msg' }, ({ payload }) => {
          handlers.onMessage(payload as Message);
        })
        .on('presence', { event: 'sync' }, () => {
          // Anyone other than us in the room counts as the peer being present.
          const others = Object.keys(channel!.presenceState()).filter((k) => k !== selfId);
          handlers.onPeer(others.length > 0);
        });

      await new Promise<void>((resolve, reject) => {
        channel!.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            void channel!.track({ joinedAt: Date.now() });
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const error = err ?? new Error(`Realtime channel ${status}`);
            handlers.onError(error);
            reject(error);
          }
        });
      });
    },

    async send(message: Message) {
      if (!channel) throw new Error('Not connected.');
      const result = await channel.send({ type: 'broadcast', event: 'msg', payload: message });
      if (result !== 'ok') handlers.onError(new Error(`Send failed: ${result}`));
    },

    async disconnect() {
      await channel?.unsubscribe();
      channel = null;
    },
  };
}
