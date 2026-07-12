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
  GYRO_SENS: 2,              // スマホのジャイロで視点を動かす感度 (端末の回転量に対する倍率)
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
};

// プレイヤーカラー候補
export const PLAYER_COLORS = [
  0xff6b6b, 0xffa94d, 0xffe066, 0x8ce99a,
  0x66d9e8, 0x74c0fc, 0xb197fc, 0xf783ac,
];
