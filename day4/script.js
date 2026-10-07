// ---------- Elements ----------
const noteText = document.getElementById("note-text");
const charCount = document.getElementById("char-count");
const wordCount = document.getElementById("word-count");
const clearBtn = document.getElementById("clear-btn");
const themeToggle = document.getElementById("theme-toggle");

const DRAFT_KEY = "quicknotes-draft";
const THEME_KEY = "quicknotes-theme";
const MAX_CHARS = 200;
const WARN_AT = 180;

// ---------- Safe localStorage helpers ----------
// localStorage can be blocked (private mode, disabled storage), so never let it crash the page.
function saveItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.log("Could not save to localStorage:", error);
  }
}

function loadItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.log("Could not read from localStorage:", error);
    return null;
  }
}

function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.log("Could not remove from localStorage:", error);
  }
}

// ---------- Counters ----------
function updateCounts() {
  const text = noteText.value;
  const chars = text.length;
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;

  charCount.textContent = `${chars} / ${MAX_CHARS} characters`;
  wordCount.textContent = `${words} words`;

  charCount.classList.toggle("warning", chars > WARN_AT);
  charCount.classList.toggle("over", chars > MAX_CHARS);
}

// ---------- Draft ----------
function clearNote() {
  noteText.value = "";
  removeItem(DRAFT_KEY);
  updateCounts();
  noteText.focus();
}

noteText.addEventListener("input", () => {
  updateCounts();
  saveItem(DRAFT_KEY, noteText.value);
});

noteText.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearNote();
  }
});

clearBtn.addEventListener("click", clearNote);

// ---------- Theme ----------
// The button label names the mode you will switch TO.
function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
}

themeToggle.addEventListener("click", () => {
  const isDark = !document.body.classList.contains("dark");
  applyTheme(isDark);
  saveItem(THEME_KEY, isDark ? "dark" : "light");
});

// ---------- On page load ----------
const savedDraft = loadItem(DRAFT_KEY);
if (savedDraft !== null) {
  noteText.value = savedDraft;
}
applyTheme(loadItem(THEME_KEY) === "dark");
updateCounts();
