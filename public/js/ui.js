// HUD・パネル操作
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export class UI {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      height: document.getElementById('height'),
      best: document.getElementById('best'),
      timer: document.getElementById('timer'),
      online: document.getElementById('online'),
      title: document.getElementById('title'),
      nameInput: document.getElementById('nameInput'),
      netStatus: document.getElementById('netStatus'),
      rankPanel: document.getElementById('rankPanel'),
      rankList: document.getElementById('rankList'),
      clearPanel: document.getElementById('clearPanel'),
      clearTime: document.getElementById('clearTime'),
      toasts: document.getElementById('toasts'),
      combo: document.getElementById('combo'),
      comboNum: document.getElementById('comboNum'),
      rewards: document.getElementById('rewards'),
      chatBar: document.getElementById('chatBar'),
      chatInput: document.getElementById('chatInput'),
      chatFeed: document.getElementById('chatFeed'),
    };
  }

  // ===== コメント (チャット) =====
  // 入力バーを開いて即入力できるようにする
  openChat() {
    this.el.chatBar.classList.remove('hidden');
    this.el.chatInput.focus();
  }

  closeChat() {
    this.el.chatBar.classList.add('hidden');
    this.el.chatInput.value = '';
    this.el.chatInput.blur();
  }

  get chatOpen() {
    return !this.el.chatBar.classList.contains('hidden');
  }

  // 画面左のフィードに1行追加する。数秒で自動的に消える。
  addChat(name, text, cssColor = '#ffe08a', isMe = false) {
    const row = document.createElement('div');
    row.className = 'chatrow' + (isMe ? ' me' : '');
    const nm = document.createElement('span');
    nm.className = 'cname';
    nm.style.color = cssColor;
    nm.textContent = `${String(name).slice(0, 12)}：`;
    const tx = document.createElement('span');
    tx.className = 'ctext';
    tx.textContent = String(text).slice(0, 40);
    row.append(nm, tx);
    this.el.chatFeed.appendChild(row);
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 5800);
    while (this.el.chatFeed.children.length > 6) this.el.chatFeed.firstChild.remove();
  }

  // コンボ数に応じて過熱していく色 (黄 → 橙 → 赤熱)
  comboColor(n) {
    if (n >= 9) return '#ff5b5b';
    if (n >= 5) return '#ff9f43';
    return '#ffd166';
  }

  showTitle(online) {
    this.el.title.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    if (online) {
      this.el.netStatus.textContent = 'オンライン接続中 🟢';
      this.el.netStatus.classList.add('online');
    }
  }

  startGame() {
    this.el.title.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  updateHud(height, best, elapsedMs, online) {
    this.el.height.textContent = `${Math.max(height, 0).toFixed(1)}m`;
    this.el.best.textContent = `${Math.max(best, 0).toFixed(1)}m`;
    this.el.timer.textContent = fmtTime(elapsedMs);
    this.el.online.textContent = String(online);
  }

  // コンボ表示: 数が増えるほど大きく・熱く・強くバウンドする
  showCombo(n) {
    this.el.comboNum.textContent = String(n);
    const c = this.el.combo;
    const col = this.comboColor(n);
    c.classList.remove('hidden');
    c.style.fontSize = `${Math.min(20 + n * 1.6, 46)}px`;
    c.style.color = col;
    // 高コンボほど光背 (グロウ) を強める
    const glow = Math.min(6 + n * 2, 30);
    c.style.textShadow = `0 2px 10px rgba(0,0,0,0.5), 0 0 ${glow}px ${col}`;
    c.classList.remove('pop');
    void c.offsetWidth; // アニメーション再トリガー
    c.classList.add('pop');
    // 手前へ飛び出す報酬ポップ (2コンボ以上のとき)
    if (n >= 2) this.floatReward(`${n}×`, col);
  }

  hideCombo() {
    this.el.combo.classList.add('hidden');
  }

  // 報酬の視覚化: テキストが画面手前に飛び出し、少しバウンドして上へ消える。
  // 行動の価値をタイムラグゼロで脳に突きつける (自己効力感の刺激)。
  floatReward(text, color = '#ffd166', big = false) {
    if (!this.el.rewards) return;
    const el = document.createElement('div');
    el.className = 'reward' + (big ? ' big' : '');
    el.textContent = text;
    el.style.color = color;
    el.style.textShadow = `0 2px 12px rgba(0,0,0,0.55), 0 0 18px ${color}`;
    // 中央から少し左右にばらけさせ、連続しても重ならないようにする
    el.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 12}%`);
    this.el.rewards.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    while (this.el.rewards.children.length > 8) this.el.rewards.firstChild.remove();
  }

  // 高度表示を一瞬拡大 (マイルストーン到達時)
  popHeight() {
    const h = this.el.height;
    h.classList.remove('pop');
    void h.offsetWidth;
    h.classList.add('pop');
  }

  toast(msg) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    this.el.toasts.appendChild(div);
    setTimeout(() => div.remove(), 3000);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  showClear(ms) {
    this.el.clearTime.textContent = fmtTime(ms);
    this.el.clearPanel.classList.remove('hidden');
  }

  hideClear() {
    this.el.clearPanel.classList.add('hidden');
  }

  openRanking() {
    this.el.rankPanel.classList.remove('hidden');
    this.el.rankList.innerHTML = '<div class="rankrow">読み込み中...</div>';
  }

  closeRanking() {
    this.el.rankPanel.classList.add('hidden');
  }

  // rows: [{client_id,name,best_height,clear_ms}] / myCid: 自分の行を強調
  renderRanking(rows, myCid, offline) {
    const list = this.el.rankList;
    list.innerHTML = '';
    if (offline) {
      const d = document.createElement('div');
      d.className = 'rankrow';
      d.textContent = 'オフラインモードです。Supabase を設定すると世界ランキングに参加できます。';
      list.appendChild(d);
    }
    if (!rows || rows.length === 0) {
      const d = document.createElement('div');
      d.className = 'rankrow';
      d.textContent = offline ? '' : 'まだ記録がありません。一番乗りになろう!';
      if (d.textContent) list.appendChild(d);
      return;
    }
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'rankrow' + (r.client_id === myCid ? ' me' : '');
      const pos = document.createElement('span');
      pos.className = 'pos';
      pos.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}`;
      const name = document.createElement('span');
      name.className = 'rname';
      name.textContent = r.name || '???';
      const h = document.createElement('span');
      h.className = 'rheight';
      h.textContent = `${Number(r.best_height).toFixed(1)}m`;
      row.append(pos, name, h);
      if (r.clear_ms != null) {
        const t = document.createElement('span');
        t.className = 'rtime';
        t.textContent = `⏱${fmtTime(r.clear_ms)}`;
        row.appendChild(t);
      }
      list.appendChild(row);
    });
  }
}

export { fmtTime };
