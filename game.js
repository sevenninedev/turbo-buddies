(() => {
  "use strict";

  const BEST_KEY = "turboBuddiesBest";
  const P1_COLOR = "#2a6fdb";
  const P2_COLOR = "#e14b1a";

  const CHARS = [
    { id: "frog", name: "Frog", src: "assets/frog.png" },
    { id: "ape", name: "Ape", src: "assets/ape.png" },
    { id: "elk", name: "Elk", src: "assets/orange.png", flame: "assets/orange_flame.png", thumb: "assets/orange_full.png" },
    { id: "gorilla", name: "Gorilla", src: "assets/gorilla.png" },
    { id: "yellow", name: "Yellow", src: "assets/yellow.png" },
    { id: "cg", name: "CG", src: "assets/cg.png", zippy: true },
  ];

  let tickleImg = null;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const elStart = document.getElementById("start");
  const elOver = document.getElementById("over");
  const elHud = document.getElementById("hud");
  const elHint = document.getElementById("hint");
  const elCards = document.getElementById("cards");
  const elLoading = document.getElementById("loading");
  const elModes = document.getElementById("modes");
  const elPrompt = document.getElementById("pick-prompt");
  const elTagline = document.getElementById("tagline");
  const elBack = document.getElementById("back-mode");
  const elHudP2 = document.getElementById("hud-p2");
  const elHudMid = document.getElementById("hud-mid");
  const elOver1p = document.getElementById("over-1p");
  const elOver2p = document.getElementById("over-2p");
  const elOverTitle = document.getElementById("over-title");

  let W = 390, H = 844;
  let state = "load"; // load | start | play | over
  let mode = 1; // 1 or 2
  let pickStep = "mode"; // mode | p1 | p2
  let chosen = { p1: null, p2: null };

  const world = {
    players: [],
    time: 0,
    dist: 0,
    speed: 140,
    obstacles: [],
    stars: [],
    particles: [],
    popups: [],
    clouds: [],
    tickles: [],
    spawnT: 0,
    tickleT: 0,
    shake: 0,
    hintT: 0,
  };

  const pointers = new Map(); // pointerId -> 1 | 2
  const keysDown = new Set();

  let audioCtx = null;
  let lastTs = 0;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load " + src));
      img.src = src;
    });
  }

  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* ignore */ }
  }

  function beep(freq, dur, type, vol, at, slide) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + (at || 0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(vol || 0.07, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function sfxCollect() {
    beep(880, 0.08, "square", 0.07, 0);
    beep(1320, 0.12, "square", 0.06, 0.07);
  }
  function sfxHit() { beep(180, 0.22, "triangle", 0.12, 0, 70); }
  function sfxOver() {
    beep(392, 0.18, "square", 0.08, 0);
    beep(311, 0.18, "square", 0.08, 0.16);
    beep(196, 0.35, "square", 0.09, 0.32);
  }
  function sfxBoost() { beep(240, 0.07, "sine", 0.03, 0, 420); }
  function sfxStart() {
    beep(523, 0.1, "square", 0.06, 0);
    beep(784, 0.16, "square", 0.06, 0.1);
  }
  function sfxGhost() {
    beep(520, 0.12, "sine", 0.05, 0, 260);
  }
  function sfxTickle() {
    beep(980, 0.07, "sine", 0.07, 0, 1500);
    beep(1320, 0.08, "sine", 0.05, 0.07, 1900);
    beep(1600, 0.1, "square", 0.04, 0.14);
  }

  function getBest() {
    const n = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);
    return Number.isFinite(n) ? n : 0;
  }
  function setBest(n) {
    const b = Math.max(getBest(), n);
    localStorage.setItem(BEST_KEY, String(b));
    return b;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function playerSize(p) {
    const img = p && p.char && p.char.image;
    const drawH = clamp(H * (mode === 2 ? 0.14 : 0.16), 80, mode === 2 ? 118 : 130);
    const drawW = img ? (img.width / img.height) * drawH : drawH * 0.7;
    return { drawW, drawH };
  }

  function makePlayer(slot, char, yOff) {
    return {
      slot,
      char,
      color: slot === 1 ? P1_COLOR : P2_COLOR,
      x: 0,
      y: H * 0.45 + (yOff || 0),
      vy: 0,
      score: 0,
      lives: 3,
      invuln: 1.1,
      boosting: false,
      ghost: false,
      flameFlicker: 1,
      giggle: 0,
    };
  }

  function placePlayers() {
    const list = world.players;
    if (list.length === 1) {
      list[0].x = clamp(W * 0.28, 80, 140);
    } else if (list.length >= 2) {
      list[0].x = clamp(W * 0.20, 64, 110);
      list[1].x = clamp(W * 0.38, 120, 175);
    }
  }

  function resetRun() {
    const p1 = makePlayer(1, chosen.p1, mode === 2 ? -40 : 0);
    world.players = [p1];
    if (mode === 2) world.players.push(makePlayer(2, chosen.p2, 50));
    placePlayers();
    world.time = 0;
    world.dist = 0;
    world.speed = 140;
    world.obstacles = [];
    world.stars = [];
    world.particles = [];
    world.popups = [];
    world.tickles = [];
    world.spawnT = 1.1;
    world.tickleT = 5.2;
    world.shake = 0;
    world.hintT = 3.4;
    pointers.clear();
    keysDown.clear();
    seedClouds();
    updateHud();
  }

  function seedClouds() {
    world.clouds = [];
    for (let i = 0; i < 8; i++) {
      world.clouds.push({
        x: rand(-40, W + 80),
        y: rand(30, H * 0.7),
        s: rand(0.6, 1.4),
        z: rand(0.25, 0.7),
        shade: rand(0.85, 1),
      });
    }
  }

  function startGame() {
    ensureAudio();
    sfxStart();
    resetRun();
    state = "play";
    elStart.hidden = true;
    elOver.hidden = true;
    elHud.hidden = false;
    elHud.classList.toggle("onep", mode === 1);
    elHudP2.hidden = mode !== 2;
    elHint.hidden = false;
    elHint.classList.toggle("twop", mode === 2);
    if (mode === 2) {
      elHint.innerHTML = '<span class="h1">P1: hold here</span><span class="h2">P2: hold here</span>';
    } else {
      elHint.textContent = "HOLD TO FLY!";
    }
    updateHud();
  }

  function livingPlayers() {
    return world.players.filter((p) => !p.ghost);
  }

  function gameOver() {
    state = "over";
    world.players.forEach((p) => { p.boosting = false; });
    pointers.clear();
    elHint.hidden = true;
    elOver.hidden = false;

    if (mode === 1) {
      const s = world.players[0] ? world.players[0].score : 0;
      const best = setBest(s);
      elOverTitle.textContent = "Game Over!";
      elOver1p.hidden = false;
      elOver2p.hidden = true;
      document.getElementById("over-score").textContent = String(s);
      document.getElementById("over-best").textContent = String(best);
    } else {
      const a = world.players[0] ? world.players[0].score : 0;
      const b = world.players[1] ? world.players[1].score : 0;
      const n1 = world.players[0] && world.players[0].char ? world.players[0].char.name : "P1";
      const n2 = world.players[1] && world.players[1].char ? world.players[1].char.name : "P2";
      let title = "It's a tie!";
      if (a > b) title = "P1 " + n1 + " Wins!";
      else if (b > a) title = "P2 " + n2 + " Wins!";
      elOverTitle.textContent = title;
      elOver1p.hidden = true;
      elOver2p.hidden = false;
      document.getElementById("over-s1").textContent = n1 + "  " + a;
      document.getElementById("over-s2").textContent = n2 + "  " + b;
    }
    sfxOver();
  }

  function heartsText(n) {
    const v = clamp(n, 0, 3);
    return "❤".repeat(v) + "♡".repeat(3 - v);
  }

  function updateHud() {
    const p1 = world.players[0];
    const p2 = world.players[1];
    if (p1) {
      document.querySelector("#hud-p1 .hud-tag").textContent = "P1" + (p1.char && p1.char.name ? " " + p1.char.name : "");
      document.getElementById("hearts-p1").textContent = heartsText(p1.lives);
      document.getElementById("score-p1").textContent = String(p1.score);
    }
    if (mode === 1) {
      elHudMid.innerHTML = p1 ? '<div class="pscore">' + p1.score + "</div>" : "";
    } else {
      elHudMid.innerHTML = "";
      if (p2) {
        document.querySelector("#hud-p2 .hud-tag").textContent = "P2" + (p2.char && p2.char.name ? " " + p2.char.name : "");
        document.getElementById("hearts-p2").textContent = heartsText(p2.lives);
        document.getElementById("score-p2").textContent = String(p2.score);
      }
    }
  }

  function addScore(p, n, x, y) {
    if (!p || p.ghost) return;
    p.score += n;
    updateHud();
    if (x != null) world.popups.push({ x, y, t: 0, text: "+" + n, color: p.color });
  }

  function hitPlayer(p) {
    if (!p || p.ghost || p.invuln > 0) return;
    p.lives -= 1;
    p.invuln = 1.6;
    world.shake = 12;
    updateHud();
    sfxHit();
    if (p.lives <= 0) {
      p.ghost = true;
      p.lives = 0;
      p.boosting = false;
      sfxGhost();
      if (livingPlayers().length === 0) gameOver();
    }
  }

  function spawnWave() {
    const sample = world.players[0] || makePlayer(1, CHARS[0], 0);
    const { drawH } = playerSize(sample);
    const margin = 50 + drawH * 0.15;
    const kindRoll = Math.random();
    const kind = kindRoll < 0.34 ? "spike" : kindRoll < 0.67 ? "rock" : "cloud";
    const pair = Math.random() < 0.35 && world.dist > 800;
    if (pair) {
      const gap = rand(180, 260);
      const mid = rand(margin + gap / 2, H - margin - gap / 2);
      world.obstacles.push(makeObstacle(W + 50, mid - gap / 2 - 30, kind));
      world.obstacles.push(makeObstacle(W + 50, mid + gap / 2 + 30, kind === "spike" ? "rock" : "spike"));
      world.stars.push({ x: W + 50, y: mid, r: 22, rot: rand(0, 6) });
    } else {
      const y = rand(margin, H - margin);
      world.obstacles.push(makeObstacle(W + 50, y, kind));
      const sy = clamp(y + rand(-160, 160), margin, H - margin);
      if (Math.abs(sy - y) < 90) {
        world.stars.push({
          x: W + 160,
          y: clamp(y < H / 2 ? y + 140 : y - 140, margin, H - margin),
          r: 22, rot: rand(0, 6),
        });
      } else {
        world.stars.push({ x: W + 90, y: sy, r: 22, rot: rand(0, 6) });
      }
    }
  }

  function makeObstacle(x, y, kind) {
    const r = kind === "cloud" ? rand(34, 48) : kind === "rock" ? rand(30, 44) : rand(26, 38);
    return { x, y, r, kind, rot: rand(-0.3, 0.3), passed: false };
  }

  function update(dt) {
    world.time += dt;
    if (state !== "play") {
      scrollDecor(dt, 40);
      return;
    }

    syncBoosts();

    world.speed = 140 + Math.min(200, world.dist / 28);
    const sp = world.speed * dt;
    world.dist += sp;

    const GRAVITY = 820;
    const BOOST = 1400;
    const MAX_UP = 420;
    const MAX_DOWN = 520;

    for (const p of world.players) {
      const zippy = !!(p.char && p.char.zippy);
      const boost = zippy ? BOOST * 1.18 : BOOST;
      if (p.boosting) {
        p.vy -= boost * dt;
        if (Math.random() < 0.6) emitBoostPuff(p);
        if (zippy && Math.random() < 0.85) emitZippyTrail(p);
      } else {
        p.vy += GRAVITY * dt;
        if (zippy && Math.random() < 0.25) emitZippyTrail(p);
      }
      p.vy = clamp(p.vy, -MAX_UP, MAX_DOWN);
      p.y += p.vy * dt;

      const { drawH } = playerSize(p);
      const minY = 86 + drawH * 0.28;
      const maxY = H - drawH * 0.36 - 64; // leave room above the hint
      if (p.y < minY) { p.y = minY; p.vy *= 0.25; }
      if (p.y > maxY) { p.y = maxY; p.vy *= 0.25; }

      if (p.invuln > 0) p.invuln -= dt;
      if (p.giggle > 0) p.giggle -= dt;
      const target = 0.88 + Math.sin(world.time * 26 + p.slot) * 0.1 + rand(-0.04, 0.04);
      p.flameFlicker += (target - p.flameFlicker) * Math.min(1, dt * 18);
    }
    placePlayers();

    if (world.shake > 0) world.shake = Math.max(0, world.shake - 28 * dt);
    if (world.hintT > 0) {
      world.hintT -= dt;
      if (world.hintT <= 0) elHint.hidden = true;
    }

    world.spawnT -= dt;
    const interval = Math.max(1.05, 1.85 - world.dist / 6000);
    if (world.spawnT <= 0) {
      spawnWave();
      world.spawnT = interval;
    }

    for (const o of world.obstacles) o.x -= sp;
    for (const s of world.stars) s.x -= sp;
    scrollDecor(dt, world.speed);

    world.tickleT -= dt;
    if (world.tickleT <= 0 && livingPlayers().length) {
      spawnTickle();
      world.tickleT = rand(7.2, 11.5);
    }
    updateTickles(dt);

    for (const o of world.obstacles) {
      if (o.x < -80) continue;
      let anyonePassed = false;
      for (const p of world.players) {
        const { drawW, drawH } = playerSize(p);
        const hbW = drawW * 0.36, hbH = drawH * 0.38;
        const hbY = p.y + drawH * 0.06, hbX = p.x;
        if (!o.passed && o.x + o.r < hbX - 40) anyonePassed = true;
        if (p.ghost) continue;
        const or = o.r * (o.kind === "cloud" ? 0.72 : 0.78);
        if (ellipseHit(hbX, hbY, hbW, hbH, o.x, o.y, or, or)) hitPlayer(p);
      }
      if (anyonePassed && !o.passed) {
        o.passed = true;
        for (const p of livingPlayers()) addScore(p, 1, o.x, o.y);
      }
    }
    world.obstacles = world.obstacles.filter((o) => o.x > -120);

    for (const s of world.stars) {
      if (s.got) continue;
      s.rot += dt * 2;
      for (const p of world.players) {
        if (p.ghost || s.got) continue;
        const { drawW, drawH } = playerSize(p);
        const hbY = p.y + drawH * 0.06, hbX = p.x;
        const dx = s.x - hbX, dy = s.y - hbY;
        if (dx * dx + dy * dy < (s.r + 28) * (s.r + 28)) {
          s.got = true;
          addScore(p, 10, s.x, s.y);
          sfxCollect();
          burst(s.x, s.y);
        }
      }
    }
    world.stars = world.stars.filter((s) => s.x > -60 && !s.got);

    for (const part of world.particles) {
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.vy += 40 * dt;
      part.t += dt;
    }
    world.particles = world.particles.filter((p) => p.t < p.life);
    for (const pop of world.popups) {
      pop.t += dt;
      pop.y -= 50 * dt;
    }
    world.popups = world.popups.filter((p) => p.t < 0.7);
  }

  function spawnTickle(x, y) {
    const living = livingPlayers();
    const target = living.length ? living[Math.floor(Math.random() * living.length)] : world.players[0];
    const ty = target ? target.y : H * 0.45;
    world.tickles.push({
      x: x != null ? x : W + 90,
      y: y != null ? y : clamp(ty + rand(-90, 90), 130, H - 150),
      vy: 0,
      wiggle: rand(0, 8),
      life: 0,
    });
  }

  function updateTickles(dt) {
    const living = livingPlayers();
    for (const t of world.tickles) {
      t.life += dt;
      t.wiggle += dt * 11;
      if (living.length) {
        let best = living[0], bd = 1e9;
        for (const p of living) {
          const d = Math.hypot(p.x - t.x, p.y - t.y);
          if (d < bd) { bd = d; best = p; }
        }
        t.vy += (best.y - t.y) * 1.8 * dt;
        t.vy = clamp(t.vy, -170, 170);
        // Swoop left, linger a little if already beside the player so it's readable
        const fly = t.x > best.x + 50 ? world.speed * 0.62 + 50 : world.speed * 0.28;
        t.x -= fly * dt;
      } else {
        t.x -= world.speed * 0.65 * dt;
      }
      t.y += t.vy * dt + Math.sin(t.wiggle) * 28 * dt;
      t.y = clamp(t.y, 110, H - 130);

      for (const p of living) {
        if (p.invuln > 0) continue;
        const { drawW, drawH } = playerSize(p);
        const hbW = drawW * 0.36, hbH = drawH * 0.38;
        const hbY = p.y + drawH * 0.06, hbX = p.x;
        if (ellipseHit(hbX, hbY, hbW, hbH, t.x - 8, t.y, 52, 40)) tickleHit(p);
      }
    }
    world.tickles = world.tickles.filter((tk) => tk.x > -180 && tk.life < 16);
  }

  function tickleHit(p) {
    const words = Math.random() < 0.5 ? "TICKLE!" : "hee hee";
    world.popups.push({ x: p.x, y: p.y - 46, t: 0, text: words, color: "#e14aa8" });
    world.shake = Math.max(world.shake, 18);
    p.giggle = 0.6;
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12 + rand(-0.2, 0.2);
      world.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * rand(50, 150),
        vy: Math.sin(a) * rand(50, 150),
        t: 0, life: 0.55, r: rand(4, 9), kind: "tickle",
      });
    }
    sfxTickle();
    hitPlayer(p);
  }

  function ellipseHit(ax, ay, aw, ah, bx, by, bw, bh) {
    const dx = (ax - bx) / (aw + bw);
    const dy = (ay - by) / (ah + bh);
    return dx * dx + dy * dy < 1;
  }

  function emitBoostPuff(p) {
    const { drawH } = playerSize(p);
    world.particles.push({
      x: p.x + rand(-10, 10),
      y: p.y + drawH * 0.38 + rand(-4, 6),
      vx: rand(-40, -10),
      vy: rand(20, 80),
      t: 0,
      life: rand(0.25, 0.5),
      r: rand(6, 12),
      kind: "flame",
    });
  }

  function emitZippyTrail(p) {
    const { drawH } = playerSize(p);
    world.particles.push({
      x: p.x - 18 + rand(-8, 4),
      y: p.y + drawH * 0.28 + rand(-12, 12),
      vx: rand(-110, -40),
      vy: rand(-30, 30),
      t: 0,
      life: rand(0.22, 0.42),
      r: rand(5, 12),
      kind: "zip",
    });
  }

  function burst(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      world.particles.push({
        x, y,
        vx: Math.cos(a) * rand(40, 120),
        vy: Math.sin(a) * rand(40, 120),
        t: 0, life: 0.45, r: rand(3, 6), kind: "spark",
      });
    }
  }

  function scrollDecor(dt, speed) {
    for (const c of world.clouds) {
      c.x -= speed * c.z * dt;
      if (c.x < -160) {
        c.x = W + rand(40, 180);
        c.y = rand(30, H * 0.72);
        c.s = rand(0.6, 1.4);
        c.z = rand(0.25, 0.7);
      }
    }
  }

  function draw() {
    const sx = world.shake ? rand(-world.shake, world.shake) : 0;
    const sy = world.shake ? rand(-world.shake, world.shake) : 0;
    ctx.save();
    ctx.translate(sx, sy);

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#9be4ff");
    g.addColorStop(0.55, "#7ec8f0");
    g.addColorStop(1, "#fff3b0");
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    ctx.beginPath();
    ctx.fillStyle = "#ffe66b";
    ctx.arc(W - 70, 70, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,220,0.35)";
    ctx.arc(W - 70, 70, 58, 0, Math.PI * 2);
    ctx.fill();

    for (const c of world.clouds) drawPuff(c.x, c.y, 46 * c.s, `rgba(255,255,255,${0.55 + c.z * 0.25})`);

    // 2P split guide
    if (state === "play" && mode === 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(22,50,74,0.18)";
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2, 80);
      ctx.lineTo(W / 2, H - 70);
      ctx.stroke();
      ctx.restore();
    }

    if (state === "play" || state === "over") {
      for (const o of world.obstacles) drawObstacle(o);
      for (const s of world.stars) if (!s.got) drawStar(s);
      for (const part of world.particles) drawParticle(part);
      for (const tk of world.tickles) drawTickle(tk);
      for (const p of world.players) drawPlayer(p);
      for (const pop of world.popups) {
        ctx.save();
        ctx.globalAlpha = 1 - pop.t / 0.7;
        ctx.font = "800 26px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = pop.color || "#16324a";
        ctx.lineWidth = 5;
        ctx.strokeText(pop.text, pop.x, pop.y);
        ctx.fillText(pop.text, pop.x, pop.y);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function drawPlayer(p) {
    const ch = p.char;
    if (!ch || !ch.image) return;
    const { drawW, drawH } = playerSize(p);
    const giggle = p.giggle > 0 ? Math.sin(world.time * 42) * 5 : 0;
    const bob = Math.sin(world.time * 4.2 + p.slot) * 4 + giggle;
    const stretch = p.boosting ? (ch.zippy ? 1.18 : 1.13) : (p.vy > 80 ? 0.93 : 1);
    const sx = 1 / Math.sqrt(stretch);
    const sy = stretch;
    const rot = clamp(p.vy * -0.00045, -0.2, 0.2) + Math.sin(world.time * 6.5 + p.slot) * 0.035
      + (p.giggle > 0 ? Math.sin(world.time * 36) * 0.14 : 0);

    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(rot);
    ctx.scale(sx, sy);

    if (ch.zippy && !p.ghost) {
      ctx.save();
      ctx.globalAlpha = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0 ? 0.25 : 0.7;
      for (let i = 0; i < 4; i++) {
        const ox = -drawW * (0.35 + i * 0.16);
        const oy = drawH * 0.28 + Math.sin(world.time * 18 + i) * 5;
        const g = ctx.createLinearGradient(ox - 18, 0, ox + 12, 0);
        g.addColorStop(0, "rgba(40,210,255,0)");
        g.addColorStop(0.5, i % 2 ? "rgba(255,80,200,0.85)" : "rgba(80,230,255,0.9)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(ox - 22, oy - 3, 36, 6);
      }
      ctx.restore();
    }

    if (p.ghost) ctx.globalAlpha = 0.38;
    else if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) ctx.globalAlpha = 0.4;

    if (ch.flameImg) {
      const f = p.flameFlicker;
      ctx.save();
      ctx.translate(0, drawH * 0.04);
      ctx.scale(f, f);
      ctx.drawImage(ch.flameImg, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
    ctx.drawImage(ch.image, -drawW / 2, -drawH / 2, drawW, drawH);

    // 2P color tag under the buddy
    if (mode === 2) {
      ctx.globalAlpha = p.ghost ? 0.5 : 1;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = "#16324a";
      ctx.lineWidth = 2;
      const label = p.ghost ? "GHOST" : ("P" + p.slot);
      const tw = p.ghost ? 52 : 32, th = 16;
      const ty = drawH / 2 + 4;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-tw / 2, ty, tw, th, 5);
      else ctx.rect(-tw / 2, ty, tw, th);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "800 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, ty + th / 2);
    }
    ctx.restore();
  }

  function drawPuff(x, y, r, color) {
    ctx.fillStyle = color;
    const bumps = [
      [x, y, r * 0.62],
      [x - r * 0.55, y + r * 0.1, r * 0.48],
      [x + r * 0.55, y + r * 0.12, r * 0.5],
      [x - r * 0.15, y - r * 0.35, r * 0.42],
    ];
    for (const [cx, cy, rr] of bumps) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTickle(t) {
    if (!tickleImg) return;
    const wiggle = Math.sin(t.wiggle) * 0.14;
    const finger = Math.sin(t.wiggle * 1.8) * 0.07;
    const drawH = clamp(H * 0.15, 88, 128);
    const drawW = (tickleImg.width / tickleImg.height) * drawH;
    ctx.save();
    ctx.translate(t.x, t.y + Math.sin(t.wiggle) * 6);
    ctx.rotate(-0.12 + wiggle);
    ctx.scale(1 + finger * 0.05, 1 - finger * 0.05);
    ctx.drawImage(tickleImg, -drawW * 0.55, -drawH * 0.5, drawW, drawH);
    ctx.restore();
  }

  function drawObstacle(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);
    if (o.kind === "spike") {
      // Glossy red/magenta spike ball — clearly not a gold star
      const halo = ctx.createRadialGradient(0, 0, o.r * 0.2, 0, 0, o.r * 1.7);
      halo.addColorStop(0, "rgba(255,70,130,0.5)");
      halo.addColorStop(1, "rgba(120,0,60,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 1.65, 0, Math.PI * 2);
      ctx.fill();

      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.2) * o.r * 0.7, Math.sin(a - 0.2) * o.r * 0.7);
        ctx.lineTo(Math.cos(a) * o.r * 1.38, Math.sin(a) * o.r * 1.38);
        ctx.lineTo(Math.cos(a + 0.2) * o.r * 0.7, Math.sin(a + 0.2) * o.r * 0.7);
        ctx.closePath();
        const sg = ctx.createLinearGradient(0, 0, Math.cos(a) * o.r, Math.sin(a) * o.r);
        sg.addColorStop(0, "#ff6b9a");
        sg.addColorStop(1, "#6a0834");
        ctx.fillStyle = sg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#3a0518";
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(-o.r * 0.28, -o.r * 0.28, 3, 0, 0, o.r * 0.86);
      g.addColorStop(0, "#ffe0f0");
      g.addColorStop(0.35, "#e01868");
      g.addColorStop(1, "#6a0a40");
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.78, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#3a0518";
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.ellipse(-o.r * 0.22, -o.r * 0.26, o.r * 0.2, o.r * 0.12, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.kind === "rock") {
      ctx.beginPath();
      const pts = 7;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const rr = o.r * (0.82 + Math.sin(i * 2.3 + o.rot * 3) * 0.18);
        const fn = i === 0 ? "moveTo" : "lineTo";
        ctx[fn](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(-o.r * 0.35, -o.r * 0.4, 4, o.r * 0.2, o.r * 0.3, o.r * 1.15);
      g.addColorStop(0, "#f0eaff");
      g.addColorStop(0.4, "#8d7bb8");
      g.addColorStop(1, "#2e2448");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#1c1630";
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.ellipse(-o.r * 0.28, -o.r * 0.3, o.r * 0.28, o.r * 0.16, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawPuff(0, 0, o.r * 1.15, "#4a5f9a");
      drawPuff(-o.r * 0.15, -o.r * 0.1, o.r * 0.95, "#6f85c4");
      drawPuff(o.r * 0.2, -o.r * 0.25, o.r * 0.55, "rgba(230,240,255,0.55)");
      // cyan spark (not gold, so it won't look like a star)
      ctx.fillStyle = "#9be7ff";
      ctx.strokeStyle = "#2a5080";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(2, -o.r * 0.15);
      ctx.lineTo(-4, o.r * 0.2);
      ctx.lineTo(1, o.r * 0.2);
      ctx.lineTo(-2, o.r * 0.55);
      ctx.lineTo(8, o.r * 0.05);
      ctx.lineTo(2, o.r * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStar(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    const r = s.r;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const b = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(b) * r * 0.42, Math.sin(b) * r * 0.42);
    }
    ctx.closePath();
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 1.35);
    glow.addColorStop(0, "rgba(255,240,120,0.55)");
    glow.addColorStop(1, "rgba(255,200,40,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const b = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(b) * r * 0.42, Math.sin(b) * r * 0.42);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.15, -r * 0.2, 2, 0, 0, r);
    g.addColorStop(0, "#fff6b0");
    g.addColorStop(0.55, "#ffe033");
    g.addColorStop(1, "#f0a000");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#c97800";
    ctx.stroke();
    ctx.restore();
  }

  function drawParticle(p) {
    const a = 1 - p.t / p.life;
    ctx.save();
    ctx.globalAlpha = a;
    if (p.kind === "flame") {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, "#fff6a0");
      g.addColorStop(0.4, "#ff9a2a");
      g.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 0.7, p.r, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "zip") {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, "#7af0ff");
      g.addColorStop(1, "rgba(255,80,200,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.3, p.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "tickle") {
      ctx.fillStyle = "#ff8ad4";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x - p.r * 0.25, p.y - p.r * 0.25, p.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#ffe566";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = Math.min(dt, 0.05);
    update(dt);
    draw();
  }

  // ---------- input ----------
  function isP1Key(code) { return code === "KeyW" || code === "ShiftLeft" || code === "ShiftRight"; }
  function isP2Key(code) { return code === "Space" || code === "ArrowUp"; }

  function playerForPointerX(x) {
    if (mode === 1) return 1;
    return x < W / 2 ? 1 : 2;
  }

  function syncBoosts() {
    if (state !== "play") {
      for (const p of world.players) p.boosting = false;
      return;
    }
    let p1 = false, p2 = false;
    for (const slot of pointers.values()) {
      if (slot === 1) p1 = true;
      if (slot === 2) p2 = true;
    }
    for (const code of keysDown) {
      if (mode === 1) {
        if (isP1Key(code) || isP2Key(code)) p1 = true;
      } else {
        if (isP1Key(code)) p1 = true;
        if (isP2Key(code)) p2 = true;
      }
    }
    setBoost(world.players[0], p1);
    if (world.players[1]) setBoost(world.players[1], p2);
  }

  function setBoost(p, on) {
    if (!p) return;
    on = !!on;
    if (state !== "play") { p.boosting = false; return; }
    if (on && !p.boosting) sfxBoost();
    p.boosting = on;
  }

  function isUiTarget(t) {
    return t && t.closest && t.closest("button, .card, .screen, a");
  }

  window.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (state === "play" && !isUiTarget(e.target)) {
      pointers.set(e.pointerId, playerForPointerX(e.clientX));
      syncBoosts();
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (state === "play" && pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, playerForPointerX(e.clientX));
      syncBoosts();
    }
  });
  function pointerEnd(e) {
    if (pointers.has(e.pointerId)) {
      pointers.delete(e.pointerId);
      syncBoosts();
    }
  }
  window.addEventListener("pointerup", pointerEnd);
  window.addEventListener("pointercancel", pointerEnd);
  window.addEventListener("blur", () => { pointers.clear(); keysDown.clear(); syncBoosts(); });

  window.addEventListener("keydown", (e) => {
    if (isP1Key(e.code) || isP2Key(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (isP1Key(e.code) || isP2Key(e.code)) {
      ensureAudio();
      keysDown.add(e.code);
      syncBoosts();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (isP1Key(e.code) || isP2Key(e.code)) {
      e.preventDefault();
      keysDown.delete(e.code);
      syncBoosts();
    }
  });

  const prevent = (e) => { e.preventDefault(); };
  document.addEventListener("touchmove", prevent, { passive: false });
  document.addEventListener("gesturestart", prevent, { passive: false });
  document.addEventListener("contextmenu", prevent);

  document.getElementById("again").addEventListener("click", (e) => {
    e.preventDefault();
    ensureAudio();
    startGame();
  });
  document.getElementById("change").addEventListener("click", (e) => {
    e.preventDefault();
    showModeSelect();
    elOver.hidden = true;
    elHud.hidden = true;
    elHint.hidden = true;
    elStart.hidden = false;
    state = "start";
  });

  function showModeSelect() {
    pickStep = "mode";
    chosen = { p1: null, p2: null };
    elModes.hidden = false;
    elCards.hidden = true;
    elPrompt.hidden = true;
    elBack.hidden = true;
    elTagline.textContent = "Fly & dodge — pick a mode!";
    elPrompt.className = "pick-prompt";
  }

  function showPick(step) {
    pickStep = step;
    elModes.hidden = true;
    elCards.hidden = false;
    elPrompt.hidden = false;
    elBack.hidden = false;
    elTagline.textContent = mode === 2 ? "Two-player race!" : "Fly & dodge — pick your buddy!";
    if (mode === 1) {
      elPrompt.textContent = "Pick your buddy!";
      elPrompt.className = "pick-prompt";
    } else if (step === "p1") {
      elPrompt.textContent = "P1, pick your buddy!";
      elPrompt.className = "pick-prompt p1-pick";
    } else {
      elPrompt.textContent = "P2, pick your buddy!";
      elPrompt.className = "pick-prompt p2-pick";
    }
    refreshCards();
  }

  function refreshCards() {
    for (const btn of elCards.querySelectorAll(".card")) {
      const id = btn.dataset.id;
      const takenByP1 = pickStep === "p2" && chosen.p1 && chosen.p1.id === id;
      btn.disabled = !!takenByP1;
      btn.classList.toggle("taken", !!takenByP1);
      const tag = btn.querySelector(".taken-tag");
      if (tag) tag.remove();
      if (takenByP1) {
        const t = document.createElement("span");
        t.className = "taken-tag";
        t.textContent = "P1";
        btn.appendChild(t);
      }
    }
  }

  document.getElementById("mode1").addEventListener("click", () => {
    ensureAudio();
    mode = 1;
    showPick("p1");
  });
  document.getElementById("mode2").addEventListener("click", () => {
    ensureAudio();
    mode = 2;
    showPick("p1");
  });
  elBack.addEventListener("click", () => {
    if (pickStep === "p2") showPick("p1");
    else showModeSelect();
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  function pickChar(c) {
    if (pickStep === "p1" || mode === 1) {
      chosen.p1 = c;
      if (mode === 1) startGame();
      else showPick("p2");
    } else if (pickStep === "p2") {
      if (chosen.p1 && chosen.p1.id === c.id) return;
      chosen.p2 = c;
      startGame();
    }
  }

  async function boot() {
    resize();
    seedClouds();
    try {
      const tickleP = loadImage("assets/tickle.png").then((img) => { tickleImg = img; });
      await Promise.all(CHARS.map(async (c) => {
        c.image = await loadImage(c.src);
        if (c.flame) c.flameImg = await loadImage(c.flame);
        if (c.thumb) c.thumbImg = await loadImage(c.thumb);
      }).concat([tickleP]));
    } catch (err) {
      elLoading.textContent = "Could not load pictures. Try refreshing.";
      console.error(err);
      return;
    }

    elCards.innerHTML = "";
    for (const c of CHARS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card";
      btn.dataset.id = c.id;
      btn.setAttribute("aria-label", "Play as " + c.name);
      const img = document.createElement("img");
      img.alt = c.name;
      img.src = c.thumb || c.src;
      const label = document.createElement("span");
      label.textContent = c.name;
      btn.appendChild(img);
      btn.appendChild(label);
      btn.addEventListener("click", () => pickChar(c));
      elCards.appendChild(btn);
    }

    elLoading.classList.add("hidden");
    state = "start";
    showModeSelect();
    elStart.hidden = false;
    requestAnimationFrame(loop);

    window.__turbo = {
      start: (id) => {
        mode = 1;
        chosen.p1 = CHARS.find((x) => x.id === id) || CHARS[2];
        chosen.p2 = null;
        startGame();
      },
      start2p: (id1, id2) => {
        mode = 2;
        chosen.p1 = CHARS.find((x) => x.id === id1) || CHARS[2];
        chosen.p2 = CHARS.find((x) => x.id === id2) || CHARS[0];
        if (chosen.p2.id === chosen.p1.id) {
          chosen.p2 = CHARS.find((x) => x.id !== chosen.p1.id) || CHARS[0];
        }
        startGame();
      },
      boost: (a, b) => {
        if (world.players[0]) setBoost(world.players[0], !!a);
        if (world.players[1]) setBoost(world.players[1], !!b);
        // also seed keys so syncBoosts doesn't immediately clear it
        keysDown.clear();
        if (a) keysDown.add("KeyW");
        if (b) keysDown.add("Space");
      },
      ready: true,
      spawnTickle: (x, y) => spawnTickle(x, y),
      getState: () => state,
      getScore: () => (world.players[0] ? world.players[0].score : 0),
      getScore2: () => (world.players[1] ? world.players[1].score : 0),
      getMode: () => mode,
    };
  }

  boot();
})();
