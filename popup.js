const STORAGE_KEY = "tasks";
const MINUTE_MS = 60 * 1000;

const storage = {
  async get() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || [];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  },
  async set(tasks) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  },
};

let tasks = [];
let tickHandle = null;
let editingTimeId = null;
let editingNameId = null;

const listEl = document.getElementById("task-list");
const emptyEl = document.getElementById("empty-state");
const formEl = document.getElementById("add-form");
const inputEl = document.getElementById("new-task");
const totalEl = document.getElementById("total-time");
const clearAllEl = document.getElementById("clear-all");

function elapsedMs(task) {
  const base = task.accumulatedMs || 0;
  if (task.runningStartedAt) {
    return base + (Date.now() - task.runningStartedAt);
  }
  return base;
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Parse "H:M:S", "M:S", or "S" (or just a number of seconds).
// Returns ms, or null if invalid.
function parseTime(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let h = 0, m = 0, s = 0;
  if (nums.length === 1) [s] = nums;
  else if (nums.length === 2) [m, s] = nums;
  else if (nums.length === 3) [h, m, s] = nums;
  else return null;
  return ((h * 3600) + (m * 60) + s) * 1000;
}

function updateTotal() {
  const total = tasks.reduce((sum, t) => sum + elapsedMs(t), 0);
  totalEl.textContent = formatTime(total);
}

function render() {
  listEl.innerHTML = "";
  emptyEl.hidden = tasks.length > 0;
  clearAllEl.hidden = tasks.length === 0;
  updateTotal();

  for (const task of tasks) {
    const li = document.createElement("li");
    li.className = "task" + (task.runningStartedAt ? " running" : "");
    li.dataset.id = task.id;

    const isEditingTime = editingTimeId === task.id;
    const isEditingName = editingNameId === task.id;
    const timeStr = formatTime(elapsedMs(task));
    li.innerHTML = `
      <div class="task-row-top">
        ${isEditingName
          ? `<input class="name-edit" type="text" maxlength="80" spellcheck="false" />`
          : `<span class="task-name" title="Click to rename"></span>`}
        <button class="delete-btn" data-action="delete" title="Delete task">×</button>
      </div>
      <div class="task-row-bottom">
        ${isEditingTime
          ? `<input class="time-edit" type="text" value="${timeStr}" spellcheck="false" />`
          : `<span class="time-display" title="Click to edit">${timeStr}</span>`}
        <button class="icon" data-action="minus" title="Subtract 1 minute">−</button>
        <button class="icon" data-action="plus" title="Add 1 minute">+</button>
        <button class="icon start-btn ${task.runningStartedAt ? "running" : ""}" data-action="toggle">
          ${task.runningStartedAt ? "Stop" : "Start"}
        </button>
      </div>
    `;

    if (isEditingName) {
      li.querySelector(".name-edit").value = task.name;
    } else {
      const nameEl = li.querySelector(".task-name");
      if (task.name) {
        nameEl.textContent = task.name;
      } else {
        nameEl.textContent = "(no title)";
        nameEl.classList.add("untitled");
      }
    }

    listEl.appendChild(li);

    if (isEditingName) {
      const input = li.querySelector(".name-edit");
      input.focus();
      input.select();
    }
    if (isEditingTime) {
      const input = li.querySelector(".time-edit");
      input.focus();
      input.select();
    }
  }

  manageTick();
}

function updateTimeDisplays() {
  for (const task of tasks) {
    if (!task.runningStartedAt) continue;
    if (editingTimeId === task.id) continue;
    const el = listEl.querySelector(`.task[data-id="${task.id}"] .time-display`);
    if (el) el.textContent = formatTime(elapsedMs(task));
  }
  updateTotal();
}

function manageTick() {
  const anyRunning = tasks.some((t) => t.runningStartedAt);
  if (anyRunning && !tickHandle) {
    tickHandle = setInterval(updateTimeDisplays, 500);
  } else if (!anyRunning && tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

async function persist() {
  await storage.set(tasks);
}

function findTask(id) {
  return tasks.find((t) => t.id === id);
}

async function addTask(name) {
  tasks.unshift({
    id: crypto.randomUUID(),
    name: name.trim(),
    accumulatedMs: 0,
    runningStartedAt: null,
  });
  await persist();
  render();
}

async function toggleTask(id) {
  const task = findTask(id);
  if (!task) return;
  const now = Date.now();
  if (task.runningStartedAt) {
    task.accumulatedMs = (task.accumulatedMs || 0) + (now - task.runningStartedAt);
    task.runningStartedAt = null;
  } else {
    for (const other of tasks) {
      if (other.id !== id && other.runningStartedAt) {
        other.accumulatedMs = (other.accumulatedMs || 0) + (now - other.runningStartedAt);
        other.runningStartedAt = null;
      }
    }
    task.runningStartedAt = now;
  }
  await persist();
  render();
}

async function adjustTask(id, deltaMs) {
  const task = findTask(id);
  if (!task) return;
  const current = elapsedMs(task);
  const next = Math.max(0, current + deltaMs);
  if (task.runningStartedAt) {
    task.runningStartedAt = Date.now();
    task.accumulatedMs = next;
  } else {
    task.accumulatedMs = next;
  }
  await persist();
  render();
}

async function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  await persist();
  render();
}

async function setTaskTime(id, ms) {
  const task = findTask(id);
  if (!task) return;
  const next = Math.max(0, ms);
  if (task.runningStartedAt) {
    task.runningStartedAt = Date.now();
    task.accumulatedMs = next;
  } else {
    task.accumulatedMs = next;
  }
  await persist();
}

function startEditingTime(id) {
  editingTimeId = id;
  editingNameId = null;
  render();
}

function startEditingName(id) {
  editingNameId = id;
  editingTimeId = null;
  render();
}

async function commitTimeEdit(input) {
  const id = editingTimeId;
  if (!id) return;
  const ms = parseTime(input.value);
  editingTimeId = null;
  if (ms !== null) {
    await setTaskTime(id, ms);
  }
  render();
}

async function commitNameEdit(input) {
  const id = editingNameId;
  if (!id) return;
  const trimmed = input.value.trim();
  editingNameId = null;
  const task = findTask(id);
  if (task && task.name !== trimmed) {
    task.name = trimmed;
    await persist();
  }
  render();
}

function cancelEdit() {
  editingTimeId = null;
  editingNameId = null;
  render();
}

listEl.addEventListener("click", (e) => {
  const timeSpan = e.target.closest(".time-display");
  if (timeSpan) {
    const li = timeSpan.closest(".task");
    if (li) startEditingTime(li.dataset.id);
    return;
  }

  const nameSpan = e.target.closest(".task-name");
  if (nameSpan) {
    const li = nameSpan.closest(".task");
    if (li) startEditingName(li.dataset.id);
    return;
  }

  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const li = btn.closest(".task");
  if (!li) return;
  const id = li.dataset.id;
  const action = btn.dataset.action;
  switch (action) {
    case "toggle":
      toggleTask(id);
      break;
    case "plus":
      adjustTask(id, MINUTE_MS);
      break;
    case "minus":
      adjustTask(id, -MINUTE_MS);
      break;
    case "delete":
      deleteTask(id);
      break;
  }
});

// Masked HH:MM:SS input: value is always 8 chars with colons at 2 and 5.
// Typing a digit overwrites (skipping colons); backspace/delete clear digits.
const isDigitPos = (i) => i !== 2 && i !== 5;

function ensureMaskShape(input) {
  if (input.value.length !== 8 || input.value[2] !== ":" || input.value[5] !== ":") {
    input.value = "00:00:00";
  }
}

function clearSelectedDigits(value, start, end) {
  const chars = value.split("");
  for (let i = start; i < end; i++) {
    if (isDigitPos(i)) chars[i] = "0";
  }
  return chars.join("");
}

function maskedInsertDigit(input, digit) {
  ensureMaskShape(input);
  let value = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  let caret = start;

  if (start !== end) {
    value = clearSelectedDigits(value, start, end);
  }
  while (caret < value.length && !isDigitPos(caret)) caret++;
  if (caret >= value.length) {
    input.value = value;
    input.setSelectionRange(caret, caret);
    return;
  }
  value = value.slice(0, caret) + digit + value.slice(caret + 1);
  caret++;
  while (caret < value.length && !isDigitPos(caret)) caret++;
  input.value = value;
  input.setSelectionRange(caret, caret);
}

function maskedDeleteBackward(input) {
  ensureMaskShape(input);
  let value = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  let caret = start;

  if (start !== end) {
    value = clearSelectedDigits(value, start, end);
    input.value = value;
    input.setSelectionRange(start, start);
    return;
  }
  while (caret > 0 && !isDigitPos(caret - 1)) caret--;
  if (caret > 0) {
    value = value.slice(0, caret - 1) + "0" + value.slice(caret);
    caret--;
  }
  input.value = value;
  input.setSelectionRange(caret, caret);
}

function maskedDeleteForward(input) {
  ensureMaskShape(input);
  let value = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  let caret = start;

  if (start !== end) {
    value = clearSelectedDigits(value, start, end);
    input.value = value;
    input.setSelectionRange(start, start);
    return;
  }
  while (caret < value.length && !isDigitPos(caret)) caret++;
  if (caret < value.length) {
    value = value.slice(0, caret) + "0" + value.slice(caret + 1);
  }
  input.value = value;
  input.setSelectionRange(caret, caret);
}

function maskedPaste(input, text) {
  ensureMaskShape(input);
  const digits = (text.match(/\d/g) || []).join("").slice(-6).padStart(6, "0");
  const value = `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
  input.value = value;
  input.setSelectionRange(value.length, value.length);
}

listEl.addEventListener("beforeinput", (e) => {
  if (!e.target.classList.contains("time-edit")) return;
  const input = e.target;
  switch (e.inputType) {
    case "insertText": {
      e.preventDefault();
      const data = e.data || "";
      if (/^\d$/.test(data)) maskedInsertDigit(input, data);
      return;
    }
    case "insertFromPaste": {
      e.preventDefault();
      maskedPaste(input, e.data || "");
      return;
    }
    case "deleteContentBackward":
    case "deleteWordBackward":
      e.preventDefault();
      maskedDeleteBackward(input);
      return;
    case "deleteContentForward":
    case "deleteWordForward":
      e.preventDefault();
      maskedDeleteForward(input);
      return;
    case "deleteContent":
      e.preventDefault();
      maskedDeleteBackward(input);
      return;
  }
});

listEl.addEventListener("keydown", (e) => {
  const isTime = e.target.classList.contains("time-edit");
  const isName = e.target.classList.contains("name-edit");
  if (!isTime && !isName) return;
  if (e.key === "Enter") {
    e.preventDefault();
    if (isTime) commitTimeEdit(e.target);
    else commitNameEdit(e.target);
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelEdit();
  }
});

listEl.addEventListener(
  "blur",
  (e) => {
    if (e.target.classList.contains("time-edit")) {
      commitTimeEdit(e.target);
    } else if (e.target.classList.contains("name-edit")) {
      commitNameEdit(e.target);
    }
  },
  true
);

clearAllEl.addEventListener("click", async () => {
  if (tasks.length === 0) return;
  if (!confirm(`Delete all ${tasks.length} task${tasks.length === 1 ? "" : "s"}?`)) return;
  tasks = [];
  editingTimeId = null;
  editingNameId = null;
  await persist();
  render();
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  await addTask(inputEl.value);
  inputEl.value = "";
  inputEl.focus();
});

(async function init() {
  tasks = await storage.get();
  render();
})();
