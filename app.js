/* MAFIA: private rooms, private role assignment, secure server-side actions, and 15-account testing. */
const SUPABASE_URL = "https://bqsjueoemtvebbadzvbj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Ly88Op8N8V4ok_ZtJPjpAQ_XNT0grzg";
const MAX_PLAYERS = 15;
const $ = (id) => document.getElementById(id);
const els = {
  createName: $("create-name"), joinName: $("join-name"), roomCode: $("room-code"), create: $("create-room"), join: $("join-room"),
  lobby: $("lobby"), lobbyTitle: $("lobby-title"), activeCode: $("active-code"), playerCount: $("player-count"), playerList: $("player-list"),
  leave: $("leave-room"), copy: $("copy-code"), notice: $("notice"), start: $("start-game"), gameStatus: $("game-status"), startHint: $("start-hint"),
  roleCard: $("role-card"), roleName: $("role-name"), roleDescription: $("role-description"), launchTest: $("launch-test-mode"), testAccountPanel: $("test-account-panel"),
  gameplay: $("gameplay-panel"), phaseTitle: $("phase-title"), aliveCount: $("alive-count"), roundResult: $("round-result"), privateResult: $("private-result"),
  actionPanel: $("action-panel"), actionTarget: $("action-target"), actionType: $("action-type"), submitAction: $("submit-action"), actionHint: $("action-hint"),
  deadNote: $("dead-note"), phaseInstruction: $("phase-instruction"), advance: $("advance-phase"), chatLog: $("chat-log"), chatForm: $("chat-form"),
  chatInput: $("chat-input"), chatHint: $("chat-hint"), daySeconds: $("day-seconds"), nightSeconds: $("night-seconds"), saveSettings: $("save-settings"), settingsHint: $("settings-hint"), lobbySettings: $("lobby-settings"), compMafia: $("comp-mafia"), compTown: $("comp-town"), compNeutral: $("comp-neutral"), roleCountGrid: $("role-count-grid"), saveComposition: $("save-composition"), compositionTotal: $("composition-total"), roleEditor: $("role-editor"), phaseTimer: $("phase-timer"), timerProgress: $("timer-progress"), phaseEyebrow: $("phase-eyebrow"), revealBanner: $("reveal-banner"), revealTitle: $("reveal-title"), revealCopy: $("reveal-copy")
};
let supabaseClient = null, currentRoom = null, currentUserId = null, pollHandle = null, noticeHandle = null;
let testAccounts = [], testModeActive = false, lastChatSignature = "", latestState = null, timerHandle = null, autoAdvanceBusy = false, lastRevealText = "";
function buildTestAccountButtons() {
  const holder = document.querySelector(".test-account-buttons");
  if (!holder) return;
  holder.replaceChildren();
  for (let i = 0; i < 15; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `test-account-button${i === 0 ? " active" : ""}`;
    button.dataset.testAccount = String(i);
    button.textContent = `Player ${i + 1}${i === 0 ? " · Host" : ""}`;
    button.addEventListener("click", () => activateTestAccount(i));
    holder.append(button);
  }
}
const ROLE_INFO = {
  Assassin: ["Mafia", "Choose one living player to kill each night. The Mafia wins by outnumbering the other living players."],
  Blackmailer: ["Mafia", "Choose a player each night. They cannot speak or vote during the following day. No cooldown."],
  Ambusher: ["Mafia", "Choose a house to watch. You attack a living visitor who performs a night action there, not the house's resident."],
  Disguiser: ["Mafia", "Choose a player each night to block their night ability. No cooldown."],
  Crewmate: ["Town", "No night ability. Discuss clues, pay attention to claims, and vote to eliminate Mafia."],
  Doctor: ["Town", "Protect one living player each night from attacks. You may protect yourself."],
  Detective: ["Town", "Investigate one living player to learn their exact role. After investigating, you must wait one full round before investigating again."],
  "Guardian Angel": ["Town", "Your ability activates only after you die. Then you may protect one living player each night."],
  Mayor: ["Town", "During the day, you can use your decree to eliminate one player without a public vote. The power has a two-round cooldown. You may still cast normal votes."],
  Distractor: ["Town", "Choose one player each night to block their night ability. No cooldown."],
  Jester: ["Neutral", "You win alone if the town votes you out. If Mafia kills you at night, you do not win and the game continues."],
  Vigilante: ["Neutral", "You have two bullets. Kill two Mafia members to win alone. If you shoot a non-Mafia player, you die."]
};
function showNotice(message, isError = false) {
  els.notice.textContent = message; els.notice.className = `notice show${isError ? " error" : ""}`;
  clearTimeout(noticeHandle); noticeHandle = setTimeout(() => els.notice.className = "notice", 3500);
}
function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) { button.dataset.originalText = button.querySelector("span").textContent; button.querySelector("span").textContent = label || "Please wait…"; }
  else if (button.dataset.originalText) { button.querySelector("span").textContent = button.dataset.originalText; delete button.dataset.originalText; }
}
function cleanName(value) { return value.trim().replace(/\s+/g, " ").slice(0, 18); }
function isConfigured() { return SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes("PASTE_"); }
function requireConfig() { if (!isConfigured()) { showNotice("Setup needed: add your Supabase URL and publishable/anon key in app.js.", true); return false; } return true; }
async function ensureSignedIn() {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) throw sessionError;
  if (session?.user) { currentUserId = session.user.id; return; }
  const { data, error } = await supabaseClient.auth.signInAnonymously();
  if (error) throw new Error(`Anonymous sign-in failed: ${error.message}. Enable Anonymous Sign-Ins in Supabase Auth settings.`);
  currentUserId = data.user.id;
}
function setButtonsDisabled(disabled) { els.create.disabled = disabled; els.join.disabled = disabled; }
function renderPlayers(players, hostId) {
  els.playerList.replaceChildren();
  players.forEach(player => {
    const item = document.createElement("div"); item.className = `player-item${player.is_alive === false ? " player-dead" : ""}`;
    const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.textContent = player.display_name.slice(0, 1).toUpperCase();
    const name = document.createElement("span"); name.className = "player-name"; name.textContent = player.display_name;
    item.append(avatar, name);
    if (player.is_alive === false) { const dead = document.createElement("span"); dead.className = "dead-tag"; dead.textContent = "DEAD"; item.append(dead); }
    if (player.user_id === hostId) { const tag = document.createElement("span"); tag.className = "host-tag"; tag.textContent = "HOST"; item.append(tag); }
    els.playerList.append(item);
  });
  els.playerCount.textContent = `${players.length} / ${MAX_PLAYERS}`;
}
function targetOptions(players, selfRole, actionType) {
  const oldValue = els.actionTarget.value;
  els.actionTarget.replaceChildren();
  const eligible = players.filter(p => p.is_alive !== false && (actionType === "protect" || p.user_id !== currentUserId));
  eligible.forEach(player => { const option = document.createElement("option"); option.value = player.user_id; option.textContent = player.display_name + (player.user_id === currentUserId ? " (you)" : ""); els.actionTarget.append(option); });
  if (eligible.some(p => p.user_id === oldValue)) els.actionTarget.value = oldValue;
  els.actionTarget.disabled = eligible.length === 0;
}
function roleAction(role, alive, phase, game) {
  if (phase === "night") {
    if (role === "Assassin") return ["kill", "Choose a player for the Mafia kill."];
    if (role === "Doctor" || (role === "Guardian Angel" && !alive)) return ["protect", role === "Doctor" ? "Choose someone to protect tonight." : "You are dead, so your Guardian Angel ability is active."];
    if (role === "Detective") return ["investigate", "Choose someone to investigate. Results are private to you."];
    if (role === "Distractor" || role === "Disguiser") return ["block", "Choose whose night ability to block."];
    if (role === "Blackmailer") return ["silence", "Choose who will be silenced during the next day."];
    if (role === "Ambusher") return ["ambush", "Choose the house to watch for visitors tonight."];
    if (role === "Vigilante") return ["shoot", `Choose carefully. ${game.vigilante_bullets ?? 2} bullet(s) remain. You need two Mafia kills to win.`];
  }
  return null;
}

