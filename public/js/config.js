// アプリのバージョン。アプデのたびに 0.1 ずつ上げる (package.json と sw.js の CACHE も揃える)。
// タイトル画面に表示し、デプロイが反映されたかを目視確認できるようにしている。
export const VERSION = '1.5';

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
  COYOTE_TIME: 0.12,
  JUMP_BUFFER: 0.16,

  PLAYER_R: 0.36,            // 当たり判定 (半幅)
  PLAYER_HALF_H: 0.75,

  CAM_DIST: 7.5,
  CAM_FOV: 110,              // 視野角。画面に写る範囲が従来 (72°) の2倍になる画角 (2·atan(2·tan(36°)) ≈ 110°)
  CAM_PITCH_MIN: -0.25,
  CAM_PITCH_MAX: 1.25,
  CAM_FOLLOW: 2.0,           // 前進中にカメラが背後へゆるく回り込む速さ (横移動では回さない)
  CAM_MANUAL_HOLD: 1.2,      // 手動カメラ操作後に自動追従を止める秒数
  GYRO_SENS: 2,              // ジャイロ視点の左右 (ヨー) 感度倍率。縦 (ピッチ) は常に1倍固定
  GYRO_INVERT_X: false,      // ジャイロの左右を反転するか (タイトルのトグルで切り替え)
  GYRO_MODE: 'hold',         // ジャイロ発動条件: 'always'=常時 / 'hold'=右半分を押してる間 / 'air'=空中の間
  GYRO_DEADZONE: 0.002,      // 1イベントあたりの微小な揺れ (rad) を無視。静止時の自動追従を妨げないため

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
  GYRO: 'lonelyup_gyro_sens',
  GYRO_INVERT: 'lonelyup_gyro_invert',
  GYRO_MODE: 'lonelyup_gyro_mode',
};

// プレイヤーカラー候補
export const PLAYER_COLORS = [
  0xff6b6b, 0xffa94d, 0xffe066, 0x8ce99a,
  0x66d9e8, 0x74c0fc, 0xb197fc, 0xf783ac,
];
