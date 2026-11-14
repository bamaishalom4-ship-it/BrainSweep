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
      durationSec: 60,
      baseSpeed: 58,
      nodeRadius: 24,
    },
    medium: {
      id: 'medium',
      label: 'Medium',
      maxNumber: 32,
      durationSec: 60,
      baseSpeed: 72,
      nodeRadius: 20,
    },
    hard: {
      id: 'hard',
      label: 'Hard',
      maxNumber: 72,
      durationSec: 60,
      baseSpeed: 84,
      nodeRadius: 16,
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
      // Pentatonic / harmonic rising pitch from 380Hz to 980Hz
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

    splits: [], // seconds taken per extracted number
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

  function resizeCanvas() {
    const rect = arenaContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvasWidth = Math.max(300, rect.width);
    canvasHeight = Math.max(220, rect.height);

    canvas.width = Math.floor(canvasWidth * dpr);
    canvas.height = Math.floor(canvasHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resizeCanvas);

  // --- Node Generation & Movement Trajectories ---
  function createNodes() {
    const cfg = DIFFICULTIES[state.difficulty];
    const count = cfg.maxNumber;
    const nodes = [];

    // Dynamically scale radius slightly if screen is compact
    const areaScale = Math.min(1.15, Math.max(0.75, Math.sqrt((canvasWidth * canvasHeight) / (950 * 560))));
    const radius = Math.round(cfg.nodeRadius * areaScale);

    const patternsPool = ['spiral', 'zigzag', 'random', 'wave'];
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const maxRx = Math.max(80, canvasWidth * 0.44 - radius);
    const maxRy = Math.max(60, canvasHeight * 0.43 - radius);

    for (let i = 1; i <= count; i++) {
      const assignedPattern =
        state.pattern === 'mixed' ? patternsPool[(i - 1) % patternsPool.length] : state.pattern;

      // Distribute initial positions evenly using golden angle spiral so nothing starts clumped
      const goldenAngle = i * 2.399963229728653;
      const normRank = Math.sqrt(i / count);
      const startRx = (0.16 + 0.82 * normRank) * maxRx;
      const startRy = (0.16 + 0.82 * normRank) * maxRy;

      const x = cx + Math.cos(goldenAngle) * startRx;
      const y = cy + Math.sin(goldenAngle) * startRy;

      const angle = Math.random() * Math.PI * 2;
      const speed = cfg.baseSpeed * (0.85 + Math.random() * 0.35);

      // Hue based on number progression for subtle visual grouping
      const hue = Math.round(190 + ((i / count) * 140) % 160);

      nodes.push({
        value: i,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius,
        speed,
        pattern: assignedPattern,
        hue,

        // Spiral parameters
        spiralAngle: goldenAngle,
        spiralRadiusNorm: 0.18 + ((i - 1) / count) * 0.78,
        spiralRadialDir: i % 2 === 0 ? 1 : -1,
        spiralArmOffset: (i % 3) * ((Math.PI * 2) / 3),

        // Zig-Zag parameters
        zigTimer: Math.random() * 0.9,
        zigPeriod: 0.55 + Math.random() * 0.45,
        zigDirX: Math.random() < 0.5 ? 1 : -1,
        zigDirY: Math.random() < 0.5 ? 1 : -1,

        // Wave parameters
        wavePhase: Math.random() * Math.PI * 2,
        waveFreq: 2.2 + Math.random() * 1.8,
        waveAmp: 45 + Math.random() * 45,
        baseY: y,
        waveDirX: i % 2 === 0 ? 1 : -1,

        // Visual trail & feedback
        trail: [],
        errorFlash: 0,
        extracted: false,
      });
    }

    state.nodes = nodes;
  }

  function updateNodes(dt) {
    const pad = 26;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const maxRx = Math.max(70, canvasWidth * 0.45);
    const maxRy = Math.max(55, canvasHeight * 0.44);

    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      if (n.extracted) continue;

      if (n.errorFlash > 0) {
        n.errorFlash = Math.max(0, n.errorFlash - dt * 3);
      }

      // Record trail point every frame for smooth motion vector cues
      n.trail.push({ x: n.x, y: n.y });
      if (n.trail.length > 8) n.trail.shift();

      // If this node is currently grabbed by the player, skip autonomous movement
      if (state.draggingNode === n) {
        continue;
      }

      const pat = n.pattern;

      if (pat === 'spiral') {
        // Orbit around center while breathing along an Archimedean spiral arm
        const angularSpeed = (n.speed / Math.max(90, (n.spiralRadiusNorm * (maxRx + maxRy)) / 2)) * 0.95;
        n.spiralAngle += angularSpeed * dt;
        n.spiralRadiusNorm += n.spiralRadialDir * 0.085 * dt;

        if (n.spiralRadiusNorm > 0.94) {
          n.spiralRadiusNorm = 0.94;
          n.spiralRadialDir = -1;
        } else if (n.spiralRadiusNorm < 0.16) {
          n.spiralRadiusNorm = 0.16;
          n.spiralRadialDir = 1;
        }

        const targetX = cx + Math.cos(n.spiralAngle) * (n.spiralRadiusNorm * maxRx);
        const targetY = cy + Math.sin(n.spiralAngle) * (n.spiralRadiusNorm * maxRy);

        // Smooth velocity steering toward spiral locus
        n.vx = (targetX - n.x) / Math.max(dt, 0.008);
        n.vy = (targetY - n.y) / Math.max(dt, 0.008);
        n.x = targetX;
        n.y = targetY;
      } else if (pat === 'zigzag') {
        // Sharp angular sawtooth motion
        n.zigTimer += dt;
        if (n.zigTimer >= n.zigPeriod) {
          n.zigTimer = 0;
          n.zigDirY *= -1;
        }
        const vx = n.zigDirX * n.speed * 0.92;
        const vy = n.zigDirY * n.speed * 1.15;
        n.vx = vx;
        n.vy = vy;
        n.x += vx * dt;
        n.y += vy * dt;
      } else if (pat === 'wave') {
        // Sinusoidal horizontal stream
        n.wavePhase += n.waveFreq * dt;
        n.vx = n.waveDirX * n.speed * 0.95;
        n.vy = Math.cos(n.wavePhase) * n.waveAmp * n.waveFreq * 0.55;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
      } else {
        // Random Drift with gentle wandering curl
        const wanderAngle = (Math.random() - 0.5) * 2.4 * dt;
        const cosA = Math.cos(wanderAngle);
        const sinA = Math.sin(wanderAngle);
        const nvx = n.vx * cosA - n.vy * sinA;
        const nvy = n.vx * sinA + n.vy * cosA;
        n.vx = nvx;
        n.vy = nvy;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
      }

      // Soft repulsion between active nodes so numbers stay legible and don't stack
      for (let j = i + 1; j < state.nodes.length; j++) {
        const other = state.nodes[j];
        if (other.extracted || state.draggingNode === other) continue;
        const dx = other.x - n.x;
        const dy = other.y - n.y;
        const distSq = dx * dx + dy * dy;
        const minDist = n.radius + other.radius + 6;
        if (distSq > 0.001 && distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * 0.35;
          const nx = dx / dist;
          const ny = dy / dist;
          n.x -= nx * overlap;
          n.y -= ny * overlap;
          other.x += nx * overlap;
          other.y += ny * overlap;
        }
      }

      // Keep inside arena bounds (with bounce)
      const minX = n.radius + pad;
      const maxX = canvasWidth - n.radius - pad;
      const minY = n.radius + pad;
      const maxY = canvasHeight - n.radius - pad;

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
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 210;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 3.5,
        alpha: 1,
        color,
      });
    }
  }

  function spawnFloatingText(x, y, text, color) {
    state.floatingTexts.push({
      x: Math.min(canvasWidth - 50, Math.max(50, x)),
      y: Math.min(canvasHeight - 30, Math.max(30, y)),
      text,
      color,
      alpha: 1,
      vy: -48,
    });
  }

  function updateEffects(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 2.1;
      if (p.alpha <= 0) state.particles.splice(i, 1);
    }

    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
      const ft = state.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.alpha -= dt * 1.4;
      if (ft.alpha <= 0) state.floatingTexts.splice(i, 1);
    }

    if (state.hintPulseTimer > 0) {
      state.hintPulseTimer = Math.max(0, state.hintPulseTimer - dt);
    }
  }

  // --- Extraction Logic ---
  function isOutsideExtractionBoundary(x, y, radius) {
    const borderZone = Math.max(28, radius * 1.35);
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
    state.draggingNode = null;
    extractionFrame.classList.remove('dragging-active');

    // Flash extraction frame
    extractionFrame.classList.add('extraction-flash');
    setTimeout(() => extractionFrame.classList.remove('extraction-flash'), 220);

    // Record split time
    const nowSec = performance.now() / 1000;
    const splitSec = Math.max(0.05, nowSec - state.lastExtractTimestamp);
    state.splits.push({ number: node.value, split: splitSec });
    state.lastExtractTimestamp = nowSec;

    state.streak += 1;
    sound.playExtract(node.value, state.maxNumber);
    spawnExtractParticles(node.x, node.y, '#00ff41');
    spawnFloatingText(node.x, node.y, `#${node.value} EXTRACTED!`, '#00ff41');

    // Add badge to bottom tray
    const badge = document.createElement('span');
    badge.className = 'extracted-badge';
    badge.textContent = node.value;
    extractedSlots.appendChild(badge);
    extractedSlots.scrollLeft = extractedSlots.scrollWidth;

    if (node.value >= state.maxNumber) {
      // Player extracted all numbers in time!
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
    // Prioritize the target node if overlapping slightly, and allow generous grab halo (+8px)
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
        // If one of the touched nodes is the exact nextTarget, prefer it immediately
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
      // Correct target grabbed!
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

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore if unsupported
      }

      sound.playGrab();
      extractionFrame.classList.add('dragging-active');

      // If it was already right on the extraction border when grabbed, require a tiny 18px movement
    } else {
      // Wrong number clicked/grabbed
      state.mistakes += 1;
      state.streak = 0;
      hitNode.errorFlash = 1.0;
      sound.playError();

      extractionFrame.classList.add('error-flash');
      setTimeout(() => extractionFrame.classList.remove('error-flash'), 240);

      const msg = state.memoryMode
        ? `Wrong sequence! Not #${hitNode.value}`
        : `Find #${state.nextTarget} first! (Grabbed #${hitNode.value})`;
      showArenaToast(msg, '#f43f5e');
      spawnFloatingText(hitNode.x, hitNode.y, `Need #${state.nextTarget}!`, '#fb7185');
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
    if (node.trail.length > 10) node.trail.shift();

    const dragDist = Math.hypot(pos.x - state.dragStartX, pos.y - state.dragStartY);

    // Extract immediately when dragged across the extraction perimeter!
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

    // Check if dragged to border OR if Quick-Flick is enabled and dragged/flicked decisively
    if (
      isOutsideExtractionBoundary(node.x, node.y, node.radius) ||
      (state.quickFlick && (dragDist >= 58 || (dragDist >= 26 && flickSpeed >= 9)))
    ) {
      completeNodeExtraction(node);
    } else {
      // Released without dragging out far enough
      state.draggingNode = null;
      extractionFrame.classList.remove('dragging-active');
      showArenaToast('Drag further out or across the border to extract!', '#003b0d');
    }
    state.pointerId = null;
  }

  canvas.addEventListener('pointerup', handlePointerRelease);
  canvas.addEventListener('pointercancel', handlePointerRelease);

  // --- Toast Helper ---
  let toastTimeout = null;
  function showArenaToast(text, bgColor = '#002b08') {
    arenaFeedback.textContent = text;
    arenaFeedback.style.background = bgColor;
    arenaFeedback.style.color = '#00ff41';
    arenaFeedback.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      arenaFeedback.classList.remove('show');
    }, 1400);
  }

  // --- Rendering ---
  function drawBackgroundGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 65, 0.07)';
    ctx.lineWidth = 1;

    const step = 48;
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

    // Subtle pattern guide overlay in center
    if (state.pattern === 'spiral' || state.pattern === 'mixed') {
      ctx.strokeStyle = 'rgba(0, 255, 65, 0.08)';
      ctx.beginPath();
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      for (let r = 60; r < Math.min(canvasWidth, canvasHeight) * 0.45; r += 65) {
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    // Extraction perimeter inner threshold line
    const borderZone = 28;
    ctx.strokeStyle = state.draggingNode
      ? 'rgba(0, 255, 65, 0.85)'
      : 'rgba(0, 255, 65, 0.28)';
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

    if (min === distLeft) return { x: 6, y };
    if (min === distRight) return { x: canvasWidth - 6, y };
    if (min === distTop) return { x, y: 6 };
    return { x, y: canvasHeight - 6 };
  }

  function render() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    drawBackgroundGrid();

    // If dragging the target node, draw a helpful tether to nearest extraction border + quick-flick ring
    if (state.draggingNode) {
      const dn = state.draggingNode;
      const edgePt = nearestEdgePoint(dn.x, dn.y);

      ctx.save();
      ctx.strokeStyle = 'rgba(0, 255, 65, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(dn.x, dn.y);
      ctx.lineTo(edgePt.x, edgePt.y);
      ctx.stroke();

      // Quick-flick radius indicator around drag start
      if (state.quickFlick) {
        const dragDist = Math.hypot(dn.x - state.dragStartX, dn.y - state.dragStartY);
        const progress = Math.min(1, dragDist / 58);
        ctx.setLineDash([]);
        ctx.strokeStyle =
          progress >= 1 ? '#b8ffca' : 'rgba(0, 255, 65, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(state.dragStartX, state.dragStartY, 58, 0, Math.PI * 2 * progress);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw nodes (draw non-target nodes first, then target node on top so it's never buried)
    const sortedNodes = [...state.nodes].sort((a, b) => {
      if (a === state.draggingNode) return 1;
      if (b === state.draggingNode) return -1;
      if (a.value === state.nextTarget) return 1;
      if (b.value === state.nextTarget) return -1;
      return a.value - b.value;
    });

    for (const n of sortedNodes) {
      if (n.extracted) continue;

      const isTarget = n.value === state.nextTarget;
      const isDragging = state.draggingNode === n;
      const isHinting = isTarget && state.hintPulseTimer > 0;

      // Motion trail
      if (n.trail.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(n.trail[0].x, n.trail[0].y);
        for (let t = 1; t < n.trail.length; t++) {
          ctx.lineTo(n.trail[t].x, n.trail[t].y);
        }
        ctx.strokeStyle = isDragging
          ? 'rgba(184, 255, 202, 0.75)'
          : 'rgba(0, 255, 65, 0.22)';
        ctx.lineWidth = isDragging ? 4 : 2;
        ctx.lineCap = 'square';
        ctx.stroke();
        ctx.restore();
      }

      // Hint sonar ring if user clicked Locate button
      if (isHinting) {
        const pulseRadius = n.radius + 8 + ((1.5 - state.hintPulseTimer) * 38) % 36;
        ctx.save();
        ctx.strokeStyle = '#ccff00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Node Circle
      ctx.save();
      const r = isDragging ? n.radius * 1.22 : n.radius;

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

      if (n.errorFlash > 0) {
        ctx.fillStyle = `rgba(255, 0, 60, ${0.4 + n.errorFlash * 0.5})`;
        ctx.strokeStyle = '#ff668a';
        ctx.lineWidth = 2.5;
      } else if (isDragging) {
        ctx.fillStyle = '#00ff41';
        ctx.strokeStyle = '#b8ffca';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(0, 255, 65, 0.9)';
        ctx.shadowBlur = 18;
      } else if (isHinting) {
        ctx.fillStyle = '#2c4c00';
        ctx.strokeStyle = '#ccff00';
        ctx.lineWidth = 2.5;
      } else {
        ctx.fillStyle = 'rgba(1, 22, 4, 0.94)';
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(0, 255, 65, 0.25)';
        ctx.shadowBlur = 6;
      }

      ctx.fill();
      ctx.stroke();

      // Number Label in Game Boy pixel font
      ctx.fillStyle = isDragging ? '#010802' : '#00ff41';
      const fontSize = Math.max(8, Math.round(r * 0.58));
      ctx.font = `${fontSize}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n.value), n.x, n.y + 1);

      ctx.restore();
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
    hudStreakBadge.textContent = `${state.streak}x streak`;

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
      timerProgressBar.style.background =
        'linear-gradient(90deg, var(--accent-emerald), var(--accent-cyan))';
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

    // Populate Results Modal
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

    // Calculate Cognitive Rank
    const completionRatio = extractedCount / state.maxNumber;
    let rank = 'C';
    if (completedAll && accuracy >= 95) rank = 'S+ Elite';
    else if (completedAll) rank = 'S';
    else if (completionRatio >= 0.8) rank = 'A';
    else if (completionRatio >= 0.55) rank = 'B';
    document.getElementById('resCognitiveRank').textContent = `Cognitive Rating: ${rank}`;

    // Render Split Bars
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
    const dt = Math.min(0.05, Math.max(0.001, (now - state.lastFrameTime) / 1000));
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

  btnHint.addEventListener('click', () => {
    if (state.status !== 'playing') return;
    state.hintsUsed += 1;
    state.hintPulseTimer = 1.5;
    showArenaToast(`Locating #${state.nextTarget}...`, '#f59e0b');
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
