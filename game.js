(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Setup                                                             */
  /* ------------------------------------------------------------------ */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (id) => document.getElementById(id);

  const W = 1280, H = 720;
  const FIELD = { left: 130, right: 1150, top: 150, bottom: 650, goalTop: 460 };
  const GOAL_DEPTH = 70;
  const GROUND = FIELD.bottom;
  const MATCH_LENGTH = 90;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now() / 1000;

  /* ------------------------------------------------------------------ */
  /*  Audio                                                             */
  /* ------------------------------------------------------------------ */
  const audio = {
    ac: null, master: null, on: true, noiseBuf: null, boostGain: null, engineGain: null,
    init() {
      if (this.ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate * 1.2;
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    },
    resume() {
      this.init();
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    },
    tone(freq, dur, type = 'sine', vol = 0.18, slideTo = null, delay = 0) {
      if (!this.on) return;
      this.init();
      if (!this.ac) return;
      const t0 = this.ac.currentTime + delay;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise(dur = 0.2, vol = 0.25, freq = 900, q = 0.8, delay = 0) {
      if (!this.on) return;
      this.init();
      if (!this.ac || !this.noiseBuf) return;
      const t0 = this.ac.currentTime + delay;
      const s = this.ac.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = this.ac.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = this.ac.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t0); s.stop(t0 + dur + 0.02);
    },
    hit(power) {
      const p = clamp(power / 1200, 0.15, 1);
      this.tone(90 + p * 60, 0.16, 'square', 0.06 + p * 0.1, 45);
      this.noise(0.1 + p * 0.1, 0.1 + p * 0.22, 1400 + p * 2000, 0.9);
    },
    jump() { this.tone(330, 0.12, 'triangle', 0.14, 620); },
    flip() { this.tone(260, 0.16, 'sawtooth', 0.08, 760); this.noise(0.1, 0.08, 1800); },
    pickup() { this.tone(760, 0.08, 'sine', 0.16); this.tone(1140, 0.1, 'sine', 0.12, 1500, 0.06); },
    goal() {
      this.tone(392, 0.5, 'sawtooth', 0.09);
      this.tone(523, 0.5, 'sawtooth', 0.08, null, 0.08);
      this.tone(659, 0.7, 'sawtooth', 0.09, null, 0.16);
      this.tone(784, 0.9, 'sawtooth', 0.08, null, 0.24);
      this.noise(0.9, 0.16, 900, 0.4);
      this.noise(1.2, 0.1, 2400, 0.5, 0.1);
    },
    beep(high) { this.tone(high ? 880 : 440, 0.12, 'square', 0.09); },
    whistle() { this.tone(1500, 0.35, 'sine', 0.12, 1200); this.noise(0.35, 0.08, 2600, 1.4); },
    setBoost(active) {
      if (!this.on) return;
      this.init();
      if (!this.ac || !this.noiseBuf) return;
      if (!this.boostGain) {
        const s = this.ac.createBufferSource();
        s.buffer = this.noiseBuf; s.loop = true;
        const f = this.ac.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 900;
        this.boostGain = this.ac.createGain();
        this.boostGain.gain.value = 0;
        s.connect(f); f.connect(this.boostGain); this.boostGain.connect(this.master);
        s.start();
        this.boostSrc = s;
      }
      const target = active ? 0.09 : 0.0;
      this.boostGain.gain.setTargetAtTime(target, this.ac.currentTime, 0.04);
    },
    setEngine(speed) {
      if (!this.on) return;
      this.init();
      if (!this.ac) return;
      if (!this.engineGain) {
        const o = this.ac.createOscillator();
        const f = this.ac.createBiquadFilter();
        const g = this.ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = 70;
        f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 4;
        g.gain.value = 0;
        o.connect(f); f.connect(g); g.connect(this.master);
        o.start();
        this.engineOsc = o; this.engineFilter = f; this.engineGain = g;
      }
      const t = this.ac.currentTime;
      this.engineOsc.frequency.setTargetAtTime(58 + speed * 38, t, 0.06);
      this.engineFilter.frequency.setTargetAtTime(220 + speed * 500, t, 0.06);
      this.engineGain.gain.setTargetAtTime(0.028 + speed * 0.03, t, 0.1);
    },
    silenceEngine() {
      if (this.ac && this.engineGain) this.engineGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.1);
      this.setBoost(false);
    },
  };

  /* ------------------------------------------------------------------ */
  /*  State                                                             */
  /* ------------------------------------------------------------------ */
  const CAR_W = 96, CAR_H = 44;
  const BALL_R = 32;
  const GRAV = 2150;

  const player = makeCar('blue', 360, 1);
  const rival = makeCar('orange', 920, -1);

  const ball = {
    x: 640, y: 330, vx: 0, vy: 0, r: BALL_R, spin: 0, spinV: 0,
    trail: [], lastHitBy: null, hot: 0,
  };

  const pads = [
    { x: 250, y: 600, active: true, timer: 0, phase: 0 },
    { x: 640, y: 430, active: true, timer: 0, phase: 2.1 },
    { x: 1030, y: 600, active: true, timer: 0, phase: 4.2 },
  ];

  const particles = [];
  const rings = [];
  const cam = { x: W / 2, y: H / 2, shake: 0, viewW: W, viewH: H, scale: 1, ox: 0, oy: 0 };

  const game = {
    state: 'menu', time: MATCH_LENGTH, countdown: 0, goalTimer: 0, overtime: false,
    blue: 0, orange: 0, timeUp: false, announce: null, lastBeep: 9,
    elapsed: 0, slow: 1, firstTo: 5,
  };

  let overlayOpen = true;
  let paused = false;
  let keys = {};
  let lastT = 0;
  let accumulator = 0;
  const STEP = 1 / 120;

  const bestKey = 'neonStrikersWins';
  let wins = Number(localStorage.getItem(bestKey) || 0);

  /* ------------------------------------------------------------------ */
  /*  Cars                                                              */
  /* ------------------------------------------------------------------ */
  function makeCar(team, x, dir) {
    return {
      team, x, y: GROUND - CAR_H / 2, vx: 0, vy: 0, w: CAR_W, h: CAR_H,
      angle: 0, grounded: true, jumps: 0, coyote: 0, boost: 50, boosting: false,
      jumpQueued: false, flipTimer: 0, flipDir: 1, dir, wheel: 0, hitCd: 0,
      input: { left: false, right: false, boost: false },
      squash: 0, trail: [], speedFx: 0,
    };
  }

  function resetCar(car, x, dir) {
    car.x = x;
    car.y = GROUND - car.h / 2;
    car.vx = 0; car.vy = 0;
    car.angle = 0; car.grounded = true; car.jumps = 0; car.coyote = 0;
    car.boost = 50; car.boosting = false; car.jumpQueued = false;
    car.flipTimer = 0; car.flipDir = dir; car.dir = dir; car.wheel = 0;
    car.hitCd = 0; car.squash = 0; car.trail.length = 0;
  }

  function kickoff() {
    resetCar(player, 360, 1);
    resetCar(rival, 920, -1);
    ball.x = 640; ball.y = 320; ball.vx = 0; ball.vy = 0; ball.spin = 0; ball.spinV = 0;
    ball.trail.length = 0; ball.lastHitBy = null; ball.hot = 0;
    pads.forEach((p) => { p.active = true; p.timer = 0; });
    particles.length = 0; rings.length = 0;
    rival.think = 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Match flow                                                        */
  /* ------------------------------------------------------------------ */
  function startMatch() {
    audio.resume();
    game.blue = 0; game.orange = 0;
    game.time = MATCH_LENGTH; game.timeUp = false; game.overtime = false;
    game.state = 'countdown'; game.countdown = 3.0;
    game.goalTimer = 0; game.announce = null; game.lastBeep = 9;
    game.elapsed = 0; game.slow = 1;
    paused = false;
    kickoff();
    updateScoreHud();
    showOverlay(null);
    $('clockBox').classList.remove('urgent', 'overtime');
    $('clockLabel').textContent = 'MATCH';
  }

  function endMatch() {
    game.state = 'over';
    audio.silenceEngine();
    audio.whistle();
    const won = game.blue > game.orange;
    if (won) { wins++; localStorage.setItem(bestKey, String(wins)); }
    const panel = $('endPanel');
    panel.classList.remove('win', 'lose');
    panel.classList.add(won ? 'win' : 'lose');
    $('endKicker').textContent = game.overtime ? 'GOLDEN GOAL' : 'FULL TIME';
    $('endTitle').textContent = won ? 'VICTORY' : 'DEFEAT';
    $('endBlue').textContent = game.blue;
    $('endOrange').textContent = game.orange;
    $('endCopy').textContent = won
      ? 'Clean strikes, sharp flips. The arena is yours.'
      : 'The orange crew got the bounce. Run it back.';
    showOverlay('end');
  }

  function scoreGoal(team) {
    if (game.state !== 'playing') return;
    game.state = 'goal';
    game.goalTimer = 2.6;
    game.slow = 0.28;
    if (team === 'blue') game.blue++; else game.orange++;
    updateScoreHud();

    cam.shake = 22;
    ball.vy = Math.min(ball.vy, -260);
    ball.hot = 1;
    burst(ball.x, ball.y, team === 'blue' ? '#5fe6ff' : '#ffab63', 60, 620);
    burst(ball.x, ball.y, '#ffffff', 26, 420);
    rings.push({ x: ball.x, y: ball.y, r: 30, max: 460, life: 0.9, color: team === 'blue' ? '#5fe6ff' : '#ffab63' });
    rings.push({ x: ball.x, y: ball.y, r: 10, max: 300, life: 0.65, color: '#ffffff' });
    game.announce = { text: 'GOAL!', sub: team === 'blue' ? 'BLUE STRIKES' : 'ORANGE STRIKES', life: 2.1, max: 2.1, color: team === 'blue' ? '#5fe6ff' : '#ffab63' };
    audio.goal();
    const won = team === 'blue' && game.blue >= game.firstTo;
    if (game.overtime || (game.blue >= game.firstTo || game.orange >= game.firstTo)) game.timeUp = true;
    if (won) game.timeUp = true;
  }

  function updateScoreHud() {
    $('blueScore').textContent = game.blue;
    $('orangeScore').textContent = game.orange;
  }

  function showOverlay(which) {
    const map = { menu: 'menuPanel', pause: 'pausePanel', end: 'endPanel' };
    Object.entries(map).forEach(([k, id]) => $(id).classList.toggle('hidden', k !== which));
    $('overlay').classList.toggle('hidden', !which);
    overlayOpen = !!which;
  }

  function togglePause(force) {
    if (game.state === 'menu' || game.state === 'over') return;
    paused = force !== undefined ? force : !paused;
    if (paused) {
      game.prevState = game.state;
      game.state = 'paused';
      showOverlay('pause');
      audio.silenceEngine();
    } else {
      game.state = game.prevState || 'playing';
      showOverlay(null);
      audio.resume();
    }
  }

  function quitToMenu() {
    paused = false;
    game.state = 'menu';
    game.announce = null;
    showOverlay('menu');
    audio.silenceEngine();
    kickoff();
  }

  /* ------------------------------------------------------------------ */
  /*  Input                                                             */
  /* ------------------------------------------------------------------ */
  const keyMap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ShiftLeft: 'boost', ShiftRight: 'boost', KeyK: 'boost', KeyL: 'boost',
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      if (!overlayOpen) togglePause();
      else if (game.state === 'paused') togglePause(false);
      return;
    }
    if (e.code === 'Enter' && (game.state === 'menu' || game.state === 'over')) {
      e.preventDefault();
      startMatch();
      return;
    }
    if (e.code === 'KeyM') { toggleSound(); return; }
    const action = keyMap[e.code];
    if (!action) return;
    e.preventDefault();
    keys[action] = true;
    if (action === 'jump') player.jumpQueued = true;
    audio.resume();
  });

  window.addEventListener('keyup', (e) => {
    const action = keyMap[e.code];
    if (!action) return;
    keys[action] = false;
  });

  window.addEventListener('blur', () => { keys = {}; if (game.state === 'playing') togglePause(true); });

  // touch
  document.querySelectorAll('[data-hold]').forEach((btn) => {
    const action = btn.dataset.hold;
    const on = (e) => {
      e.preventDefault();
      btn.classList.add('on');
      audio.resume();
      if (action === 'jump') { player.jumpQueued = true; keys.jump = true; }
      else keys[action] = true;
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const off = (e) => {
      e.preventDefault();
      btn.classList.remove('on');
      if (action !== 'jump') keys[action] = false;
      else keys.jump = false;
    };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });

  document.querySelectorAll('[data-tap]').forEach((btn) => {
    const action = btn.dataset.tap;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('on');
      audio.resume();
      if (action === 'jump') player.jumpQueued = true;
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    });
    const off = (e) => { e.preventDefault(); btn.classList.remove('on'); };
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });

  // gamepad
  function pollGamepad() {
    if (!navigator.getGamepads) return;
    const gp = navigator.getGamepads()[0];
    if (!gp) return;
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.24) { keys.left = ax < -0.2; keys.right = ax > 0.2; }
    if (gp.buttons[0] && gp.buttons[0].pressed) { if (!player.gpJump) player.jumpQueued = true; player.gpJump = true; }
    else player.gpJump = false;
    keys.boost = keys.boost || !!(gp.buttons[1] && gp.buttons[1].pressed) || !!(gp.buttons[5] && gp.buttons[5].pressed);
  }

  /* ------------------------------------------------------------------ */
  /*  Physics                                                           */
  /* ------------------------------------------------------------------ */
  function updateCar(car, dt) {
    const inp = car.input;
    let throttle = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (car === player) {
      throttle = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      inp.right = !!keys.right; inp.left = !!keys.left; inp.boost = !!keys.boost;
    }
    if (throttle !== 0) car.dir = throttle;

    const wantBoost = inp.boost && car.boost > 0;
    car.boosting = wantBoost;
    if (wantBoost) {
      car.boost = Math.max(0, car.boost - 32 * dt);
      if (car.boost <= 0) car.boosting = false;
    } else {
      car.boost = Math.min(100, car.boost + 2.5 * dt);
    }

    const accel = car.grounded ? 2500 : 1250;
    const maxSpeed = car.boosting ? 1400 : car.grounded ? 780 : 960;

    if (throttle !== 0) {
      const cur = car.vx * throttle;
      if (cur < maxSpeed) car.vx += throttle * accel * dt;
    } else if (car.grounded) {
      const fric = 2300 * dt;
      if (Math.abs(car.vx) <= fric) car.vx = 0;
      else car.vx -= Math.sign(car.vx) * fric;
    } else {
      car.vx *= 1 - 0.7 * dt;
    }

    if (car.boosting) {
      car.vx += car.dir * 2100 * dt;
      if (!car.grounded) car.vy -= 620 * dt;
      if (Math.random() < 0.8) {
        car.trail.push({ x: car.x - car.dir * 44, y: car.y + rand(-10, 10), life: 0.35, max: 0.35, r: rand(6, 14), team: car.team });
      }
    }

    const cap = car.boosting ? 1500 : 900;
    car.vx = clamp(car.vx, -cap, cap);
    if (car.grounded) car.vx = clamp(car.vx, -820, 1500);

    // gravity & jumping
    if (car.grounded) {
      car.coyote = 0.1;
      car.jumps = 0;
    } else {
      car.coyote = Math.max(0, car.coyote - dt);
    }

    if (car.jumpQueued) {
      car.jumpQueued = false;
      if (car.grounded || car.coyote > 0) {
        car.vy = -900;
        car.grounded = false; car.coyote = 0; car.jumps = 1;
        car.squash = 1;
        if (car === player) audio.jump();
        dust(car.x, GROUND, 8, '#cfe8ff');
      } else if (car.jumps < 2) {
        car.vy = Math.min(car.vy, -720);
        car.jumps = 2;
        car.flipTimer = 0.42;
        car.flipDir = throttle || car.dir;
        car.vx += car.flipDir * 420;
        if (car === player) audio.flip();
        burst(car.x, car.y, car.team === 'blue' ? '#7fe9ff' : '#ffb070', 10, 260, 0.3);
      }
    }

    if (!car.grounded) car.vy += GRAV * dt;
    car.vy = clamp(car.vy, -1400, 1900);

    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // walls
    const minX = FIELD.left + car.w / 2 + 2;
    const maxX = FIELD.right - car.w / 2 - 2;
    if (car.x < minX) { car.x = minX; if (car.vx < -220) bumpWall(car); car.vx = Math.max(0, car.vx) * 0.2; }
    if (car.x > maxX) { car.x = maxX; if (car.vx > 220) bumpWall(car); car.vx = Math.min(0, car.vx) * 0.2; }

    // ceiling
    if (car.y - car.h / 2 < FIELD.top) {
      car.y = FIELD.top + car.h / 2;
      car.vy = Math.abs(car.vy) * 0.25;
    }

    // floor
    if (car.y + car.h / 2 >= GROUND) {
      car.y = GROUND - car.h / 2;
      if (!car.grounded) {
        car.squash = Math.min(1, Math.abs(car.vy) / 900 + 0.35);
        if (Math.abs(car.vy) > 300) dust(car.x, GROUND, 7, '#b9d4ef');
      }
      car.vy = 0;
      car.grounded = true;
      car.jumps = 0;
    } else {
      car.grounded = false;
    }

    // visual rotation
    if (car.flipTimer > 0) {
      car.flipTimer = Math.max(0, car.flipTimer - dt);
      const p = 1 - car.flipTimer / 0.42;
      car.angle = car.flipDir * p * Math.PI * 2;
    } else {
      car.angle = lerp(car.angle, car.grounded ? 0 : clamp(car.vy / 2600, -0.2, 0.2), 1 - Math.pow(0.001, dt));
    }

    car.wheel += car.vx * dt * 0.07;
    car.squash = Math.max(0, car.squash - dt * 3.2);
    car.hitCd = Math.max(0, car.hitCd - dt);
    car.speedFx = Math.abs(car.vx) / 1400;

    // trail decay
    for (let i = car.trail.length - 1; i >= 0; i--) {
      const t = car.trail[i];
      t.life -= dt;
      if (t.life <= 0) car.trail.splice(i, 1);
    }
  }

  function bumpWall(car) {
    cam.shake = Math.max(cam.shake, 4);
    dust(car.x, car.y, 5, '#9fc4e8');
    audio.noise(0.08, 0.06, 500);
  }

  function updateBall(dt) {
    if (game.state === 'countdown') return;

    ball.vy += 1650 * dt;
    ball.vx *= 1 - 0.16 * dt;
    ball.vy *= 1 - 0.04 * dt;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.spin += ball.spinV * dt;
    ball.spinV *= 1 - 0.5 * dt;
    if (ball.hot > 0) ball.hot = Math.max(0, ball.hot - dt * 0.6);

    // floor
    if (ball.y + ball.r > GROUND) {
      ball.y = GROUND - ball.r;
      // goals recess: ball is allowed in only past goal line; floor still solid
      if (ball.vy > 30) {
        if (ball.vy > 220) {
          dust(ball.x, GROUND, 6, '#d7ecff');
          audio.noise(0.08, Math.min(0.12, ball.vy / 6000), 420);
        }
        ball.vy = -ball.vy * 0.72;
        ball.vx *= 0.985;
        if (Math.abs(ball.vy) < 40) ball.vy = 0;
        ball.spinV += ball.vx * 0.006;
      }
    }

    // ceiling
    if (ball.y - ball.r < FIELD.top) {
      ball.y = FIELD.top + ball.r;
      if (ball.vy < 0) ball.vy = -ball.vy * 0.74;
      ball.spinV += ball.vx * 0.004;
    }

    // side walls / goals
    const inGoalBand = ball.y + ball.r * 0.35 > FIELD.goalTop;
    if (ball.x - ball.r < FIELD.left) {
      if (!inGoalBand) {
        ball.x = FIELD.left + ball.r;
        if (ball.vx < 0) { ball.vx = -ball.vx * 0.8; ball.spinV = -ball.vx * 0.01; }
      } else if (ball.x < FIELD.left - 6) {
        scoreGoal('orange');
      }
    }
    if (ball.x + ball.r > FIELD.right) {
      if (!inGoalBand) {
        ball.x = FIELD.right - ball.r;
        if (ball.vx > 0) { ball.vx = -ball.vx * 0.8; ball.spinV = -ball.vx * 0.01; }
      } else if (ball.x > FIELD.right + 6) {
        scoreGoal('blue');
      }
    }

    // keep the ball inside the goal box once it's scored
    if (game.state === 'goal') {
      if (ball.x - ball.r < FIELD.left - GOAL_DEPTH) {
        ball.x = FIELD.left - GOAL_DEPTH + ball.r;
        ball.vx = Math.abs(ball.vx) * 0.4;
      }
      if (ball.x + ball.r > FIELD.right + GOAL_DEPTH) {
        ball.x = FIELD.right + GOAL_DEPTH - ball.r;
        ball.vx = -Math.abs(ball.vx) * 0.4;
      }
    }

    // clamp
    const speed = Math.hypot(ball.vx, ball.vy);
    const maxS = 1850;
    if (speed > maxS) { ball.vx *= maxS / speed; ball.vy *= maxS / speed; }

    ball.trail.push({ x: ball.x, y: ball.y, life: 0.55, max: 0.55 });
    if (ball.trail.length > 26) ball.trail.shift();
    for (let i = ball.trail.length - 1; i >= 0; i--) {
      ball.trail[i].life -= dt;
      if (ball.trail[i].life <= 0) ball.trail.splice(i, 1);
    }
  }

  function collideCarBall(car) {
    const b = ball;
    const dx = b.x - car.x, dy = b.y - car.y;
    const cos = Math.cos(car.angle), sin = Math.sin(car.angle);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const hw = car.w / 2, hh = car.h / 2;
    const qx = clamp(lx, -hw, hw), qy = clamp(ly, -hh, hh);
    let nx = lx - qx, ny = ly - qy;
    let dist = Math.hypot(nx, ny);
    if (dist > b.r) return;

    if (dist < 0.0001) {
      // deep overlap: push out along the shortest axis
      if (hw - Math.abs(lx) < hh - Math.abs(ly)) { nx = Math.sign(lx) || 1; ny = 0; }
      else { nx = 0; ny = Math.sign(ly) || -1; }
      dist = 0.0001;
    }
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen; ny /= nlen;
    const wnx = nx * cos - ny * sin;
    const wny = nx * sin + ny * cos;

    const pen = b.r - dist + 0.5;
    b.x += wnx * pen;
    b.y += wny * pen;

    const rel = (b.vx - car.vx) * wnx + (b.vy - car.vy) * wny;
    if (rel < 80) {
      const closing = clamp(-rel, 220, 1350);
      const carSpeed = Math.hypot(car.vx, car.vy);
      const j = closing * 0.94 + carSpeed * 0.22;
      b.vx += wnx * j + car.vx * 0.26;
      b.vy += wny * j + car.vy * 0.26;
      // lift the ball a touch when clipped from above
      if (wny < -0.35) b.vy -= 60;
      b.spinV += (car.vx * wnx + car.vy * wny) * 0.0025 + rand(-2, 2);
      b.lastHitBy = car.team;
      car.hitCd = 0.09;
      const power = Math.min(1, j / 1200);
      cam.shake = Math.max(cam.shake, 3 + power * 9);
      const col = car.team === 'blue' ? '#8beeff' : '#ffc088';
      burst(b.x - wnx * b.r, b.y - wny * b.r, col, 6 + Math.floor(power * 10), 220 + power * 420, 0.35);
      rings.push({ x: b.x - wnx * b.r, y: b.y - wny * b.r, r: 8, max: 60 + power * 90, life: 0.32, color: col });
      if (car === player) audio.hit(j);
      else audio.hit(j * 0.8);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 1850) { b.vx *= 1850 / sp; b.vy *= 1850 / sp; }
    }
  }

  function collideCars(dt) {
    const dx = rival.x - player.x;
    const dy = rival.y - player.y;
    const overlapX = CAR_W - Math.abs(dx);
    const overlapY = CAR_H - Math.abs(dy);
    if (overlapX > 0 && overlapY > 0) {
      const sign = Math.sign(dx) || 1;
      const push = overlapX * 0.5;
      player.x -= sign * push;
      rival.x += sign * push;
      const avg = (player.vx + rival.vx) * 0.5;
      player.vx = avg - sign * 60;
      rival.vx = avg + sign * 60;
      player.x = clamp(player.x, FIELD.left + CAR_W / 2, FIELD.right - CAR_W / 2);
      rival.x = clamp(rival.x, FIELD.left + CAR_W / 2, FIELD.right - CAR_W / 2);
      if (Math.abs(dx) < 20 && Math.abs(player.vx - rival.vx) > 400) {
        cam.shake = Math.max(cam.shake, 6);
        audio.noise(0.09, 0.1, 300);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  AI                                                                */
  /* ------------------------------------------------------------------ */
  function thinkAI(dt) {
    rival.think = (rival.think || 0) - dt;
    if (rival.think > 0) return;
    rival.think = 0.05 + Math.random() * 0.07;

    const inp = rival.input;
    const predX = ball.x + ball.vx * 0.2;
    const ballSide = ball.x > (FIELD.left + FIELD.right) / 2;

    // stand goal-side of the ball so a touch sends it left
    let targetX = predX + 62;
    if (ball.vx > 500) targetX = predX + 95;
    if (!ballSide && ball.y < GROUND - 120) targetX = predX + 40;
    targetX = clamp(targetX, FIELD.left + 90, FIELD.right - 60);

    const dx = targetX - rival.x;
    inp.left = dx < -14;
    inp.right = dx > 14;
    inp.boost = Math.abs(dx) > 250 && rival.boost > 12 && ball.x < FIELD.right - 100;

    // don't wander into its own net
    if (rival.x > FIELD.right - 130 && ball.x < rival.x) {
      inp.right = false;
      inp.left = true;
    }

    const nearX = Math.abs(ball.x - rival.x) < 140;
    const ballAbove = ball.y < rival.y - 55;
    const ballVeryHigh = ball.y < FIELD.top + 250;

    if (nearX && ballAbove && rival.grounded && Math.random() < 0.55) rival.jumpQueued = true;
    else if (!rival.grounded && nearX && rival.jumps === 1 && Math.random() < 0.16) rival.jumpQueued = true;

    // aerial challenge when the ball hangs near its goal
    if (ballVeryHigh && nearX && rival.grounded && Math.random() < 0.12) rival.jumpQueued = true;

    rival.boostGoal = ballSide ? 52 : 85;
  }

  /* ------------------------------------------------------------------ */
  /*  Boost pads & particles                                            */
  /* ------------------------------------------------------------------ */
  function updatePads(dt) {
    for (const p of pads) {
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) { p.active = true; p.phase = 0; rings.push({ x: p.x, y: p.y, r: 6, max: 60, life: 0.5, color: '#ffc46b' }); }
        continue;
      }
      p.phase += dt;
      for (const car of [player, rival]) {
        if (Math.hypot(car.x - p.x, car.y - p.y) < 58) {
          p.active = false; p.timer = 6;
          car.boost = Math.min(100, car.boost + 34);
          burst(p.x, p.y, '#ffd27a', 12, 240, 0.4);
          rings.push({ x: p.x, y: p.y, r: 8, max: 90, life: 0.45, color: '#ffd27a' });
          if (car === player) audio.pickup();
          break;
        }
      }
    }
  }

  function burst(x, y, color, count, speed, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.75);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life, max: life,
        size: rand(2, 5.5), color, grav: 900, drag: 2.2, type: Math.random() < 0.35 ? 'spark' : 'dot',
      });
    }
  }

  function dust(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: x + rand(-20, 20), y: y - rand(0, 6), vx: rand(-90, 90), vy: rand(-160, -30),
        life: 0.45, max: 0.45, size: rand(3, 8), color, grav: -40, drag: 2.4, type: 'smoke',
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      const t = 1 - r.life / 0.9;
      r.r = lerp(r.r, r.max, 0.14);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Update loop                                                       */
  /* ------------------------------------------------------------------ */
  function update(dt) {
    game.elapsed += dt;

    if (game.state === 'paused' || game.state === 'menu') return;

    if (game.state === 'countdown') {
      const before = Math.ceil(game.countdown);
      game.countdown -= dt;
      const after = Math.ceil(game.countdown);
      if (after !== before && after >= 1) { audio.beep(false); }
      if (game.countdown <= 0.55 && game.countdown > 0) {
        if (game.lastBeep !== 0) { audio.beep(true); game.lastBeep = 0; }
      }
      if (game.countdown <= 0) {
        game.state = 'playing';
        game.announce = { text: 'GO!', sub: '', life: 0.7, max: 0.7, color: '#ffffff' };
      }
    }

    if (game.state === 'playing') {
      game.time -= dt;
      if (game.time <= 0) {
        game.time = 0;
        game.timeUp = true;
        if (game.blue === game.orange) {
          game.overtime = true;
          game.timeUp = false;
          if (!game.announce || game.announce.text !== 'OVERTIME') {
            game.announce = { text: 'OVERTIME', sub: 'NEXT GOAL WINS', life: 2.2, max: 2.2, color: '#ffd76a' };
            audio.whistle();
          }
        } else if (game.state === 'playing') {
          endMatch();
          return;
        }
      }
      if (game.time < 10 && Math.ceil(game.time) !== game.lastTick) {
        game.lastTick = Math.ceil(game.time);
        if (game.lastTick > 0 && game.lastTick <= 5) audio.beep(false);
      }
    }

    if (game.state === 'goal') {
      game.goalTimer -= dt;
      game.slow = lerp(game.slow, 1, 1 - Math.pow(0.02, dt));
      if (game.goalTimer <= 0) {
        if (game.timeUp) { endMatch(); return; }
        game.state = 'countdown';
        game.countdown = 2.4;
        game.slow = 1;
        kickoff();
        game.announce = null;
      }
    }

    // physics timestep scale
    let ts = game.state === 'goal' ? 0.35 : 1;
    const pdt = dt * ts;

    thinkAI(pdt);
    updateCar(player, pdt);
    updateCar(rival, pdt);
    collideCars(pdt);
    updateBall(pdt);
    if (game.state === 'playing' || game.state === 'goal') {
      collideCarBall(player);
      collideCarBall(rival);
    }
    updatePads(pdt);
    updateParticles(dt);

    if (player.boosting) audio.setBoost(true); else audio.setBoost(false);
    audio.setEngine(clamp(Math.abs(player.vx) / 1200, 0, 1));

    if (game.announce) {
      game.announce.life -= dt;
      if (game.announce.life <= 0) game.announce = null;
    }

    cam.shake = Math.max(0, cam.shake - dt * 34);

    // clock
    const shown = game.overtime ? 0 : Math.ceil(Math.max(0, game.time));
    const mm = Math.floor(shown / 60);
    const ss = String(shown % 60).padStart(2, '0');
    $('clock').textContent = game.overtime ? 'OT' : `${mm}:${ss}`;
    const box = $('clockBox');
    box.classList.toggle('urgent', !game.overtime && game.time <= 15 && game.state !== 'over');
    box.classList.toggle('overtime', game.overtime);
    $('clockLabel').textContent = game.overtime ? 'GOLDEN GOAL' : 'MATCH';

    $('boostFill').style.width = `${player.boost}%`;
    $('boostNum').textContent = Math.round(player.boost);
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                         */
  /* ------------------------------------------------------------------ */
  let crowd = null;
  let hexPattern = null;

  function buildCrowd() {
    crowd = [];
    for (let y = 22; y < 140; y += 13) {
      for (let x = 18 + (Math.random() * 10 | 0); x < W - 8; x += 15 + (Math.random() * 5 | 0)) {
        const left = x < W / 2;
        crowd.push({
          x, y: y + Math.random() * 3, s: 3 + Math.random() * 2.4,
          c: left ? (Math.random() < 0.72 ? '#2b8fd6' : '#7fd8ff') : (Math.random() < 0.72 ? '#d4703a' : '#ffc28a'),
          ph: Math.random() * Math.PI * 2, sp: 0.6 + Math.random() * 1.7,
        });
      }
    }
  }

  function buildHexPattern() {
    const s = 46;
    const pc = document.createElement('canvas');
    pc.width = s * 3; pc.height = s * 1.75;
    const c = pc.getContext('2d');
    c.strokeStyle = 'rgba(120, 190, 255, 0.30)';
    c.lineWidth = 1.1;
    const h = s * 0.866;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = col * s * 1.5 + (row % 2 ? s * 0.75 : 0);
        const cy = row * h;
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const px = cx + Math.cos(a) * s * 0.5;
          const py = cy + Math.sin(a) * s * 0.5;
          i ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.closePath();
        c.stroke();
      }
    }
    hexPattern = ctx.createPattern(pc, 'repeat');
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const cw = Math.max(1, rect.width), ch = Math.max(1, rect.height);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    cam.dpr = dpr;
    cam.cw = cw; cam.ch = ch;
  }

  function computeView() {
    const cw = cam.cw, ch = cam.ch;
    const aspect = cw / ch;
    let scale, viewW, viewH;
    if (aspect < 1.2) {
      // portrait / narrow: zoom in and follow the action
      viewW = 900;
      scale = cw / viewW;
      viewH = ch / scale;
      if (viewH > H) { viewH = H; scale = ch / H; viewW = cw / scale; }
    } else {
      scale = Math.min(cw / W, ch / H);
      viewW = cw / scale;
      viewH = ch / scale;
    }
    cam.scale = scale; cam.viewW = viewW; cam.viewH = viewH;

    const fx = clamp(ball.x, viewW / 2, W - viewW / 2);
    const fy = clamp(ball.y - 20, viewH / 2, H - viewH / 2);
    if (viewW >= W - 1) cam.x = W / 2;
    else cam.x = lerp(cam.x, fx, 0.09);
    if (viewH >= H - 1) cam.y = H / 2;
    else cam.y = lerp(cam.y, fy, 0.07);

    cam.x = clamp(cam.x, viewW / 2, W - viewW / 2);
    cam.y = clamp(cam.y, viewH / 2, H - viewH / 2);
  }

  function draw() {
    computeView();
    const dpr = cam.dpr || 1;
    const scale = cam.scale;
    const shake = cam.shake;
    const sx = shake ? rand(-shake, shake) : 0;
    const sy = shake ? rand(-shake, shake) : 0;
    const ox = (cam.cw - cam.viewW * scale) / 2 + sx;
    const oy = (cam.ch - cam.viewH * scale) / 2 + sy;

    // backdrop fill across whole canvas
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, cam.ch);
    bg.addColorStop(0, '#05081a');
    bg.addColorStop(0.55, '#070d24');
    bg.addColorStop(1, '#040613');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cam.cw, cam.ch);

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox - (cam.x - cam.viewW / 2) * scale), dpr * (oy - (cam.y - cam.viewH / 2) * scale));

    const vx0 = cam.x - cam.viewW / 2, vy0 = cam.y - cam.viewH / 2;
    drawBackdrop(vx0, vy0, cam.viewW, cam.viewH);
    drawArena();
    drawPads();
    drawBallTrail();
    drawCar(rival);
    drawCar(player);
    drawBall();
    drawParticles();
    drawAnnounce();
    drawVignette(vx0, vy0, cam.viewW, cam.viewH);
  }

  function drawBackdrop(x0, y0, w, h) {
    // deep gradient
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#0a1030');
    g.addColorStop(0.42, '#0a1233');
    g.addColorStop(1, '#050914');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, h);

    // stadium light glows
    const t = game.elapsed;
    const lights = [[246, 46, '#4aa8ff'], [430, 34, '#7f6bff'], [850, 34, '#ff9a5c'], [1034, 46, '#ff6a3c']];
    for (const [lx, ly, col] of lights) {
      const rg = ctx.createRadialGradient(lx, ly, 4, lx, ly, 220);
      rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.13 + Math.sin(t * 1.4 + lx) * 0.02;
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(lx, ly, 220, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // housing
      ctx.fillStyle = '#111a38';
      ctx.fillRect(lx - 34, ly - 10, 68, 14);
      ctx.fillStyle = 'rgba(220, 240, 255, 0.85)';
      for (let i = 0; i < 5; i++) ctx.fillRect(lx - 30 + i * 13, ly - 8, 8, 5);
    }

    // crowd stands
    ctx.fillStyle = 'rgba(7, 11, 28, 0.85)';
    ctx.fillRect(x0, y0, w, 148);
    if (crowd) {
      for (const c of crowd) {
        if (c.x < x0 - 10 || c.x > x0 + w + 10) continue;
        const flick = 0.45 + Math.sin(t * c.sp + c.ph) * 0.22;
        ctx.globalAlpha = flick;
        ctx.fillStyle = c.c;
        ctx.fillRect(c.x, c.y, c.s, c.s * 1.25);
      }
      ctx.globalAlpha = 1;
    }
    // stand rail
    ctx.fillStyle = 'rgba(110, 160, 255, 0.18)';
    ctx.fillRect(x0, 144, w, 2);
    ctx.fillStyle = 'rgba(255, 160, 90, 0.14)';
    ctx.fillRect(x0, 147, w, 1);
  }

  function roundRect(x, y, w, h, r) {
    const c = ctx;
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function drawArena() {
    const L = FIELD.left, R = FIELD.right, T = FIELD.top, B = FIELD.bottom;

    // empty goal recesses
    drawGoalRecess(L - GOAL_DEPTH, T, GOAL_DEPTH, B - T, 'blue', true);
    drawGoalRecess(R, T, GOAL_DEPTH, B - T, 'orange', false);

    // field panel
    const fg = ctx.createLinearGradient(0, T, 0, B);
    fg.addColorStop(0, '#101a45');
    fg.addColorStop(0.5, '#16224f');
    fg.addColorStop(1, '#1b2a5e');
    ctx.fillStyle = fg;
    ctx.fillRect(L, T, R - L, B - T);

    // hex grid
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, R - L, B - T); ctx.clip();
    if (hexPattern) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = hexPattern;
      ctx.fillRect(L, T, R - L, B - T);
      ctx.globalAlpha = 1;
    }
    // floor light pool
    const pool = ctx.createRadialGradient(640, B, 40, 640, B, 720);
    pool.addColorStop(0, 'rgba(90, 160, 255, 0.22)');
    pool.addColorStop(0.55, 'rgba(60, 110, 220, 0.08)');
    pool.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = pool;
    ctx.fillRect(L, T, R - L, B - T);
    ctx.restore();

    // soft beam shafts
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, R - L, B - T); ctx.clip();
    ctx.globalAlpha = 0.055;
    for (let i = 0; i < 4; i++) {
      const bx = 250 + i * 260;
      const grd = ctx.createLinearGradient(bx, T, bx + 120, B);
      grd.addColorStop(0, i % 2 ? '#ffb27a' : '#8fd8ff');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(bx - 34, T); ctx.lineTo(bx + 34, T);
      ctx.lineTo(bx + 210, B); ctx.lineTo(bx + 60, B);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // markings
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T + 2, R - L, B - T - 2); ctx.clip();
    ctx.strokeStyle = 'rgba(150, 205, 255, 0.26)';
    ctx.lineWidth = 2;
    // halfway line
    ctx.setLineDash([12, 12]);
    ctx.beginPath(); ctx.moveTo(640, T + 10); ctx.lineTo(640, B); ctx.stroke();
    ctx.setLineDash([]);
    // center circle on the deck
    ctx.beginPath(); ctx.ellipse(640, B - 2, 150, 30, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(640, B - 2, 150, 30, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    // goal boxes
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L + 118, B); ctx.lineTo(L + 118, B - 130); ctx.lineTo(L + 240, B - 130); ctx.lineTo(L + 240, B);
    ctx.moveTo(R - 118, B); ctx.lineTo(R - 118, B - 130); ctx.lineTo(R - 240, B - 130); ctx.lineTo(R - 240, B);
    ctx.stroke();
    ctx.restore();

    // field glass walls (above goal height)
    drawWallStrip(L, T, FIELD.goalTop - T, 'blue');
    drawWallStrip(R, T, FIELD.goalTop - T, 'orange');

    // ceiling line
    ctx.strokeStyle = 'rgba(130, 200, 255, 0.42)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(R, T); ctx.stroke();
    ctx.strokeStyle = 'rgba(130, 200, 255, 0.10)';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(R, T); ctx.stroke();

    // top corner braces
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.25)';
    ctx.lineWidth = 2;
    for (const cx of [L, R]) {
      const s = cx === L ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(cx, T); ctx.lineTo(cx + s * 30, T + 30); ctx.stroke();
    }

    // goal mouths glow + posts
    drawGoalMouth(L, 'blue', 1);
    drawGoalMouth(R, 'orange', -1);

    // deck
    const deck = ctx.createLinearGradient(0, B, 0, B + 70);
    deck.addColorStop(0, '#1d2c60');
    deck.addColorStop(0.16, '#121a3c');
    deck.addColorStop(1, '#070b1c');
    ctx.fillStyle = deck;
    ctx.fillRect(L - GOAL_DEPTH - 30, B, (R - L) + (GOAL_DEPTH + 30) * 2, 70);

    // floor line
    ctx.strokeStyle = 'rgba(210, 240, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(L, B); ctx.lineTo(R, B); ctx.stroke();
    ctx.strokeStyle = 'rgba(90, 190, 255, 0.5)';
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(L, B); ctx.lineTo(R, B); ctx.stroke();
    ctx.strokeStyle = 'rgba(90, 190, 255, 0.12)';
    ctx.lineWidth = 44;
    ctx.beginPath(); ctx.moveTo(L, B); ctx.lineTo(R, B); ctx.stroke();

    // goal line accents (team colored)
    ctx.strokeStyle = 'rgba(56, 217, 255, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(L, B); ctx.lineTo(L, B - 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 138, 60, 0.9)';
    ctx.beginPath(); ctx.moveTo(R, B); ctx.lineTo(R, B - 4); ctx.stroke();

    // ground reflection glow under cars/ball is drawn per entity
    // pitch markings glow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = 'rgba(150, 210, 255, 0.4)';
    ctx.fillRect(0, 0, 0, 0);
    ctx.globalAlpha = 1;
  }

  function drawWallStrip(x, top, height, team) {
    const g = ctx.createLinearGradient(x, top, x + (x < 640 ? 14 : -14), top + height);
    if (team === 'blue') { g.addColorStop(0, 'rgba(70, 200, 255, 0.4)'); g.addColorStop(1, 'rgba(20, 60, 140, 0.15)'); }
    else { g.addColorStop(0, 'rgba(255, 160, 90, 0.4)'); g.addColorStop(1, 'rgba(140, 60, 20, 0.15)'); }
    ctx.fillStyle = g;
    ctx.fillRect(x - (x < 640 ? 9 : 0), top, 9, height);

    // inner sheen
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(x - (x < 640 ? 9 : 0), top, 2, height);

    // wall ribs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    for (let y = top + 26; y < top + height; y += 34) {
      ctx.beginPath();
      ctx.moveTo(x + (x < 640 ? 4 : -4), y);
      ctx.lineTo(x + (x < 640 ? 16 : -16), y + 18);
      ctx.stroke();
    }
  }

  function drawGoalRecess(x, y, w, h, team, leftSide) {
    const gx = leftSide ? x : x;
    const col = team === 'blue' ? '56, 190, 255' : '255, 140, 70';
    const g = ctx.createLinearGradient(gx, y, gx + w, y + h);
    g.addColorStop(0, `rgba(${col}, 0.16)`);
    g.addColorStop(0.5, 'rgba(6, 10, 26, 0.9)');
    g.addColorStop(1, `rgba(${col}, 0.05)`);
    ctx.fillStyle = g;
    ctx.fillRect(gx, y, w, h);

    // net
    ctx.save();
    ctx.beginPath(); ctx.rect(gx, y, w, h); ctx.clip();
    ctx.strokeStyle = `rgba(${col}, 0.18)`;
    ctx.lineWidth = 1;
    for (let i = -h; i < w + h; i += 12) {
      ctx.beginPath(); ctx.moveTo(gx + i, y); ctx.lineTo(gx + i + h, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx + i, y + h); ctx.lineTo(gx + i + h, y); ctx.stroke();
    }
    // goal light
    const lg = ctx.createRadialGradient(gx + w / 2, y + h - 50, 10, gx + w / 2, y + h - 50, 150);
    lg.addColorStop(0, `rgba(${col}, 0.4)`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(gx, y, w, h);
    ctx.restore();
  }

  function drawGoalMouth(x, team, dir) {
    const y = FIELD.goalTop;
    const col = team === 'blue' ? '#38d9ff' : '#ff8a3c';
    const colRgb = team === 'blue' ? '56, 217, 255' : '255, 138, 60';

    // glow around the mouth
    const gg = ctx.createLinearGradient(x, y, x + dir * 120, y + 120);
    gg.addColorStop(0, `rgba(${colRgb}, 0.26)`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(x, y, dir * 120, 190);

    // post / crossbar
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 22;
    ctx.fillStyle = col;
    roundRect(x - (dir > 0 ? 0 : 11), y - 8, 11, 20, 5);
    ctx.fill();
    ctx.restore();

    // vertical post line
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x, FIELD.bottom); ctx.stroke();
    ctx.strokeStyle = `rgba(${colRgb}, 0.25)`;
    ctx.lineWidth = 18;
    ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x, FIELD.bottom); ctx.stroke();
  }

  function drawPads() {
    const t = game.elapsed;
    for (const p of pads) {
      const bob = Math.sin(t * 2.2 + p.phase) * 5;
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      if (!p.active) {
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#ffcf8a';
        ctx.lineWidth = 2;
        hexRing(0, 0, 16);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }
      const pulse = 0.6 + Math.sin(t * 4 + p.phase) * 0.25;
      ctx.globalAlpha = 0.34 * pulse;
      const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 50);
      gl.addColorStop(0, '#ffd98a');
      gl.addColorStop(1, 'rgba(255, 180, 60, 0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      ctx.rotate(t * 1.1 + p.phase);
      ctx.strokeStyle = '#ffd88a';
      ctx.lineWidth = 2.4;
      ctx.shadowColor = '#ffb347';
      ctx.shadowBlur = 16;
      hexRing(0, 0, 15);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffe9b8';
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function hexRing(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function drawBallTrail() {
    for (const t of ball.trail) {
      const a = (t.life / t.max) * 0.5;
      const r = BALL_R * (0.35 + (t.life / t.max) * 0.65);
      const col = ball.lastHitBy === 'orange' ? '255, 150, 80' : ball.lastHitBy === 'blue' ? '90, 220, 255' : '200, 230, 255';
      ctx.fillStyle = `rgba(${col}, ${a * 0.5})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawBall() {
    const b = ball;
    // floor shadow
    const hAbove = clamp((GROUND - b.y) / 420, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 - hAbove * 0.65);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(b.x, GROUND + 2, b.r * (1 - hAbove * 0.3), 9 * (1 - hAbove * 0.4), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // glow
    const hot = b.hot;
    const glowCol = b.lastHitBy === 'blue' ? '90, 220, 255' : b.lastHitBy === 'orange' ? '255, 150, 80' : '180, 225, 255';
    const gl = ctx.createRadialGradient(b.x, b.y, b.r * 0.4, b.x, b.y, b.r * 3);
    gl.addColorStop(0, `rgba(${glowCol}, ${0.35 + hot * 0.3})`);
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3, 0, Math.PI * 2); ctx.fill();

    // body
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    const bg = ctx.createRadialGradient(-b.r * 0.35, -b.r * 0.4, 2, 0, 0, b.r * 1.15);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.55, '#dbe7ff');
    bg.addColorStop(0.85, '#8ea8d6');
    bg.addColorStop(1, '#5a6f9c');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();

    // panels
    ctx.strokeStyle = 'rgba(40, 60, 100, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.62, 0.4, 2.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.9, 3.3, 5.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-b.r * 0.15, -b.r); ctx.lineTo(-b.r * 0.15, -b.r * 0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.r * 0.55, b.r * 0.2); ctx.lineTo(b.r * 0.15, b.r * 0.5); ctx.stroke();

    // top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.ellipse(-b.r * 0.28, -b.r * 0.42, b.r * 0.3, b.r * 0.19, -0.6, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = `rgba(${glowCol}, 0.9)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, b.r - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawCar(car) {
    const w = car.w, h = car.h;
    const isBlue = car.team === 'blue';
    const col = isBlue ? '#38d9ff' : '#ff8a3c';
    const colDeep = isBlue ? '#0f5bd6' : '#c4471a';
    const colRgb = isBlue ? '56, 217, 255' : '255, 138, 60';

    // shadow
    const hAbove = clamp((GROUND - car.y) / 400, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.32 * (1 - hAbove * 0.6);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(car.x, GROUND + 3, w * 0.5 * (1 - hAbove * 0.25), 8 * (1 - hAbove * 0.4), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // boost trail
    for (const t of car.trail) {
      const a = (t.life / t.max) * 0.55;
      ctx.fillStyle = isBlue ? `rgba(120, 230, 255, ${a})` : `rgba(255, 190, 110, ${a})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * (t.life / t.max), 0, Math.PI * 2); ctx.fill();
    }

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    // boost flame
    if (car.boosting) {
      const flick = 0.75 + Math.random() * 0.5;
      const rear = -car.dir * (w / 2);
      const g = ctx.createLinearGradient(rear, 0, rear - car.dir * 74 * flick, 0);
      g.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
      g.addColorStop(0.35, isBlue ? 'rgba(90, 220, 255, 0.85)' : 'rgba(255, 170, 70, 0.85)');
      g.addColorStop(1, 'rgba(120, 80, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(rear + car.dir * 4, -9);
      ctx.lineTo(rear - car.dir * 52 * flick, -2);
      ctx.lineTo(rear - car.dir * 70 * flick, 0);
      ctx.lineTo(rear - car.dir * 52 * flick, 2);
      ctx.lineTo(rear + car.dir * 4, 9);
      ctx.closePath();
      ctx.fill();
    }

    // underglow
    if (car.grounded) {
      ctx.globalAlpha = 0.5;
      const ug = ctx.createRadialGradient(0, h / 2, 2, 0, h / 2, 70);
      ug.addColorStop(0, `rgba(${colRgb}, 0.65)`);
      ug.addColorStop(1, `rgba(${colRgb}, 0)`);
      ctx.fillStyle = ug;
      ctx.beginPath(); ctx.ellipse(0, h / 2 + 4, 70, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // wheels
    const wheelY = h / 2 - 3;
    for (const wx of [-w * 0.28, w * 0.28]) {
      ctx.fillStyle = '#0a0e1c';
      ctx.beginPath(); ctx.arc(wx, wheelY, 12, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(wx, wheelY);
      ctx.rotate(car.wheel);
      ctx.strokeStyle = `rgba(${colRgb}, 0.85)`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 3) * i * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.stroke();
      }
      ctx.fillStyle = '#2b3c5c';
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // chassis
    const bodyGrad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    bodyGrad.addColorStop(0, isBlue ? '#7ceaff' : '#ffc08a');
    bodyGrad.addColorStop(0.32, col);
    bodyGrad.addColorStop(0.62, colDeep);
    bodyGrad.addColorStop(1, isBlue ? '#082a66' : '#4c1508');
    ctx.fillStyle = bodyGrad;
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    roundRect(-w / 2, -h / 2, w, h, 14);
    ctx.fill();
    ctx.shadowBlur = 0;

    // body outline
    ctx.strokeStyle = `rgba(255, 255, 255, 0.65)`;
    ctx.lineWidth = 1.6;
    roundRect(-w / 2, -h / 2, w, h, 14);
    ctx.stroke();

    // top rim light
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h / 2 + 2.4);
    ctx.lineTo(w * 0.26, -h / 2 + 2.4);
    ctx.stroke();

    // cockpit
    const cockpitX = car.dir > 0 ? -w * 0.06 : w * 0.06;
    ctx.fillStyle = 'rgba(8, 20, 40, 0.82)';
    ctx.beginPath();
    ctx.moveTo(cockpitX - 20, -h / 2 + 5);
    ctx.lineTo(cockpitX + 16, -h / 2 + 5);
    ctx.lineTo(cockpitX + 9, -h / 2 + 16);
    ctx.lineTo(cockpitX - 15, -h / 2 + 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(${colRgb}, 0.35)`;
    ctx.beginPath();
    ctx.moveTo(cockpitX - 17, -h / 2 + 6);
    ctx.lineTo(cockpitX + 9, -h / 2 + 6);
    ctx.lineTo(cockpitX + 5, -h / 2 + 12);
    ctx.lineTo(cockpitX - 13, -h / 2 + 12);
    ctx.closePath();
    ctx.fill();

    // racing stripe
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(-w * 0.34, -2, w * 0.68, 3);

    // headlight
    const noseX = car.dir * (w / 2 - 4);
    ctx.fillStyle = '#fff7d6';
    ctx.shadowColor = '#fff2b0';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.ellipse(noseX, -h * 0.06, 4.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // tail light
    ctx.fillStyle = '#ff5a4a';
    ctx.shadowColor = '#ff4030';
    ctx.shadowBlur = 10;
    ctx.fillRect(-car.dir * (w / 2 - 3) - 2, -4, 3, 8);
    ctx.shadowBlur = 0;

    // team decal
    ctx.fillStyle = 'rgba(6, 12, 28, 0.5)';
    ctx.font = '700 13px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isBlue ? '07' : '11', car.dir * 14, 8);

    ctx.restore();

    // grounded dust glow
    if (car.grounded && Math.abs(car.vx) > 400 && Math.random() < 0.4) {
      particles.push({
        x: car.x - Math.sign(car.vx) * 46, y: GROUND - 4, vx: -Math.sign(car.vx) * rand(40, 160), vy: rand(-70, -10),
        life: 0.4, max: 0.4, size: rand(2, 5), color: isBlue ? 'rgba(120,220,255,0.5)' : 'rgba(255,180,100,0.5)',
        grav: -20, drag: 2, type: 'smoke',
      });
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = p.type === 'smoke' ? a * 0.4 : a;
      ctx.fillStyle = p.color;
      if (p.type === 'spark') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 0.5);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.type === 'smoke' ? (1.6 - a * 0.6) : a), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const r of rings) {
      const a = clamp(r.life / 0.9, 0, 1);
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 + (1 - a) * 4;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawAnnounce() {
    const a = game.announce;
    if (!a) return;
    const p = 1 - a.life / a.max;
    const pop = p < 0.18 ? lerp(0.6, 1.12, p / 0.18) : p < 0.3 ? lerp(1.12, 1, (p - 0.18) / 0.12) : 1;
    const fade = a.life < 0.25 ? a.life / 0.25 : 1;
    ctx.save();
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.globalAlpha = fade;
    ctx.translate(cam.cw / 2, cam.ch * 0.36);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const size = Math.min(cam.cw * 0.13, 120);
    ctx.font = `700 ${size}px "Chakra Petch", system-ui, sans-serif`;
    ctx.strokeStyle = 'rgba(4, 8, 20, 0.8)';
    ctx.lineWidth = size * 0.14;
    ctx.strokeText(a.text, 0, 0);
    const g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, a.color);
    g.addColorStop(1, a.color);
    ctx.fillStyle = g;
    ctx.shadowColor = a.color;
    ctx.shadowBlur = 42;
    ctx.fillText(a.text, 0, 0);
    ctx.shadowBlur = 0;
    if (a.sub) {
      ctx.font = `700 ${Math.max(11, size * 0.17)}px "Space Grotesk", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(230, 242, 255, 0.85)';
      ctx.fillText(a.sub, 0, size * 0.52);
    }
    ctx.restore();
  }

  function drawVignette(x0, y0, w, h) {
    const g = ctx.createRadialGradient(640, 380, 260, 640, 380, 780);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0, 2, 10, 0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, h);

    // subtle top/bottom gradients
    const top = ctx.createLinearGradient(0, 0, 0, 150);
    top.addColorStop(0, 'rgba(4, 7, 20, 0.55)');
    top.addColorStop(1, 'rgba(4, 7, 20, 0)');
    ctx.fillStyle = top;
    ctx.fillRect(x0, y0, w, 150);
  }

  /* ------------------------------------------------------------------ */
  /*  Main loop                                                         */
  /* ------------------------------------------------------------------ */
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;

    if (game.state !== 'paused' && game.state !== 'menu' && game.state !== 'over') {
      accumulator += dt;
      let guard = 0;
      while (accumulator >= STEP && guard++ < 8) {
        update(STEP);
        accumulator -= STEP;
      }
    } else {
      // keep visual effects alive even when freeze-framed
      game.elapsed += dt;
      updateParticles(dt);
      cam.shake = Math.max(0, cam.shake - dt * 34);
      if (game.announce) {
        game.announce.life -= dt;
        if (game.announce.life <= 0) game.announce = null;
      }
    }

    pollGamepad();
    draw();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /*  Wiring                                                            */
  /* ------------------------------------------------------------------ */
  $('playBtn').addEventListener('click', startMatch);
  $('rematchBtn').addEventListener('click', startMatch);
  $('resumeBtn').addEventListener('click', () => togglePause(false));
  $('quitBtn').addEventListener('click', quitToMenu);
  $('pauseBtn').addEventListener('click', () => togglePause());
  $('soundBtn').addEventListener('click', toggleSound);

  function toggleSound() {
    audio.on = !audio.on;
    if (audio.on) { audio.resume(); audio.tone(660, 0.09, 'sine', 0.12); }
    else audio.silenceEngine();
    $('soundIcon').textContent = audio.on ? '♪' : '✕';
    $('soundBtn').classList.toggle('active', !audio.on);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') togglePause(true);
  });

  window.addEventListener('resize', () => { resize(); buildHexPattern(); });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => { if (e.target === canvas) e.preventDefault(); });

  // prevent page scroll on mobile while playing
  document.addEventListener('touchmove', (e) => { if (e.target.closest('.stage')) e.preventDefault(); }, { passive: false });

  buildCrowd();
  resize();
  buildHexPattern();
  kickoff();
  updateScoreHud();
  update();
  requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });
})();
