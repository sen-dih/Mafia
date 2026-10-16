/*
  Milestone 02: private rooms, lobby, host-controlled start, and private role assignment.
  Role assignment happens inside a SECURITY DEFINER database function. The client receives only its own role.
*/
const SUPABASE_URL = "https://bqsjueoemtvebbadzvbj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Ly88Op8N8V4ok_ZtJPjpAQ_XNT0grzg";
const MAX_PLAYERS = 15;

const $ = (id) => document.getElementById(id);
const els = {
  createName: $("create-name"), joinName: $("join-name"), roomCode: $("room-code"),
  create: $("create-room"), join: $("join-room"), lobby: $("lobby"),
  lobbyTitle: $("lobby-title"), activeCode: $("active-code"), playerCount: $("player-count"),
  playerList: $("player-list"), leave: $("leave-room"), copy: $("copy-code"), notice: $("notice"),
  start: $("start-game"), gameStatus: $("game-status"), startHint: $("start-hint"),
  roleCard: $("role-card"), roleName: $("role-name"), roleDescription: $("role-description"),
  launchTest: $("launch-test-mode"), testAccountPanel: $("test-account-panel")
};

let supabaseClient = null;
let currentRoom = null;
let currentUserId = null;
let pollHandle = null;
let noticeHandle = null;
let testAccounts = [];
let testModeActive = false;

function showNotice(message, isError = false) {
  els.notice.textContent = message;
  els.notice.className = `notice show${isError ? " error" : ""}`;
  clearTimeout(noticeHandle);
  noticeHandle = setTimeout(() => els.notice.className = "notice", 3200);
}
function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.querySelector("span").textContent;
    button.querySelector("span").textContent = label || "Please wait…";
  } else if (button.dataset.originalText) {
    button.querySelector("span").textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}
