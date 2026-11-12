// bUild eYes — the link between EYEs. The headset is the HOST: it runs the creatures' minds and sends
// the world ~20× a second. Every other EYE (phone, tablet, laptop cam) only shows it and sends wishes back
// (drop food here, …). Peer-to-peer over WebRTC; the free PeerJS broker only introduces the devices.
import Peer from 'peerjs';
const PREFIX = 'build-eyes-v1-';
export const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');

export function hostRoom(code, { onMsg = () => { }, onCount = () => { }, onError = () => { } } = {}) {
  const peers = new Set();
  let peer, dead = false;
  const open = () => {
    peer = new Peer(PREFIX + code, { debug: 0 });
    peer.on('connection', c => {
      c.on('open', () => { peers.add(c); onCount(peers.size); });
      c.on('data', d => onMsg(d, c));
      c.on('close', () => { peers.delete(c); onCount(peers.size); });
      c.on('error', () => { peers.delete(c); onCount(peers.size); });
    });
    peer.on('error', e => { onError(e); if (!dead && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error')) setTimeout(() => { try { peer.destroy(); } catch (_) { } open(); }, 3000); });
    peer.on('disconnected', () => { if (!dead) try { peer.reconnect(); } catch (_) { } });
  };
  open();
  return {
    code, get count() { return peers.size; },
    send(msg) { for (const c of peers) if (c.open) try { c.send(msg); } catch (_) { } },
    close() { dead = true; try { peer.destroy(); } catch (_) { } },
  };
}

export function joinRoom(code, { onMsg = () => { }, onState = () => { } } = {}) {
  let peer, conn, dead = false, retry;
  const go = () => {
    peer = new Peer(undefined, { debug: 0 });
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
      conn.on('open', () => onState('linked'));
      conn.on('data', d => onMsg(d));
      conn.on('close', () => { onState('lost'); again(); });
      conn.on('error', () => { onState('lost'); again(); });
    });
    peer.on('error', e => { onState(e.type === 'peer-unavailable' ? 'nohost' : 'lost'); again(); });
  };
  const again = () => { if (dead || retry) return; retry = setTimeout(() => { retry = null; try { peer.destroy(); } catch (_) { } go(); }, 2500); };
  go();
  return {
    send(msg) { if (conn && conn.open) try { conn.send(msg); } catch (_) { } },
    close() { dead = true; clearTimeout(retry); try { peer.destroy(); } catch (_) { } },
  };
}
