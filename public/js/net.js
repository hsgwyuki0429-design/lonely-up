import { CONFIG, STORAGE } from './config.js';

// Supabase 連携: 世界ランキング (Postgres) + オンラインプレイ (Realtime)
// 環境変数未設定でもオフラインモードとして動作する。
export class Net {
  constructor() {
    this.sb = null;
    this.channel = null;
    this.online = 1;
    this.connected = false;
    this._lastSend = 0;
    this._lastScoreSync = 0;
    this._lastSentBest = -1;

    this.cid = localStorage.getItem(STORAGE.CID);
    if (!this.cid) {
      this.cid = crypto.randomUUID();
      localStorage.setItem(STORAGE.CID, this.cid);
    }

    const env = window.__ENV || {};
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && window.supabase) {
      try {
        this.sb = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
      } catch (err) {
        console.warn('[net] supabase init failed', err);
      }
    }
  }

  get available() {
    return !!this.sb;
  }

  // ===== オンラインプレイ (Realtime Broadcast + Presence) =====
  join(me, { onPos, onCount, onJoin, onLeave, onChat } = {}) {
    if (!this.sb) return;
    this.channel = this.sb.channel('lonely-up:lobby', {
      config: {
        broadcast: { self: false },
        presence: { key: this.cid },
      },
    });

    this.channel
      .on('broadcast', { event: 'pos' }, ({ payload }) => {
        if (payload?.i !== this.cid) onPos?.(payload);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload?.i !== this.cid) onChat?.(payload);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = this.channel.presenceState();
        this.online = Math.max(Object.keys(state).length, 1);
        onCount?.(this.online);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key !== this.cid) onJoin?.(newPresences?.[0]?.name);
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key !== this.cid) onLeave?.(key);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          await this.channel.track({ name: me.name, color: me.color });
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          this.connected = false;
        }
      });
  }

  // 位置ブロードキャスト (スロットル付き)
  sendPos(me, pos, yaw, bowing = false) {
    if (!this.channel || !this.connected) return;
    const now = performance.now();
    if (now - this._lastSend < CONFIG.NET_SEND_MS) return;
    this._lastSend = now;
    const payload = {
      i: this.cid,
      n: me.name,
      c: me.color,
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      ry: Math.round(yaw * 100) / 100,
    };
    if (bowing) payload.b = 1; // 会釈中フラグ
    this.channel.send({ type: 'broadcast', event: 'pos', payload });
  }

  // コメントを全員へブロードキャスト
  sendChat(me, text) {
    if (!this.channel || !this.connected) return;
    const t = String(text).trim().slice(0, 40);
    if (!t) return;
    this.channel.send({
      type: 'broadcast', event: 'chat',
      payload: { i: this.cid, n: me.name, c: me.color, t },
    });
  }

  // ===== 世界ランキング =====
  async submitScore(name, bestHeight, clearMs) {
    if (!this.sb) return false;
    const row = {
      client_id: this.cid,
      name: (name || 'ゲスト').slice(0, 16),
      best_height: Math.round(bestHeight * 10) / 10,
      updated_at: new Date().toISOString(),
    };
    if (clearMs != null) row.clear_ms = clearMs;
    const { error } = await this.sb
      .from('rankings')
      .upsert(row, { onConflict: 'client_id' });
    if (error) {
      console.warn('[net] submit failed', error.message);
      return false;
    }
    return true;
  }

  // ベスト更新を一定間隔で自動送信
  maybeSyncScore(name, bestHeight, clearMs) {
    const now = performance.now();
    if (bestHeight <= this._lastSentBest + 0.5) return;
    if (now - this._lastScoreSync < CONFIG.SCORE_SYNC_MS) return;
    this._lastScoreSync = now;
    this._lastSentBest = bestHeight;
    this.submitScore(name, bestHeight, clearMs);
  }

  async fetchTop(limit = 50) {
    if (!this.sb) return null;
    const { data, error } = await this.sb
      .from('rankings')
      .select('client_id,name,best_height,clear_ms')
      .order('best_height', { ascending: false })
      .order('clear_ms', { ascending: true, nullsFirst: false })
      .limit(limit);
    if (error) {
      console.warn('[net] fetch failed', error.message);
      return null;
    }
    return data;
  }
}
