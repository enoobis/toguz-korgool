import test from "node:test";
import assert from "node:assert/strict";
import { applySteps, createGame, play, totalStones } from "./game.js";

function board(partial) {
  const game = createGame();
  game.pits = partial.pits.map((row) => row.slice());
  if (partial.kazan) game.kazan = partial.kazan.slice();
  if (partial.tuz) game.tuz = partial.tuz.slice();
  if (partial.turn != null) game.turn = partial.turn;
  return game;
}

function sameBoard(replayed, game) {
  assert.deepEqual(replayed.pits, game.pits);
  assert.deepEqual(replayed.kazan, game.kazan);
  assert.deepEqual(replayed.tuz, game.tuz);
}

test("старт: в каждой лунке 9, в казанах пусто", () => {
  const game = createGame();
  assert.deepEqual(game.pits, [Array(9).fill(9), Array(9).fill(9)]);
  assert.deepEqual(game.kazan, [0, 0]);
  assert.equal(totalStones(game), 162);
});

test("ход 7–6 забирает 10, как в начальном примере", () => {
  const before = createGame();
  const result = play(before, 6);
  assert.equal(result.ok, true);
  assert.deepEqual(result.game.pits[0], [9, 9, 9, 9, 9, 9, 1, 10, 10]);
  assert.deepEqual(result.game.pits[1], [10, 10, 10, 10, 10, 0, 9, 9, 9]);
  assert.deepEqual(result.game.kazan, [10, 0]);
  assert.equal(result.game.turn, 1);
  assert.equal(result.game.over, false);
  assert.equal(totalStones(result.game), 162);
  sameBoard(applySteps(before, result.steps), result.game);
  assert.deepEqual(before.pits[0], Array(9).fill(9));
});

test("первый дом не берёт: последний камень остаётся у себя", () => {
  const result = play(createGame(), 0);
  assert.deepEqual(result.game.pits[0], [1, 10, 10, 10, 10, 10, 10, 10, 10]);
  assert.deepEqual(result.game.pits[1], Array(9).fill(9));
  assert.deepEqual(result.game.kazan, [0, 0]);
});

test("один камень перекладывается в следующую свою лунку и чёт там не берётся", () => {
  const game = createGame();
  game.pits[0][0] = 1;
  const result = play(game, 0);
  assert.equal(result.game.pits[0][0], 0);
  assert.equal(result.game.pits[0][1], 10);
  assert.equal(result.game.kazan[0], 0);
});

test("туз: последний камень делает 3, три уходят в казан", () => {
  const before = board({
    pits: [
      [12, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 2, 0, 0, 0, 0, 0, 0],
    ],
    kazan: [0, 0],
  });
  const result = play(before, 0);
  assert.equal(result.game.tuz[0], 2);
  assert.equal(result.game.pits[1][2], 0);
  assert.equal(result.game.kazan[0], 3);
  assert.equal(result.game.over, false);
  sameBoard(applySteps(before, result.steps), result.game);
});

test("второй туз не ставится, 3 камня остаются", () => {
  const before = board({
    pits: [
      [12, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 2, 0, 0, 0, 0, 0, 0],
    ],
    tuz: [4, null],
  });
  const result = play(before, 0);
  assert.equal(result.game.tuz[0], 4);
  assert.equal(result.game.pits[1][2], 3);
  assert.equal(result.game.kazan[0], 0);
});

test("зеркало туза соперника не берётся", () => {
  const before = board({
    pits: [
      [12, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 2, 0, 0, 0, 0, 0, 0],
    ],
    tuz: [null, 2],
  });
  const result = play(before, 0);
  assert.equal(result.game.tuz[0], null);
  assert.equal(result.game.pits[1][2], 3);
});

test("девятая лунка не становится тузом", () => {
  const before = board({
    pits: [
      [18, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 2],
    ],
  });
  const result = play(before, 0);
  assert.equal(result.game.tuz[0], null);
  assert.equal(result.game.pits[1][8], 3);
  assert.equal(result.game.kazan[0], 0);
});

test("камень в чужой туз сразу падает в чужой казан", () => {
  const before = board({
    pits: [
      [3, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    tuz: [null, 1],
    kazan: [0, 4],
  });
  const result = play(before, 0);
  assert.equal(result.game.pits[0][0], 1);
  assert.equal(result.game.pits[0][1], 0);
  assert.equal(result.game.pits[0][2], 1);
  assert.equal(result.game.kazan[1], 5);
  sameBoard(applySteps(before, result.steps), result.game);
});

test("82 камня заканчивают партию", () => {
  const before = board({
    pits: [
      [0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    kazan: [80, 70],
  });
  const result = play(before, 8);
  assert.equal(result.game.over, true);
  assert.equal(result.game.winner, 0);
  assert.equal(result.game.reason, "82");
  assert.equal(result.game.kazan[0], 82);
  assert.equal(result.game.pits[1][0], 0);
  sameBoard(applySteps(before, result.steps), result.game);
});

test("ат сыроо: соперник ходит и, если не отдал камни, партия кончается", () => {
  let state = board({
    pits: [
      [0, 0, 0, 0, 0, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 0, 0, 0, 0],
    ],
    kazan: [10, 10],
  });
  const first = play(state, 8);
  assert.equal(first.game.over, false);
  assert.equal(first.game.turn, 1);
  assert.equal(sum(first.game.pits[0]), 0);
  assert.equal(first.game.pits[1][0], 1);

  const second = play(first.game, 1);
  assert.equal(second.game.over, true);
  assert.equal(second.game.reason, "atsyrau");
  assert.equal(second.game.winner, 1);
  assert.equal(second.game.kazan[1], 12);
  assert.equal(sum(second.game.pits[0]) + sum(second.game.pits[1]), 0);
  sameBoard(applySteps(first.game, second.steps), second.game);
});

test("если после пустой стороны соперник отдал камень, партия жива", () => {
  const state = board({
    pits: [
      [0, 0, 0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 0, 0, 1],
    ],
    kazan: [0, 0],
  });
  const first = play(state, 8);
  const second = play(first.game, 8);
  assert.equal(second.game.over, false);
  assert.equal(second.game.turn, 0);
  assert.equal(second.game.pits[0][0], 1);
});

test("пустая лунка и чужой ход не принимаются", () => {
  const game = createGame();
  game.pits[0][3] = 0;
  assert.equal(play(game, 3).ok, false);
  assert.equal(play(game, -1).ok, false);
  assert.equal(play(game, 1.5).ok, false);
});

test("случайные партии не теряют камни и повторяют шаги", () => {
  const rand = mulberry32(7);
  for (let n = 0; n < 30; n++) {
    let state = createGame();
    for (let move = 0; move < 250 && !state.over; move++) {
      const options = [];
      for (let i = 0; i < 9; i++) if (state.pits[state.turn][i] > 0) options.push(i);
      assert.ok(options.length > 0);
      const pit = options[Math.floor(rand() * options.length)];
      const result = play(state, pit);
      assert.equal(result.ok, true);
      sameBoard(applySteps(state, result.steps), result.game);
      assert.equal(totalStones(result.game), 162);
      state = result.game;
    }
  }
});

function sum(row) {
  return row.reduce((a, b) => a + b, 0);
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
