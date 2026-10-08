"use strict";
const assert = require("node:assert/strict");
const { Game, overlaps } = require("../game.js");

const tests = [
  ["Initial state and reset", () => {
    const game = new Game();
    assert.equal(game.aliens.length, 24);
    assert.equal(game.lives, 3);
    game.score = 90; game.lives = 0; game.phase = "lost"; game.reset();
    assert.equal(game.phase, "playing");
    assert.equal(game.score, 0);
    assert.equal(game.lives, 3);
  }],
  ["Movement bounds and simultaneous opposite controls", () => {
    const game = new Game();
    for (let i = 0; i < 100; i++) game.update(.04, { left: true });
    assert.equal(game.ship.x, 0);
    for (let i = 0; i < 100; i++) game.update(.04, { right: true });
    assert.equal(game.ship.x, 568);
    game.update(.04, { left: true, right: true });
    assert.equal(game.ship.x, 568);
  }],
  ["Fire cooldown and bounded frame duration", () => {
    const game = new Game();
    game.update(.01, { fire: true });
    game.update(.01, { fire: true });
    assert.equal(game.shots.length, 1);
    game.update(100, { right: true });
    assert.equal(game.ship.x, 294);
  }],
  ["Alien hit increments score and clears the final alien", () => {
    const game = new Game(() => .5);
    game.aliens = [{ x: 100, y: 40, width: 28, height: 22, row: 0 }];
    game.shots = [{ x: 110, y: 45, width: 4, height: 10 }];
    game.update(0);
    assert.equal(game.score, 10);
    assert.equal(game.aliens.length, 0);
    assert.equal(game.phase, "won");
  }],
  ["Ship hits lose a life with temporary protection", () => {
    const game = new Game();
    const hit = () => ({ x: game.ship.x + 10, y: game.ship.y, width: 4, height: 10 });
    game.enemyShots = [hit(), hit()];
    game.update(0);
    assert.equal(game.lives, 2);
    game.enemyShots = [hit()];
    game.update(.04);
    assert.equal(game.lives, 2);
    game.grace = 0; game.lives = 1; game.enemyShots = [hit()];
    game.update(0);
    assert.equal(game.phase, "lost");
    assert.equal(game.lives, 0);
  }],
  ["Boundary turns descend and aliens reaching ship end the game", () => {
    const game = new Game();
    game.aliens = [{ x: 560, y: 344, width: 28, height: 22, row: 0 }];
    game.update(.04);
    assert.equal(game.direction, -1);
    assert.equal(game.phase, "lost");
    const x = game.ship.x;
    game.update(.04, { right: true });
    assert.equal(game.ship.x, x);
  }],
  ["Enemy fire originates from the lowest alien in a column", () => {
    const game = new Game(() => 0);
    game.enemyCooldown = 0;
    game.update(0);
    assert.equal(game.enemyShots.length, 1);
    assert.equal(game.enemyShots[0].y, 38 + 2 * 38 + 22);
  }],
  ["Collision bounds and expired projectiles", () => {
    assert.equal(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 1, height: 1 }), true);
    assert.equal(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 1, height: 1 }), false);
    const game = new Game();
    game.shots = [{ x: 0, y: -20, width: 4, height: 10 }];
    game.enemyShots = [{ x: 0, y: 401, width: 4, height: 10 }];
    game.update(0);
    assert.equal(game.shots.length, 0);
    assert.equal(game.enemyShots.length, 0);
  }]
];

for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
