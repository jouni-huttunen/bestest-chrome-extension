// Popup: one on/off switch per feature. See SPEC.md section 5.5.
import { FEATURES } from "../features/registry.js";

const STORAGE_KEY = "enabled";

const list = document.getElementById("features");
const notice = document.getElementById("notice");
const reloadButton = document.getElementById("reload");

// Feature IDs toggled since the popup opened; their tabs get reloaded.
const toggled = new Set();

async function readEnabled() {
  const { [STORAGE_KEY]: stored } = await chrome.storage.local.get(STORAGE_KEY);
  return stored && typeof stored === "object" ? stored : {};
}

// Read-modify-write, serialized so quick toggles don't overwrite each other.
let writing = Promise.resolve();
function saveEnabled(id, value) {
  writing = writing.then(async () => {
    const enabled = await readEnabled();
    enabled[id] = value;
    await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
  });
  return writing;
}

function renderRow(feature, enabled) {
  const label = document.createElement("label");
  label.className = "row";

  const title = document.createElement("span");
  title.textContent = feature.title;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.checked = enabled[feature.id] !== false;
  input.addEventListener("change", async () => {
    await saveEnabled(feature.id, input.checked);
    toggled.add(feature.id);
    notice.hidden = false;
  });

  label.append(title, input);
  return label;
}

function render(enabled) {
  const sites = [...new Set(FEATURES.map((f) => f.site))];
  for (const site of sites) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = site;
    section.append(heading);
    for (const feature of FEATURES.filter((f) => f.site === site)) {
      section.append(renderRow(feature, enabled));
    }
    list.append(section);
  }
}

reloadButton.addEventListener("click", async () => {
  const patterns = [
    ...new Set(FEATURES.filter((f) => toggled.has(f.id)).flatMap((f) => f.matches)),
  ];
  const tabs = patterns.length ? await chrome.tabs.query({ url: patterns }) : [];
  await Promise.all(tabs.map((tab) => chrome.tabs.reload(tab.id)));
  toggled.clear();
  notice.hidden = true;
});

render(await readEnabled());
