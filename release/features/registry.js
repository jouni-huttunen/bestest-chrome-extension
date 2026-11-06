// The feature list in code. Must mirror the registry table in SPEC.md section 6.
export const FEATURES = [
  {
    id: "twitter-media-grid-restore",
    title: "Twitter media grid restore",
    site: "x.com",
    matches: ["https://x.com/*"],
    js: ["features/x.com/twitter-media-grid-restore.js"],
    runAt: "document_start",
    world: "MAIN",
  },
  {
    id: "twitter-easy-block",
    title: "Twitter Easy Block",
    site: "x.com",
    matches: ["https://x.com/*"],
    js: ["features/x.com/twitter-easy-block.js"],
    runAt: "document_idle",
    world: "MAIN",
  },
  {
    id: "twitter-ui-cleanup",
    title: "Twitter UI Cleanup",
    site: "x.com",
    matches: ["https://x.com/*"],
    css: ["features/x.com/twitter-ui-cleanup.css"],
    runAt: "document_start",
  },
];
