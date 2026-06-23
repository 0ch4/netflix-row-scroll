// Netflix 1行スクロール
// マウスホイール1ノッチ = ちょうど1行ぶんスナップスクロール
(() => {
  "use strict";

  // ===== 設定（好みで変えてOK）=====
  const SETTINGS = {
    duration: 180,   // スクロールアニメの時間(ms)。0 にすると瞬間移動
    offset: 0,       // 行の上端を画面のどこに合わせるか(px)。固定ヘッダーの分だけ下げたいなら 60 など
    epsilon: 2,      // 境界判定の許容誤差(px)
  };

  // 行の候補セレクタ（Netflixのクラス名変更に備えて複数）
  const ROW_SELECTORS = [".lolomoRow", ".rowContainer", "[data-list-context] .row"];

  let animating = false;
  let targetY = null;
  let rafId = null;

  // 現在表示されている「行」要素を取得
  function getRows() {
    for (const sel of ROW_SELECTORS) {
      const els = [...document.querySelectorAll(sel)].filter(
        (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 4
      );
      if (els.length >= 2) return els;
    }
    return [];
  }

  // 各行の上端の「絶対Y座標」をソートして返す
  function rowTops(rows) {
    const y = window.scrollY;
    return rows
      .map((r) => Math.round(r.getBoundingClientRect().top + y - SETTINGS.offset))
      .sort((a, b) => a - b);
  }

  // base位置から見て、dir方向の次の行境界を返す
  function nextBoundary(dir, rows, base) {
    const tops = rowTops(rows);
    const e = SETTINGS.epsilon;
    let t;
    if (dir > 0) {
      t = tops.find((v) => v > base + e);
    } else {
      const prev = tops.filter((v) => v < base - e);
      t = prev.length ? prev[prev.length - 1] : 0;
    }
    if (t == null) {
      // 最後の行など境界が見つからない時は1ピッチぶん動かす
      const pitch = tops.length > 1 ? tops[1] - tops[0] : Math.round(window.innerHeight * 0.4);
      t = base + dir * pitch;
    }
    // ページ範囲にクランプ
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return Math.max(0, Math.min(max, t));
  }

  function easeOutCubic(p) {
    return 1 - Math.pow(1 - p, 3);
  }

  function animate() {
    if (rafId) cancelAnimationFrame(rafId);
    if (SETTINGS.duration <= 0) {
      window.scrollTo(0, targetY);
      animating = false;
      return;
    }
    const start = window.scrollY;
    const dist = targetY - start;
    const t0 = performance.now();
    animating = true;
    function step(now) {
      const p = Math.min(1, (now - t0) / SETTINGS.duration);
      window.scrollTo(0, start + dist * easeOutCubic(p));
      if (p < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        animating = false;
        rafId = null;
      }
    }
    rafId = requestAnimationFrame(step);
  }

  function onWheel(e) {
    // 動画再生中(/watch)は何もしない（シーク等を邪魔しない）
    if (location.pathname.startsWith("/watch")) return;
    // 横スクロールや修飾キー併用はデフォルトに任せる
    if (e.ctrlKey || e.shiftKey || e.altKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY === 0) return;

    const rows = getRows();
    if (rows.length < 2) return; // 行が取れない時はデフォルト動作

    e.preventDefault();
    e.stopPropagation();

    const dir = e.deltaY > 0 ? 1 : -1;
    // アニメ中は最終目標から、止まっていれば現在位置から次の境界を計算
    const base = animating && targetY != null ? targetY : window.scrollY;
    targetY = nextBoundary(dir, rows, base);
    animate();
  }

  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
})();
