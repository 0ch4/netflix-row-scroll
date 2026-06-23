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
    debug: true,     // true でコンソールに診断ログを出す（原因調査用。後で false に）
  };

  const log = (...a) => SETTINGS.debug && console.log("[1行スクロール]", ...a);

  // ===== サイトごとの定義 =====
  // mode: "first" = 最初にヒットしたセレクタだけ使う（同じ概念の別名フォールバック向き）
  //       "union" = 全セレクタの結果を合算（種類の違う行が混在するページ向き）
  const SITES = [
    {
      name: "netflix",
      test: (h) => h.includes("netflix.com"),
      mode: "first",
      selectors: [".lolomoRow", ".rowContainer", "[data-list-context] .row"],
      autoOffset: () => 0,
      disabled: () => location.pathname.startsWith("/watch"),
    },
    {
      name: "youtube",
      test: (h) => h.includes("youtube.com"),
      mode: "union",
      selectors: [
        "ytd-rich-item-renderer",     // 通常動画（グリッド、複数/行）
        "ytd-rich-section-renderer",  // Shorts棚など（全幅、1/行）
        "ytd-rich-grid-row",          // 旧グリッドの行ラッパー
        "ytd-video-renderer",         // 検索結果（縦リスト）
        "ytd-grid-video-renderer",    // 旧チャンネルグリッド
        "ytd-reel-shelf-renderer",    // Shortsシェルフ（登録/検索）
        "ytd-shelf-renderer",         // 各種シェルフ
      ],
      // 横スクロールする棚(Shorts等)の内側にいる個別サムネは除外。棚そのものを1境界にする。
      exclude: (el) =>
        el.matches("ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer") &&
        el.closest(
          "ytd-rich-section-renderer, ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer"
        ) !== null,
      autoOffset: () => {
        const m = document.querySelector("#masthead-container, ytd-masthead");
        let off = m ? m.offsetHeight : 56;
        const chips = document.querySelector("ytd-feed-filter-chip-bar-renderer");
        if (chips && chips.getClientRects().length) off += chips.offsetHeight;
        return off + 8;
      },
      disabled: () => location.pathname.startsWith("/watch"),
    },
  ];

  let animating = false;
  let targetY = null;
  let rafId = null;
  let scroller = window; // 直近に使ったスクロール対象

  function currentSite() {
    const h = location.hostname;
    return SITES.find((s) => s.test(h)) || null;
  }

  function effectiveOffset(site) {
    return SETTINGS.offset === "auto" ? site.autoOffset() : SETTINGS.offset;
  }

  // ===== スクロール対象の抽象化（window でも内側要素でも動くように）=====
  const sTop = (s) => (s === window ? window.scrollY : s.scrollTop);
  const sMax = (s) =>
    s === window
      ? document.documentElement.scrollHeight - window.innerHeight
      : s.scrollHeight - s.clientHeight;
  const sSet = (s, y) => (s === window ? window.scrollTo(0, y) : (s.scrollTop = y));
  const sOriginTop = (s) => (s === window ? 0 : s.getBoundingClientRect().top);

  // アイテムの祖先で実際にスクロールする要素を探す。無ければ window。
  function getScroller(item) {
    for (let el = item ? item.parentElement : null; el; el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      const ov = getComputedStyle(el).overflowY;
      if (
        (ov === "auto" || ov === "scroll" || ov === "overlay") &&
        el.scrollHeight > el.clientHeight + 4
      ) {
        return el;
      }
    }
    return window;
  }

  // 矩形ベースの可視判定（offsetParent はYouTubeのCSS構造でnullになり得るので使わない）
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.height > 4 && r.width > 0;
  };

  function getItems(site) {
    if (site.mode === "union") {
      const set = new Set();
      for (const sel of site.selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (!visible(el)) continue;
          if (site.exclude && site.exclude(el)) continue;
          set.add(el);
        }
      }
      return [...set];
    }
    for (const sel of site.selectors) {
      const els = [...document.querySelectorAll(sel)].filter(visible);
      if (els.length >= 2) return els;
    }
    return [];
  }

  // アイテム上端の座標（スクロール対象の内部座標）を、近いものをまとめて行境界配列にする
  function rowTops(items, offset, s) {
    const st = sTop(s);
    const origin = sOriginTop(s);
    const raw = items
      .map((el) => el.getBoundingClientRect().top - origin + st - offset)
      .sort((a, b) => a - b);
    const out = [];
    for (const v of raw) {
      if (!out.length || v - out[out.length - 1] > SETTINGS.cluster) out.push(v);
    }
    return out.map(Math.round);
  }

  function nextBoundary(dir, tops, base, s) {
    const e = SETTINGS.epsilon;
    let t;
    if (dir > 0) {
      t = tops.find((v) => v > base + e);
    } else {
      const prev = tops.filter((v) => v < base - e);
      t = prev.length ? prev[prev.length - 1] : 0;
    }
    if (t == null) {
      const pitch = tops.length > 1 ? tops[1] - tops[0] : Math.round(window.innerHeight * 0.4);
      t = base + dir * pitch;
    }
    return Math.max(0, Math.min(sMax(s), t));
  }

  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

  function animate() {
    if (rafId) cancelAnimationFrame(rafId);
    if (SETTINGS.duration <= 0) {
      sSet(scroller, targetY);
      animating = false;
      return;
    }
    const start = sTop(scroller);
    const dist = targetY - start;
    const t0 = performance.now();
    animating = true;
    function step(now) {
      const p = Math.min(1, (now - t0) / SETTINGS.duration);
      sSet(scroller, start + dist * easeOutCubic(p));
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
    if (!site) return;
    if (site.disabled()) return log("disabled (watch等)");

    if (e.ctrlKey || e.shiftKey || e.altKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY === 0) return;

    const items = getItems(site);
    if (items.length < 2) return log("行アイテム不足", items.length);

    const s = getScroller(items[0]);
    const offset = effectiveOffset(site);
    const tops = rowTops(items, offset, s);
    if (tops.length < 2) return log("境界不足", tops.length, "items=", items.length);

    e.preventDefault();
    e.stopPropagation();

    scroller = s;
    const dir = e.deltaY > 0 ? 1 : -1;
    const cur = sTop(s);
    const base = animating && targetY != null ? targetY : cur;
    targetY = nextBoundary(dir, tops, base, s);

    log(
      site.name,
      "scroller=", s === window ? "window" : s.tagName.toLowerCase(),
      "items=", items.length,
      "rows=", tops.length,
      "offset=", offset,
      "cur=", Math.round(cur),
      "→", Math.round(targetY)
    );

    animate();
  }

  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
  log("読み込み完了", location.hostname);
})();