function cleanName(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 18);
}
function isConfigured() {
  return SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("PASTE_") &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes("PASTE_");
}
async function ensureSignedIn() {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) throw sessionError;
  if (session?.user) {
    currentUserId = session.user.id;
    return;
  }
  const { data, error } = await supabaseClient.auth.signInAnonymously();
  if (error) throw new Error(`Anonymous sign-in failed: ${error.message}. Enable Anonymous Sign-Ins in Supabase Auth settings.`);
  currentUserId = data.user.id;
}
function requireConfig() {
  if (!isConfigured()) {
    showNotice("Setup needed: add your Supabase URL and publishable/anon key in app.js.", true);
    return false;
  }
  return true;
}
function setButtonsDisabled(disabled) {
  els.create.disabled = disabled;
  els.join.disabled = disabled;
}
function renderPlayers(players, hostId) {
  els.playerList.replaceChildren();
  players.forEach((player, index) => {
    const item = document.createElement("div");
    item.className = "player-item";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = player.display_name.slice(0, 1).toUpperCase();
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.display_name;
    item.append(avatar, name);
    if (player.user_id === hostId) {
      const tag = document.createElement("span");
      tag.className = "host-tag";
      tag.textContent = "HOST";
      item.append(tag);
    }
    els.playerList.append(item);
  });
  els.playerCount.textContent = `${players.length} / ${MAX_PLAYERS}`;
}
async function refreshLobby() {
  if (!currentRoom) return;
  const { data, error } = await supabaseClient.rpc("get_private_room_state", { p_room_code: currentRoom.code });
  if (error) {
    showNotice(`Lobby refresh failed: ${error.message}`, true);
    return;
  }
  if (!data?.room) {
    stopPolling();
    currentRoom = null;
    els.lobby.classList.add("hidden");
    showNotice("This room is no longer available.", true);
    return;
  }
  currentRoom = { ...currentRoom, ...data.room };
  const players = data.players || [];
  renderPlayers(players, data.room.host_user_id);
  const isHost = currentUserId && currentUserId === data.room.host_user_id;
  const inGame = data.room.status === "in_game" || data.room.status === "finished";
  els.start.classList.toggle("hidden", !isHost || inGame);
  els.start.disabled = players.length < 4;
  els.startHint.classList.toggle("hidden", !isHost || inGame);
  els.gameStatus.textContent = inGame ? "Game started · roles assigned" : `${players.length} player${players.length === 1 ? "" : "s"} in lobby`;
  els.roleCard.classList.toggle("hidden", !inGame || !data.self_role);
  if (inGame && data.self_role) {
    const descriptions = {
      Mafia: "You are on the Mafia team. Your team’s night actions will be added in the next milestone. For now, keep your identity secret.",
      Detective: "You are the Detective. Investigations will be added in the next milestone. For now, keep your identity secret.",
      Doctor: "You are the Doctor. Protect actions will be added in the next milestone. For now, keep your identity secret.",
      Villager: "You are a Villager. Use discussion and deduction to find the Mafia. Voting will be added in the next milestone."
    };
    els.roleName.textContent = data.self_role;
    els.roleDescription.textContent = descriptions[data.self_role] || "Keep your role secret.";
  }
}
function startPolling() {
  stopPolling();
  refreshLobby();
  // Simple first milestone. We can replace this with private Realtime Broadcast after the room/RLS
  // behaviour is tested. A 2-second poll is intentionally modest for a turn-based lobby.
  pollHandle = setInterval(refreshLobby, 2000);
}
function stopPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}
function openLobby(room) {
  currentRoom = room;
  els.activeCode.textContent = room.code;
  els.lobbyTitle.textContent = "Your room is waiting";
  els.lobby.classList.remove("hidden");
  els.lobby.scrollIntoView({ behavior: "smooth", block: "nearest" });
  startPolling();
}
async function createRoom() {
  if (!requireConfig()) return;
  const name = cleanName(els.createName.value);
  if (!name) return showNotice("Enter a player name first.", true);
  setBusy(els.create, true, "Creating room…");
  try {
    await ensureSignedIn();
    const { data, error } = await supabaseClient.rpc("create_private_room", { p_display_name: name });
    if (error) throw error;
    if (!data?.room?.code) throw new Error("The server did not return a room code.");
    els.joinName.value = name;
    openLobby(data.room);
    showNotice("Private room created. Share the code with your crew.");
  } catch (error) {
    showNotice(error.message || "Couldn't create room.", true);
  } finally {
    setBusy(els.create, false);
  }
}
async function joinRoom() {
  if (!requireConfig()) return;
  const name = cleanName(els.joinName.value);
  const code = els.roomCode.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!name) return showNotice("Enter a player name first.", true);
  if (code.length < 5) return showNotice("Enter a valid room code.", true);
  setBusy(els.join, true, "Joining room…");
  try {
    await ensureSignedIn();
    const { data, error } = await supabaseClient.rpc("join_private_room", {
      p_room_code: code, p_display_name: name
    });
    if (error) throw error;
    if (!data?.room?.code) throw new Error("The server did not return the room.");
    openLobby(data.room);
    showNotice("You joined the room.");
  } catch (error) {
    showNotice(error.message || "Couldn't join room.", true);
  } finally {
    setBusy(els.join, false);
  }
}
async function startGame() {
  if (!currentRoom || !requireConfig()) return;
  if (currentUserId !== currentRoom.host_user_id) {
    showNotice("Only the room host can start the game.", true);
    return;
  }
  setBusy(els.start, true, "Assigning roles…");
  try {
    const { error } = await supabaseClient.rpc("start_private_game", { p_room_code: currentRoom.code });
    if (error) throw error;
    await refreshLobby();
    showNotice("Game started. Your role is private.");
  } catch (error) {
    showNotice(error.message || "Couldn't start the game.", true);
  } finally {
    setBusy(els.start, false);
  }
}

