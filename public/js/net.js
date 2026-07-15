import { CONFIG, STORAGE, VERSION } from './config.js';

// クライアントID (UUID) を生成する。crypto.randomUUID は「安全なコンテキスト (HTTPS/localhost)」
// でしか使えず、それ以外 (一部の埋め込みブラウザ等) では undefined になり例外で
// アプリ全体が起動不能になる。使えない環境でも動くようフォールバックを用意する。
function makeClientId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fallthrough */ }
  const hex = (n) => {
    let s = '';
    try {
      const a = new Uint8Array(n);
      crypto.getRandomValues(a);
      for (const b of a) s += b.toString(16).padStart(2, '0');
    } catch {
      for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    }
    return s;
  };
  return `${hex(4)}-${hex(2)}-${hex(2)}-${hex(2)}-${hex(6)}`;
}

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

    this.version = VERSION;
    this.roster = new Map();   // cid -> { name, color, v }  (presence から)
    this.heights = new Map();  // cid -> { y, t }            (pos 受信から: 現在の高さ)
    this.selfY = 0;            // 自分の現在の高さ (main が毎フレーム更新)
    this._me = null;

    this.cid = localStorage.getItem(STORAGE.CID);
    if (!this.cid) {
      this.cid = makeClientId();
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
    this._me = me;
    this.channel = this.sb.channel('lonely-up:lobby', {
      config: {
        broadcast: { self: false },
        presence: { key: this.cid },
      },
    });

    this.channel
      .on('broadcast', { event: 'pos' }, ({ payload }) => {
        if (payload?.i && payload.i !== this.cid) {
          // 現在の高さ (足元) を記録。オンライン一覧に表示する
          this.heights.set(payload.i, {
            y: payload.y - CONFIG.PLAYER_HALF_H, t: performance.now(),
          });
          onPos?.(payload);
        }
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload?.i !== this.cid) onChat?.(payload);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = this.channel.presenceState();
        this.online = Math.max(Object.keys(state).length, 1);
        // 名簿を作り直す (name / color / version)
        this.roster.clear();
        for (const [cid, metas] of Object.entries(state)) {
          const m = (metas && metas[0]) || {};
          this.roster.set(cid, { name: m.name || '???', color: m.color | 0, v: m.v || '?' });
        }
        onCount?.(this.online);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key !== this.cid) onJoin?.(newPresences?.[0]?.name);
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key !== this.cid) {
          this.heights.delete(key);
          onLeave?.(key);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          await this.channel.track({ name: me.name, color: me.color, v: this.version });
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          this.connected = false;
        }
      });
  }

  // 名前や色を変えたら presence を更新する (名簿へ即反映)
  async updateIdentity(me) {
    this._me = me;
    if (this.channel && this.connected) {
      try {
        await this.channel.track({ name: me.name, color: me.color, v: this.version });
      } catch { /* 一時的な失敗は無視 */ }
    }
  }

  // 今オンラインの人の一覧。各行に現在の高さと version を添える。
  // y は分かれば足元の高さ (m)、不明なら null (待機中など)。
  onlineList() {
    const now = performance.now();
    const rows = [];
    for (const [cid, r] of this.roster) {
      const isMe = cid === this.cid;
      let y = null;
      if (isMe) y = this.selfY;
      else {
        const h = this.heights.get(cid);
        if (h && now - h.t < 10000) y = h.y; // 10秒以内の受信のみ「現在地」とみなす
      }
      rows.push({ cid, name: r.name, color: r.color, v: r.v, y, isMe });
    }
    return rows;
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
