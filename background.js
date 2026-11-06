// Service worker: registers one content script per enabled feature.
// See SPEC.md section 5.3.
import { FEATURES } from "./features/registry.js";

const STORAGE_KEY = "enabled";

async function readEnabled() {
  const { [STORAGE_KEY]: stored } = await chrome.storage.local.get(STORAGE_KEY);
  return stored && typeof stored === "object" ? stored : {};
}

function toRegistration(feature) {
  const script = {
    id: feature.id,
    matches: feature.matches,
    runAt: feature.runAt,
    allFrames: false,
    persistAcrossSessions: true,
  };
  if (feature.js) script.js = feature.js;
  if (feature.css) script.css = feature.css;
  if (feature.world) script.world = feature.world;
  return script;
}

async function registerEnabled() {
  const enabled = await readEnabled();
  await chrome.scripting.unregisterContentScripts();
  const scripts = FEATURES.filter((f) => enabled[f.id] !== false).map(toRegistration);
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

// Serialized so two syncs never interleave their unregister/register calls.
let pending = Promise.resolve();
function sync() {
  pending = pending
    .then(registerEnabled)
    .catch((err) => console.error("Bestest: failed to sync content scripts", err));
  return pending;
}

chrome.runtime.onInstalled.addListener(() => {
  sync();
});
chrome.runtime.onStartup.addListener(() => {
  sync();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) sync();
});
