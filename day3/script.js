// ---------- Starting data ----------
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

const CATEGORIES = ["personal", "work", "study"];
const MAX_LENGTH = 200;


// Returns an array of notes whose text contains `word`, ignoring case.
function searchNotes(word) {
  const target = word.toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(target));
}

// Returns the note with the most characters, or null if there are no notes.
function longestNote() {
  if (notes.length === 0) {
    return null;
  }
  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

// Returns an object counting notes per category, e.g. { personal: 2, work: 1, study: 2 }.
function countByCategory() {
  const counts = { personal: 0, work: 0, study: 0 };
  for (const note of notes) {
    counts[note.category] = (counts[note.category] || 0) + 1;
  }
  return counts;
}

// Returns a sentence such as "5 notes: 2 personal, 1 work, 2 study."
function getSummary() {
  const counts = countByCategory();
  const total = notes.length;
  const noun = total === 1 ? "note" : "notes";
  const parts = Object.keys(counts).map((category) => `${counts[category]} ${category}`);
  return `${total} ${noun}: ${parts.join(", ")}.`;
}

// Returns true if a note with the same text exists (ignoring case and extra spaces).
function isDuplicate(text) {
  const clean = text.trim().toLowerCase();
  return notes.some((note) => note.text.trim().toLowerCase() === clean);
}

// Adds a note if it is valid. Returns true when added, false otherwise (and logs why).
function addNote(text, category) {
  const clean = typeof text === "string" ? text.trim() : "";

  if (clean.length < 1 || clean.length > MAX_LENGTH) {
    console.log(`Not added: text must be 1-${MAX_LENGTH} characters (got ${clean.length}).`);
    return false;
  }
  if (isDuplicate(clean)) {
    console.log(`Not added: "${clean}" already exists.`);
    return false;
  }
  if (!CATEGORIES.includes(category)) {
    console.log(`Not added: category must be one of ${CATEGORIES.join(", ")} (got "${category}").`);
    return false;
  }

  const nextId = notes.length > 0 ? Math.max(...notes.map((note) => note.id)) + 1 : 1;
  notes.push({ id: nextId, text: clean, category: category });
  return true;
}

// ---------- Tests ----------
// Each call has its expected output in a comment next to it.

// searchNotes
console.log("searchNotes('the'):", searchNotes("the").map((n) => n.id)); // [ 2, 3 ]  (ids of "Finish the Day 3 assignment" and "Email the project report to Grace")
console.log("searchNotes('MILK'):", searchNotes("MILK").map((n) => n.id)); // [ 1 ]  (case is ignored)
console.log("searchNotes('zebra'):", searchNotes("zebra")); // []  (edge case: no results)

// longestNote
console.log("longestNote():", longestNote()); // { id: 3, text: 'Email the project report to Grace', category: 'work' }
const savedNotes = notes;
notes = [];
console.log("longestNote() with no notes:", longestNote()); // null  (edge case: empty array)
notes = savedNotes;

// countByCategory
console.log("countByCategory():", countByCategory()); // { personal: 2, work: 1, study: 2 }
notes = [];
console.log("countByCategory() with no notes:", countByCategory()); // { personal: 0, work: 0, study: 0 }  (edge case)
notes = savedNotes;

// getSummary
console.log("getSummary():", getSummary()); // 5 notes: 2 personal, 1 work, 2 study.
notes = [{ id: 1, text: "Only one", category: "work" }];
console.log("getSummary() with one note:", getSummary()); // 1 note: 0 personal, 1 work, 0 study.  (edge case: singular "note")
notes = savedNotes;

// isDuplicate
console.log("isDuplicate('call mum'):", isDuplicate("call mum")); // true  (case ignored)
console.log("isDuplicate('  BUY MILK AND BREAD  '):", isDuplicate("  BUY MILK AND BREAD  ")); // true  (extra spaces and case ignored)
console.log("isDuplicate('Call dad'):", isDuplicate("Call dad")); // false

// addNote
console.log("addNote('Plan weekend trip', 'personal'):", addNote("Plan weekend trip", "personal")); // true
console.log("addNote('call MUM', 'personal'):", addNote("call MUM", "personal")); // logs: Not added: "call MUM" already exists.  then false
console.log("addNote('', 'work'):", addNote("", "work")); // logs: Not added: text must be 1-200 characters (got 0).  then false
console.log("addNote('x'.repeat(201), 'work'):", addNote("x".repeat(201), "work")); // logs: Not added: text must be 1-200 characters (got 201).  then false
console.log("addNote('Book dentist', 'health'):", addNote("Book dentist", "health")); // logs: Not added: category must be one of personal, work, study (got "health").  then false
console.log("getSummary() after adding:", getSummary()); // 6 notes: 3 personal, 1 work, 2 study.
