/**
 * BrainSweep — Cognitive Number Extraction Game
 * Visual Scanning, Peripheral Tracking & Saccadic Speed Trainer
 */

(() => {
  // --- Configuration Constants ---
  const DIFFICULTIES = {
    easy: {
      id: 'easy',
      label: 'Easy',
      maxNumber: 14,
      totalNumbers: 20,
      durationSec: 60,
      baseSpeed: 42,
      maxRadius: 23,
    },
    medium: {
      id: 'medium',
      label: 'Medium',
      maxNumber: 32,
      totalNumbers: 40,
      durationSec: 60,
      baseSpeed: 48,
      maxRadius: 19,
    },
    hard: {
      id: 'hard',
      label: 'Hard',
      maxNumber: 72,
      totalNumbers: 80,
      durationSec: 60,
      baseSpeed: 54,
      maxRadius: 15,
    },
  };

  // --- Synthesized Web Audio Engine ---
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playGrab() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(480, this.ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.065);
    }

    playExtract(stepIndex, totalSteps) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const progress = Math.min(1, stepIndex / Math.max(1, totalSteps));
      const baseFreq = 380 + progress * 600;

      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc2.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + 0.14);

      osc2.frequency.setValueAtTime(baseFreq * 1.5, now);
      osc2.frequency.exponentialRampToValueAtTime(baseFreq * 2, now + 0.14);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc2.start(now);
      osc.stop(now + 0.16);
      osc2.stop(now + 0.16);
    }

    playError() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.16);

      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    }

    playVictory() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const now = this.ctx.currentTime + idx * 0.09;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      });
    }
  }

  // --- DOM Elements ---
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const arenaContainer = document.getElementById('arenaContainer');
  const extractionFrame = document.getElementById('extractionFrame');
  const arenaFeedback = document.getElementById('arenaFeedback');

  const hudNextTarget = document.getElementById('hudNextTarget');
  const hudTotalTarget = document.getElementById('hudTotalTarget');
  const hudTimer = document.getElementById('hudTimer');
  const timerProgressBar = document.getElementById('timerProgressBar');
  const hudExtracted = document.getElementById('hudExtracted');
  const hudStreakBadge = document.getElementById('hudStreakBadge');
  const hudPace = document.getElementById('hudPace');

  const extractedSlots = document.getElementById('extractedSlots');
  const trayStatusText = document.getElementById('trayStatusText');

  const setupModal = document.getElementById('setupModal');
  const resultsModal = document.getElementById('resultsModal');
  const difficultyGrid = document.getElementById('difficultyGrid');
  const patternGrid = document.getElementById('patternGrid');
  const chkQuickFlick = document.getElementById('chkQuickFlick');
  const chkMemoryMode = document.getElementById('chkMemoryMode');

  const btnStartGame = document.getElementById('btnStartGame');
  const btnPlayAgain = document.getElementById('btnPlayAgain');
  const btnChangeConfig = document.getElementById('btnChangeConfig');
  const btnHint = document.getElementById('btnHint');
  const btnSound = document.getElementById('btnSound');
  const btnMenu = document.getElementById('btnMenu');
  const btnReset = document.getElementById('btnReset');

  // --- Game State ---
  const sound = new SoundEngine();

  const state = {
    status: 'menu', // 'menu' | 'playing' | 'ended'
    difficulty: 'easy',
    pattern: 'spiral',
    quickFlick: true,
    memoryMode: false,

    maxNumber: 14,
    nextTarget: 1,
    timeRemaining: 60.0,
    totalDuration: 60.0,
    lastFrameTime: 0,
    lastExtractTimestamp: 0,

    streak: 0,
    mistakes: 0,
    hintsUsed: 0,
    hintPulseTimer: 0,

    splits: [],
    nodes: [],
    particles: [],
    floatingTexts: [],

    // Pointer / Dragging state
    draggingNode: null,
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
    dragStartX: 0,
    dragStartY: 0,
    dragVelX: 0,
    dragVelY: 0,
  };

  // --- High Scores in LocalStorage ---
  function loadHighScores() {
    try {
      const raw = localStorage.getItem('neurosweep_best_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveHighScore(diff, extractedCount, maxCount, timeTaken) {
    try {
      const scores = loadHighScores();
      const prev = scores[diff];
      const isBetter =
        !prev ||
        extractedCount > prev.extracted ||
        (extractedCount === prev.extracted && timeTaken < prev.time);

      if (isBetter) {
        scores[diff] = { extracted: extractedCount, max: maxCount, time: timeTaken };
        localStorage.setItem('neurosweep_best_v1', JSON.stringify(scores));
      }
      updateHighScoreBadges();
    } catch {
      // ignore storage errors
    }
  }

  function updateHighScoreBadges() {
    const scores = loadHighScores();
    ['easy', 'medium', 'hard'].forEach((diff) => {
      const el = document.getElementById(`best${diff.charAt(0).toUpperCase() + diff.slice(1)}`);
      if (!el) return;
      const rec = scores[diff];
      if (!rec) {
        el.textContent = 'Best: —';
      } else if (rec.extracted >= rec.max) {
        el.textContent = `Best: Cleared in ${rec.time.toFixed(1)}s`;
      } else {
        el.textContent = `Best: ${rec.extracted} / ${rec.max} extracted`;
      }
    });
  }

  // --- Resize & Canvas DPR Setup ---
  let canvasWidth = 800;
  let canvasHeight = 500;

  function computeOptimalRadius(count, maxAllowed) {
    // Ensure circles never occupy more than ~16% of total arena area so there is always open space
    const usableArea = Math.max(40000, (canvasWidth - 28) * (canvasHeight - 28));
    const idealRadius = Math.sqrt((usableArea * 0.16) / (count * Math.PI));
    return Math.max(10, Math.min(maxAllowed, Math.floor(idealRadius)));
  }

  function resizeCanvas() {
    const rect = arenaContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const prevW = canvasWidth;
    const prevH = canvasHeight;

    canvasWidth = Math.max(260, rect.width);
    canvasHeight = Math.max(200, rect.height);

    canvas.width = Math.floor(canvasWidth * dpr);
    canvas.height = Math.floor(canvasHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Rescale existing node positions & radii proportionally if resized mid-game
    if (state.nodes.length > 0 && prevW > 0 && prevH > 0) {
      const cfg = DIFFICULTIES[state.difficulty];
      const newRadius = computeOptimalRadius(cfg.totalNumbers, cfg.maxRadius);
      const scaleX = canvasWidth / prevW;
      const scaleY = canvasHeight / prevH;
      for (const n of state.nodes) {
        n.x *= scaleX;
        n.y *= scaleY;
        n.radius = newRadius;
      }
    }
  }

  window.addEventListener('resize', resizeCanvas);

  // --- Node Generation & Smooth Velocity Trajectories ---
  function createNodes() {
    const cfg = DIFFICULTIES[state.difficulty];
    const count = cfg.totalNumbers;
    const nodes = [];

    const radius = computeOptimalRadius(count, cfg.maxRadius);
    const pad = radius + 14;
    const usableW = Math.max(100, canvasWidth - pad * 2);
    const usableH = Math.max(100, canvasHeight - pad * 2);

    // Distribute initial positions on a shuffled stratified grid across the ENTIRE arena
    const aspect = usableW / usableH;
    const cols = Math.max(3, Math.ceil(Math.sqrt(count * aspect)));
    const rows = Math.max(3, Math.ceil(count / cols));
    const cellW = usableW / cols;
    const cellH = usableH / rows;

    const slots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        slots.push({ r, c });
      }
    }
    // Shuffle grid slots so numbers 1..N are scattered evenly across the whole rectangle
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }

    const patternsPool = ['spiral', 'zigzag', 'random', 'wave'];

    for (let i = 1; i <= count; i++) {
      const assignedPattern =
        state.pattern === 'mixed' ? patternsPool[(i - 1) % patternsPool.length] : state.pattern;

      const slot = slots[(i - 1) % slots.length];
      const jitterX = (Math.random() - 0.5) * cellW * 0.45;
      const jitterY = (Math.random() - 0.5) * cellH * 0.45;
      const x = Math.min(canvasWidth - pad, Math.max(pad, pad + (slot.c + 0.5) * cellW + jitterX));
      const y = Math.min(canvasHeight - pad, Math.max(pad, pad + (slot.r + 0.5) * cellH + jitterY));

      const angle = (i * 2.399963) + (Math.random() - 0.5) * 0.5;
      const speed = cfg.baseSpeed * (0.88 + (i % 5) * 0.06);

      nodes.push({
        value: i,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius,
        speed,
        pattern: assignedPattern,

        // Spiral parameters: each node has its own preferred elliptical ring (0.24..0.94) covering the full arena
        preferredRing: 0.22 + ((i - 1) / Math.max(1, count - 1)) * 0.74,
        orbitDir: 1, // uniform clockwise flow prevents head-on traffic jams

        // Zig-Zag parameters
        zigTimer: (i * 0.19) % 1.4,
        zigPeriod: 1.1 + (i % 4) * 0.25,
        zigDirX: i % 2 === 0 ? 1 : -1,
        zigDirY: i % 3 === 0 ? 1 : -1,

        // Wave parameters
        wavePhase: i * 0.65,
        waveFreq: 1.5 + (i % 3) * 0.35,
        waveDirX: i % 2 === 0 ? 1 : -1,

        // Smooth wander phase for random mode (no per-frame jitter)
        wanderPhase: i * 1.1,
        wanderRate: (i % 2 === 0 ? 1 : -1) * (0.4 + (i % 4) * 0.12),

        trail: [],
        errorFlash: 0,
        extracted: false,
      });
    }

    // Run static relaxation passes before starting so zero circles overlap on frame 1
    const minSepPad = 6;
    for (let pass = 0; pass < 20; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDist = a.radius + b.radius + minSepPad;
          const distSq = dx * dx + dy * dy;
          if (distSq > 0.0001 && distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            const push = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;
            a.x = Math.min(canvasWidth - pad, Math.max(pad, a.x - nx * push));
            a.y = Math.min(canvasHeight - pad, Math.max(pad, a.y - ny * push));
            b.x = Math.min(canvasWidth - pad, Math.max(pad, b.x + nx * push));
            b.y = Math.min(canvasHeight - pad, Math.max(pad, b.y + ny * push));
          }
        }
      }
    }

    state.nodes = nodes;
  }

  function updateNodes(dt) {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const halfW = Math.max(80, canvasWidth * 0.46);
    const halfH = Math.max(80, canvasHeight * 0.46);

    // 1. Compute desired velocity per node based on its trajectory pattern
    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      if (n.extracted) continue;

      if (n.errorFlash > 0) {
        n.errorFlash = Math.max(0, n.errorFlash - dt * 3);
      }

      if (state.draggingNode === n) {
        continue;
      }

      const pat = n.pattern;
      let desiredVx = n.vx;
      let desiredVy = n.vy;

      if (pat === 'spiral') {
        // Smooth elliptical orbit velocity covering the entire rectangular arena
        const normX = (n.x - cx) / halfW;
        const normY = (n.y - cy) / halfH;
        const currentR = Math.max(0.08, Math.hypot(normX, normY));

        // Unit tangent vector in normalized ellipse space, mapped back to screen space
        const tanNormX = (-normY / currentR) * n.orbitDir;
        const tanNormY = (normX / currentR) * n.orbitDir;

        // Gentle radial spring toward this node's assigned ring so nodes stay spread from center to edge
        const radialErr = n.preferredRing - currentR;
        const radNormX = (normX / currentR) * radialErr * 0.45;
        const radNormY = (normY / currentR) * radialErr * 0.45;

        const rawVx = (tanNormX + radNormX) * halfW;
        const rawVy = (tanNormY + radNormY) * halfH;
        const rawLen = Math.max(0.001, Math.hypot(rawVx, rawVy));

        desiredVx = (rawVx / rawLen) * n.speed;
        desiredVy = (rawVy / rawLen) * n.speed;
      } else if (pat === 'zigzag') {
        n.zigTimer += dt;
        if (n.zigTimer >= n.zigPeriod) {
          n.zigTimer = 0;
          n.zigDirY *= -1;
        }
        desiredVx = n.zigDirX * n.speed * 0.82;
        desiredVy = n.zigDirY * n.speed * 0.82;
      } else if (pat === 'wave') {
        n.wavePhase += n.waveFreq * dt;
        desiredVx = n.waveDirX * n.speed * 0.88;
        desiredVy = Math.cos(n.wavePhase) * n.speed * 0.72;
      } else {
        // Smooth continuous curve (no random per-frame jitter)
        n.wanderPhase += n.wanderRate * dt;
        const curAngle = Math.atan2(n.vy, n.vx) + Math.sin(n.wanderPhase) * 0.65 * dt;
        desiredVx = Math.cos(curAngle) * n.speed;
        desiredVy = Math.sin(curAngle) * n.speed;
      }

      // Smoothly blend velocity toward desired trajectory
      const blend = Math.min(1, dt * 6);
      n.vx += (desiredVx - n.vx) * blend;
      n.vy += (desiredVy - n.vy) * blend;
    }

    // 2. Smooth velocity-based soft separation (prevents clumping WITHOUT position jitter)
    for (let i = 0; i < state.nodes.length; i++) {
      const a = state.nodes[i];
      if (a.extracted || state.draggingNode === a) continue;

      for (let j = i + 1; j < state.nodes.length; j++) {
        const b = state.nodes[j];
        if (b.extracted || state.draggingNode === b) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const comfortDist = a.radius + b.radius + 10;
        const distSq = dx * dx + dy * dy;

        if (distSq > 0.001 && distSq < comfortDist * comfortDist) {
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const ny = dy / dist;

          // Gentle velocity steering away from each other
          const overlapRatio = (comfortDist - dist) / comfortDist;
          const pushImpulse = overlapRatio * 150 * dt;
          a.vx -= nx * pushImpulse;
          a.vy -= ny * pushImpulse;
          b.vx += nx * pushImpulse;
          b.vy += ny * pushImpulse;

          // Only if physically overlapping, apply a tiny damped position correction
          const hardMin = a.radius + b.radius + 2;
          if (dist < hardMin) {
            const corr = (hardMin - dist) * 0.22;
            a.x -= nx * corr;
            a.y -= ny * corr;
            b.x += nx * corr;
            b.y += ny * corr;
          }
        }
      }
    }

    // 3. Integrate positions & keep smoothly inside arena bounds
    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      if (n.extracted || state.draggingNode === n) continue;

      // Clamp maximum velocity so repulsion never causes sudden darts
      const spd = Math.hypot(n.vx, n.vy);
      const maxSpd = n.speed * 1.35;
      if (spd > maxSpd) {
        n.vx = (n.vx / spd) * maxSpd;
        n.vy = (n.vy / spd) * maxSpd;
      }

      n.x += n.vx * dt;
      n.y += n.vy * dt;

      const pad = n.radius + 14;
      const minX = pad;
      const maxX = canvasWidth - pad;
      const minY = pad;
      const maxY = canvasHeight - pad;

      if (n.x < minX) {
        n.x = minX;
        n.vx = Math.abs(n.vx);
        n.zigDirX = 1;
        n.waveDirX = 1;
      } else if (n.x > maxX) {
        n.x = maxX;
        n.vx = -Math.abs(n.vx);
        n.zigDirX = -1;
        n.waveDirX = -1;
      }

      if (n.y < minY) {
        n.y = minY;
        n.vy = Math.abs(n.vy);
        n.zigDirY = 1;
      } else if (n.y > maxY) {
        n.y = maxY;
        n.vy = -Math.abs(n.vy);
        n.zigDirY = -1;
      }
    }
  }

  // --- Particle & Floating Text Effects ---
  function spawnExtractParticles(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 2.5,
        alpha: 1,
        color,
      });
    }
  }

  function spawnFloatingText(x, y, text, color) {
    state.floatingTexts.push({
      x: Math.min(canvasWidth - 65, Math.max(65, x)),
      y: Math.min(canvasHeight - 30, Math.max(30, y)),
      text,
      color,
      alpha: 1,
      vy: -42,
    });
  }

  function updateEffects(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 2.3;
      if (p.alpha <= 0) state.particles.splice(i, 1);
    }

    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
      const ft = state.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.alpha -= dt * 1.5;
      if (ft.alpha <= 0) state.floatingTexts.splice(i, 1);
    }

    if (state.hintPulseTimer > 0) {
      state.hintPulseTimer = Math.max(0, state.hintPulseTimer - dt);
    }
  }

  // --- Extraction Logic ---
  function isOutsideExtractionBoundary(x, y, radius) {
    const borderZone = Math.max(22, radius * 1.25);
    return (
      x <= borderZone ||
      x >= canvasWidth - borderZone ||
      y <= borderZone ||
      y >= canvasHeight - borderZone
    );
  }

  function completeNodeExtraction(node) {
    if (node.extracted) return;
    node.extracted = true;
    node.trail = [];
    state.draggingNode = null;
    extractionFrame.classList.remove('dragging-active');

    extractionFrame.classList.add('extraction-flash');
    setTimeout(() => extractionFrame.classList.remove('extraction-flash'), 180);

    const nowSec = performance.now() / 1000;
    const splitSec = Math.max(0.05, nowSec - state.lastExtractTimestamp);
    state.splits.push({ number: node.value, split: splitSec });
    state.lastExtractTimestamp = nowSec;

    state.streak += 1;
    sound.playExtract(node.value, state.maxNumber);
    spawnExtractParticles(node.x, node.y, '#fc6200');
    spawnFloatingText(node.x, node.y, `#${node.value} OK`, '#ffa347');

    const badge = document.createElement('span');
    badge.className = 'extracted-badge';
    badge.textContent = node.value;
    extractedSlots.appendChild(badge);
    extractedSlots.scrollLeft = extractedSlots.scrollWidth;

    if (node.value >= state.maxNumber) {
      updateHUD();
      finishGame(true);
    } else {
      state.nextTarget = node.value + 1;
      trayStatusText.textContent = state.memoryMode
        ? `Extracted #${node.value}! Keep going in ascending order...`
        : `Extracted #${node.value}! Now scan and drag out #${state.nextTarget}`;
      updateHUD();
    }
  }

  // --- Pointer / Touch Interaction ---
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function findNodeAt(x, y) {
    let bestCandidate = null;
    let bestDist = Infinity;

    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const n = state.nodes[i];
      if (n.extracted) continue;
      const dx = x - n.x;
      const dy = y - n.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = n.radius + 9;

      if (dist <= hitRadius) {
        if (n.value === state.nextTarget) {
          return n;
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestCandidate = n;
        }
      }
    }
    return bestCandidate;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.status !== 'playing') return;
    e.preventDefault();
    const pos = getCanvasCoords(e);
    const hitNode = findNodeAt(pos.x, pos.y);

    if (!hitNode) return;

    if (hitNode.value === state.nextTarget) {
      state.draggingNode = hitNode;
      state.pointerId = e.pointerId;
      state.pointerX = pos.x;
      state.pointerY = pos.y;
      state.dragStartX = pos.x;
      state.dragStartY = pos.y;
      state.dragVelX = 0;
      state.dragVelY = 0;

      hitNode.x = pos.x;
      hitNode.y = pos.y;
      hitNode.trail = [{ x: pos.x, y: pos.y }];

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore if unsupported
      }

      sound.playGrab();
      extractionFrame.classList.add('dragging-active');
    } else {
      state.mistakes += 1;
      state.streak = 0;
      hitNode.errorFlash = 1.0;
      sound.playError();

      extractionFrame.classList.add('error-flash');
      setTimeout(() => extractionFrame.classList.remove('error-flash'), 220);

      const msg = state.memoryMode
        ? `Wrong sequence! Not #${hitNode.value}`
        : `Find #${state.nextTarget} first!`;
      showArenaToast(msg, '#3b0712');
      spawnFloatingText(hitNode.x, hitNode.y, `Need #${state.nextTarget}`, '#ff4d6d');
      updateHUD();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (state.status !== 'playing' || !state.draggingNode) return;
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;

    const pos = getCanvasCoords(e);
    state.dragVelX = pos.x - state.pointerX;
    state.dragVelY = pos.y - state.pointerY;
    state.pointerX = pos.x;
    state.pointerY = pos.y;

    const node = state.draggingNode;
    node.x = pos.x;
    node.y = pos.y;
    node.trail.push({ x: pos.x, y: pos.y });
    if (node.trail.length > 8) node.trail.shift();

    const dragDist = Math.hypot(pos.x - state.dragStartX, pos.y - state.dragStartY);

    if (dragDist >= 16 && isOutsideExtractionBoundary(node.x, node.y, node.radius)) {
      completeNodeExtraction(node);
    }
  });

  function handlePointerRelease(e) {
    if (!state.draggingNode) return;
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;

    const node = state.draggingNode;
    const pos = getCanvasCoords(e);
    const dragDist = Math.hypot(pos.x - state.dragStartX, pos.y - state.dragStartY);
    const flickSpeed = Math.hypot(state.dragVelX, state.dragVelY);

    if (
      isOutsideExtractionBoundary(node.x, node.y, node.radius) ||
      (state.quickFlick && (dragDist >= 52 || (dragDist >= 24 && flickSpeed >= 8)))
    ) {
      completeNodeExtraction(node);
    } else {
      node.trail = [];
      state.draggingNode = null;
      extractionFrame.classList.remove('dragging-active');
      showArenaToast('Drag across the border or flick outward!', '#1c0a00');
    }
    state.pointerId = null;
  }

  canvas.addEventListener('pointerup', handlePointerRelease);
  canvas.addEventListener('pointercancel', handlePointerRelease);

  // --- Toast Helper ---
  let toastTimeout = null;
  function showArenaToast(text, bgColor = '#1c0a00') {
    arenaFeedback.textContent = text;
    arenaFeedback.style.background = bgColor;
    arenaFeedback.style.color = '#fc6200';
    arenaFeedback.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      arenaFeedback.classList.remove('show');
    }, 1300);
  }

  // --- Clean, Eye-Friendly Rendering ---
  function drawBackgroundGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(252, 98, 0, 0.05)';
    ctx.lineWidth = 1;

    const step = 56;
    for (let x = step; x < canvasWidth; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
    for (let y = step; y < canvasHeight; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    // Extraction perimeter inner threshold line
    const borderZone = 20;
    ctx.strokeStyle = state.draggingNode
      ? 'rgba(252, 98, 0, 0.85)'
      : 'rgba(252, 98, 0, 0.24)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = state.draggingNode ? 2 : 1;
    ctx.strokeRect(
      borderZone,
      borderZone,
      canvasWidth - borderZone * 2,
      canvasHeight - borderZone * 2
    );
    ctx.restore();
  }

  function nearestEdgePoint(x, y) {
    const distLeft = x;
    const distRight = canvasWidth - x;
    const distTop = y;
    const distBottom = canvasHeight - y;
    const min = Math.min(distLeft, distRight, distTop, distBottom);

    if (min === distLeft) return { x: 4, y };
    if (min === distRight) return { x: canvasWidth - 4, y };
    if (min === distTop) return { x, y: 4 };
    return { x, y: canvasHeight - 4 };
  }

  function render() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    drawBackgroundGrid();

    // If dragging the target node, draw a helpful tether to nearest extraction border
    if (state.draggingNode) {
      const dn = state.draggingNode;
      const edgePt = nearestEdgePoint(dn.x, dn.y);

      ctx.save();
      if (dn.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(dn.trail[0].x, dn.trail[0].y);
        for (let t = 1; t < dn.trail.length; t++) {
          ctx.lineTo(dn.trail[t].x, dn.trail[t].y);
        }
        ctx.strokeStyle = 'rgba(255, 163, 71, 0.65)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(252, 98, 0, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(dn.x, dn.y);
      ctx.lineTo(edgePt.x, edgePt.y);
      ctx.stroke();

      if (state.quickFlick) {
        const dragDist = Math.hypot(dn.x - state.dragStartX, dn.y - state.dragStartY);
        const progress = Math.min(1, dragDist / 52);
        ctx.setLineDash([]);
        ctx.strokeStyle =
          progress >= 1 ? '#ffa347' : 'rgba(252, 98, 0, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(state.dragStartX, state.dragStartY, 52, 0, Math.PI * 2 * progress);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw non-target nodes first, then target node on top so it's never hidden behind another circle
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < state.nodes.length; i++) {
        const n = state.nodes[i];
        if (n.extracted) continue;

        const isPriority = n === state.draggingNode || n.value === state.nextTarget;
        if ((pass === 0 && isPriority) || (pass === 1 && !isPriority)) continue;

        const isTarget = n.value === state.nextTarget;
        const isDragging = state.draggingNode === n;
        const isHinting = isTarget && state.hintPulseTimer > 0;

        // Hint sonar ring if user clicked Locate button
        if (isHinting) {
          const pulseRadius = n.radius + 7 + ((1.5 - state.hintPulseTimer) * 34) % 30;
          ctx.save();
          ctx.strokeStyle = '#ffc400';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Crisp Node Circle (no blurry glow or trailing artifacts)
        ctx.save();
        const r = isDragging ? n.radius * 1.2 : n.radius;

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

        if (n.errorFlash > 0) {
          ctx.fillStyle = '#4c0514';
          ctx.strokeStyle = '#ff4d6d';
          ctx.lineWidth = 2.2;
        } else if (isDragging) {
          ctx.fillStyle = '#fc6200';
          ctx.strokeStyle = '#ffa347';
          ctx.lineWidth = 2.5;
        } else if (isHinting) {
          ctx.fillStyle = '#fc6200';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
        } else {
          ctx.fillStyle = '#0b0400';
          ctx.strokeStyle = '#fc6200';
          ctx.lineWidth = 1.8;
        }

        ctx.fill();
        ctx.stroke();

        // Crisp Number Label
        ctx.fillStyle = isDragging || isHinting ? '#050200' : '#fc6200';
        const fontSize = Math.max(8, Math.round(r * 0.56));
        ctx.font = `${fontSize}px "Press Start 2P", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n.value), n.x, n.y + 1);

        ctx.restore();
      }
    }

    // Draw particles
    for (const p of state.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      ctx.restore();
    }

    // Draw floating feedback texts
    for (const ft of state.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillStyle = ft.color;
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  // --- HUD & Game Loop ---
  function updateHUD() {
    const extractedCount = state.nextTarget - 1;
    hudNextTarget.textContent = state.memoryMode ? '?' : String(state.nextTarget);
    hudTotalTarget.textContent = `/ ${state.maxNumber}`;
    hudExtracted.textContent = String(extractedCount);
    hudStreakBadge.textContent = `${state.streak}x`;

    if (extractedCount > 0) {
      const elapsed = state.totalDuration - state.timeRemaining;
      const avg = elapsed / extractedCount;
      hudPace.textContent = avg.toFixed(2);
    } else {
      hudPace.textContent = '—';
    }
  }

  function updateTimerDisplay() {
    const t = Math.max(0, state.timeRemaining);
    const mins = Math.floor(t / 60);
    const secs = (t % 60).toFixed(1).padStart(4, '0');
    hudTimer.textContent = `0${mins}:${secs}`;

    const pct = Math.max(0, Math.min(100, (t / state.totalDuration) * 100));
    timerProgressBar.style.width = `${pct}%`;

    if (t <= 10) {
      hudTimer.className = 'hud-value mono accent-rose';
      timerProgressBar.style.background = 'var(--accent-rose)';
    } else if (t <= 25) {
      hudTimer.className = 'hud-value mono accent-amber';
      timerProgressBar.style.background = 'var(--accent-amber)';
    } else {
      hudTimer.className = 'hud-value mono';
      timerProgressBar.style.background = 'var(--text-main)';
    }
  }

  function startGame() {
    const cfg = DIFFICULTIES[state.difficulty];
    state.status = 'playing';
    state.maxNumber = cfg.maxNumber;
    state.nextTarget = 1;
    state.totalDuration = cfg.durationSec;
    state.timeRemaining = cfg.durationSec;
    state.streak = 0;
    state.mistakes = 0;
    state.hintsUsed = 0;
    state.hintPulseTimer = 0;
    state.splits = [];
    state.particles = [];
    state.floatingTexts = [];
    state.draggingNode = null;
    state.quickFlick = chkQuickFlick.checked;
    state.memoryMode = chkMemoryMode.checked;

    extractedSlots.innerHTML = '';
    trayStatusText.textContent = 'Scan the field and drag #1 across the arena border!';

    setupModal.classList.remove('active');
    resultsModal.classList.remove('active');

    resizeCanvas();
    createNodes();
    updateHUD();
    updateTimerDisplay();

    const now = performance.now();
    state.lastFrameTime = now;
    state.lastExtractTimestamp = now / 1000;
  }

  function finishGame(completedAll) {
    state.status = 'ended';
    state.draggingNode = null;
    extractionFrame.classList.remove('dragging-active');

    const extractedCount = completedAll ? state.maxNumber : state.nextTarget - 1;
    const timeTaken = Math.min(
      state.totalDuration,
      Math.max(0.1, state.totalDuration - state.timeRemaining)
    );

    if (completedAll) {
      sound.playVictory();
    } else {
      sound.playError();
    }

    saveHighScore(state.difficulty, extractedCount, state.maxNumber, timeTaken);

    const resultBadge = document.getElementById('resultBadge');
    const resultHeadline = document.getElementById('resultHeadline');
    const resultSubheadline = document.getElementById('resultSubheadline');

    if (completedAll) {
      resultBadge.textContent = 'CHALLENGE CONQUERED';
      resultHeadline.textContent = `Cleared 1–${state.maxNumber} in ${timeTaken.toFixed(1)}s!`;
      resultSubheadline.textContent = `Outstanding peripheral scanning & motor extraction speed on ${DIFFICULTIES[state.difficulty].label} (${state.pattern.toUpperCase()}).`;
    } else {
      resultBadge.textContent = 'TIME EXPIRED (60.0s)';
      resultHeadline.textContent = `Extracted ${extractedCount} of ${state.maxNumber} Targets`;
      resultSubheadline.textContent = `You reached #${extractedCount} on ${DIFFICULTIES[state.difficulty].label} (${state.pattern.toUpperCase()}) mode. Keep training to clear all ${state.maxNumber}!`;
    }

    document.getElementById('resExtracted').textContent = `${extractedCount} / ${state.maxNumber}`;
    document.getElementById('resTime').textContent = `${timeTaken.toFixed(1)}s`;
    const avgSpeed = extractedCount > 0 ? `${(timeTaken / extractedCount).toFixed(2)}s / #` : '—';
    document.getElementById('resAvgSpeed').textContent = avgSpeed;

    const totalAttempts = extractedCount + state.mistakes;
    const accuracy =
      totalAttempts > 0 ? Math.round((extractedCount / totalAttempts) * 100) : 100;
    document.getElementById('resAccuracy').textContent = `${accuracy}%`;

    const completionRatio = extractedCount / state.maxNumber;
    let rank = 'C';
    if (completedAll && accuracy >= 95) rank = 'S+ Elite';
    else if (completedAll) rank = 'S';
    else if (completionRatio >= 0.8) rank = 'A';
    else if (completionRatio >= 0.55) rank = 'B';
    document.getElementById('resCognitiveRank').textContent = `Cognitive Rating: ${rank}`;

    const splitContainer = document.getElementById('splitBarsContainer');
    splitContainer.innerHTML = '';
    if (state.splits.length > 0) {
      const maxSplit = Math.max(...state.splits.map((s) => s.split), 1.5);
      state.splits.forEach((s) => {
        const bar = document.createElement('div');
        bar.className = 'split-bar';
        const heightPct = Math.max(10, Math.min(100, (s.split / maxSplit) * 100));
        bar.style.height = `${heightPct}%`;
        bar.setAttribute('data-tooltip', `#${s.number}: ${s.split.toFixed(2)}s`);
        splitContainer.appendChild(bar);
      });
    } else {
      splitContainer.innerHTML =
        '<span style="color: var(--text-muted); font-size: 0.78rem;">Extract numbers to record reaction splits.</span>';
    }

    resultsModal.classList.add('active');
  }

  function tick(now) {
    const dt = Math.min(0.033, Math.max(0.001, (now - state.lastFrameTime) / 1000));
    state.lastFrameTime = now;

    if (state.status === 'playing') {
      state.timeRemaining -= dt;
      if (state.timeRemaining <= 0) {
        state.timeRemaining = 0;
        updateTimerDisplay();
        finishGame(false);
      } else {
        updateTimerDisplay();
      }
    }

    updateNodes(dt);
    updateEffects(dt);
    render();

    requestAnimationFrame(tick);
  }

  // --- UI Event Listeners ---
  difficultyGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.diff-card');
    if (!card) return;
    difficultyGrid.querySelectorAll('.diff-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    state.difficulty = card.dataset.difficulty;
  });

  patternGrid.addEventListener('click', (e) => {
    const chip = e.target.closest('.pattern-chip');
    if (!chip) return;
    patternGrid.querySelectorAll('.pattern-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.pattern = chip.dataset.pattern;
  });

  btnStartGame.addEventListener('click', () => {
    sound.init();
    startGame();
  });

  btnPlayAgain.addEventListener('click', () => {
    startGame();
  });

  btnChangeConfig.addEventListener('click', () => {
    resultsModal.classList.remove('active');
    setupModal.classList.add('active');
  });

  btnMenu.addEventListener('click', () => {
    state.status = 'menu';
    state.draggingNode = null;
    extractionFrame.classList.remove('dragging-active');
    resultsModal.classList.remove('active');
    setupModal.classList.add('active');
  });

  btnReset.addEventListener('click', () => {
    sound.init();
    startGame();
    showArenaToast('Round Reset!', '#1c0a00');
  });

  btnHint.addEventListener('click', () => {
    if (state.status !== 'playing') return;
    state.hintsUsed += 1;
    state.hintPulseTimer = 1.5;
    showArenaToast(`Locating #${state.nextTarget}...`, '#1c0a00');
  });

  btnSound.addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    btnSound.style.opacity = sound.enabled ? '1' : '0.45';
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      btnHint.click();
    } else if (e.key === 'm' || e.key === 'M') {
      btnSound.click();
    } else if (e.key === 'r' || e.key === 'R') {
      btnReset.click();
    } else if (e.key === 'Escape') {
      btnMenu.click();
    }
  });

  // --- Initial Boot ---
  updateHighScoreBadges();
  resizeCanvas();
  createNodes();
  state.lastFrameTime = performance.now();
  requestAnimationFrame(tick);
})();
