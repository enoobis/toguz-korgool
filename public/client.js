import { applyStep } from "/game.js";

const names = ["куйрук", "текилдек", "ат өтпөс", "жаман үй", "бел үй", "далы", "эки тишти", "көк моюн", "ооз"];

const home = document.querySelector("#home");
const wait = document.querySelector("#wait");
const table = document.querySelector("#table");
const leaveBtn = document.querySelector("#leave");
const nameInput = document.querySelector("#name");
const makeForm = document.querySelector("#make");
const makeBtn = makeForm.querySelector("button");
const codeInput = document.querySelector("#code");
const homeMsg = document.querySelector("#home-msg");
const roomsEl = document.querySelector("#rooms");
const copyBtn = document.querySelector("#copy");
const waitMsg = document.querySelector("#wait-msg");
const statusEl = document.querySelector("#status");
const board = document.querySelector("#board");
const rowOpp = document.querySelector("#row-opp");
const rowYou = document.querySelector("#row-you");
const oppName = document.querySelector("#opp-name");
const youName = document.querySelector("#you-name");
const kazanOpp = document.querySelector("#kazan-opp");
const kazanYou = document.querySelector("#kazan-you");
const nextBtn = document.querySelector("#next");
const bead = document.querySelector("#bead");

let playerId = localStorage.getItem("tk-id");
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem("tk-id", playerId);
}

nameInput.value = localStorage.getItem("tk-name") || "";
nameInput.addEventListener("input", () => {
  localStorage.setItem("tk-name", nameInput.value.trim());
});

let socket = null;
let sockN = 0;
let online = false;
let screen = "home";
let you = 0;
let phase = "home";
let game = null;
let code = "";
let busy = false;
let want = false;
let opp = "";
let me = "";
let pendingJoin = new URLSearchParams(location.search).get("c");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const queue = [];
let pumping = false;

function send(payload) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
}

function show(name) {
  screen = name;
  home.hidden = name !== "home";
  wait.hidden = name !== "wait";
  table.hidden = name !== "table";
  leaveBtn.hidden = name === "home";
}

