import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createGame, play, view } from "./game.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const pub = path.join(root, "public");
const files = new Map([
  ["/", [path.join(pub, "index.html"), "text/html; charset=utf-8"]],
  ["/index.html", [path.join(pub, "index.html"), "text/html; charset=utf-8"]],
  ["/style.css", [path.join(pub, "style.css"), "text/css; charset=utf-8"]],
  ["/client.js", [path.join(pub, "client.js"), "text/javascript; charset=utf-8"]],
  ["/game.js", [path.join(root, "game.js"), "text/javascript; charset=utf-8"]],
]);

const rooms = new Map();
const people = new Map();

function send(socket, payload) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
}

function cleanName(value) {
  const name = String(value || "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  return name || "игрок";
}

function otherId(room, id) {
  return id === room.hostId ? room.guestId : room.hostId;
}

function roomList() {
  return [...rooms.values()]
    .filter((room) => room.phase === "wait")
    .map((room) => ({ code: room.code, host: room.hostName }));
}

function publishRooms() {
  const roomsNow = roomList();
  for (const person of people.values()) {
    if (!person.room && person.socket.readyState === 1) {
      send(person.socket, { type: "rooms", rooms: roomsNow });
    }
  }
}

function publishRoom(room, steps) {
  for (const id of [room.hostId, room.guestId]) {
    if (!id) continue;
    const person = people.get(id);
    if (!person || person.socket.readyState !== 1) continue;
    const oppId = otherId(room, id);
    const opp = oppId ? people.get(oppId) : null;
    send(person.socket, {
      type: "state",
      you: room.side[id] ?? 0,
      code: room.code,
      phase: room.phase,
      youName: person.name,
      oppName: opp ? opp.name : null,
      game: room.game ? view(room.game) : null,
      steps: steps || [],
      want: room.want.has(id),
    });
  }
}

function makeCode() {
  for (let i = 0; i < 20; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(Date.now()).slice(-4);
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  rooms.delete(code);
  for (const id of [room.hostId, room.guestId]) {
    const person = id && people.get(id);
    if (person) person.room = null;
  }
}

function leave(person) {
  const room = person.room && rooms.get(person.room);
  person.room = null;
  if (!room) {
    publishRooms();
    return;
  }
  if (room.phase === "wait") {
    closeRoom(room.code);
    publishRooms();
    return;
  }
  if (person.id === room.hostId) room.hostId = null;
  else room.guestId = null;
  room.want.delete(person.id);
  if (!room.hostId && !room.guestId) {
    rooms.delete(room.code);
    publishRooms();
    return;
  }
  room.phase = "gone";
  if (room.game) {
    room.game = { ...room.game, over: true, reason: "leave" };
  }
  publishRoom(room);
  publishRooms();
}

function home(person) {
  send(person.socket, { type: "home" });
  send(person.socket, { type: "rooms", rooms: roomList() });
}

function join(person, code) {
  if (person.room && person.room !== code) return;
  const room = rooms.get(code);
  if (!room || room.phase !== "wait") {
    send(person.socket, { type: "err", text: room ? "лобби занято" : "нет такого лобби" });
    return;
  }
  if (room.hostId === person.id) {
    person.room = code;
    publishRoom(room);
    return;
  }
  room.guestId = person.id;
  room.phase = "play";
  room.game = createGame();
  room.side = { [room.hostId]: 0, [room.guestId]: 1 };
  person.room = code;
  const host = people.get(room.hostId);
  if (host) host.room = code;
  publishRoom(room);
  publishRooms();
  console.log(`${code}  ${room.hostName} — ${person.name}`);
}

function create(person) {
  if (person.room) return;
  const code = makeCode();
  const room = {
    code,
    hostId: person.id,
    hostName: person.name,
    guestId: null,
    phase: "wait",
    game: null,
    side: { [person.id]: 0 },
    want: new Set(),
  };
  rooms.set(code, room);
  person.room = code;
  publishRoom(room);
  publishRooms();
  console.log(`лобби ${code}  ${person.name}`);
}

function move(person, pit) {
  const room = person.room && rooms.get(person.room);
  if (!room || room.phase !== "play" || !room.game || room.game.over) return;
  if (room.side[person.id] !== room.game.turn) {
    send(person.socket, { type: "err", text: "ход соперника" });
    return;
  }
  const result = play(room.game, pit);
  if (!result.ok) {
    send(person.socket, { type: "err", text: result.error });
    return;
  }
  room.game = result.game;
  if (result.game.over) {
    room.phase = "over";
    room.want.clear();
    console.log(`${room.code}  конец`);
  }
  publishRoom(room, result.steps);
}

function rematch(person) {
  const room = person.room && rooms.get(person.room);
  if (!room || room.phase !== "over" || !room.hostId || !room.guestId) return;
  room.want.add(person.id);
  if (room.want.size >= 2) {
    room.want.clear();
    room.side[room.hostId] = 1 - room.side[room.hostId];
    room.side[room.guestId] = 1 - room.side[room.guestId];
    room.game = createGame();
    room.phase = "play";
  }
  publishRoom(room);
}

function hello(socket, msg) {
  let id = String(msg.playerId || "");
  if (!/^[a-zA-Z0-9-]{8,48}$/.test(id)) id = crypto.randomUUID();
  const name = cleanName(msg.name);
  let person = people.get(id);
  if (person && person.socket !== socket) {
    const old = person.socket;
    person.socket = socket;
    old.close();
  }
  if (!person) {
    person = { id, name, socket, room: null, timer: null };
    people.set(id, person);
  }
  clearTimeout(person.timer);
  person.name = name;
  person.socket = socket;
  socket.personId = id;
  send(socket, { type: "id", playerId: id });

  if (person.room && rooms.has(person.room)) {
    const room = rooms.get(person.room);
    if (room.hostId === id) room.hostName = name;
    publishRoom(room);
    return;
  }
  person.room = null;
  if (msg.join && /^\d{4}$/.test(String(msg.join))) {
    join(person, String(msg.join));
    if (!person.room) home(person);
    return;
  }
  home(person);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const hit = files.get(url.pathname);
  if (!hit || !fs.existsSync(hit[0])) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": hit[1],
    "Cache-Control": "no-store",
  });
  fs.createReadStream(hit[0]).pipe(res);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "hello") {
      hello(socket, msg);
      return;
    }
    const person = people.get(socket.personId);
    if (!person) return;
    if (msg.name) person.name = cleanName(msg.name);
    if (msg.type === "create") create(person);
    else if (msg.type === "join") join(person, String(msg.code || ""));
    else if (msg.type === "leave") {
      leave(person);
      home(person);
    } else if (msg.type === "move") move(person, msg.pit);
    else if (msg.type === "rematch") rematch(person);
  });

  socket.on("close", () => {
    const person = people.get(socket.personId);
    if (!person || person.socket !== socket) return;
    person.timer = setTimeout(() => {
      if (person.socket !== socket) return;
      leave(person);
      people.delete(person.id);
    }, 15000);
  });
});

server.listen(port, "0.0.0.0", () => {
  const nets = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if ((net.family === "IPv4" || net.family === 4) && !net.internal) nets.push(net.address);
    }
  }
  console.log(`тогуз коргоол  http://localhost:${port}`);
  for (const ip of nets) console.log(`сеть           http://${ip}:${port}`);
});