const COMPOSITION_ROLES = [
  ["Assassin","Mafia"],["Blackmailer","Mafia"],["Ambusher","Mafia"],["Disguiser","Mafia"],
  ["Crewmate","Town"],["Doctor","Town"],["Detective","Town"],["Guardian Angel","Town"],["Mayor","Town"],["Distractor","Town"],
  ["Jester","Neutral"],["Vigilante","Neutral"]
];
const FIXED_15 = {"Assassin":1,"Blackmailer":1,"Ambusher":1,"Disguiser":0,"Crewmate":6,"Doctor":1,"Detective":1,"Guardian Angel":1,"Mayor":1,"Distractor":1,"Jester":0,"Vigilante":0};
let compositionInputsBuilt = false, compositionPlayerCount = -1;
function defaultComposition(count) {
  if (count === 15) return {...FIXED_15};
  const mafia = count >= 12 ? 3 : count >= 8 ? 2 : 1;
  const town = count - mafia;
  return {"Assassin":1,"Blackmailer":mafia-1,"Ambusher":0,"Disguiser":0,"Crewmate":Math.max(0,town-2),"Doctor":1,"Detective":1,"Guardian Angel":0,"Mayor":0,"Distractor":0,"Jester":0,"Vigilante":0};
}
function buildCompositionInputs(count) {
  if (!compositionInputsBuilt) {
    els.roleCountGrid.replaceChildren();
    COMPOSITION_ROLES.forEach(([role,side]) => {
      const label=document.createElement("label"); label.className="role-count-row";
      const name=document.createElement("span"); name.textContent=`${role} · ${side}`;
      const input=document.createElement("input"); input.type="number"; input.min="0"; input.max="15"; input.step="1"; input.value="0"; input.dataset.role=role; input.setAttribute("aria-label",`${role} count`);
      input.addEventListener("input", updateCompositionEditor);
      label.append(name,input); els.roleCountGrid.append(label);
    });
    compositionInputsBuilt=true;
  }
  const defaults=defaultComposition(count);
  els.roleCountGrid.querySelectorAll("input[data-role]").forEach(input=>input.value=String(defaults[input.dataset.role]||0));
  compositionPlayerCount=count;
  updateCompositionEditor();
}
function readComposition() {
  const result={}; els.roleCountGrid.querySelectorAll("input[data-role]").forEach(input=>result[input.dataset.role]=Math.max(0,Math.min(15,Number.parseInt(input.value||"0",10)||0))); return result;
}
function updateCompositionEditor() {
  if (!els.roleCountGrid) return;
  const comp=readComposition(); let total=0,mafia=0,town=0,neutral=0;
  for (const [role,side] of COMPOSITION_ROLES) { const n=comp[role]||0; total+=n; if(side==="Mafia")mafia+=n; else if(side==="Town")town+=n; else neutral+=n; }
  const count=latestState?.players?.length || 0;
  els.compositionTotal.textContent=`${total} / ${count} roles selected · Mafia ${mafia} · Town ${town} · Neutral ${neutral}`;
  els.compositionTotal.style.color=total===count&&mafia>0&&town>=3*mafia?"#a7f3d0":"#fca5a5";
  els.compMafia.textContent=String(mafia); els.compTown.textContent=String(town); els.compNeutral.textContent=String(neutral);
}
async function saveRoleComposition() {
  if(!currentRoom||!latestState)return;
  if(currentUserId!==currentRoom.host_user_id)return showNotice("Only the host can edit role composition.",true);
  const comp=readComposition(), count=(latestState.players||[]).length;
  const total=Object.values(comp).reduce((a,b)=>a+b,0);
  const mafia=["Assassin","Blackmailer","Ambusher","Disguiser"].reduce((n,r)=>n+comp[r],0);
  const town=["Crewmate","Doctor","Detective","Guardian Angel","Mayor","Distractor"].reduce((n,r)=>n+comp[r],0);
  if(total!==count)return showNotice(`Role counts total ${total}, but ${count} players are in the room.`,true);
  if(mafia<1||town<3*mafia)return showNotice("Fairness rule: Town must have at least 3 players per Mafia member.",true);
  if(count===15&&JSON.stringify(Object.keys(FIXED_15).sort().map(k=>[k,comp[k]]))!==JSON.stringify(Object.keys(FIXED_15).sort().map(k=>[k,FIXED_15[k]])))return showNotice("The 15-player composition is fixed.",true);
  setBusy(els.saveComposition,true,"Saving composition…");
  try { const {error}=await supabaseClient.rpc("set_private_role_composition",{p_room_code:currentRoom.code,p_composition:comp}); if(error)throw error; showNotice("Role composition saved. Roles will still be assigned randomly."); }
  catch(error){showNotice(error.message||"Couldn't save role composition.",true);}
  finally{setBusy(els.saveComposition,false);}
}

