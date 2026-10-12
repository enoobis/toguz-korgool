// тогуз коргоол
// больше одного камня — первый снова в ту же лунку, дальше против часовой.
// один камень — сразу в следующую.
// последний в чужой лунке: чёт — забрал, ровно 3 — туз (если можно).
// туз нельзя на 9-й, второй раз и в зеркало туза соперника.
// 82 в казане — победа. нечем ходить — ат сыроо.

export function createGame() {
  return {
    pits: [Array(9).fill(9), Array(9).fill(9)],
    kazan: [0, 0],
    tuz: [null, null],
    turn: 0,
    over: false,
    winner: null,
    draw: false,
    reason: null,
    seen: {},
  };
}

export function view(game) {
  return {
    pits: game.pits,
    kazan: game.kazan,
    tuz: game.tuz,
    turn: game.turn,
    over: game.over,
    winner: game.winner,
    draw: game.draw,
    reason: game.reason,
  };
}

export function positionKey(game) {
  return [
    game.pits[0].join(","),
    game.pits[1].join(","),
    game.kazan.join(","),
    game.tuz.join(","),
    game.turn,
  ].join("/");
}

function clone(game) {
  return {
    pits: [game.pits[0].slice(), game.pits[1].slice()],
    kazan: [game.kazan[0], game.kazan[1]],
    tuz: [game.tuz[0], game.tuz[1]],
    turn: game.turn,
    over: game.over,
    winner: game.winner,
    draw: game.draw,
    reason: game.reason,
    seen: { ...game.seen },
  };
}

function next(side, idx) {
  idx += 1;
  if (idx === 9) return [1 - side, 0];
  return [side, idx];
}

function sum(row) {
  let n = 0;
  for (const x of row) n += x;
  return n;
}

function canTuz(game, me, idx) {
  if (idx === 8) return false;
  if (game.tuz[me] != null) return false;
  if (game.tuz[1 - me] === idx) return false;
  return true;
}

export function applyStep(game, step) {
  if (step.t === "take" || step.t === "zero") game.pits[step.s][step.i] = 0;
  else if (step.t === "drop") game.pits[step.s][step.i] = step.n;
  else if (step.t === "touch") game.kazan[step.k] = step.n;
  else if (step.t === "kazan") game.kazan[step.s] = step.n;
  else if (step.t === "tuz") game.tuz[step.s] = step.i;
  else if (step.t === "sweep") {
    game.pits[step.s] = Array(9).fill(0);
    game.kazan[step.s] = step.n;
  }
  return game;
}

export function applySteps(game, steps) {
  const nextGame = clone(game);
  for (const step of steps) applyStep(nextGame, step);
  return nextGame;
}

export function totalStones(game) {
  return sum(game.pits[0]) + sum(game.pits[1]) + game.kazan[0] + game.kazan[1];
}

function finishScore(game) {
  game.over = true;
  if (game.kazan[0] > game.kazan[1]) {
    game.winner = 0;
    game.draw = false;
  } else if (game.kazan[1] > game.kazan[0]) {
    game.winner = 1;
    game.draw = false;
  } else {
    game.winner = null;
    game.draw = true;
  }
}

export function play(game, pit) {
  if (!game || game.over) return { ok: false, error: "партия закончена" };
  if (!Number.isInteger(pit) || pit < 0 || pit > 8) return { ok: false, error: "сюда нельзя" };
  if (sum(game.pits[game.turn]) === 0) return { ok: false, error: "ходов нет" };
  const count = game.pits[game.turn][pit];
  if (count <= 0) return { ok: false, error: "пусто" };

  const g = clone(game);
  const steps = [];
  const me = g.turn;
  let side = me;
  let idx = pit;
  let lead = null;

  const gain = (who, n) => {
    if (!n) return;
    g.kazan[who] += n;
    if (lead == null && g.kazan[who] >= 82) lead = who;
  };

  g.pits[me][pit] = 0;
  steps.push({ t: "take", s: me, i: pit });

  if (count === 1) [side, idx] = next(side, idx);

  let lastIntoTuz = false;
  for (let k = 0; k < count; k++) {
    if (k > 0) [side, idx] = next(side, idx);
    const owner = 1 - side;
    if (g.tuz[owner] === idx) {
      gain(owner, 1);
      steps.push({ t: "touch", s: side, i: idx, k: owner, n: g.kazan[owner] });
      lastIntoTuz = true;
      continue;
    }
    lastIntoTuz = false;
    g.pits[side][idx] += 1;
    steps.push({ t: "drop", s: side, i: idx, n: g.pits[side][idx] });
  }

  if (!lastIntoTuz && side !== me) {
    const n = g.pits[side][idx];
    if (n === 3 && canTuz(g, me, idx)) {
      g.pits[side][idx] = 0;
      g.tuz[me] = idx;
      gain(me, 3);
      steps.push({ t: "tuz", s: me, i: idx });
      steps.push({ t: "zero", s: side, i: idx });
      steps.push({ t: "kazan", s: me, n: g.kazan[me] });
    } else if (n % 2 === 0) {
      g.pits[side][idx] = 0;
      gain(me, n);
      steps.push({ t: "zero", s: side, i: idx });
      steps.push({ t: "kazan", s: me, n: g.kazan[me] });
    }
  }

  if (lead != null) {
    g.over = true;
    g.winner = lead;
    g.draw = false;
    g.reason = "82";
    return { ok: true, game: g, steps };
  }

  const nxt = 1 - me;
  if (sum(g.pits[nxt]) === 0) {
    const rest = sum(g.pits[me]);
    g.pits[me] = Array(9).fill(0);
    g.kazan[me] += rest;
    steps.push({ t: "sweep", s: me, n: g.kazan[me] });
    g.reason = "atsyrau";
    finishScore(g);
    return { ok: true, game: g, steps };
  }

  g.turn = nxt;
  const key = positionKey(g);
  g.seen[key] = (g.seen[key] || 0) + 1;
  if (g.seen[key] >= 3) {
    g.over = true;
    g.winner = null;
    g.draw = true;
    g.reason = "repeat";
  }
  return { ok: true, game: g, steps };
}
