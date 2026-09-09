import type {
  RoomMessage,
  RoomSnapshot,
  ConnectionState,
  InputIntent,
  ClientMessage,
  ChatMessage,
  ChatError,
} from './wire/room.js';
import type { Appearance, WorldSession } from './core/contract.js';
export type { ChatMessage, ChatError } from './wire/room.js';
type Events = {
  state: ConnectionState;
  snapshot: RoomSnapshot;
  appearance: { actorId: string; appearance: Appearance };
  welcome: Extract<RoomMessage, { type: 'welcome' }>;
  chat: ChatMessage;
  chatError: ChatError;
  central: boolean;
  error: string;
};
export class RoomConnection {
  private socket?: WebSocket;
  private listeners = new Map<keyof Events, Set<(value: never) => void>>();
  private sequence = 0;
  private retries = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private generation = 0;
  private expiresAt = Infinity;
  state: ConnectionState = 'offline';
  actorId = '';
  constructor(
    private revalidate: () => Promise<WorldSession>,
    private endpoint = defaultEndpoint(),
  ) {}
  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (value: never) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (value: never) => void);
  }
  private emit<K extends keyof Events>(event: K, value: Events[K]) {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }
  private status(value: ConnectionState) {
    this.state = value;
    this.emit('state', value);
  }
  connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    )
      return;
    this.stopped = false;
    this.generation++;
    clearTimeout(this.timer);
    this.status(this.retries ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(this.endpoint);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      let message: RoomMessage;
      try {
        message = JSON.parse(String(event.data)) as RoomMessage;
      } catch {
        return;
      }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
      if (message.type === 'welcome') {
        this.actorId = message.actorId;
        this.expiresAt = message.expiresAt;
        this.sequence = 0;
        this.retries = 0;
        this.status('ready');
        this.emit('welcome', message);
        this.emit('snapshot', message.snapshot);
      }
      if (message.type === 'snapshot') this.emit('snapshot', message);
      if (message.type === 'chat') this.emit('chat', message.message);
      if (message.type === 'chat-error') this.emit('chatError', message);
      if (message.type === 'appearance')
        this.emit('appearance', { actorId: message.actorId, appearance: message.appearance });
      if (message.type === 'central') this.emit('central', message.available);
      if (message.type === 'error') this.emit('error', message.message);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.stopped) return;
      if (event.code === 4003 || event.code === 4002 || Date.now() >= this.expiresAt) {
        this.status('expired');
        return;
      }
      if ([4001, 4004, 4008].includes(event.code)) {
        this.status('offline');
        this.emit('error', event.reason || 'Room connection ended. Return Home to re-enter.');
        return;
      }
      this.retry();
    };
    socket.onerror = () => {
      this.emit('error', 'Room connection interrupted.');
    };
  }
  private retry() {
    if (this.stopped) return;
    if (this.retries >= 5) {
      this.status('offline');
      return;
    }
    this.status('reconnecting');
    const generation = this.generation;
    this.timer = globalThis.setTimeout(
      () => {
        void this.revalidate()
          .then(() => {
            if (!this.stopped && generation === this.generation) this.connect();
          })
          .catch((error: unknown) => {
            if (this.stopped || generation !== this.generation) return;
            const status = (error as { status?: number })?.status;
            if (status === 401 || status === 403 || Date.now() >= this.expiresAt) this.status('expired');
            else this.retry();
          });
      },
      Math.min(500 * 2 ** this.retries++, 5000),
    );
  }
  send(
    value:
      | Omit<InputIntent, 'seq'>
      | { type: 'chat'; text: string }
      | { type: 'emote'; id: 'wave' | 'dance' }
      | { type: 'interact'; id: 'showroom-switch' | 'race-ready' | 'respawn' | 'race-reset' }
      | { type: 'diagnostic'; stage: 'scene-ready' | 'room-joined' },
  ) {
    if (this.state !== 'ready' || this.socket?.readyState !== WebSocket.OPEN) return 0;
    if (this.socket.bufferedAmount > 16384) return 0;
    const message = { ...value, seq: ++this.sequence } as ClientMessage;
    this.socket.send(JSON.stringify(message));
    return message.seq;
  }
  disconnect() {
    this.generation++;
    this.stopped = true;
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'Leaving world');
    this.status('offline');
  }
  dispose() {
    this.disconnect();
    this.listeners.clear();
  }
}

function defaultEndpoint() {
  if (typeof location === 'undefined')
    throw new Error('Provide an explicit WebSocket endpoint outside a browser.');
  return new URL('/room', location.origin.replace(/^http/, 'ws')).href;
}