async function launchFivePlayerTest() {
  if (!requireConfig()) return;
  if (currentRoom) {
    showNotice("Leave your current room before launching a test room.", true);
    return;
  }
  setBusy(els.launchTest, true, "Creating test accounts…");
  els.launchTest.disabled = true;
  const createdAccounts = [];
  try {
    if (!window.supabase?.createClient) throw new Error("Supabase's browser library did not load. Check your internet connection and refresh.");

    // Each client has its own in-memory anonymous session. No passwords or email addresses are used.
    for (let i = 1; i <= 5; i++) {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw new Error(`Could not create test player ${i}: ${error.message}`);
      createdAccounts.push({ client, userId: data.user.id, name: `Test Player ${i}` });
    }

    const { data: created, error: createError } = await createdAccounts[0].client.rpc("create_private_room", {
      p_display_name: createdAccounts[0].name
    });
    if (createError) throw createError;
    const room = created?.room;
    if (!room?.code) throw new Error("Supabase did not return a room code for the test room.");

    for (let i = 1; i < createdAccounts.length; i++) {
      const { error } = await createdAccounts[i].client.rpc("join_private_room", {
        p_room_code: room.code,
        p_display_name: createdAccounts[i].name
      });
      if (error) throw new Error(`Test player ${i + 1} couldn't join: ${error.message}`);
    }

    testAccounts = createdAccounts;
    testModeActive = true;
    els.testAccountPanel.classList.remove("hidden");
    els.launchTest.disabled = true;
    els.launchTest.querySelector("span").textContent = "Test room created";
    activateTestAccount(0, false);
    openLobby(room);
    showNotice("Five separate test players joined. Switch accounts in the lobby to inspect each role.");
  } catch (error) {
    await Promise.allSettled(createdAccounts.map(account => account.client.auth.signOut()));
    testAccounts = [];
    testModeActive = false;
    els.testAccountPanel.classList.add("hidden");
    showNotice(error.message || "Couldn't launch the five-player test.", true);
  } finally {
    setBusy(els.launchTest, false);
    if (testModeActive) {
      els.launchTest.disabled = true;
      els.launchTest.querySelector("span").textContent = "Test room created";
    } else {
      els.launchTest.disabled = false;
    }
  }
}

function activateTestAccount(index, refresh = true) {
  const account = testAccounts[index];
  if (!account) return;
  supabaseClient = account.client;
  currentUserId = account.userId;
  document.querySelectorAll("[data-test-account]").forEach(button => {
    const active = Number(button.dataset.testAccount) === index;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (refresh && currentRoom) refreshLobby();
  showNotice(`Viewing ${account.name}${index === 0 ? " (host)" : ""}.`);
}

async function leaveRoom() {
  stopPolling();
  currentRoom = null;
  els.lobby.classList.add("hidden");
  els.playerList.replaceChildren();
  els.testAccountPanel.classList.add("hidden");
  if (testModeActive) {
    await Promise.allSettled(testAccounts.map(account => account.client.auth.signOut()));
    testAccounts = [];
    testModeActive = false;
    els.launchTest.disabled = false;
    els.launchTest.querySelector("span").textContent = "Launch 5-player test";
  }
  showNotice("You left the lobby on this screen. Your membership will expire with the room.");
  // Explicit membership removal is added in the next milestone to keep this first SQL small.
}
async function copyCode() {
  if (!currentRoom) return;
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    showNotice("Room code copied.");
  } catch {
    showNotice(`Room code: ${currentRoom.code}`);
  }
}

els.create.addEventListener("click", createRoom);
els.join.addEventListener("click", joinRoom);
els.leave.addEventListener("click", leaveRoom);
els.copy.addEventListener("click", copyCode);
els.start.addEventListener("click", startGame);
els.launchTest.addEventListener("click", launchFivePlayerTest);
document.querySelectorAll("[data-test-account]").forEach(button => {
  button.addEventListener("click", () => activateTestAccount(Number(button.dataset.testAccount)));
});
els.roomCode.addEventListener("input", () => {
  els.roomCode.value = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
});
els.roomCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRoom();
});
els.createName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") createRoom();
});
els.joinName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRoom();
});

if (window.supabase?.createClient && isConfigured()) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
} else {
  // Keep the page previewable before backend setup.
  setButtonsDisabled(false);
}