function paintNet() {
  makeBtn.disabled = !online;
  makeBtn.textContent = online ? "создать лобби" : "нет связи";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function renderRooms(list) {
  roomsEl.innerHTML = list.map((room) => (
    `<button type="button" data-code="${room.code}"><span>${escapeHtml(room.host)}</span><span>${room.code}</span></button>`
  )).join("");
}

function dots(count) {
  const shown = Math.min(count, 8);
  if (!shown) return "";
  let html = "";
  for (let i = 0; i < shown; i++) {
    const angle = (Math.PI * 2 * i) / shown - Math.PI / 2;
    const radius = shown === 1 ? 0 : 26;
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius;
    html += `<i style="left:${x}%;top:${y}%"></i>`;
  }
  return html;
}

function cell(side, index, state) {
  const count = state.pits[side][index];
  const tuz = state.tuz[1 - side] === index;
  const can = !busy && !state.over && state.turn === you && side === you && count > 0;
  return `<button type="button" class="pit${can ? " can" : ""}${tuz ? " tuz" : ""}" data-s="${side}" data-i="${index}" aria-label="${names[index]}, ${count}">
    <span class="dots">${dots(count)}</span>
    <span class="n">${count || ""}</span>
    <span class="mark">туз</span>
  </button>`;
}

function fill(row, side, reversed, state) {
  const order = reversed ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  row.innerHTML = order.map((index) => cell(side, index, state)).join("");
}

function statusText(state) {
  if (phase === "gone" || state?.reason === "leave") return "соперник вышел";
  if (!state) return "";
  if (state.over) {
    if (state.draw) return "ничья";
    if (state.winner === you) return "ты победил";
    return "соперник победил";
  }
  if (busy) return "ход";
  if (state.turn === you) return "твой ход";
  return "ход соперника";
}

function paint(state) {
  if (!state) return;
  const oppSide = 1 - you;
  fill(rowOpp, oppSide, true, state);
  fill(rowYou, you, false, state);
  kazanOpp.firstElementChild.textContent = state.kazan[oppSide];
  kazanYou.firstElementChild.textContent = state.kazan[you];
  oppName.textContent = opp || "соперник";
  youName.textContent = me || "ты";
  oppName.classList.toggle("on", state.turn === oppSide && !state.over);
  youName.classList.toggle("on", state.turn === you && !state.over);
  kazanOpp.classList.toggle("win", state.over && !state.draw && state.winner === oppSide);
  kazanYou.classList.toggle("win", state.over && !state.draw && state.winner === you);
  const text = statusText(state);
  statusEl.textContent = text;
  statusEl.classList.toggle("live", text === "твой ход" || text === "ты победил");
  const finished = state.over || phase === "gone";
  nextBtn.hidden = !finished;
  if (finished) {
    const back = phase === "gone" || state.reason === "leave";
    nextBtn.dataset.act = back ? "leave" : "rematch";
    nextBtn.textContent = back ? "в лобби" : want ? "ждём" : "ещё";
    nextBtn.disabled = !back && want;
  }
  document.title = state.over ? `${text} · тогуз коргоол` : state.turn === you ? "твой ход" : "ход соперника";
}

function bump(el) {
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function moveBead(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  bead.hidden = false;
  bead.style.transform = `translate(${rect.left + rect.width / 2}px, ${rect.top + rect.height / 2}px)`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clone(state) {
  return {
    pits: state.pits.map((row) => row.slice()),
    kazan: state.kazan.slice(),
    tuz: state.tuz.slice(),
    turn: state.turn,
    over: state.over,
    winner: state.winner,
    draw: state.draw,
    reason: state.reason,
  };
}

function kazanOf(step) {
  if (step.t === "touch") return step.k === you ? kazanYou : kazanOpp;
  return step.s === you ? kazanYou : kazanOpp;
}

async function animate(from, steps) {
  const local = clone(from);
  busy = true;
  paint(local);
  if (reduce || !steps.length) {
    for (const step of steps) applyStep(local, step);
    return local;
  }
  const wait = steps.length > 22 ? 36 : 70;
  bead.style.transitionDuration = `${Math.max(wait - 10, 16)}ms`;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const moving = step.t === "drop" || step.t === "touch" || step.t === "take";
    if (moving) moveBead(board.querySelector(`.pit[data-s="${step.s}"][data-i="${step.i}"]`));
    applyStep(local, step);
    if (step.t === "touch" || step.t === "kazan" || step.t === "sweep") bump(kazanOf(step));
    paint(local);
    if (moving) {
      board.querySelector(`.pit[data-s="${step.s}"][data-i="${step.i}"]`)?.classList.add("hot");
      const linger = steps[i + 1]?.t === "zero" ? 220 : wait;
      await sleep(linger);
    }
  }
  bead.hidden = true;
  return local;
}

async function handle(msg) {
  if (msg.type === "id" && msg.playerId) {
    playerId = msg.playerId;
    localStorage.setItem("tk-id", playerId);
    return;
  }
  if (msg.type === "rooms") {
    renderRooms(msg.rooms || []);
    return;
  }
  if (msg.type === "err") {
    busy = false;
    if (screen === "home") {
      homeMsg.textContent = msg.text;
      codeInput.value = "";
    } else if (game) {
      statusEl.textContent = msg.text;
      paint(game);
    }
    return;
  }
  if (msg.type === "home") {
    phase = "home";
    game = null;
    busy = false;
    show("home");
    document.title = "тогуз коргоол";
    return;
  }
  if (msg.type !== "state") return;

  you = msg.you;
  phase = msg.phase;
  code = msg.code;
  want = msg.want;
  me = msg.youName || nameInput.value.trim() || "ты";
  opp = msg.oppName || "";

  if (msg.phase === "wait") {
    busy = false;
    game = null;
    copyBtn.textContent = msg.code;
    waitMsg.textContent = "жди соперника";
    show("wait");
    document.title = msg.code;
    return;
  }

  show("table");
  const steps = msg.steps || [];
  if (steps.length && game && !reduce) {
    await animate(game, steps);
  }
  busy = false;
  game = msg.game;
  bead.hidden = true;
  paint(game);
}

async function pump(msg) {
  queue.push(msg);
  if (pumping) return;
  pumping = true;
  while (queue.length) await handle(queue.shift());
  pumping = false;
}

function connect() {
  const mine = ++sockN;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const next = new WebSocket(`${proto}//${location.host}`);
  socket = next;
  next.onopen = () => {
    if (mine !== sockN) return;
    online = true;
    paintNet();
    const joinCode = pendingJoin;
    pendingJoin = null;
    if (joinCode) history.replaceState({}, "", location.pathname);
    send({
      type: "hello",
      playerId,
      name: nameInput.value,
      join: joinCode || undefined,
    });
  };
  next.onmessage = (event) => pump(JSON.parse(event.data));
  next.onclose = () => {
    if (mine !== sockN) return;
    online = false;
    paintNet();
    setTimeout(connect, 1200);
  };
}

makeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  homeMsg.textContent = "";
  if (!online) return;
  send({ type: "create", name: nameInput.value });
});

codeInput.addEventListener("input", () => {
  const value = codeInput.value.replace(/\D/g, "").slice(0, 4);
  codeInput.value = value;
  homeMsg.textContent = "";
  if (value.length === 4) send({ type: "join", code: value, name: nameInput.value });
});

document.querySelector("#enter").addEventListener("submit", (event) => {
  event.preventDefault();
});

roomsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-code]");
  if (!button) return;
  homeMsg.textContent = "";
  send({ type: "join", code: button.dataset.code, name: nameInput.value });
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/?c=${code}`);
    waitMsg.textContent = "ссылка скопирована";
    setTimeout(() => {
      if (screen === "wait") waitMsg.textContent = "жди соперника";
    }, 1200);
  } catch {
    waitMsg.textContent = code;
  }
});

leaveBtn.addEventListener("click", () => send({ type: "leave" }));

nextBtn.addEventListener("click", () => {
  if (nextBtn.dataset.act === "leave") send({ type: "leave" });
  else send({ type: "rematch" });
});

board.addEventListener("click", (event) => {
  const pit = event.target.closest(".pit");
  if (!pit || busy || !game || game.over) return;
  if (Number(pit.dataset.s) !== you || game.turn !== you) return;
  if (!game.pits[you][pit.dataset.i]) return;
  busy = true;
  paint(game);
  send({ type: "move", pit: Number(pit.dataset.i) });
});

paintNet();
connect();
