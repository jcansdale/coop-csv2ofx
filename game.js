(function (root) {
  "use strict";

  const WIDTH = 600, HEIGHT = 400;
  function overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  class Game {
    constructor(random = Math.random) { this.random = random; this.reset(); }
    reset() {
      this.phase = "playing";
      this.score = 0;
      this.lives = 3;
      this.ship = { x: 284, y: 365, width: 32, height: 20 };
      this.aliens = Array.from({ length: 24 }, (_, index) => ({
        x: 80 + (index % 8) * 54, y: 38 + Math.floor(index / 8) * 38,
        width: 28, height: 22, row: Math.floor(index / 8)
      }));
      this.shots = [];
      this.enemyShots = [];
      this.direction = 1;
      this.cooldown = 0;
      this.enemyCooldown = 1.2;
      this.grace = 0;
    }
    update(delta, input = {}) {
      if (this.phase !== "playing") return;
      const dt = Math.min(Math.max(delta, 0), .04);
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.grace = Math.max(0, this.grace - dt);
      this.ship.x = Math.min(WIDTH - this.ship.width, Math.max(0, this.ship.x + ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 250 * dt));
      if (input.fire && this.cooldown === 0) {
        this.shots.push({ x: this.ship.x + 14, y: this.ship.y - 10, width: 4, height: 10 });
        this.cooldown = .24;
      }
      const step = this.direction * (25 + (24 - this.aliens.length) * 2.5) * dt;
      if (this.aliens.some(alien => alien.x + step < 12 || alien.x + alien.width + step > WIDTH - 12)) {
        this.direction *= -1;
        this.aliens.forEach(alien => { alien.y += 14; });
      } else { this.aliens.forEach(alien => { alien.x += step; }); }
      this.enemyCooldown -= dt;
      if (this.enemyCooldown <= 0 && this.aliens.length) {
        // Only the lowest surviving alien in each column can fire.
        const front = this.aliens.filter(alien => !this.aliens.some(other => Math.abs(other.x - alien.x) < 1 && other.y > alien.y));
        const alien = front[Math.floor(this.random() * front.length)];
        this.enemyShots.push({ x: alien.x + 12, y: alien.y + alien.height, width: 4, height: 10 });
        this.enemyCooldown = .65 + this.random() * .65;
      }
      this.shots.forEach(shot => { shot.y -= 360 * dt; });
      this.enemyShots.forEach(shot => { shot.y += 155 * dt; });
      this.shots = this.shots.filter(shot => {
        const hit = this.aliens.findIndex(alien => overlaps(shot, alien));
        if (hit >= 0) { this.aliens.splice(hit, 1); this.score += 10; return false; }
        return shot.y + shot.height > 0;
      });
      this.enemyShots = this.enemyShots.filter(shot => {
        if (overlaps(shot, this.ship)) {
          if (this.grace === 0) { this.lives--; this.grace = 1.5; }
          return false;
        }
        return shot.y < HEIGHT;
      });
      if (!this.aliens.length) this.phase = "won";
      else if (this.lives <= 0 || this.aliens.some(alien => alien.y + alien.height >= this.ship.y)) this.phase = "lost";
    }
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = { Game, overlaps }; return; }

  const $ = id => document.getElementById(id);
  const canvas = $("game-canvas");
  const context = canvas.getContext("2d");
  const game = new Game();
  const keys = new Set(), pointers = new Map();
  let frame = null, lastTime = null, paused = true, opened = false;
  let lastScore = -1, lastLives = -1;
  const alienPixels = ["01000010", "00100100", "11111111", "10111101", "11111111", "01111110", "01000010", "00100100"];
  const shipPixels = ["00011000", "00011000", "00111100", "00111100", "01111110", "11111111"];

  function pixels(pattern, x, y, size, color) {
    context.fillStyle = color;
    pattern.forEach((row, dy) => Array.from(row).forEach((pixel, dx) => {
      if (pixel === "1") context.fillRect(Math.round(x + dx * size), Math.round(y + dy * size), size, size);
    }));
  }
  function draw() {
    if (!context) return;
    context.fillStyle = "#080f22";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#566382";
    for (let i = 0; i < 30; i++) context.fillRect((i * 137 + 31) % WIDTH, (i * 73 + 17) % HEIGHT, 1, 1);
    game.aliens.forEach(alien => pixels(alienPixels, alien.x, alien.y, 3, ["#bcff70", "#7be9ff", "#e2a8ff"][alien.row]));
    pixels(shipPixels, game.ship.x, game.ship.y, 4, "#7be9ff");
    if (game.grace > 0) {
      context.strokeStyle = "#7be9ff";
      context.strokeRect(game.ship.x - 5, game.ship.y - 5, game.ship.width + 10, game.ship.height + 10);
    }
    for (const [shots, color] of [[game.shots, "#bcff70"], [game.enemyShots, "#ffb4ad"]]) {
      context.fillStyle = color;
      shots.forEach(shot => context.fillRect(shot.x, shot.y, shot.width, shot.height));
    }
    if (paused || game.phase !== "playing") {
      context.fillStyle = "#080f22cc";
      context.fillRect(0, 150, WIDTH, 90);
      context.fillStyle = "#e5e9ff";
      context.font = "bold 24px monospace";
      context.textAlign = "center";
      context.fillText(game.phase === "won" ? "SECTOR CLEARED!" : game.phase === "lost" ? "GAME OVER" : "PAUSED", WIDTH / 2, 202);
    }
    if (lastScore !== game.score) { $("game-score").textContent = `Score: ${game.score}`; lastScore = game.score; }
    if (lastLives !== game.lives) { $("game-lives").textContent = `Lives: ${game.lives}`; lastLives = game.lives; }
  }
  function clearInput() { keys.clear(); pointers.clear(); }
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastTime = null;
    clearInput();
  }
  function tick(time) {
    frame = null;
    if (paused || !opened) return;
    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    const held = new Set([...keys, ...pointers.values()]);
    game.update(dt, { left: held.has("left"), right: held.has("right"), fire: held.has("fire") });
    draw();
    if (game.phase === "playing") frame = requestAnimationFrame(tick);
    else {
      stop();
      $("game-status").textContent = game.phase === "won" ? `Sector cleared! Score: ${game.score}. Play again with Restart.` : `Game over. Score: ${game.score}. Try again with Restart.`;
      $("game-pause").disabled = true;
    }
  }
  function pause() {
    if (!opened || paused || game.phase !== "playing") return;
    paused = true;
    stop();
    draw();
    $("game-pause").textContent = "Resume game";
    $("game-status").textContent = "Paused. Select Resume game to continue.";
  }
  function resume() {
    if (!opened || !paused || game.phase !== "playing") return;
    paused = false;
    $("game-pause").textContent = "Pause game";
    $("game-status").textContent = "Playing. Clear the aliens; avoid their shots.";
    $("game-arena").focus({ preventScroll: true });
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (!context) {
      $("game-panel").hidden = false;
      $("play-game").setAttribute("aria-expanded", "true");
      $("play-game").textContent = "Close Space Patrol";
      opened = true;
      $("game-pause").disabled = true;
      $("game-status").textContent = "Your browser cannot display this game. Your OFX conversion is unaffected.";
      return;
    }
    stop();
    game.reset();
    paused = true;
    opened = true;
    $("game-panel").hidden = false;
    $("play-game").setAttribute("aria-expanded", "true");
    $("play-game").textContent = "Close Space Patrol";
    $("game-pause").disabled = false;
    resume();
    draw();
    $("game-panel").scrollIntoView({ block: "start", behavior: "auto" });
  }
  function close() {
    stop();
    paused = true;
    opened = false;
    $("game-panel").hidden = true;
    $("play-game").setAttribute("aria-expanded", "false");
    $("play-game").textContent = "Play Space Patrol";
  }
  const keyActions = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", Space: "fire" };
  $("game-arena").addEventListener("keydown", event => {
    if (keyActions[event.code]) { event.preventDefault(); if (!paused) keys.add(keyActions[event.code]); }
    else if (event.code === "KeyP" && !event.repeat) { event.preventDefault(); paused ? resume() : pause(); }
    else if (event.code === "Escape") { close(); $("play-game").focus(); }
  });
  $("game-arena").addEventListener("keyup", event => {
    if (keyActions[event.code]) { event.preventDefault(); keys.delete(keyActions[event.code]); }
  });
  $("game-arena").addEventListener("blur", clearInput);
  $("game-panel").addEventListener("keydown", event => {
    if (event.code === "Escape") { close(); $("play-game").focus(); }
  });
  $("game-panel").addEventListener("focusout", event => {
    if (!event.relatedTarget || !$("game-panel").contains(event.relatedTarget)) pause();
  });
  for (const action of ["left", "right", "fire"]) {
    const button = $(`game-${action}`);
    button.addEventListener("pointerdown", event => {
      if (paused || game.phase !== "playing") return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, action);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(event, event => pointers.delete(event.pointerId));
    button.addEventListener("keydown", event => {
      if (event.code === "Space" || event.code === "Enter") { event.preventDefault(); if (!paused) keys.add(action); }
    });
    button.addEventListener("keyup", event => {
      if (event.code === "Space" || event.code === "Enter") { event.preventDefault(); keys.delete(action); }
    });
    button.addEventListener("blur", clearInput);
  }
  $("play-game").addEventListener("click", () => { if (opened) { close(); } else { start(); } });
  $("game-pause").addEventListener("click", () => paused ? resume() : pause());
  $("game-restart").addEventListener("click", start);
  $("game-close").addEventListener("click", () => { close(); $("play-game").focus(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("blur", pause);
  root.SpacePatrol = {
    unlock() { $("easter-egg").hidden = false; },
    lock() { close(); game.reset(); lastScore = -1; lastLives = -1; $("easter-egg").hidden = true; $("game-status").textContent = "Ready to play."; }
  };
})(globalThis);
