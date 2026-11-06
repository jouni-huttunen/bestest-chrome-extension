// twitter-media-grid-restore: X profile Media tabs show the legacy media grid.
// See SPEC.md section 8.1.
(() => {
  "use strict";

  const FLAG_NAMES = [
    "responsive_web_profile_redesign_enabled",
    "rweb_media_carousel_enabled",
  ];
  const MARKER = "__BESTEST_TWITTER_MEDIA_GRID_RESTORE__";
  const REVISION = 1;

  function patch(state) {
    try {
      const configs = [
        state?.featureSwitch?.defaultConfig,
        state?.featureSwitch?.user?.config,
      ];
      for (const config of configs) {
        if (!config) continue;
        for (const name of FLAG_NAMES) {
          const flag = config[name];
          if (flag && typeof flag === "object") flag.value = false;
        }
      }
    } catch {
      // Unexpected state shape: stop patching, keep the state as it is.
    }
    return state;
  }

  try {
    let initialState;

    const existing = Object.getOwnPropertyDescriptor(window, "__INITIAL_STATE__");
    if (existing && "value" in existing) initialState = patch(existing.value);

    Object.defineProperty(window, "__INITIAL_STATE__", {
      configurable: true,
      enumerable: true,
      get() {
        return initialState;
      },
      set(value) {
        initialState = patch(value);
      },
    });

    Object.defineProperty(window, MARKER, {
      value: Object.freeze({ id: "twitter-media-grid-restore", revision: REVISION }),
      enumerable: false,
      writable: false,
      configurable: false,
    });
  } catch {
    // Fail closed: leave X untouched if its bootstrap object can't be patched.
  }
})();
