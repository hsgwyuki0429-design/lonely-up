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
      chatStamps: document.getElementById('chatStamps'),
      chatLogPanel: document.getElementById('chatLogPanel'),
      chatLogList: document.getElementById('chatLogList'),
      onlinePanel: document.getElementById('onlinePanel'),
      onlineList: document.getElementById('onlineList'),
      onlineSummary: document.getElementById('onlineSummary'),
    };
  }

  // ===== オンラインの人の一覧 =====
  openOnline() {
    this.el.onlinePanel.classList.remove('hidden');
  }

  closeOnline() {
    this.el.onlinePanel.classList.add('hidden');
  }

  get onlineOpen() {
    return !this.el.onlinePanel.classList.contains('hidden');
  }

  // rows: [{ name, colorHex, height(null可), v, outdated, isMe }]  latest: 最新版の文字列
  renderOnline(rows, latest, anyOutdated) {
    this.el.onlineSummary.innerHTML = '';
    const sum = document.createElement('div');
    sum.className = 'osum ' + (anyOutdated ? 'warn' : 'ok');
    sum.textContent = anyOutdated
      ? `⚠ 最新は v${latest}。古いバージョンの人がいます`
      : `✓ 全員が最新 (v${latest}) です`;
    this.el.onlineSummary.appendChild(sum);

    const list = this.el.onlineList;
    list.innerHTML = '';
    // 高い人から並べる (高さ不明は末尾)
    rows.slice().sort((a, b) => (b.height ?? -1) - (a.height ?? -1)).forEach((r) => {
      const row = document.createElement('div');
      row.className = 'onlinerow' + (r.isMe ? ' me' : '');

      const dot = document.createElement('span');
      dot.className = 'odot';
      dot.style.background = r.colorHex;

      const name = document.createElement('span');
      name.className = 'oname';
      name.textContent = (r.name || '???') + (r.isMe ? '（あなた）' : '');

      const h = document.createElement('span');
      h.className = 'oheight';
      h.textContent = r.height == null ? '待機中' : `${Math.max(r.height, 0).toFixed(1)}m`;

      const ver = document.createElement('span');
      ver.className = 'over ' + (r.outdated ? 'old' : 'new');
      ver.textContent = r.outdated ? `v${r.v} ⚠` : `v${r.v} ✓`;

      row.append(dot, name, h, ver);
      list.appendChild(row);
    });
    if (!rows.length) {
      const d = document.createElement('div');
      d.className = 'rankrow';
      d.textContent = 'オフラインモードです。';
      list.appendChild(d);
    }
  }

  // ===== コメント (チャット) =====
  // 入力バーを開く。キーボードは自動で出さない (スタンプを押すだけで送れるように)。
  openChat() {
    this.el.chatBar.classList.remove('hidden');
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

  // ===== チャット履歴 (消えずに残るログ) =====
  openChatLog() { this.el.chatLogPanel.classList.remove('hidden'); }
  closeChatLog() { this.el.chatLogPanel.classList.add('hidden'); }
  get chatLogOpen() { return !this.el.chatLogPanel.classList.contains('hidden'); }

  // log: [{ name, text, color, isMe, t(ms) }] を古い順に描画し、最下部までスクロール
  renderChatLog(log) {
    const list = this.el.chatLogList;
    list.innerHTML = '';
    if (!log.length) {
      const d = document.createElement('div');
      d.className = 'rankrow';
      d.textContent = 'まだコメントはありません。';
      list.appendChild(d);
      return;
    }
    for (const e of log) {
      const row = document.createElement('div');
      row.className = 'logrow' + (e.isMe ? ' me' : '');
      const time = document.createElement('span');
      time.className = 'ltime';
      const d = new Date(e.t || Date.now());
      time.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const nm = document.createElement('span');
      nm.className = 'lname';
      nm.style.color = e.color || '#ffe08a';
      nm.textContent = `${String(e.name).slice(0, 12)}：`;
      const tx = document.createElement('span');
      tx.className = 'ltext';
      tx.textContent = String(e.text).slice(0, 40);
      row.append(time, nm, tx);
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight; // 最新を表示
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

  // タイトルのオンライン表示 (人数 + 一覧を開けるヒント)
  setOnlineCount(n) {
    this.el.netStatus.textContent = `🟢 オンライン ${n}人（タップで一覧）`;
    this.el.netStatus.classList.add('online', 'clickable');
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