function updateComposition(count) {
  if (count < 4) { els.compMafia.textContent = "1"; els.compTown.textContent = String(Math.max(0,count-1)); els.compNeutral.textContent = "0"; return; }
  const mafia = count >= 14 ? 4 : count >= 11 ? 3 : count >= 8 ? 2 : 1;
  const neutralPossible = count >= 7;
  els.compMafia.textContent = String(mafia);
  els.compTown.textContent = neutralPossible ? `${count-mafia-1}–${count-mafia}` : String(count-mafia);
  els.compNeutral.textContent = neutralPossible ? "0–1" : "0";
}
function startTimerTicker() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(async () => {
    const game = latestState?.game;
    if (!game || game.phase === "finished" || !game.phase_started_at) return;
    const duration = Number(game.phase === "day" ? game.day_seconds : game.night_seconds) || (game.phase === "day" ? 90 : 30);
    const elapsed = Math.max(0, (Date.now() - new Date(game.phase_started_at).getTime()) / 1000);
    const remaining = Math.max(0, Math.ceil(duration - elapsed));
    els.phaseTimer.textContent = `${String(Math.floor(remaining/60)).padStart(2,"0")}:${String(remaining%60).padStart(2,"0")}`;
    els.timerProgress.style.width = `${Math.min(100, Math.max(0, elapsed/duration*100))}%`;
    els.timerProgress.classList.toggle("timer-low", remaining <= 10);
    if (currentUserId === latestState?.room?.host_user_id && remaining <= 0 && !autoAdvanceBusy) {
      autoAdvanceBusy = true;
      try { await advancePhase(true); } finally { autoAdvanceBusy = false; }
    }
  }, 250);
}
function renderGameplay(data) {
  const game = data.game;
  if (data.room?.status === "lobby") { els.gameplay.classList.add("hidden"); document.body.dataset.phase = "lobby"; return; }
  if (!game) { els.gameplay.classList.add("hidden"); return; }
  els.gameplay.classList.remove("hidden");
  const phase = game.phase, alive = data.self_alive !== false, players = data.players || [], isHost = currentUserId === data.room.host_user_id;
  els.phaseTitle.textContent = phase === "finished" ? `${game.winner || "Game"} wins` : `${phase === "night" ? "Night" : "Day"} ${game.round_number}`;
  document.body.dataset.phase = phase; els.phaseEyebrow.textContent = phase === "day" ? "MORNING · DISCUSSION OPEN" : phase === "night" ? "NIGHTFALL · CHOOSE CAREFULLY" : "MATCH COMPLETE";
  els.phaseTimer.classList.toggle("hidden", phase === "finished");
  if (game.last_result && game.last_result !== lastRevealText && /died|eliminated|wins|killed|revealed|Mafia members remain/i.test(game.last_result)) { lastRevealText = game.last_result; els.revealTitle.textContent = phase === "day" ? "DAWN BREAKS" : game.winner ? `${game.winner.toUpperCase()} VICTORIOUS` : "THE VOTE IS IN"; els.revealCopy.textContent = game.last_result; els.revealBanner.classList.remove("reveal-show"); void els.revealBanner.offsetWidth; els.revealBanner.classList.add("reveal-show"); }
  els.aliveCount.textContent = `Alive: ${game.living_players ?? players.filter(p => p.is_alive !== false).length}`;
  els.roundResult.textContent = game.last_result || "";
  els.privateResult.textContent = data.private_result || ""; els.privateResult.classList.toggle("hidden", !data.private_result);
  const role = data.self_role;
  const action = roleAction(role, alive, phase, game);
  const isSilenced = !!players.find(p => p.user_id === currentUserId)?.silenced;
  const isDayAction = phase === "day" && alive && role;
  const canAct = phase !== "finished" && !(phase === "day" && isSilenced) && ((alive && (action || isDayAction)) || (!alive && role === "Guardian Angel" && phase === "night"));
  els.actionPanel.classList.toggle("hidden", !canAct);
  els.deadNote.classList.toggle("hidden", alive || phase === "finished");
  els.deadNote.textContent = role === "Guardian Angel" && !alive ? "You are dead, but your Guardian Angel power is active. You can protect one living player each night. Dead players can still read chat." : "You are dead. You can still read the public chat, but you cannot act or send messages.";
  if (canAct) {
    const previousActionType = els.actionType.value;
    els.actionType.replaceChildren();
    const addType = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; els.actionType.append(o); };
    if (phase === "day") {
      addType("vote", "Cast your vote");
      if (role === "Mayor") addType("mayor_eliminate", "Mayor's decree (bypass vote)");
      els.actionHint.textContent = role === "Mayor" ? "You can vote normally or use your decree. Cooldown is enforced by the server." : "Choose who you think should be eliminated.";
      els.submitAction.querySelector("span").textContent = "Submit vote";
    } else {
      addType(action[0], action[0] === "kill" ? "Mafia kill" : action[0] === "protect" ? "Protect" : action[0] === "investigate" ? "Investigate" : action[0] === "block" ? "Block ability" : action[0] === "silence" ? "Blackmail" : action[0] === "ambush" ? "Set ambush" : "Fire revolver");
      els.actionHint.textContent = action[1]; els.submitAction.querySelector("span").textContent = "Submit night action";
    }
    if ([...els.actionType.options].some(option => option.value === previousActionType)) els.actionType.value = previousActionType;
    if (phase === "day") els.submitAction.querySelector("span").textContent = els.actionType.value === "mayor_eliminate" ? "Use mayor's decree" : "Submit vote";
    targetOptions(players, role, phase === "day" ? "vote" : action?.[0]);
    const submitted = !!game.self_action_submitted;
    els.submitAction.disabled = submitted || els.actionTarget.options.length === 0;
    if (submitted) els.actionHint.textContent = "Your action is already submitted for this phase and is locked until the next phase.";
  }
  els.advance.classList.toggle("hidden", !isHost || phase === "finished" || !testModeActive);
  els.advance.querySelector("span").textContent = "TEST: Force next phase";
  els.phaseInstruction.textContent = phase === "finished" ? `Game over. Winner: ${game.winner || "unknown"}.` : isHost ? (testModeActive ? "Testing mode: use the temporary force-next-phase button to skip the timer." : "The phase advances automatically when the timer reaches zero.") : "The phase advances when the shared timer reaches zero.";
  els.advance.classList.toggle("hidden", !isHost || phase === "finished");
  els.advance.disabled = !testModeActive;
  const chat = data.chat || [];
  const signature = JSON.stringify(chat.map(m => [m.created_at, m.display_name, m.body]));
  if (signature !== lastChatSignature) {
    els.chatLog.replaceChildren();
    chat.forEach(message => { const row = document.createElement("div"); row.className = "chat-message"; const who = document.createElement("strong"); who.textContent = message.display_name; const body = document.createElement("span"); body.textContent = message.body; row.append(who, body); els.chatLog.append(row); });
    els.chatLog.scrollTop = els.chatLog.scrollHeight; lastChatSignature = signature;
  }
  const canChat = alive && phase === "day" && !(players.find(p => p.user_id === currentUserId)?.silenced);
  els.chatInput.disabled = !canChat; els.chatForm.querySelector("button").disabled = !canChat;
  els.chatHint.textContent = !alive ? "You are dead. You can read chat but cannot send messages." : phase !== "day" ? "Public chat opens during the day." : canChat ? "Keep it public. Dead players can still read the conversation." : "You are silenced and cannot speak this day.";
}
async function refreshLobby() {
  if (!currentRoom) return;
  const { data, error } = await supabaseClient.rpc("get_private_room_state", { p_room_code: currentRoom.code });
  if (error) { showNotice(`Lobby refresh failed: ${error.message}`, true); return; }
  if (!data?.room) { stopPolling(); currentRoom = null; els.lobby.classList.add("hidden"); showNotice("This room is no longer available.", true); return; }
  currentRoom = { ...currentRoom, ...data.room }; latestState = data;
  const players = data.players || []; renderPlayers(players, data.room.host_user_id); updateComposition(players.length);
  const isHost = currentUserId && currentUserId === data.room.host_user_id;
  const inGame = data.room.status === "in_game" || data.room.status === "finished";
  if (!compositionInputsBuilt || (compositionPlayerCount !== players.length && !inGame)) buildCompositionInputs(players.length);
  els.roleEditor.classList.toggle("hidden", !isHost || inGame);
  els.roleCountGrid.querySelectorAll("input").forEach(input=>input.disabled=!isHost||inGame||players.length===15);
  els.saveComposition.classList.toggle("hidden",!isHost||inGame||players.length===15);
  if(players.length===15){ els.compositionTotal.textContent="15 / 15 roles · Fixed balanced preset"; }

  els.start.classList.toggle("hidden", !isHost || inGame); els.start.disabled = players.length < 4;
  els.startHint.classList.toggle("hidden", !isHost || inGame);
  els.lobbySettings.classList.toggle("hidden", inGame);
  els.daySeconds.disabled = !isHost || inGame; els.nightSeconds.disabled = !isHost || inGame; els.saveSettings.classList.toggle("hidden", !isHost || inGame);
  if (data.game?.day_seconds) els.daySeconds.value = String(data.game.day_seconds);
  if (data.game?.night_seconds) els.nightSeconds.value = String(data.game.night_seconds);
  els.settingsHint.textContent = isHost ? "Settings lock when the match starts. Role assignments remain random." : "Only the host can set the round lengths before the match starts.";
  els.gameStatus.textContent = inGame ? (data.game?.phase === "finished" ? `Game over · ${data.game.winner} wins` : `Game started · ${data.game?.phase || "in progress"}`) : `${players.length} player${players.length === 1 ? "" : "s"} in lobby`;
  els.roleCard.classList.toggle("hidden", !inGame || !data.self_role);
  if (inGame && data.self_role) {
    const [category, description] = ROLE_INFO[data.self_role] || ["Unknown", "Keep your role secret."];
    els.roleName.textContent = data.self_role;
    const teammates = data.mafia_team?.filter(p => p.user_id !== currentUserId).map(p => `${p.display_name} (${p.role}${p.is_alive ? "" : ", dead"})`) || [];
    els.roleDescription.textContent = `${category} · ${description}${teammates.length ? ` Mafia teammates: ${teammates.join(", ")}.` : ""}`;
  }
  renderGameplay(data);
}
function startPolling() { stopPolling(); refreshLobby(); pollHandle = setInterval(refreshLobby, 2200); startTimerTicker(); }
function stopPolling() { if (pollHandle) clearInterval(pollHandle); pollHandle = null; if (timerHandle) clearInterval(timerHandle); timerHandle = null; }
function openLobby(room) { currentRoom = room; els.activeCode.textContent = room.code; els.lobbyTitle.textContent = "Your room is waiting"; els.lobby.classList.remove("hidden"); els.lobby.scrollIntoView({ behavior: "smooth", block: "nearest" }); startPolling(); }
async function createRoom() {
  if (!requireConfig()) return; const name = cleanName(els.createName.value); if (!name) return showNotice("Enter a player name first.", true);
  setBusy(els.create, true, "Creating room…");
  try { await ensureSignedIn(); const { data, error } = await supabaseClient.rpc("create_private_room", { p_display_name: name }); if (error) throw error; if (!data?.room?.code) throw new Error("The server did not return a room code."); els.joinName.value = name; openLobby(data.room); showNotice("Private room created. Share the code with your crew."); }
  catch (error) { showNotice(error.message || "Couldn't create room.", true); } finally { setBusy(els.create, false); }
}
async function joinRoom() {
  if (!requireConfig()) return; const name = cleanName(els.joinName.value); const code = els.roomCode.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!name) return showNotice("Enter a player name first.", true); if (code.length < 5) return showNotice("Enter a valid room code.", true);
  setBusy(els.join, true, "Joining room…");
  try { await ensureSignedIn(); const { data, error } = await supabaseClient.rpc("join_private_room", { p_room_code: code, p_display_name: name }); if (error) throw error; if (!data?.room?.code) throw new Error("The server did not return the room."); openLobby(data.room); showNotice("You joined the room."); }
  catch (error) { showNotice(error.message || "Couldn't join room.", true); } finally { setBusy(els.join, false); }
}
async function startGame() {
  if (!currentRoom || !requireConfig()) return; if (currentUserId !== currentRoom.host_user_id) return showNotice("Only the room host can start the game.", true);
  setBusy(els.start, true, "Assigning roles…");
  try { const { error } = await supabaseClient.rpc("start_private_game", { p_room_code: currentRoom.code }); if (error) throw error; await refreshLobby(); showNotice("Game started. Your role is private."); }
  catch (error) { showNotice(error.message || "Couldn't start the game.", true); } finally { setBusy(els.start, false); }
}
async function saveSettings() {
  if (!currentRoom) return;
  setBusy(els.saveSettings, true, "Saving…");
  try { const { error } = await supabaseClient.rpc("set_private_game_settings", { p_room_code: currentRoom.code, p_day_seconds: Number(els.daySeconds.value), p_night_seconds: Number(els.nightSeconds.value) }); if (error) throw error; await refreshLobby(); showNotice("Round timers saved. They lock when the game starts."); }
  catch (error) { showNotice(error.message || "Couldn't save match settings.", true); }
  finally { setBusy(els.saveSettings, false); }
}
async function submitAction() {
  if (!currentRoom || !latestState?.game) return;
  const actionType = els.actionType.value; const target = els.actionTarget.value || null;
  setBusy(els.submitAction, true, "Submitting…");
  try { const { error } = await supabaseClient.rpc("submit_private_action", { p_room_code: currentRoom.code, p_action_type: actionType, p_target_user_id: target }); if (error) throw error; await refreshLobby(); showNotice("Action submitted privately."); }
  catch (error) { showNotice(error.message || "Couldn't submit action.", true); } finally { setBusy(els.submitAction, false); }
}
async function advancePhase(automatic = false) {
  if (!currentRoom) return; if (!automatic) setBusy(els.advance, true, "Resolving…");
  try { const { data, error } = await supabaseClient.rpc("advance_private_phase", { p_room_code: currentRoom.code }); if (error) throw error; await refreshLobby(); showNotice(data?.winner ? `${data.winner} wins!` : (data?.result || "Phase resolved.")); }
  catch (error) { showNotice(error.message || "Couldn't resolve the phase.", true); } finally { setBusy(els.advance, false); }
}
async function sendChat(event) {
  event.preventDefault(); if (!currentRoom) return; const body = els.chatInput.value.trim(); if (!body) return;
  try { const { error } = await supabaseClient.rpc("send_private_chat", { p_room_code: currentRoom.code, p_body: body }); if (error) throw error; els.chatInput.value = ""; await refreshLobby(); }
  catch (error) { showNotice(error.message || "Couldn't send message.", true); }
}
async function launchFifteenPlayerTest() {
  if (!requireConfig()) return; if (currentRoom) return showNotice("Leave your current room before launching a test room.", true);
  setBusy(els.launchTest, true, "Creating test accounts…"); els.launchTest.disabled = true; const createdAccounts = [];
  try {
    if (!window.supabase?.createClient) throw new Error("Supabase's browser library did not load. Check your internet connection and refresh.");
    for (let i = 1; i <= 15; i++) {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error } = await client.auth.signInAnonymously(); if (error) throw new Error(`Could not create test player ${i}: ${error.message}`);
      createdAccounts.push({ client, userId: data.user.id, name: `Test Player ${i}` });
    }
    const { data: created, error: createError } = await createdAccounts[0].client.rpc("create_private_room", { p_display_name: createdAccounts[0].name }); if (createError) throw createError;
    const room = created?.room; if (!room?.code) throw new Error("Supabase did not return a room code for the test room.");
    for (let i = 1; i < createdAccounts.length; i++) { const { error } = await createdAccounts[i].client.rpc("join_private_room", { p_room_code: room.code, p_display_name: createdAccounts[i].name }); if (error) throw new Error(`Test player ${i + 1} couldn't join: ${error.message}`); }
    testAccounts = createdAccounts; testModeActive = true; els.testAccountPanel.classList.remove("hidden"); els.launchTest.disabled = true; els.launchTest.querySelector("span").textContent = "Test room created";
    activateTestAccount(0, false); openLobby(room); showNotice("Fifteen test players joined. Start the match, then switch accounts to inspect composition and actions.");
  } catch (error) { await Promise.allSettled(createdAccounts.map(account => account.client.auth.signOut())); testAccounts = []; testModeActive = false; els.testAccountPanel.classList.add("hidden"); showNotice(error.message || "Couldn't launch the five-player test.", true); }
  finally { setBusy(els.launchTest, false); if (testModeActive) { els.launchTest.disabled = true; els.launchTest.querySelector("span").textContent = "Test room created"; } else els.launchTest.disabled = false; }
}
function activateTestAccount(index, refresh = true) {
  const account = testAccounts[index]; if (!account) return; supabaseClient = account.client; currentUserId = account.userId;
  document.querySelectorAll("[data-test-account]").forEach(button => { const active = Number(button.dataset.testAccount) === index; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
  if (refresh && currentRoom) refreshLobby(); showNotice(`Viewing ${account.name}${index === 0 ? " (host)" : ""}.`);
}
async function leaveRoom() {
  stopPolling(); currentRoom = null; latestState = null; lastChatSignature = ""; els.lobby.classList.add("hidden"); els.playerList.replaceChildren(); els.testAccountPanel.classList.add("hidden");
  if (testModeActive) { await Promise.allSettled(testAccounts.map(account => account.client.auth.signOut())); testAccounts = []; testModeActive = false; els.launchTest.disabled = false; els.launchTest.querySelector("span").textContent = "Launch 15-player test"; }
  showNotice("You left this screen. Room membership remains until the room is cleaned up.");
}
async function copyCode() { if (!currentRoom) return; try { await navigator.clipboard.writeText(currentRoom.code); showNotice("Room code copied."); } catch { showNotice(`Room code: ${currentRoom.code}`); } }
els.create.addEventListener("click", createRoom); els.join.addEventListener("click", joinRoom); els.leave.addEventListener("click", leaveRoom); els.copy.addEventListener("click", copyCode);
els.start.addEventListener("click", startGame); els.saveSettings.addEventListener("click", saveSettings); els.saveComposition.addEventListener("click", saveRoleComposition); els.launchTest.addEventListener("click", launchFifteenPlayerTest); els.submitAction.addEventListener("click", submitAction);
els.actionType.addEventListener("change", () => { if (latestState?.game?.phase === "day") els.submitAction.querySelector("span").textContent = els.actionType.value === "mayor_eliminate" ? "Use mayor's decree" : "Submit vote"; }); els.advance.addEventListener("click", advancePhase); els.chatForm.addEventListener("submit", sendChat);
buildTestAccountButtons();
els.roomCode.addEventListener("input", () => { els.roomCode.value = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); });
els.roomCode.addEventListener("keydown", event => { if (event.key === "Enter") joinRoom(); }); els.createName.addEventListener("keydown", event => { if (event.key === "Enter") createRoom(); }); els.joinName.addEventListener("keydown", event => { if (event.key === "Enter") joinRoom(); });
if (window.supabase?.createClient && isConfigured()) supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
else setButtonsDisabled(false);
