// twitter-easy-block: one-click block button with a cancel window, for
// accounts you don't follow. See SPEC.md section 8.2.
(() => {
  "use strict";

  // ── Constants (8.2.1) ──────────────────────────────────────────────────
  const TIMER_MS = 1000;
  const MAX_FIBER_DEPTH = 40;
  const POLL_MS = 40;
  const MARKER = "__BESTEST_TWITTER_EASY_BLOCK__";
  const REVISION = 6;

  const SEL = {
    post: 'article[data-testid="tweet"]',
    cell: '[data-testid="cellInnerDiv"]',
    caret: '[data-testid="caret"]',
    grok: 'button[aria-label="Grok actions"]',
    menu: '#layers [role="menu"]',
    menuItem: '[role="menuitem"]',
    blockItem: '[data-testid="block"]',
    confirmDialog: '[data-testid="confirmationSheetDialog"]',
    confirmButton: '[data-testid="confirmationSheetConfirm"]',
    accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
    profileActions: '[data-testid="primaryColumn"] [data-testid="userActions"]',
    rowActions: '[data-testid="userActions"]',
    profileBtn: ".teb-btn.teb-profile",
  };

  const VISUAL_CLASSES = ["teb-arming", "teb-working", "teb-cancel", "teb-fail"];
  const RING_LENGTH = 94.25; // 2πr for r = 15
  const SHARD_COUNT = 34;
  const SHARD_COLORS = ["#f4212e", "#ff7a00", "#ffd400", "#fff"];
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Countdown durations come from TIMER_MS, never hard-coded.
  const T = `${TIMER_MS}ms`;
  const CSS = `
.teb-btn{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin:-7px 0;padding:0;border:0;border-radius:9999px;background:transparent;color:#71767b;cursor:pointer}
.teb-btn.teb-profile{width:36px;height:36px;margin:0 8px 12px 0;border:1px solid var(--teb-border,rgb(207,217,222));color:var(--teb-fg,#0f1419)}
.teb-btn[data-state=""]:hover{color:#f4212e;background:rgba(244,33,46,.1)}
.teb-icon{width:18.75px;height:18.75px}
.teb-profile .teb-icon{width:20px;height:20px}
.teb-icon circle,.teb-icon line{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.teb-ring{position:absolute;inset:0;width:34px;height:34px;transform:rotate(-90deg);opacity:0;pointer-events:none}
.teb-ring circle{fill:none;stroke-width:2.5}
.teb-track{stroke:rgba(244,33,46,.15)}
.teb-progress{stroke:#ffd400;stroke-dasharray:${RING_LENGTH};stroke-dashoffset:${RING_LENGTH};stroke-linecap:round}
.teb-btn.teb-arming{animation:teb-color ${T} linear forwards,teb-tint ${T} linear forwards}
.teb-btn.teb-arming .teb-ring{opacity:1}
.teb-btn.teb-arming .teb-progress{animation:teb-fill ${T} linear forwards,teb-stroke ${T} linear forwards}
.teb-btn.teb-arming .teb-icon{animation:teb-pulse ${T} linear forwards}
.teb-btn.teb-working{color:#f4212e;background:rgba(244,33,46,.28)}
.teb-btn.teb-working .teb-icon{animation:teb-spin 800ms linear infinite}
.teb-btn.teb-cancel{animation:teb-cancel 350ms ease-out}
.teb-btn.teb-fail{animation:teb-shake 400ms}
@keyframes teb-fill{from{stroke-dashoffset:${RING_LENGTH}}to{stroke-dashoffset:0}}
@keyframes teb-stroke{0%{stroke:#ffd400}55%{stroke:#ff7a00}100%{stroke:#f4212e}}
@keyframes teb-color{0%{color:#ffd400}55%{color:#ff7a00}100%{color:#f4212e}}
@keyframes teb-tint{from{background:rgba(255,212,0,.08)}to{background:rgba(244,33,46,.28)}}
@keyframes teb-pulse{0%,16%{transform:scale(1)}8%{transform:scale(1.08)}28%,48%,64%,76%,86%,94%,100%{transform:scale(1)}38%,56%,70%,81%,90%,97%{transform:scale(1.14)}}
@keyframes teb-spin{to{transform:rotate(360deg)}}
@keyframes teb-cancel{from{transform:scale(.8);background:rgba(113,118,123,.25)}to{transform:scale(1);background:transparent}}
@keyframes teb-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}}
html.teb-stealth #layers [role="group"],
html.teb-stealth #layers [data-testid="sheetDialog"],
html.teb-stealth #layers [role="dialog"],
html.teb-stealth #layers [data-testid="mask"]{opacity:0!important;pointer-events:none!important}
`;

  // ── Reading the author (8.2.3) ─────────────────────────────────────────
  function postUser(article) {
    const key = Object.keys(article).find((k) => k.startsWith("__reactFiber"));
    let f = key && article[key];
    for (let d = 0; f && d < MAX_FIBER_DEPTH; d++, f = f.return) {
      const t = f.memoizedProps?.tweet;
      if (t?.user) return (t.retweeted_status || t).user; // reposts: the ORIGINAL author
    }
    return null;
  }

  let ownHandle = null;
  function getOwnHandle() {
    if (!ownHandle) {
      const text = document.querySelector(SEL.accountSwitcher)?.textContent || "";
      const match = text.match(/@(\w+)/);
      if (match) ownHandle = match[1].toLowerCase();
    }
    return ownHandle;
  }

  // Profile header's user (8.2.10): first fiber up from its ⋯ button whose
  // props carry a user with a screen_name.
  function profileUser(actions) {
    const key = Object.keys(actions).find((k) => k.startsWith("__reactFiber"));
    let f = key && actions[key];
    for (let d = 0; f && d < MAX_FIBER_DEPTH; d++, f = f.return) {
      const u = f.memoizedProps?.user;
      if (typeof u?.screen_name === "string") return u;
    }
    return null;
  }

  // Handles (lowercased) this feature blocked since the page loaded (8.2.3).
  const blockedHandles = new Set();

  // Show rule (8.2.3): the user's screen_name when it qualifies, else null.
  function qualify(user) {
    if (!user || user.following !== false || user.blocking === true) return null;
    const handle = user.screen_name;
    if (typeof handle !== "string" || !handle) return null;
    const lower = handle.toLowerCase();
    const own = getOwnHandle();
    if (own && lower === own) return null;
    if (blockedHandles.has(lower)) return null;
    return handle;
  }

  const qualifyingHandle = (article) => qualify(postUser(article));
  const profileHandle = (actions) => (actions ? qualify(profileUser(actions)) : null);

  // A button lives on a post (root: its article) or in a profile header
  // (root: the header's button row). Each kind knows how to re-check and
  // re-render its root, find its ⋯ button, and finish a successful block.
  const POST = {
    root: (btn) => btn.closest(SEL.post),
    handle: (root) => qualifyingHandle(root),
    refresh: (root) => update(root),
    caret: (root) => root.querySelector(SEL.caret),
    done(btn, root, at) {
      root.dataset.tebBlocked = "1";
      if (at) burst(at.x, at.y);
      // X may already have removed or replaced the post (8.2.8).
      if (root.isConnected) removePost(root).catch(() => {});
    },
  };
  const PROFILE = {
    root: (btn) => btn.parentElement,
    handle: (root) => profileHandle(root.querySelector(SEL.rowActions)),
    refresh: () => updateProfile(),
    caret: (root) => root.querySelector(SEL.rowActions),
    done(btn, root, at) {
      if (at) burst(at.x, at.y);
      btn.remove();
    },
  };

  // On-screen center of an element still in the page with a real size, else
  // null. A detached or hidden element measures 0×0 at (0,0) (8.2.8).
  function centerOf(el) {
    if (!el?.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  const kindOf = (btn) => (btn.classList.contains("teb-profile") ? PROFILE : POST);

  // ── Button (8.2.5) ─────────────────────────────────────────────────────
  const timers = new WeakMap();

  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  }

  function setHandle(btn, handle) {
    btn.dataset.handle = handle;
    btn.setAttribute("aria-label", `Block @${handle}`);
    btn.title = `Block @${handle} (click again to cancel)`;
  }

  function createButton(handle, profile = false) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = profile ? "teb-btn teb-profile" : "teb-btn";
    btn.dataset.state = "";
    setHandle(btn, handle);

    const icon = svg("svg", { class: "teb-icon", viewBox: "0 0 24 24", "aria-hidden": "true" });
    icon.append(
      svg("circle", { cx: "12", cy: "12", r: "9" }),
      svg("line", { x1: "5.64", y1: "5.64", x2: "18.36", y2: "18.36" })
    );
    const ring = svg("svg", { class: "teb-ring", viewBox: "0 0 34 34", "aria-hidden": "true" });
    ring.append(
      svg("circle", { class: "teb-track", cx: "17", cy: "17", r: "15" }),
      svg("circle", { class: "teb-progress", cx: "17", cy: "17", r: "15" })
    );
    btn.append(icon, ring);
    btn.addEventListener("click", onClick);
    return btn;
  }

  // Remove all visual classes, force a reflow, then add the new one, so the
  // animation restarts even on rapid double clicks.
  function setVisual(btn, cls) {
    btn.classList.remove(...VISUAL_CLASSES);
    void btn.offsetWidth;
    if (cls) btn.classList.add(cls);
  }

  function clearTimer(btn) {
    clearTimeout(timers.get(btn));
    timers.delete(btn);
  }

  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    try {
      const btn = event.currentTarget;
      if (btn.dataset.state === "") arm(btn);
      else if (btn.dataset.state === "arming") cancel(btn);
      // "working": ignored
    } catch {
      // Fail closed.
    }
  }

  function arm(btn) {
    const kind = kindOf(btn);
    const root = kind.root(btn);
    const handle = btn.dataset.handle;
    if (!root || !handle) return;
    btn.dataset.state = "arming";
    setVisual(btn, "teb-arming");
    timers.set(btn, setTimeout(() => fire(btn, kind, root, handle), TIMER_MS));
  }

  function cancel(btn) {
    clearTimer(btn);
    btn.dataset.state = "";
    setVisual(btn, "teb-cancel");
  }

  function fire(btn, kind, root, handle) {
    try {
      timers.delete(btn);
      // Re-check the show rule now, independent of when the last scan ran
      // (e.g. the owner followed the author during the countdown).
      if (kind.handle(root) !== handle) {
        btn.dataset.state = "";
        setVisual(btn, null);
        kind.refresh(root);
        return;
      }
      btn.dataset.state = "working";
      setVisual(btn, "teb-working");
      enqueue(async () => {
        // Burst point (8.2.8): recorded now, while the button is surely in the
        // page; X often drops it by the time the block succeeds.
        const startAt = centerOf(btn);
        const ok = await blockViaUi(root, kind.caret, handle);
        try {
          if (ok) {
            blockedHandles.add(handle.toLowerCase());
            kind.done(btn, root, centerOf(btn) || startAt);
          } else {
            btn.dataset.state = "";
            setVisual(btn, "teb-fail");
          }
        } catch {
          // Fail closed.
        }
      });
    } catch {
      // Fail closed.
    }
  }

  // Block jobs run one at a time; they share X's single menu layer.
  let queue = Promise.resolve();
  const enqueue = (fn) => (queue = queue.then(fn, fn));

  // ── Blocking through X's UI (8.2.6) ────────────────────────────────────
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function wait(fn, ms) {
    const end = Date.now() + ms;
    for (;;) {
      const value = fn();
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(POLL_MS);
    }
  }

  const closeMenu = () => {
    const backdrop = document.querySelector(SEL.menu)
      ?.closest('[role="group"]')?.firstElementChild?.firstElementChild;
    if (backdrop) backdrop.click();
  };

  function findBlockItem() {
    const menu = document.querySelector(SEL.menu);
    if (!menu) return null;
    return (
      menu.querySelector(SEL.blockItem) ||
      [...menu.querySelectorAll(SEL.menuItem)].find((el) =>
        el.textContent.trim().startsWith("Block @")
      ) ||
      null
    );
  }

  // A job starting while the previous job's delayed removal is pending
  // cancels that removal, so back-to-back jobs stay hidden.
  let stealthTimer;
  function stealthOn() {
    clearTimeout(stealthTimer);
    document.documentElement.classList.add("teb-stealth");
  }
  function stealthOff() {
    clearTimeout(stealthTimer);
    stealthTimer = setTimeout(() => {
      document.documentElement.classList.remove("teb-stealth");
    }, 150);
  }

  // root: the post's article, or the profile header's button row.
  async function blockViaUi(root, findCaret, handle) {
    stealthOn();
    try {
      if (!root.isConnected) return false;

      if (document.querySelector(SEL.menu)) {
        closeMenu();
        await wait(() => !document.querySelector(SEL.menu), 1000);
      }

      const caret = findCaret(root);
      if (!caret) return false;
      caret.click();

      const item = await wait(findBlockItem, 2000);
      if (!item) {
        closeMenu();
        return false;
      }
      if (!item.textContent.toLowerCase().includes(`@${handle.toLowerCase()}`)) {
        closeMenu();
        return false;
      }
      item.click();

      const confirm = await wait(() => document.querySelector(SEL.confirmButton), 3000);
      if (!confirm) {
        closeMenu();
        return false;
      }
      confirm.click();

      await wait(() => !document.querySelector(SEL.confirmDialog), 3000);
      await sleep(120);
      if (document.querySelector(SEL.menu)) closeMenu();
      return true;
    } catch {
      return false;
    } finally {
      stealthOff();
    }
  }

  // ── Celebration (8.2.8) ────────────────────────────────────────────────
  function effect(x, y, width, height, style) {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed",
      left: `${x - width / 2}px`,
      top: `${y - height / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: "none",
      zIndex: "2147483647",
      ...style,
    });
    document.body.append(el);
    return el;
  }

  function play(el, keyframes, options) {
    const remove = () => el.remove();
    el.animate(keyframes, options).finished.then(remove, remove);
  }

  function burst(x, y) {
    play(
      effect(x, y, 34, 34, {
        borderRadius: "50%",
        background: "radial-gradient(circle,#fff 0%,#ffd400 35%,#f4212e 70%,transparent 72%)",
      }),
      [
        { transform: "scale(.4)", opacity: 1 },
        { transform: "scale(2.4)", opacity: 0 },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.8,.3,1)" }
    );

    const rings = [
      { border: "4px solid #f4212e", scale: 10, delay: 0 },
      { border: "2px solid #ff7a00", scale: 7, delay: 110 },
    ];
    for (const ring of rings) {
      play(
        effect(x, y, 40, 40, { borderRadius: "50%", boxSizing: "border-box", border: ring.border }),
        [
          { transform: "scale(.3)", opacity: 1 },
          { transform: `scale(${ring.scale})`, opacity: 0 },
        ],
        { duration: 700, delay: ring.delay, easing: "cubic-bezier(.1,.7,.3,1)", fill: "backwards" }
      );
    }

    for (let i = 0; i < SHARD_COUNT; i++) {
      const angle = (i / SHARD_COUNT) * 2 * Math.PI + Math.random() * 0.3;
      const distance = 70 + Math.random() * 130;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      const r = Math.random() * 2 - 1;
      const size = 3 + Math.random() * 6;
      const color = SHARD_COLORS[i % SHARD_COLORS.length];
      play(
        effect(x, y, size, i % 2 ? size * 2.5 : size, {
          background: color,
          boxShadow: `0 0 6px ${color}`,
          borderRadius: Math.floor(i / 2) % 2 ? "1px" : "50%",
        }),
        [
          { transform: "translate(0px,0px) rotate(0deg) scale(1)", opacity: 1 },
          {
            transform: `translate(${0.8 * dx}px,${0.8 * dy - 30}px) rotate(${r * 540}deg) scale(1)`,
            opacity: 1,
            offset: 0.6,
          },
          { transform: `translate(${dx}px,${dy + 30}px) rotate(${r * 720}deg) scale(.2)`, opacity: 0 },
        ],
        { duration: 750 + Math.random() * 450, easing: "cubic-bezier(.15,.8,.35,1)" }
      );
    }
  }

  async function removePost(article) {
    await article.animate(
      [
        { transform: "translateX(0px)", boxShadow: "inset 0 0 0 3px rgba(244,33,46,.9)" },
        { transform: "translateX(-7px)" },
        { transform: "translateX(6px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(2px)" },
        { transform: "translateX(0px)", boxShadow: "inset 0 0 60px 10px rgba(244,33,46,.35)" },
      ],
      { duration: 380, easing: "ease-out" }
    ).finished;

    await article.animate(
      [
        { filter: "grayscale(0) blur(0px)", opacity: 1, transform: "scale(1)" },
        { filter: "grayscale(1) blur(3px)", opacity: 0, transform: "scale(.94)" },
      ],
      { duration: 420, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" }
    ).finished;

    const target = article.closest(SEL.cell) || article;
    const height = target.getBoundingClientRect().height;
    target.style.overflow = "hidden";
    await target.animate([{ height: `${height}px` }, { height: "0px" }], {
      duration: 320,
      easing: "cubic-bezier(.4,0,.2,1)",
    }).finished;
    target.style.display = "none";
  }

  // ── Keeping up with the SPA (8.2.7) ────────────────────────────────────
  function update(article) {
    if (article.dataset.tebBlocked === "1") return;

    const handle = qualifyingHandle(article);
    const btn = article.querySelector(".teb-btn");

    if (handle) {
      // First icon of the header's icon group (8.2.4): before Grok's wrapper,
      // else before the caret's. Grok is never hidden here; 8.3 does that.
      const anchor =
        article.querySelector(SEL.grok)?.parentElement ||
        article.querySelector(SEL.caret)?.parentElement;
      if (!btn) {
        if (!anchor?.parentElement) return;
        anchor.parentElement.insertBefore(createButton(handle), anchor);
      } else if (btn.dataset.state === "") {
        if (btn.dataset.handle !== handle) {
          setHandle(btn, handle); // the article was reused for another post
        }
        // X often renders Grok after the caret; move the button next to it
        // (8.2.4). Idle only: re-inserting restarts CSS animations.
        if (anchor?.parentElement && btn.nextElementSibling !== anchor) {
          anchor.parentElement.insertBefore(btn, anchor);
        }
      }
    } else if (btn && btn.dataset.state !== "working") {
      clearTimer(btn);
      btn.remove();
    }
  }

  // Profile header button (8.2.10). Idempotent.
  function updateProfile() {
    const actions = document.querySelector(SEL.profileActions);
    const row = actions?.parentElement;
    let btn = null;
    for (const b of document.querySelectorAll(SEL.profileBtn)) {
      if (row && b.parentElement === row && !btn) btn = b;
      else if (b.dataset.state !== "working") {
        clearTimer(b);
        b.remove(); // left over from another profile
      }
    }
    if (!actions || !row) return;

    const handle = profileHandle(actions);
    if (handle) {
      if (!btn) {
        btn = createButton(handle, true);
        row.insertBefore(btn, actions);
      } else if (btn.dataset.state === "") {
        if (btn.dataset.handle !== handle) setHandle(btn, handle);
        if (btn.nextElementSibling !== actions) row.insertBefore(btn, actions);
      }
      // Follow X's theme: copy the ⋯ button's colors.
      const cs = getComputedStyle(actions);
      if (btn.style.getPropertyValue("--teb-fg") !== cs.color) {
        btn.style.setProperty("--teb-fg", cs.color);
      }
      if (btn.style.getPropertyValue("--teb-border") !== cs.borderTopColor) {
        btn.style.setProperty("--teb-border", cs.borderTopColor);
      }
    } else if (btn && btn.dataset.state !== "working") {
      clearTimer(btn);
      btn.remove();
    }
  }

  function scan() {
    for (const article of document.querySelectorAll(SEL.post)) {
      try {
        update(article);
      } catch {
        // Fail closed for this post only.
      }
    }
    try {
      updateProfile();
    } catch {
      // Fail closed for the profile header only.
    }
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      try {
        scan();
      } catch {
        // Fail closed.
      }
    });
  }

  // ── Startup (8.2.2) ────────────────────────────────────────────────────
  try {
    if (MARKER in window) return;
    Object.defineProperty(window, MARKER, {
      value: Object.freeze({ id: "twitter-easy-block", revision: REVISION }),
      enumerable: false,
      writable: false,
      configurable: false,
    });

    const style = document.createElement("style");
    style.id = "teb-style";
    style.textContent = CSS;
    document.head.append(style);

    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    scan();
  } catch {
    // Fail closed: leave X untouched.
  }
})();
