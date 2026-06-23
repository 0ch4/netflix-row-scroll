// 1行スクロール (Netflix / YouTube)
// マウスホイール1ノッチ = ちょうど1行ぶんスナップスクロール
(() => {
  "use strict";

  // ===== 設定（好みで変えてOK）=====
  const SETTINGS = {
    duration: 180,   // スクロールアニメの時間(ms)。0 にすると瞬間移動
    offset: "auto",  // 行の上端を画面のどこに合わせるか。"auto"=サイトごと自動 / 数値でpx指定
    epsilon: 2,      // 境界判定の許容誤差(px)
    cluster: 6,      // この差(px)以内のアイテム上端は「同じ行」とみなす
  };

  // ===== サイトごとの定義 =====
  const SITES = [
    {
      name: "netflix",
      test: (h) => h.includes("netflix.com"),
      // 行コンテナそのもの（1要素=1行）
      selectors: [".lolomoRow", ".rowContainer", "[data-list-context] .row"],
      // Netflixのヘッダーは透過なので 0 でOK
      autoOffset: () => 0,
      disabled: () => location.pathname.startsWith("/watch"),
    },
    {
      name: "youtube",
      test: (h) => h.includes("youtube.com"),
      // グリッド/リストの「各アイテム」。同じ高さのものをクラスタリングして行にする
      selectors: [
        "ytd-rich-item-renderer",
        "ytd-video-renderer",
        "ytd-grid-video-renderer",
        "ytd-rich-grid-row",
      ],
      // 固定ヘッダー(masthead)の分だけ下げて、行が隠れないようにする
      autoOffset: () => {
        const m = document.querySelector("#masthead-container, ytd-masthead");
        return (m ? m.offsetHeight : 56) + 8;
      },
      disabled: () => location.pathname.startsWith("/watch"),
    },
  ];

  let animating = false;
  let targetY = null;
  let rafId = null;

  function currentSite() {
    const h = location.hostname;
    return SITES.find((s) => s.test(h)) || null;
  }

  function effectiveOffset(site) {
    return SETTINGS.offset === "auto" ? site.autoOffset() : SETTINGS.offset;
  }

  // 表示中のアイテム要素を取得（最初に2個以上見つかったセレクタを採用）
  function getItems(site) {
    for (const sel of site.selectors) {
      const els = [...document.querySelectorAll(sel)].filter(
        (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 4
      );
      if (els.length >= 2) return els;
    }
    return [];
  }

  // アイテム上端の絶対Y座標を、近いものをまとめて「行の境界」配列にする
  function rowTops(items, offset) {
    const y = window.scrollY;
    const raw = items
      .map((el) => el.getBoundingClientRect().top + y - offset)
      .sort((a, b) => a - b);
    const out = [];
    for (const v of raw) {
      if (!out.length || v - out[out.length - 1] > SETTINGS.cluster) out.push(v);
    }
    return out.map(Math.round);
  }

  // base位置から見て、dir方向の次の行境界を返す
  function nextBoundary(dir, tops, base) {
    const e = SETTINGS.epsilon;
    let t;
    if (dir > 0) {
      t = tops.find((v) => v > base + e);
    } else {
      const prev = tops.filter((v) => v < base - e);
      t = prev.length ? prev[prev.length - 1] : 0;
    }
    if (t == null) {
      // 末尾など境界が無い時は1ピッチぶん動かす
      const pitch = tops.length > 1 ? tops[1] - tops[0] : Math.round(window.innerHeight * 0.4);
      t = base + dir * pitch;
    }
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
    const site = currentSite();
    if (!site || site.disabled()) return;

    // 横スクロールや修飾キー併用はデフォルトに任せる
    if (e.ctrlKey || e.shiftKey || e.altKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY === 0) return;

    const items = getItems(site);
    if (items.length < 2) return;

    const offset = effectiveOffset(site);
    const tops = rowTops(items, offset);
    if (tops.length < 2) return; // 行が1つしか取れない時はデフォルト動作

    e.preventDefault();
    e.stopPropagation();

    const dir = e.deltaY > 0 ? 1 : -1;
    // アニメ中は最終目標から、止まっていれば現在位置から次の境界を計算
    const base = animating && targetY != null ? targetY : window.scrollY;
    targetY = nextBoundary(dir, tops, base);
    animate();
  }

  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
})();
