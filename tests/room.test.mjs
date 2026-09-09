import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomConnection } from '../dist/room.js';

test('room welcome, chat, backpressure, terminal close and disposal', () => {
  const previous = globalThis.WebSocket;
  const sockets = [];
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    bufferedAmount = 0;
    sent = [];
    constructor(endpoint) {
      this.endpoint = endpoint;
      sockets.push(this);
    }
    send(message) {
      this.sent.push(JSON.parse(message));
    }
    close(code) {
      this.readyState = 3;
      this.onclose?.({ code });
    }
    message(message) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  globalThis.WebSocket = Socket;
  try {
    const room = new RoomConnection(async () => ({}), 'wss://world.example/room');
    let chat;
    room.on('chat', (value) => {
      chat = value;
    });
    room.connect();
    room.connect();
    assert.equal(sockets.length, 1);
    const socket = sockets[0];
    socket.onmessage({ data: 'null' });
    socket.onmessage({ data: 'broken JSON' });
    socket.message({
      type: 'welcome',
      actorId: 'test',
      expiresAt: Date.now() + 10000,
      snapshot: { actors: [] },
    });
    assert.equal(room.state, 'ready');
    assert.equal(room.send({ type: 'chat', text: 'hello' }), 1);
    assert.equal(socket.sent[0].seq, 1);
    socket.message({ type: 'chat', message: { text: 'hello' } });
    assert.equal(chat.text, 'hello');
    socket.bufferedAmount = 20000;
    assert.equal(room.send({ type: 'chat', text: 'blocked' }), 0);
    socket.close(4003);
    assert.equal(room.state, 'expired');
    room.dispose();
    assert.equal(room.state, 'offline');
  } finally {
    globalThis.WebSocket = previous;
  }
});
