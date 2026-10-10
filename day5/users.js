const API_URL = "https://jsonplaceholder.typicode.com/users";

const loadButton = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusEl = document.getElementById("status");
const usersList = document.getElementById("users-list");

// All users returned by the API. The filter works on this array,
// so typing never triggers a new request.
let users = [];

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type || "";
}

function createDetail(label, value) {
  const p = document.createElement("p");
  p.className = "user-detail";
  p.textContent = label + ": " + value;
  return p;
}

// Draws any array of users into the list.
function renderUsers(list) {
  usersList.replaceChildren();

  list.forEach(function (user) {
    const li = document.createElement("li");

    const name = document.createElement("strong");
    name.className = "user-name";
    name.textContent = user.name;

    li.append(
      name,
      createDetail("Email", user.email),
      createDetail("City", user.address.city),
      createDetail("Company", user.company.name)
    );

    usersList.appendChild(li);
  });
}

// Filters the stored array by name (case-insensitive) and redraws it.
function applyFilter() {
  const text = filterInput.value.trim().toLowerCase();
  const matches = users.filter(function (user) {
    return user.name.toLowerCase().includes(text);
  });

  renderUsers(matches);

  if (matches.length === 0) {
    setStatus("No users match your filter.", "error");
  } else if (text === "") {
    setStatus("Loaded " + users.length + " users.", "success");
  } else {
    setStatus("Showing " + matches.length + " of " + users.length + " users.", "success");
  }
}

async function loadUsers() {
  loadButton.disabled = true;
  setStatus("Loading users...", "loading");

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("Server responded with status " + response.status);
    }

    users = await response.json();
    applyFilter(); // respects anything already typed in the filter box
  } catch (error) {
    users = [];
    renderUsers(users);
    setStatus("Could not load users: " + error.message, "error");
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", loadUsers);

filterInput.addEventListener("input", function () {
  if (users.length > 0) {
    applyFilter();
  }
});
