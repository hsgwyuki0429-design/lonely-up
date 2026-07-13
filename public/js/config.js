// アプリのバージョン。アプデのたびに 0.1 ずつ上げる (package.json と sw.js の CACHE も揃える)。
// タイトル画面に表示し、デプロイが反映されたかを目視確認できるようにしている。
export const VERSION = '2.6';

// 全クライアント共通の定数。SEED を変えると塔の形が変わる
// (全員同じ塔を登ることでランキングが公平になる)。
export const CONFIG = {
  SEED: 20260711,
  GOAL_HEIGHT: 300,          // この高さのゴール台に立てばクリア

  GRAVITY: 22,
  JUMP_VEL: 9.6,             // ジャンプ高 ≈ 2.1m
  MOVE_SPEED: 6.2,
  STICK_DEADZONE: 0.12,      // スティックの遊び。これ以下の入力は無視し、超えた分を 0〜1 に再スケール
  GROUND_ACCEL: 46,
  AIR_ACCEL: 20,
  COYOTE_TIME: 0.2,          // 足場から出た後もジャンプを受け付ける猶予 (端ジャンプの空振り対策)
  JUMP_BUFFER: 0.2,          // ジャンプ先行入力の保持時間 (早めに押しても拾う)

  PLAYER_R: 0.36,            // 当たり判定 (半幅)
  PLAYER_HALF_H: 0.75,

  CAM_DIST: 7.5,
  CAM_FOV: 110,              // 視野角。画面に写る範囲が従来 (72°) の2倍になる画角 (2·atan(2·tan(36°)) ≈ 110°)
  CAM_PITCH_MIN: -0.25,
  CAM_PITCH_MAX: 1.25,
  CAM_FOLLOW: 2.0,           // 前進中にカメラが背後へゆるく回り込む速さ (横移動では回さない)
  CAM_MANUAL_HOLD: 1.2,      // 手動カメラ操作後に自動追従を止める秒数

  // 操作は片手モードのみ: 画面全体がスティック / タップでジャンプ / 走って端 (または隣のブロック)
  // に当たると自動ジャンプ。カメラは自動追従 + 着地時に次の足場の方向へ引っ張る。
  ONE_HAND_FOLLOW: 0.5,      // 横移動時にカメラが背後へ回り込む強さ (0〜1, 前進成分との大きい方を採用)
  ONE_HAND_AUTOJUMP_MAG: 0.5, // 壁 (隣接ブロック) の自動ジャンプが発動するスティック倒し量のしきい値
  ONE_HAND_AUTOJUMP_ARM: 0.15, // 端の自動ジャンプを「準備」するスティック倒し量。これを超えて動いていれば端で自動ジャンプ
  ONE_HAND_AUTOJUMP_GRACE: 0.45, // スティックを離してから端の自動ジャンプが効き続ける猶予 (秒)
  ONE_HAND_PULL: 12,         // 着地時に「次の足場」の方向へ視点が回り込む速さ (大きいほど速い)
  ONE_HAND_PULL_TIME: 0.6,   // 着地後、視点の引っ張りが効き続ける時間 (秒)。手動カメラ操作で即中断

  // 「下寄り表示」版: 自機を画面の下1/3あたりに置き、上 (登る先) を広く見せる。
  CAM_LOW_SUBJECT: false,    // タイトルのトグルで切替
  CAM_LOW_LOOKUP: 5.0,       // 視点を上へずらす量 (m)。大きいほど自機が画面下に寄る

  BOW_TIME: 0.9,             // 会釈 (おじぎ) の長さ (秒)

  KILL_Y: -14,               // ここまで落ちたらスタートに戻る
  NET_SEND_MS: 120,          // 位置ブロードキャスト間隔
  SCORE_SYNC_MS: 15000,      // ベスト高度の自動送信間隔
  MAX_GHOSTS: 24,            // 同時表示する他プレイヤー数
};

export const STORAGE = {
  CID: 'lonelyup_cid',
  NAME: 'lonelyup_name',
  BEST: 'lonelyup_best',
  CLEAR_MS: 'lonelyup_clear_ms',
  COLOR: 'lonelyup_color',
  LOW_CAM: 'lonelyup_low_cam',
};

// プレイヤーカラー候補
export const PLAYER_COLORS = [
  0xff6b6b, 0xffa94d, 0xffe066, 0x8ce99a,
  0x66d9e8, 0x74c0fc, 0xb197fc, 0xf783ac,
];
