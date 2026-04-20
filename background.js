const STORAGE_KEY = "tasks";
const BADGE_COLOR = "#E11D48";
const ALARM_NAME = "refresh-badge";

function elapsedMs(task) {
  const base = task.accumulatedMs || 0;
  if (task.runningStartedAt) {
    return base + (Date.now() - task.runningStartedAt);
  }
  return base;
}

async function refreshBadge() {
  const { [STORAGE_KEY]: tasks = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const running = tasks.find((t) => t && t.runningStartedAt);

  if (running) {
    const minutes = Math.floor(elapsedMs(running) / 60000);
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeText({ text: String(minutes) });
    await ensureAlarm();
  } else {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.alarms.clear(ALARM_NAME);
  }
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  }
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    refreshBadge();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshBadge();
});

refreshBadge();
