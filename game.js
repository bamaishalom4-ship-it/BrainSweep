/**
 * BrainSweep — Cognitive Number Extraction Game
 * Visual Scanning, Inhibitory Control & Selective Attention Trainer
 * Includes 100% Offline PWA Support & "Survival Sweep" Endless Offline Mode
 */

(() => {
  // --- Global Leaderboard Google Apps Script Web App Endpoint ---
  const DEFAULT_LEADERBOARD_API_URL =
    'https://script.google.com/macros/s/AKfycbziXn-4cNUEga8XpnoPAF22gOtCH9cIFaj2HojI1A4Aap_yNzCWkss37ne3U3kEic-A/exec';
  const USER_STORAGE_KEY = 'brainsweep_user';
  const LOCAL_LB_FALLBACK_KEY = 'brainsweep_local_lb_mirror_v1';

  function getLeaderboardApiUrl() {
    try {
      const custom = localStorage.getItem('brainsweep_api_url');
      if (custom && custom.startsWith('https://script.google.com/')) {
        return custom.trim();
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_LEADERBOARD_API_URL;
  }

  function isApiUrlConfigured() {
    const url = getLeaderboardApiUrl();
    return Boolean(
      url &&
        url.startsWith('https://script.google.com/') &&
        !url.includes('PASTE_YOUR_WEB_APP_URL_HERE')
    );
  }

  // --- 1. Difficulty Progression & Cognitive Ratios Configuration (Online Mode) ---
  const DIFFICULTIES = {
    easy: {
      id: 'easy',
      label: 'Easy',
      poolSize: 20,
      targetCount: 12,
      distractorCount: 8,
      targetRatio: 0.6, // 60% (~5.0s per target)
      durationSec: 60,
      baseSpeed: 42,
      maxRadius: 23,
    },
    medium: {
      id: 'medium',
      label: 'Medium',
      poolSize: 36,
      targetCount: 20,
      distractorCount: 16,
      targetRatio: 20 / 36, // ~55.6% (~3.0s per target)
      durationSec: 60,
      baseSpeed: 58,
      maxRadius: 19,
    },
    hard: {
      id: 'hard',
      label: 'Hard',
      poolSize: 50,
      targetCount: 25,
      distractorCount: 25,
      targetRatio: 0.5, // 50% (~2.4s per target)
      durationSec: 60,
      baseSpeed: 98, // High-velocity trajectories to compensate for mobile-friendly 50-node pool
      maxRadius: 17,
    },
  };

  // --- Offline "Survival Sweep" Mode Configuration ---
  const OFFLINE_SURVIVAL_CONFIG = {
    id: 'offline_survival',
    label: 'Survival Sweep (Offline)',
    activePoolSize: 17, // 1 active sequential target + 16 moving distractors on screen at any time
    distractorCount: 16,
    durationSec: 60,
    baseSpeed: 56,
    maxRadius: 20,
    distractorPenaltySec: 2.0,
  };

  // --- Service Worker Registration for 100% Offline PWA ---
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {
          // Ignore registration errors if opened via file:// protocol
        });
      });
    }
  }
  registerServiceWorker();

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
      const progress = Math.min(1, (stepIndex % 30) / Math.max(1, Math.min(30, totalSteps || 25)));
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
  const ghostLayer = document.getElementById('ghostLayer');
  const targetHudCard = document.getElementById('targetHudCard');

  const offlineStageBanner = document.getElementById('offlineStageBanner');
  const offlineStageBest = document.getElementById('offlineStageBest');
  const offlineMenuPanel = document.getElementById('offlineMenuPanel');
  const onlineDifficultySection = document.getElementById('onlineDifficultySection');
  const bestOfflineEl = document.getElementById('bestOffline');

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
  const infoModal = document.getElementById('infoModal');
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
  const btnInfo = document.getElementById('btnInfo');
  const btnCloseInfo = document.getElementById('btnCloseInfo');

  // --- Game State ---
  const sound = new SoundEngine();

  const state = {
    status: 'menu', // 'menu' | 'playing' | 'paused' | 'ended'
    isOfflineMode: !navigator.onLine,
    difficulty: 'easy',
    pattern: 'spiral',
    quickFlick: true,
    memoryMode: false,

    totalNumbers: 20,
    targetCount: 12,
    distractorCount: 8,

    targetNumbers: [],
    distractorNumbers: [],
    distractorSet: new Set(),

    currentStepIndex: 0, // Number of targets extracted so far
    nextTarget: 1,

    timeRemaining: 60.0,
    totalDuration: 60.0,
    lastFrameTime: 0,
    lastExtractTimestamp: 0,

    streak: 0,
    mistakes: 0,
    hintsUsed: 0,
    hintPulseTimer: 0,
    memoryPeekTimer: 0,

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

  // --- High Scores in LocalStorage (Online & Offline Survival Sweep) ---
  const STORAGE_KEY = 'brainsweep_best_v2';
  const OFFLINE_STORAGE_KEY = 'brainsweep_offline_best_v1';

  function loadHighScores() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveHighScore(diff, extractedCount, targetTotal, timeTaken) {
    try {
      const scores = loadHighScores();
      const prev = scores[diff] || { extracted: 0, max: targetTotal, time: 60, total: 0 };
      const isBetter =
        extractedCount > (prev.extracted || 0) ||
        (extractedCount === prev.extracted && timeTaken < (prev.time || 60));

      const cumulativeTotal =
        (parseInt(prev.total, 10) || 0) + (parseInt(extractedCount, 10) || 0);

      scores[diff] = {
        extracted: isBetter ? extractedCount : prev.extracted || 0,
        max: targetTotal,
        time: isBetter ? timeTaken : prev.time || 60,
        total: cumulativeTotal,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
      updateHighScoreBadges();
      return cumulativeTotal;
    } catch {
      return extractedCount;
    }
  }

  function getOfflineBestScore() {
    try {
      const val = parseInt(localStorage.getItem(OFFLINE_STORAGE_KEY) || '0', 10);
      return Number.isFinite(val) ? val : 0;
    } catch {
      return 0;
    }
  }

  function saveOfflineBestScore(extractedCount) {
    try {
      const prevBest = getOfflineBestScore();
      const newBest = Math.max(prevBest, extractedCount);
      localStorage.setItem(OFFLINE_STORAGE_KEY, String(newBest));
      updateHighScoreBadges();
      return newBest;
    } catch {
      return extractedCount;
    }
  }

  function updateHighScoreBadges() {
    const scores = loadHighScores();
    let highestTotalScore = 0;

    ['easy', 'medium', 'hard'].forEach((diff) => {
      const cfg = DIFFICULTIES[diff];
      const el = document.getElementById(`best${diff.charAt(0).toUpperCase() + diff.slice(1)}`);
      const rec = scores[diff];
      const tot = rec ? parseInt(rec.total, 10) || rec.extracted || 0 : 0;
      if (tot > highestTotalScore) {
        highestTotalScore = tot;
      }
      if (!el) return;
      if (!rec) {
        el.textContent = `Total: 0 pts (Best: —/${cfg.targetCount})`;
      } else {
        el.textContent = `Total: ${tot} pts (Best: ${rec.extracted}/${cfg.targetCount})`;
      }
    });

    const offlineBest = getOfflineBestScore();
    if (offlineBest > highestTotalScore) {
      highestTotalScore = offlineBest;
    }

    if (bestOfflineEl) {
      bestOfflineEl.textContent = `Best Offline Score: ${offlineBest}`;
    }
    if (offlineStageBest) {
      offlineStageBest.textContent = `Best Offline Score: ${offlineBest}`;
    }

    const homeBestScoreValue = document.getElementById('homeBestScoreValue');
    const homeBestScoreSub = document.getElementById('homeBestScoreSub');
    if (homeBestScoreValue) {
      const curRec = scores[state.difficulty];
      const curDiffTotal = curRec ? parseInt(curRec.total, 10) || curRec.extracted || 0 : 0;
      const displayScore = state.isOfflineMode
        ? offlineBest
        : Math.max(curDiffTotal, highestTotalScore);
      homeBestScoreValue.textContent = String(displayScore);
    }
    if (homeBestScoreSub) {
      homeBestScoreSub.textContent = state.isOfflineMode
        ? 'BEST OFFLINE SURVIVAL SCORE'
        : `BEST: ${DIFFICULTIES[state.difficulty].label.toUpperCase()} MODE`;
    }
  }

  // --- Network Status Listener (Online vs Offline "Survival Sweep") ---
  function syncNetworkModeUI() {
    const isOffline = !navigator.onLine;
    state.isOfflineMode = isOffline;
    document.body.classList.toggle('offline-mode', isOffline);

    if (offlineStageBanner) {
      offlineStageBanner.hidden = !isOffline;
    }
    if (offlineMenuPanel) {
      offlineMenuPanel.hidden = !isOffline;
    }
    if (onlineDifficultySection) {
      onlineDifficultySection.hidden = isOffline;
    }

    const startSpan = document.getElementById('homeStartMainText');
    if (startSpan) {
      startSpan.textContent = isOffline
        ? 'START SURVIVAL SWEEP (60s)'
        : 'START 60s CHALLENGE';
    }

    updateHighScoreBadges();
    updateHUD();
  }

  window.addEventListener('offline', () => {
    syncNetworkModeUI();
    if (state.status === 'menu') {
      // Bypass normal difficulty selection and launch Survival Sweep when going offline
      startGame();
      showArenaToast('OFFLINE MODE: SURVIVAL SWEEP', '#1c0a00');
    } else {
      showArenaToast('Connection Lost — Offline Mode Active', '#1c0a00');
    }
  });

  window.addEventListener('online', () => {
    syncNetworkModeUI();
    showArenaToast('Back Online — Standard Modes Unlocked', '#1c0a00');
  });

  // --- 2. Randomize Distractor Placement (Online "Gap" Rule) ---
  function generateTargetAndDistractorLists(poolSize, targetCount) {
    const allNumbers = Array.from({ length: poolSize }, (_, idx) => idx + 1);

    const shuffled = [...allNumbers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    const targetNumbers = shuffled.slice(0, targetCount).sort((a, b) => a - b);
    const distractorNumbers = shuffled.slice(targetCount).sort((a, b) => a - b);

    return {
      targetNumbers,
      distractorNumbers,
      distractorSet: new Set(distractorNumbers),
    };
  }

  // --- Resize & Canvas DPR Setup ---
  let canvasWidth = 800;
  let canvasHeight = 500;

  function computeOptimalRadius(count, maxAllowed) {
    const usableArea = Math.max(40000, (canvasWidth - 28) * (canvasHeight - 28));
    const idealRadius = Math.sqrt((usableArea * 0.155) / (count * Math.PI));
    return Math.max(11, Math.min(maxAllowed, Math.floor(idealRadius)));
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

    if (state.nodes.length > 0 && prevW > 0 && prevH > 0) {
      const activeCount = state.isOfflineMode
        ? OFFLINE_SURVIVAL_CONFIG.activePoolSize
        : DIFFICULTIES[state.difficulty].poolSize;
      const maxR = state.isOfflineMode
        ? OFFLINE_SURVIVAL_CONFIG.maxRadius
        : DIFFICULTIES[state.difficulty].maxRadius;
      const newRadius = computeOptimalRadius(activeCount, maxR);
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

  // --- Helper: Pick Non-Overlapping Spawn Coordinate & Distractor Value ---
  function findSafeSpawnPosition(radius) {
    const pad = radius + 18;
    const minX = pad;
    const maxX = Math.max(pad + 10, canvasWidth - pad);
    const minY = pad;
    const maxY = Math.max(pad + 10, canvasHeight - pad);

    let bestX = (minX + maxX) / 2;
    let bestY = (minY + maxY) / 2;
    let maxMinDist = -1;

    // Sample 18 candidate positions and pick the one furthest from existing nodes
    for (let attempt = 0; attempt < 18; attempt++) {
      const cx = minX + Math.random() * (maxX - minX);
      const cy = minY + Math.random() * (maxY - minY);
      let nearest = Infinity;

      for (let i = 0; i < state.nodes.length; i++) {
        const other = state.nodes[i];
        if (other.extracted) continue;
        const d = Math.hypot(cx - other.x, cy - other.y);
        if (d < nearest) nearest = d;
      }

      if (nearest > maxMinDist) {
        maxMinDist = nearest;
        bestX = cx;
        bestY = cy;
      }
      if (nearest >= radius * 3.2) break;
    }

    return { x: bestX, y: bestY };
  }

  function pickUniqueDistractorNumber(targetVal, usedValues) {
    // Pick a distractor number near the current target range so player must read carefully
    const minVal = Math.max(1, targetVal - 4);
    const maxVal = targetVal + 32;
    for (let tries = 0; tries < 50; tries++) {
      const candidate = minVal + Math.floor(Math.random() * (maxVal - minVal + 1));
      if (candidate !== targetVal && !usedValues.has(candidate)) {
        usedValues.add(candidate);
        return candidate;
      }
    }
    let fallback = targetVal + 2;
    while (fallback === targetVal || usedValues.has(fallback)) {
      fallback += 1;
    }
    usedValues.add(fallback);
    return fallback;
  }

  function buildSingleNodeObject(value, isDistractor, indexSeed, count, baseSpeed, radius, isHard) {
    const patternsPool = ['spiral', 'zigzag', 'random', 'wave'];
    const assignedPattern =
      state.pattern === 'mixed'
        ? patternsPool[indexSeed % patternsPool.length]
        : state.pattern;

    const pos = findSafeSpawnPosition(radius);
    const angle = indexSeed * 2.399963 + (Math.random() - 0.5) * 0.5;
    const speed = baseSpeed * (0.9 + (indexSeed % 5) * 0.055);

    return {
      value,
      isTarget: !isDistractor,
      isDistractor,
      x: pos.x,
      y: pos.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      speed,
      pattern: assignedPattern,

      preferredRing: 0.24 + ((indexSeed % count) / Math.max(1, count - 1)) * 0.7,
      orbitDir: 1,

      zigTimer: (indexSeed * 0.19) % 1.2,
      zigPeriod: (isHard ? 0.72 : 1.1) + (indexSeed % 4) * 0.2,
      zigDirX: indexSeed % 2 === 0 ? 1 : -1,
      zigDirY: indexSeed % 3 === 0 ? 1 : -1,

      wavePhase: indexSeed * 0.65,
      waveFreq: (isHard ? 2.25 : 1.5) + (indexSeed % 3) * 0.35,
      waveDirX: indexSeed % 2 === 0 ? 1 : -1,

      wanderPhase: indexSeed * 1.1,
      wanderRate: (indexSeed % 2 === 0 ? 1 : -1) * ((isHard ? 0.68 : 0.4) + (indexSeed % 4) * 0.12),

      trail: [],
      errorFlash: 0,
      extracted: false,
    };
  }

  // --- Node Generation (Online Mode vs Offline Endless "Survival Sweep") ---
  function createOfflineSurvivalNodes() {
    const cfg = OFFLINE_SURVIVAL_CONFIG;
    state.totalNumbers = cfg.activePoolSize;
    state.targetCount = Infinity; // Endless survival
    state.distractorCount = cfg.distractorCount;
    state.currentStepIndex = 0;
    state.nextTarget = 1;
    state.nodes = [];

    const radius = computeOptimalRadius(cfg.activePoolSize, cfg.maxRadius);
    const usedValues = new Set([1]);

    // 1. Spawn initial target #1
    state.nodes.push(
      buildSingleNodeObject(1, false, 1, cfg.activePoolSize, cfg.baseSpeed, radius, false)
    );

    // 2. Spawn 16 moving distractor numbers alongside the target
    const distractorNums = [];
    for (let d = 0; d < cfg.distractorCount; d++) {
      const dVal = pickUniqueDistractorNumber(1, usedValues);
      distractorNums.push(dVal);
      state.nodes.push(
        buildSingleNodeObject(dVal, true, d + 2, cfg.activePoolSize, cfg.baseSpeed, radius, false)
      );
    }

    state.targetNumbers = [1];
    state.distractorNumbers = distractorNums;
    state.distractorSet = new Set(distractorNums);
  }

  function createNodes() {
    if (state.isOfflineMode) {
      createOfflineSurvivalNodes();
      return;
    }

    const cfg = DIFFICULTIES[state.difficulty];
    state.totalNumbers = cfg.poolSize;
    state.targetCount = cfg.targetCount;
    state.distractorCount = cfg.distractorCount;

    const { targetNumbers, distractorNumbers, distractorSet } = generateTargetAndDistractorLists(
      cfg.poolSize,
      cfg.targetCount
    );

    state.targetNumbers = targetNumbers;
    state.distractorNumbers = distractorNumbers;
    state.distractorSet = distractorSet;
    state.currentStepIndex = 0;
    state.nextTarget = targetNumbers[0];

    const count = cfg.poolSize;
    const nodes = [];

    const radius = computeOptimalRadius(count, cfg.maxRadius);
    const pad = radius + 14;
    const usableW = Math.max(100, canvasWidth - pad * 2);
    const usableH = Math.max(100, canvasHeight - pad * 2);

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
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }

    const patternsPool = ['spiral', 'zigzag', 'random', 'wave'];
    const isHard = state.difficulty === 'hard';

    for (let i = 1; i <= count; i++) {
      const assignedPattern =
        state.pattern === 'mixed' ? patternsPool[(i - 1) % patternsPool.length] : state.pattern;

      const slot = slots[(i - 1) % slots.length];
      const jitterX = (Math.random() - 0.5) * cellW * 0.45;
      const jitterY = (Math.random() - 0.5) * cellH * 0.45;
      const x = Math.min(canvasWidth - pad, Math.max(pad, pad + (slot.c + 0.5) * cellW + jitterX));
      const y = Math.min(canvasHeight - pad, Math.max(pad, pad + (slot.r + 0.5) * cellH + jitterY));

      const angle = i * 2.399963 + (Math.random() - 0.5) * 0.5;
      const speed = cfg.baseSpeed * (0.9 + (i % 5) * 0.055);
      const isDistractor = distractorSet.has(i);

      nodes.push({
        value: i,
        isTarget: !isDistractor,
        isDistractor,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius,
        speed,
        pattern: assignedPattern,

        preferredRing: 0.22 + ((i - 1) / Math.max(1, count - 1)) * 0.74,
        orbitDir: 1,

        zigTimer: (i * 0.19) % 1.2,
        zigPeriod: (isHard ? 0.72 : 1.1) + (i % 4) * 0.2,
        zigDirX: i % 2 === 0 ? 1 : -1,
        zigDirY: i % 3 === 0 ? 1 : -1,

        wavePhase: i * 0.65,
        waveFreq: (isHard ? 2.25 : 1.5) + (i % 3) * 0.35,
        waveDirX: i % 2 === 0 ? 1 : -1,

        wanderPhase: i * 1.1,
        wanderRate: (i % 2 === 0 ? 1 : -1) * ((isHard ? 0.68 : 0.4) + (i % 4) * 0.12),

        trail: [],
        errorFlash: 0,
        extracted: false,
      });
    }

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
        const normX = (n.x - cx) / halfW;
        const normY = (n.y - cy) / halfH;
        const currentR = Math.max(0.08, Math.hypot(normX, normY));

        const tanNormX = (-normY / currentR) * n.orbitDir;
        const tanNormY = (normX / currentR) * n.orbitDir;

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
        desiredVx = n.zigDirX * n.speed * 0.85;
        desiredVy = n.zigDirY * n.speed * 0.85;
      } else if (pat === 'wave') {
        n.wavePhase += n.waveFreq * dt;
        desiredVx = n.waveDirX * n.speed * 0.9;
        desiredVy = Math.cos(n.wavePhase) * n.speed * 0.75;
      } else {
        n.wanderPhase += n.wanderRate * dt;
        const curAngle = Math.atan2(n.vy, n.vx) + Math.sin(n.wanderPhase) * 0.65 * dt;
        desiredVx = Math.cos(curAngle) * n.speed;
        desiredVy = Math.sin(curAngle) * n.speed;
      }

      const blend = Math.min(1, dt * 6);
      n.vx += (desiredVx - n.vx) * blend;
      n.vy += (desiredVy - n.vy) * blend;
    }

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

          const overlapRatio = (comfortDist - dist) / comfortDist;
          const pushImpulse = overlapRatio * 155 * dt;
          a.vx -= nx * pushImpulse;
          a.vy -= ny * pushImpulse;
          b.vx += nx * pushImpulse;
          b.vy += ny * pushImpulse;

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

    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      if (n.extracted || state.draggingNode === n) continue;

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

    if (state.memoryPeekTimer > 0) {
      state.memoryPeekTimer = Math.max(0, state.memoryPeekTimer - dt);
      if (state.memoryPeekTimer === 0) {
        updateHUD();
      }
    }
  }

  // --- Ghost Trail Spawn & Centered HUD Peripheral Pulse ---
  function spawnGhostTarget(dropX, dropY, nextTargetNumber) {
    if (!ghostLayer) return;

    const clampedX = Math.min(canvasWidth - 48, Math.max(48, dropX));
    const clampedY = Math.min(canvasHeight - 38, Math.max(38, dropY));

    const ghostEl = document.createElement('div');
    ghostEl.className = 'ghost-target-spawn';
    ghostEl.textContent = String(nextTargetNumber);
    ghostEl.style.left = `${clampedX}px`;
    ghostEl.style.top = `${clampedY}px`;

    ghostLayer.appendChild(ghostEl);

    const cleanup = () => {
      if (ghostEl.parentNode) {
        ghostEl.parentNode.removeChild(ghostEl);
      }
    };
    ghostEl.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 650);
  }

  function triggerTargetHudPulse() {
    if (!targetHudCard) return;
    targetHudCard.classList.remove('target-pulse');
    void targetHudCard.offsetWidth;
    targetHudCard.classList.add('target-pulse');
  }

  // --- Helper: Format Upcoming Target Sequence Preview ---
  function formatUpcomingQueueText() {
    if (state.isOfflineMode) {
      return `SURVIVAL SWEEP: Find & extract #${state.nextTarget} (Avoid distractors: -2s)`;
    }
    if (state.memoryMode) {
      return `Memory Mode: Target ${state.currentStepIndex + 1} of ${state.targetCount}`;
    }
    const upcoming = state.targetNumbers
      .slice(state.currentStepIndex, state.currentStepIndex + 4)
      .map((num) => `#${num}`)
      .join(' → ');
    return `TARGETS: ${upcoming}`;
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

    const dropX = node.x;
    const dropY = node.y;

    state.currentStepIndex += 1;
    state.streak += 1;
    sound.playExtract(state.currentStepIndex, state.isOfflineMode ? 30 : state.targetCount);
    spawnExtractParticles(dropX, dropY, '#fc6200');

    const badge = document.createElement('span');
    badge.className = 'extracted-badge';
    badge.textContent = node.value;
    extractedSlots.appendChild(badge);
    // Keep extracted badge DOM list bounded in endless mode so DOM never bloats
    while (extractedSlots.children.length > 40) {
      extractedSlots.removeChild(extractedSlots.firstChild);
    }
    extractedSlots.scrollLeft = extractedSlots.scrollWidth;

    if (state.isOfflineMode) {
      // --- Offline "Survival Sweep" Endless Spawning Logic (Zero Memory Leaks) ---
      // 1. Remove the extracted target node from state.nodes array immediately
      const idx = state.nodes.indexOf(node);
      if (idx !== -1) {
        state.nodes.splice(idx, 1);
      }

      // 2. Advance to next sequential target (1 -> 2 -> 3 -> 4...)
      state.nextTarget = state.currentStepIndex + 1;

      // 3. Ensure no existing distractor has the same value as the new sequential target
      const usedValues = new Set([state.nextTarget]);
      for (const n of state.nodes) {
        if (n.value !== state.nextTarget) {
          usedValues.add(n.value);
        }
      }
      for (const n of state.nodes) {
        if (n.isDistractor && n.value === state.nextTarget) {
          n.value = pickUniqueDistractorNumber(state.nextTarget, usedValues);
        }
      }

      // Also cycle one random distractor value to keep the number range advancing with the player
      const distractors = state.nodes.filter((n) => n.isDistractor);
      if (distractors.length > 0) {
        const randomDist = distractors[Math.floor(Math.random() * distractors.length)];
        usedValues.delete(randomDist.value);
        randomDist.value = pickUniqueDistractorNumber(state.nextTarget, usedValues);
      }
      state.distractorSet = new Set(
        state.nodes.filter((n) => n.isDistractor).map((n) => n.value)
      );

      // 4. Spawn the new sequential target in the arena
      const cfg = OFFLINE_SURVIVAL_CONFIG;
      const radius = computeOptimalRadius(cfg.activePoolSize, cfg.maxRadius);
      const speedBoost = Math.min(35, state.currentStepIndex * 0.8);
      const newTargetNode = buildSingleNodeObject(
        state.nextTarget,
        false,
        state.nextTarget + 7,
        cfg.activePoolSize,
        cfg.baseSpeed + speedBoost,
        radius,
        false
      );
      state.nodes.push(newTargetNode);

      // 5. Spawn the 0.6s Ghost Trail of the next sequential number at the drop point
      spawnGhostTarget(dropX, dropY, state.nextTarget);
      trayStatusText.textContent = formatUpcomingQueueText();
      updateHUD();
      return;
    }

    // Check if all targetCount targets (12, 20, or 25) have been found!
    if (state.currentStepIndex >= state.targetCount) {
      spawnFloatingText(dropX, dropY, `#${node.value} CLEAR!`, '#ffa347');
      updateHUD();
      finishGame(true);
    } else {
      state.nextTarget = state.targetNumbers[state.currentStepIndex];

      spawnGhostTarget(dropX, dropY, state.nextTarget);
      triggerTargetHudPulse();

      if (state.memoryMode) {
        state.memoryPeekTimer = 1.3;
        showArenaToast(`Next Target: #${state.nextTarget} (Memorize!)`, '#1c0a00');
      }
      trayStatusText.textContent = formatUpcomingQueueText();
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

      if (state.isOfflineMode) {
        // Apply -2s distractor timer penalty in Offline Survival Sweep
        state.timeRemaining = Math.max(
          0,
          state.timeRemaining - OFFLINE_SURVIVAL_CONFIG.distractorPenaltySec
        );
        updateTimerDisplay();
        showArenaToast(
          `Distractor! -2.0s Penalty (Find #${state.nextTarget})`,
          '#3b0712'
        );
        spawnFloatingText(hitNode.x, hitNode.y, '-2.0s!', '#ff4d6d');
        updateHUD();
        if (state.timeRemaining <= 0) {
          finishGame(false);
        }
        return;
      }

      const isGapDistractor = state.distractorSet.has(hitNode.value);
      const msg = state.memoryMode
        ? isGapDistractor
          ? `#${hitNode.value} is a Distractor Gap!`
          : `Out of order! Not #${hitNode.value}`
        : isGapDistractor
          ? `Distractor Gap! Target is #${state.nextTarget}`
          : `Find #${state.nextTarget} first!`;

      showArenaToast(msg, '#3b0712');
      spawnFloatingText(
        hitNode.x,
        hitNode.y,
        isGapDistractor ? 'DISTRACTOR!' : `Need #${state.nextTarget}`,
        '#ff4d6d'
      );
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

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < state.nodes.length; i++) {
        const n = state.nodes[i];
        if (n.extracted) continue;

        const isPriority = n === state.draggingNode || n.value === state.nextTarget;
        if ((pass === 0 && isPriority) || (pass === 1 && !isPriority)) continue;

        const isTarget = n.value === state.nextTarget;
        const isDragging = state.draggingNode === n;
        const isHinting = isTarget && state.hintPulseTimer > 0;

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

        ctx.fillStyle = isDragging || isHinting ? '#050200' : '#fc6200';
        const fontSize = Math.max(8, Math.round(r * 0.56));
        ctx.font = `${fontSize}px "Press Start 2P", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n.value), n.x, n.y + 1);

        ctx.restore();
      }
    }

    for (const p of state.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      ctx.restore();
    }

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
    const extractedCount = state.currentStepIndex;

    if (state.isOfflineMode) {
      // Offline Survival Sweep: prominent Extracted count + streak
      hudExtracted.textContent = String(extractedCount);
      hudStreakBadge.textContent = `Next: #${state.nextTarget}`;
      return;
    }

    const hideTarget = state.memoryMode && state.memoryPeekTimer <= 0;
    hudNextTarget.textContent = hideTarget ? '?' : `#${state.nextTarget}`;
    hudTotalTarget.textContent = `(${Math.min(state.targetCount, extractedCount + 1)}/${state.targetCount})`;
    hudExtracted.textContent = `${extractedCount}/${state.targetCount}`;
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
    syncNetworkModeUI();

    const durationSec = state.isOfflineMode
      ? OFFLINE_SURVIVAL_CONFIG.durationSec
      : DIFFICULTIES[state.difficulty].durationSec;

    state.status = 'playing';
    state.totalDuration = durationSec;
    state.timeRemaining = durationSec;
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
    if (ghostLayer) ghostLayer.innerHTML = '';

    setupModal.classList.remove('active');
    resultsModal.classList.remove('active');
    infoModal.classList.remove('active');
    const lvlModal = document.getElementById('levelSelectModal');
    const setModal = document.getElementById('settingsModal');
    const trajModal = document.getElementById('trajectoryModal');
    if (lvlModal) lvlModal.classList.remove('active');
    if (setModal) setModal.classList.remove('active');
    if (trajModal) trajModal.classList.remove('active');
    document.body.classList.remove('results-active');
    document.body.classList.add('playing-active');

    resizeCanvas();
    createNodes();

    if (!state.isOfflineMode) {
      triggerTargetHudPulse();
      if (state.memoryMode) {
        state.memoryPeekTimer = 1.5;
        showArenaToast(`First Target: #${state.nextTarget} (Memorize!)`, '#1c0a00');
      } else {
        state.memoryPeekTimer = 0;
      }
    } else {
      state.memoryPeekTimer = 0;
      spawnGhostTarget(canvasWidth / 2, canvasHeight / 2, 1);
    }

    trayStatusText.textContent = formatUpcomingQueueText();
    updateHUD();
    updateTimerDisplay();

    const now = performance.now();
    state.lastFrameTime = now;
    state.lastExtractTimestamp = now / 1000;
  }

  function finishGame(completedAll) {
    state.status = 'ended';
    document.body.classList.remove('playing-active');
    document.body.classList.add('results-active');
    state.draggingNode = null;
    extractionFrame.classList.remove('dragging-active');

    const resultBadge = document.getElementById('resultBadge');
    const resultHeadline = document.getElementById('resultHeadline');
    const resultSubheadline = document.getElementById('resultSubheadline');
    const resSessionScoreBanner = document.getElementById('resSessionScoreBanner');
    const resTotalScoreBanner = document.getElementById('resTotalScoreBanner');

    if (state.isOfflineMode) {
      const extractedCount = state.currentStepIndex;
      const bestOffline = saveOfflineBestScore(extractedCount);

      if (extractedCount > 0) {
        sound.playVictory();
      } else {
        sound.playError();
      }

      resultBadge.textContent = 'OFFLINE MODE: SURVIVAL SWEEP';
      resultHeadline.textContent = `Time's up! You extracted ${extractedCount} numbers. Your best is ${bestOffline}.`;
      resultSubheadline.textContent = `60-second endless sequential pull complete. Best Offline Score: ${bestOffline}.`;

      if (resSessionScoreBanner) {
        resSessionScoreBanner.textContent = `Session Score: ${extractedCount}`;
      }
      if (resTotalScoreBanner) {
        resTotalScoreBanner.textContent = `Best Offline: ${bestOffline}`;
      }

      document.getElementById('resExtracted').textContent = String(extractedCount);
      document.getElementById('resTime').textContent = String(bestOffline);
      const avgSpeed = extractedCount > 0 ? `${(60 / extractedCount).toFixed(2)}s / #` : '—';
      document.getElementById('resAvgSpeed').textContent = avgSpeed;

      const totalAttempts = extractedCount + state.mistakes;
      const accuracy =
        totalAttempts > 0 ? Math.round((extractedCount / totalAttempts) * 100) : 100;
      document.getElementById('resAccuracy').textContent = `${accuracy}%`;
      document.getElementById('resCognitiveRank').textContent = `Best Offline Score: ${bestOffline}`;
    } else {
      const sessionScore = completedAll ? state.targetCount : state.currentStepIndex;
      const timeTaken = Math.min(
        state.totalDuration,
        Math.max(0.1, state.totalDuration - state.timeRemaining)
      );

      if (completedAll) {
        sound.playVictory();
      } else {
        sound.playError();
      }

      const localCumulativeTotal = saveHighScore(
        state.difficulty,
        sessionScore,
        state.targetCount,
        timeTaken
      );
      const cfg = DIFFICULTIES[state.difficulty];

      if (completedAll) {
        resultBadge.textContent = 'CHALLENGE CONQUERED';
        resultHeadline.textContent = `Cleared ${state.targetCount} Targets in ${timeTaken.toFixed(1)}s!`;
        resultSubheadline.textContent = `Session Score: ${sessionScore} added to your ${cfg.label} Total Score!`;
      } else {
        resultBadge.textContent = 'TIME EXPIRED (60.0s)';
        resultHeadline.textContent = `Extracted ${sessionScore} of ${state.targetCount} Targets`;
        resultSubheadline.textContent = `Session Score: ${sessionScore} added to your ${cfg.label} Total Score!`;
      }

      if (resSessionScoreBanner) {
        resSessionScoreBanner.textContent = `Session Score: ${sessionScore}`;
      }
      if (resTotalScoreBanner) {
        resTotalScoreBanner.textContent = `Total Score: ${localCumulativeTotal}`;
      }

      document.getElementById('resExtracted').textContent = `${sessionScore}`;
      document.getElementById('resTime').textContent = `${localCumulativeTotal}`;
      const avgSpeed = sessionScore > 0 ? `${(timeTaken / sessionScore).toFixed(2)}s / #` : '—';
      document.getElementById('resAvgSpeed').textContent = avgSpeed;

      const totalAttempts = sessionScore + state.mistakes;
      const accuracy =
        totalAttempts > 0 ? Math.round((sessionScore / totalAttempts) * 100) : 100;
      document.getElementById('resAccuracy').textContent = `${accuracy}%`;

      const completionRatio = sessionScore / state.targetCount;
      let rank = 'C';
      if (completedAll && accuracy >= 95) rank = 'S+ Elite';
      else if (completedAll) rank = 'S';
      else if (completionRatio >= 0.8) rank = 'A';
      else if (completionRatio >= 0.55) rank = 'B';
      document.getElementById('resCognitiveRank').textContent = `Cognitive Rating: ${rank}`;

      // Step 3: Submit sessionScore to Google Apps Script & update Total Score with backend response
      handleGameEndLeaderboardSubmission(state.difficulty, sessionScore);
    }

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

    if (state.status !== 'paused') {
      updateNodes(dt);
      updateEffects(dt);
    }
    render();

    requestAnimationFrame(tick);
  }

  // --- Persistent Settings, Screen Routing & Bottom Navigation ---
  const SETTINGS_STORAGE_KEY = 'brainsweep_settings_v1';
  const PATTERN_LABELS = {
    spiral: 'SPIRAL VORTEX',
    zigzag: 'ZIG-ZAG SWEEP',
    random: 'RANDOM DRIFT',
    wave: 'HARMONIC WAVE',
    mixed: 'HYBRID CHAOS',
  };

  const levelSelectModal = document.getElementById('levelSelectModal');
  const settingsModal = document.getElementById('settingsModal');
  const trajectoryModal = document.getElementById('trajectoryModal');
  const bottomNav = document.getElementById('bottomNav');

  const btnCloseLevelSelect = document.getElementById('btnCloseLevelSelect');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const btnCancelSettings = document.getElementById('btnCancelSettings');
  const btnCloseTrajectory = document.getElementById('btnCloseTrajectory');
  const btnCancelTrajectory = document.getElementById('btnCancelTrajectory');

  let returnToResultsOnClose = false;

  const btnSettingSound = document.getElementById('btnSettingSound');
  const btnSettingDifficulty = document.getElementById('btnSettingDifficulty');
  const btnSettingTrajectory = document.getElementById('btnSettingTrajectory');

  const settingSoundIconBox = document.getElementById('settingSoundIconBox');
  const settingSoundSvgOn = document.getElementById('settingSoundSvgOn');
  const settingSoundSvgOff = document.getElementById('settingSoundSvgOff');
  const settingSoundValue = document.getElementById('settingSoundValue');
  const settingDifficultyValue = document.getElementById('settingDifficultyValue');
  const settingTrajectoryValue = document.getElementById('settingTrajectoryValue');
  const homeStartDiffLabel = document.getElementById('homeStartDiffLabel');

  function loadPersistedSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.soundEnabled === 'boolean') {
          sound.enabled = parsed.soundEnabled;
        }
        if (parsed.difficulty && DIFFICULTIES[parsed.difficulty]) {
          state.difficulty = parsed.difficulty;
        }
        if (parsed.pattern && PATTERN_LABELS[parsed.pattern]) {
          state.pattern = parsed.pattern;
        }
        if (typeof parsed.quickFlick === 'boolean' && chkQuickFlick) {
          chkQuickFlick.checked = parsed.quickFlick;
          state.quickFlick = parsed.quickFlick;
        }
        if (typeof parsed.memoryMode === 'boolean' && chkMemoryMode) {
          chkMemoryMode.checked = parsed.memoryMode;
          state.memoryMode = parsed.memoryMode;
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  function savePersistedSettings() {
    try {
      const payload = {
        soundEnabled: sound.enabled,
        difficulty: state.difficulty,
        pattern: state.pattern,
        quickFlick: chkQuickFlick ? chkQuickFlick.checked : true,
        memoryMode: chkMemoryMode ? chkMemoryMode.checked : false,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }

  function syncSettingsUI() {
    // 1. Sync Sound UI
    if (btnSound) {
      btnSound.style.opacity = sound.enabled ? '1' : '0.45';
    }
    if (settingSoundValue) {
      settingSoundValue.textContent = sound.enabled ? 'ON' : 'OFF';
      settingSoundValue.classList.toggle('off', !sound.enabled);
    }
    if (settingSoundIconBox) {
      settingSoundIconBox.classList.toggle('muted', !sound.enabled);
    }
    if (settingSoundSvgOn && settingSoundSvgOff) {
      settingSoundSvgOn.hidden = !sound.enabled;
      settingSoundSvgOff.hidden = sound.enabled;
    }

    // 2. Sync Difficulty UI (Settings row, Level Select cards, Home Start button, Best Play display)
    const diffUpper = DIFFICULTIES[state.difficulty].label.toUpperCase();
    const patUpper = PATTERN_LABELS[state.pattern] || 'SPIRAL VORTEX';

    if (settingDifficultyValue) {
      settingDifficultyValue.textContent = diffUpper;
    }
    if (settingTrajectoryValue) {
      settingTrajectoryValue.textContent = patUpper;
    }
    if (homeStartDiffLabel) {
      homeStartDiffLabel.textContent = state.isOfflineMode
        ? `OFFLINE // ${patUpper}`
        : `${diffUpper} // ${patUpper}`;
    }

    if (difficultyGrid) {
      difficultyGrid.querySelectorAll('.diff-card').forEach((c) => {
        c.classList.toggle('active', c.dataset.difficulty === state.difficulty);
      });
    }

    if (patternGrid) {
      patternGrid.querySelectorAll('.pattern-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.pattern === state.pattern);
      });
    }

    updateHighScoreBadges();
  }

  function setBottomNavActiveTab(tabName) {
    if (!bottomNav) return;
    bottomNav.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === tabName);
    });
  }

  function closeAllOverlayModals() {
    setupModal.classList.remove('active');
    if (levelSelectModal) levelSelectModal.classList.remove('active');
    if (settingsModal) settingsModal.classList.remove('active');
    if (trajectoryModal) trajectoryModal.classList.remove('active');
    if (infoModal) infoModal.classList.remove('active');
    if (leaderboardModal) leaderboardModal.classList.remove('active');
    if (resultsModal) resultsModal.classList.remove('active');
  }

  function navigateToScreen(tabName) {
    document.body.classList.remove('playing-active');
    document.body.classList.remove('results-active');
    if (state.status === 'playing') {
      state.status = 'menu';
      state.draggingNode = null;
      extractionFrame.classList.remove('dragging-active');
    }

    if (tabName === 'leaderboard') {
      const user = getSavedUser();
      if (!user) {
        openRegistrationModal({
          prefill: false,
          onComplete: () => navigateToScreen('leaderboard'),
        });
        return;
      }
      closeAllOverlayModals();
      setBottomNavActiveTab('leaderboard');
      syncPlayerProfileUI();
      leaderboardModal.classList.add('active');
      loadLeaderboardTab(state.difficulty || 'easy');
      return;
    }

    closeAllOverlayModals();
    setBottomNavActiveTab(tabName);

    if (tabName === 'levels' && levelSelectModal) {
      syncSettingsUI();
      levelSelectModal.classList.add('active');
    } else if (tabName === 'help' && infoModal) {
      infoModal.classList.add('active');
    } else if (tabName === 'settings' && settingsModal) {
      syncSettingsUI();
      settingsModal.classList.add('active');
    } else {
      // Default: 'home'
      setBottomNavActiveTab('home');
      syncNetworkModeUI();
      syncSettingsUI();
      setupModal.classList.add('active');
    }
  }

  // --- UI Event Listeners ---
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.bottom-nav-btn');
      if (!btn) return;
      navigateToScreen(btn.dataset.nav);
    });
  }

  difficultyGrid.addEventListener('click', (e) => {
    const playBtn = e.target.closest('[data-play-diff]');
    if (playBtn) {
      state.difficulty = playBtn.dataset.playDiff;
      savePersistedSettings();
      syncSettingsUI();
      sound.init();
      startGame();
      return;
    }

    const card = e.target.closest('.diff-card');
    if (!card) return;
    state.difficulty = card.dataset.difficulty;
    savePersistedSettings();
    syncSettingsUI();
  });

  patternGrid.addEventListener('click', (e) => {
    const chip = e.target.closest('.pattern-chip');
    if (!chip) return;
    state.pattern = chip.dataset.pattern;
    savePersistedSettings();
    syncSettingsUI();
    if (trajectoryModal) {
      trajectoryModal.classList.remove('active');
    }
  });

  if (chkQuickFlick) {
    chkQuickFlick.addEventListener('change', () => {
      state.quickFlick = chkQuickFlick.checked;
      savePersistedSettings();
    });
  }

  if (chkMemoryMode) {
    chkMemoryMode.addEventListener('change', () => {
      state.memoryMode = chkMemoryMode.checked;
      savePersistedSettings();
    });
  }

  if (btnSettingSound) {
    btnSettingSound.addEventListener('click', () => {
      sound.enabled = !sound.enabled;
      if (sound.enabled) sound.playGrab();
      savePersistedSettings();
      syncSettingsUI();
    });
  }

  if (btnSettingDifficulty) {
    btnSettingDifficulty.addEventListener('click', () => {
      const order = ['easy', 'medium', 'hard'];
      const nextIdx = (order.indexOf(state.difficulty) + 1) % order.length;
      state.difficulty = order[nextIdx];
      savePersistedSettings();
      syncSettingsUI();
    });
  }

  if (btnSettingTrajectory) {
    btnSettingTrajectory.addEventListener('click', () => {
      syncSettingsUI();
      if (trajectoryModal) {
        trajectoryModal.classList.add('active');
      }
    });
  }

  if (btnCloseTrajectory) {
    btnCloseTrajectory.addEventListener('click', () => {
      trajectoryModal.classList.remove('active');
    });
  }

  if (btnCancelTrajectory) {
    btnCancelTrajectory.addEventListener('click', () => {
      trajectoryModal.classList.remove('active');
    });
  }

  if (btnCloseLevelSelect) {
    btnCloseLevelSelect.addEventListener('click', () => {
      navigateToScreen('home');
    });
  }

  function closeSettingsAndReturn() {
    if (returnToResultsOnClose) {
      returnToResultsOnClose = false;
      if (settingsModal) settingsModal.classList.remove('active');
      document.body.classList.add('results-active');
      resultsModal.classList.add('active');
    } else {
      navigateToScreen('home');
    }
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', closeSettingsAndReturn);
  }

  if (btnCancelSettings) {
    btnCancelSettings.addEventListener('click', closeSettingsAndReturn);
  }

  btnStartGame.addEventListener('click', () => {
    sound.init();
    startGame();
  });

  btnPlayAgain.addEventListener('click', () => {
    startGame();
  });

  btnChangeConfig.addEventListener('click', () => {
    navigateToScreen('home');
  });

  btnMenu.addEventListener('click', () => {
    navigateToScreen('home');
  });

  btnReset.addEventListener('click', () => {
    sound.init();
    infoModal.classList.remove('active');
    startGame();
    showArenaToast('Round Reset!', '#1c0a00');
  });

  let prevStatusBeforeInfo = 'menu';
  btnInfo.addEventListener('click', () => {
    if (infoModal.classList.contains('active')) {
      btnCloseInfo.click();
      return;
    }
    prevStatusBeforeInfo = state.status;
    if (state.status === 'playing') {
      state.status = 'paused';
      state.draggingNode = null;
      extractionFrame.classList.remove('dragging-active');
      infoModal.classList.add('active');
    } else {
      navigateToScreen('help');
    }
  });

  btnCloseInfo.addEventListener('click', () => {
    infoModal.classList.remove('active');
    if (prevStatusBeforeInfo === 'playing' && state.status === 'paused') {
      state.status = 'playing';
      document.body.classList.add('playing-active');
      state.lastFrameTime = performance.now();
    } else {
      navigateToScreen('home');
    }
  });

  btnHint.addEventListener('click', () => {
    if (state.status !== 'playing') return;
    state.hintsUsed += 1;
    state.hintPulseTimer = 1.5;
    showArenaToast(`Locating #${state.nextTarget}...`, '#1c0a00');
  });

  btnSound.addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    savePersistedSettings();
    syncSettingsUI();
  });

  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape' && registerModal && registerModal.classList.contains('active')) {
        btnCancelRegister.click();
      }
      return;
    }

    if (e.key === 'h' || e.key === 'H') {
      btnHint.click();
    } else if (e.key === 'm' || e.key === 'M') {
      btnSound.click();
    } else if (e.key === 'r' || e.key === 'R') {
      btnReset.click();
    } else if (e.key === 'i' || e.key === 'I') {
      btnInfo.click();
    } else if (e.key === 'Escape') {
      if (registerModal && registerModal.classList.contains('active')) {
        btnCancelRegister.click();
      } else if (trajectoryModal && trajectoryModal.classList.contains('active')) {
        trajectoryModal.classList.remove('active');
      } else if (leaderboardModal && leaderboardModal.classList.contains('active')) {
        btnCloseLeaderboard.click();
      } else if (levelSelectModal && levelSelectModal.classList.contains('active')) {
        btnCloseLevelSelect.click();
      } else if (settingsModal && settingsModal.classList.contains('active')) {
        btnCloseSettings.click();
      } else if (infoModal.classList.contains('active')) {
        btnCloseInfo.click();
      } else {
        btnMenu.click();
      }
    }
  });

  // --- iOS PWA Installation Prompt ---
  const IOS_INSTALL_DISMISSED_KEY = 'brainsweep_ios_install_dismissed_v1';

  function initIosInstallPrompt() {
    const iosBanner = document.getElementById('iosInstallBanner');
    const btnCloseIos = document.getElementById('btnCloseIosBanner');
    if (!iosBanner) return;

    // 1. Check if user previously dismissed the prompt
    try {
      if (localStorage.getItem(IOS_INSTALL_DISMISSED_KEY) === 'true') {
        return;
      }
    } catch {
      // ignore storage errors
    }

    // 2. Detect iOS device (iPhone, iPad, iPod, including iPadOS 13+ desktop-class Safari)
    const ua = window.navigator.userAgent || '';
    const isIOS =
      (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    // 3. Detect if app is NOT running in standalone mode
    const isStandalone =
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

    if (isIOS && !isStandalone) {
      iosBanner.hidden = false;
    }

    if (btnCloseIos) {
      btnCloseIos.addEventListener('click', () => {
        iosBanner.hidden = true;
        try {
          localStorage.setItem(IOS_INSTALL_DISMISSED_KEY, 'true');
        } catch {
          // ignore storage errors
        }
      });
    }
  }

  // --- Global Leaderboard & Player Registration Logic ---
  const registerModal = document.getElementById('registerModal');
  const registerForm = document.getElementById('registerForm');
  const regUsernameInput = document.getElementById('regUsername');
  const regEmailInput = document.getElementById('regEmail');
  const regErrorMsg = document.getElementById('regErrorMsg');
  const btnCancelRegister = document.getElementById('btnCancelRegister');
  const btnSubmitRegisterText = document.getElementById('btnSubmitRegisterText');

  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardTabs = document.getElementById('leaderboardTabs');
  const leaderboardTableBody = document.getElementById('leaderboardTableBody');
  const lbUserIndicator = document.getElementById('lbUserIndicator');
  const btnCloseLeaderboard = document.getElementById('btnCloseLeaderboard');
  const btnRefreshLeaderboard = document.getElementById('btnRefreshLeaderboard');
  const btnLbChangeUser = document.getElementById('btnLbChangeUser');

  const btnLeaderboardHome = document.getElementById('btnLeaderboardHome');
  const btnLeaderboardResults = document.getElementById('btnLeaderboardResults');
  const btnChangeUser = document.getElementById('btnChangeUser');
  const btnResultsChangeUser = document.getElementById('btnResultsChangeUser');
  const btnSetupMenuIcon = document.getElementById('btnSetupMenuIcon');
  const btnResultsMenuIcon = document.getElementById('btnResultsMenuIcon');
  const currentPlayerNameEl = document.getElementById('currentPlayerName');
  const resultsPlayerNameEl = document.getElementById('resultsPlayerName');

  let activeLeaderboardTab = 'easy';
  let pendingPostRegistrationCallback = null;
  let pendingScorePayload = null;

  function getSavedUser() {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.username && parsed.email) {
        return {
          username: String(parsed.username).trim(),
          email: String(parsed.email).trim().toLowerCase(),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  function saveUserToLocalStorage(username, email) {
    const cleanUser = {
      username: String(username).trim(),
      email: String(email).trim().toLowerCase(),
    };
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(cleanUser));
    } catch {
      // ignore storage errors
    }
    syncPlayerProfileUI();
    return cleanUser;
  }

  function syncPlayerProfileUI() {
    const user = getSavedUser();
    const displayName = user ? user.username : 'GUEST';
    if (currentPlayerNameEl) {
      currentPlayerNameEl.textContent = displayName;
    }
    if (resultsPlayerNameEl) {
      resultsPlayerNameEl.textContent = displayName;
    }
    if (lbUserIndicator) {
      lbUserIndicator.textContent = user ? `Playing as: ${user.username}` : 'Playing as: Guest';
    }
  }

  // Local mirror helper so leaderboard & duplicate username checks also work before Web App URL is pasted
  function loadLocalLeaderboardMirror() {
    try {
      const raw = localStorage.getItem(LOCAL_LB_FALLBACK_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLocalLeaderboardMirror(rows) {
    try {
      localStorage.setItem(LOCAL_LB_FALLBACK_KEY, JSON.stringify(rows));
    } catch {
      // ignore
    }
  }

  function upsertLocalLeaderboardMirror({ username, email, difficulty, sessionScore, exactTotal }) {
    const rows = loadLocalLeaderboardMirror();
    const normUser = username.trim().toLowerCase();
    const normEmail = email.trim().toLowerCase();
    const existing = rows.find((r) => String(r.username).trim().toLowerCase() === normUser);
    const addScore = Math.max(0, parseInt(sessionScore, 10) || 0);

    const key =
      difficulty === 'medium'
        ? 'mediumScore'
        : difficulty === 'hard'
          ? 'hardScore'
          : 'easyScore';

    if (existing) {
      if (existing.email && existing.email.toLowerCase() !== normEmail) {
        return {
          status: 'error',
          code: 'USERNAME_TAKEN',
          message: 'Username already taken. Please choose another.',
        };
      }
      const prevTotal = Math.max(0, parseInt(existing[key], 10) || 0);
      const newTotal =
        exactTotal !== undefined ? Math.max(0, parseInt(exactTotal, 10) || 0) : prevTotal + addScore;
      existing[key] = newTotal;
      saveLocalLeaderboardMirror(rows);
      return { status: 'ok', updated: true, sessionScore: addScore, newTotal };
    }

    const initialTotal =
      exactTotal !== undefined ? Math.max(0, parseInt(exactTotal, 10) || 0) : addScore;
    rows.push({
      username: username.trim(),
      email: normEmail,
      easyScore: difficulty === 'easy' ? initialTotal : 0,
      mediumScore: difficulty === 'medium' ? initialTotal : 0,
      hardScore: difficulty === 'hard' ? initialTotal : 0,
    });
    saveLocalLeaderboardMirror(rows);
    return { status: 'ok', created: true, sessionScore: addScore, newTotal: initialTotal };
  }

  function getLocalTop50ForDifficulty(difficulty) {
    const rows = loadLocalLeaderboardMirror();
    const key =
      difficulty === 'medium'
        ? 'mediumScore'
        : difficulty === 'hard'
          ? 'hardScore'
          : 'easyScore';

    return rows
      .filter((r) => r.username && (Number(r[key]) || 0) > 0)
      .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
      .slice(0, 50)
      .map((r, idx) => ({
        position: idx + 1,
        username: r.username,
        score: Number(r[key]) || 0,
      }));
  }

  function applyBackendTotalToUI(diff, newTotal) {
    if (!Number.isFinite(newTotal)) return;
    const resTotalScoreBanner = document.getElementById('resTotalScoreBanner');
    const resTimeBox = document.getElementById('resTime');
    if (resTotalScoreBanner) {
      resTotalScoreBanner.textContent = `Total Score: ${newTotal}`;
    }
    if (resTimeBox) {
      resTimeBox.textContent = String(newTotal);
    }
    // Sync local difficulty badge total with authoritative backend cumulative total
    try {
      const scores = loadHighScores();
      if (scores[diff]) {
        scores[diff].total = newTotal;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
        updateHighScoreBadges();
      }
    } catch {
      // ignore
    }
  }

  // Send POST request to Google Apps Script Web App with sessionScore
  async function postScoreToBackend({ username, email, difficulty, sessionScore, action = 'submit' }) {
    const cleanSessionScore = Math.max(0, parseInt(sessionScore, 10) || 0);
    if (!isApiUrlConfigured()) {
      return upsertLocalLeaderboardMirror({
        username,
        email,
        difficulty,
        sessionScore: cleanSessionScore,
      });
    }

    const apiUrl = getLeaderboardApiUrl();
    const response = await fetch(apiUrl, {
      method: 'POST',
      // Use text/plain to avoid CORS preflight block on Google Apps Script Web Apps
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        action,
        username: username.trim(),
        email: email.trim().toLowerCase(),
        difficulty: difficulty || 'easy',
        sessionScore: cleanSessionScore,
        score: cleanSessionScore, // included for backward compatibility
      }),
    });

    const data = await response.json();
    if (data && data.status === 'ok') {
      const backendTotal =
        data.newTotal !== undefined
          ? parseInt(data.newTotal, 10)
          : data.bestScore !== undefined
            ? parseInt(data.bestScore, 10)
            : undefined;

      const mirrorResult = upsertLocalLeaderboardMirror({
        username,
        email,
        difficulty,
        sessionScore: cleanSessionScore,
        exactTotal: backendTotal,
      });
      if (data.newTotal === undefined) {
        data.newTotal = mirrorResult.newTotal;
      }
    }
    return data;
  }

  // Fetch Top 50 for a difficulty tab from Google Apps Script Web App
  async function fetchLeaderboardEntries(difficulty) {
    if (!isApiUrlConfigured()) {
      return getLocalTop50ForDifficulty(difficulty);
    }

    const apiUrl = getLeaderboardApiUrl();
    const url = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}difficulty=${encodeURIComponent(difficulty)}`;
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (data && data.status === 'ok' && Array.isArray(data.entries)) {
      return data.entries;
    }
    throw new Error((data && data.message) || 'Failed to load leaderboard');
  }

  function showRegistrationError(msg) {
    if (!regErrorMsg) return;
    regErrorMsg.textContent = msg;
    regErrorMsg.hidden = false;
  }

  function clearRegistrationError() {
    if (!regErrorMsg) return;
    regErrorMsg.textContent = '';
    regErrorMsg.hidden = true;
  }

  function openRegistrationModal({ prefill = true, onComplete = null } = {}) {
    if (!registerModal) return;
    clearRegistrationError();
    pendingPostRegistrationCallback = onComplete;

    const existing = getSavedUser();
    if (prefill && existing) {
      regUsernameInput.value = existing.username;
      regEmailInput.value = existing.email;
    } else {
      regUsernameInput.value = '';
      regEmailInput.value = '';
    }

    registerModal.classList.add('active');
    setTimeout(() => regUsernameInput.focus(), 60);
  }

  function closeRegistrationModal() {
    if (!registerModal) return;
    registerModal.classList.remove('active');
    clearRegistrationError();
  }

  function renderLeaderboardRows(entries) {
    if (!leaderboardTableBody) return;
    leaderboardTableBody.innerHTML = '';

    if (!entries || entries.length === 0) {
      leaderboardTableBody.innerHTML =
        '<tr><td colspan="3" class="lb-status-cell">No scores recorded for this difficulty yet. Be #1!</td></tr>';
      return;
    }

    const currentUser = getSavedUser();
    const currentUsernameLower = currentUser ? currentUser.username.toLowerCase() : '';

    entries.slice(0, 50).forEach((item, index) => {
      const pos = item.position || index + 1;
      const tr = document.createElement('tr');

      if (pos <= 3) {
        tr.classList.add(`rank-${pos}`);
      }
      if (
        currentUsernameLower &&
        String(item.username || '').trim().toLowerCase() === currentUsernameLower
      ) {
        tr.classList.add('is-current-user');
      }

      const tdPos = document.createElement('td');
      tdPos.className = 'col-pos';
      tdPos.textContent = `#${pos}`;

      const tdName = document.createElement('td');
      tdName.className = 'col-name';
      tdName.textContent = String(item.username || 'Anonymous');

      const tdPts = document.createElement('td');
      tdPts.className = 'col-pts';
      tdPts.textContent = String(item.score ?? 0);

      tr.appendChild(tdPos);
      tr.appendChild(tdName);
      tr.appendChild(tdPts);
      leaderboardTableBody.appendChild(tr);
    });
  }

  async function loadLeaderboardTab(difficulty) {
    activeLeaderboardTab = difficulty;
    if (leaderboardTabs) {
      leaderboardTabs.querySelectorAll('.lb-tab').forEach((btn) => {
        const isMatch = btn.dataset.lbDiff === difficulty;
        btn.classList.toggle('active', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
    }

    if (leaderboardTableBody) {
      leaderboardTableBody.innerHTML =
        '<tr><td colspan="3" class="lb-status-cell">Loading Top 50 rankings...</td></tr>';
    }

    try {
      const entries = await fetchLeaderboardEntries(difficulty);
      renderLeaderboardRows(entries);
    } catch {
      const fallbackEntries = getLocalTop50ForDifficulty(difficulty);
      renderLeaderboardRows(fallbackEntries);
    }
  }

  function openLeaderboardModal(defaultDiff = state.difficulty) {
    const user = getSavedUser();
    if (!user) {
      // Prompt registration first if no saved brainsweep_user exists
      openRegistrationModal({
        prefill: false,
        onComplete: () => openLeaderboardModal(defaultDiff),
      });
      return;
    }

    syncPlayerProfileUI();
    leaderboardModal.classList.add('active');
    loadLeaderboardTab(defaultDiff || 'easy');
  }

  function handleGameEndLeaderboardSubmission(difficulty, sessionScore) {
    const user = getSavedUser();
    if (user) {
      postScoreToBackend({
        username: user.username,
        email: user.email,
        difficulty,
        sessionScore,
        action: 'submit_score',
      })
        .then((res) => {
          if (res && res.status === 'ok' && res.newTotal !== undefined) {
            applyBackendTotalToUI(difficulty, Number(res.newTotal));
          }
        })
        .catch(() => {
          // Local cumulative fallback already displayed
        });
    } else {
      // No saved user in localStorage: prompt Registration Modal to record their sessionScore
      pendingScorePayload = { difficulty, sessionScore };
      openRegistrationModal({
        prefill: false,
        onComplete: () => {
          pendingScorePayload = null;
        },
      });
    }
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearRegistrationError();

      const username = (regUsernameInput.value || '').trim();
      const email = (regEmailInput.value || '').trim().toLowerCase();

      if (!username) {
        showRegistrationError('Username cannot be empty.');
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        showRegistrationError('Please enter a valid email address.');
        return;
      }

      const prevBtnText = btnSubmitRegisterText ? btnSubmitRegisterText.textContent : 'SAVE & CONTINUE';
      if (btnSubmitRegisterText) {
        btnSubmitRegisterText.textContent = 'VERIFYING...';
      }

      try {
        const diffToSubmit = pendingScorePayload ? pendingScorePayload.difficulty : state.difficulty;
        const sessionScoreToSubmit = pendingScorePayload ? pendingScorePayload.sessionScore : 0;

        const result = await postScoreToBackend({
          username,
          email,
          difficulty: diffToSubmit,
          sessionScore: sessionScoreToSubmit,
          action: 'register',
        });

        if (
          result &&
          (result.code === 'USERNAME_TAKEN' ||
            (result.status === 'error' &&
              String(result.message || '').toLowerCase().includes('already taken')))
        ) {
          showRegistrationError('Username already taken. Please choose another.');
          return;
        }

        if (result && result.status === 'error') {
          showRegistrationError(result.message || 'Registration failed. Please try again.');
          return;
        }

        if (result && result.newTotal !== undefined) {
          applyBackendTotalToUI(diffToSubmit, Number(result.newTotal));
        }

        // Save verified user to localStorage
        saveUserToLocalStorage(username, email);
        pendingScorePayload = null;
        closeRegistrationModal();

        if (typeof pendingPostRegistrationCallback === 'function') {
          const cb = pendingPostRegistrationCallback;
          pendingPostRegistrationCallback = null;
          cb();
        }
      } catch {
        const diffToSubmit = pendingScorePayload ? pendingScorePayload.difficulty : state.difficulty;
        const sessionScoreToSubmit = pendingScorePayload ? pendingScorePayload.sessionScore : 0;
        const localCheck = upsertLocalLeaderboardMirror({
          username,
          email,
          difficulty: diffToSubmit,
          sessionScore: sessionScoreToSubmit,
        });
        if (localCheck.code === 'USERNAME_TAKEN') {
          showRegistrationError('Username already taken. Please choose another.');
          return;
        }
        if (localCheck.newTotal !== undefined) {
          applyBackendTotalToUI(diffToSubmit, Number(localCheck.newTotal));
        }
        saveUserToLocalStorage(username, email);
        pendingScorePayload = null;
        closeRegistrationModal();
        if (typeof pendingPostRegistrationCallback === 'function') {
          const cb = pendingPostRegistrationCallback;
          pendingPostRegistrationCallback = null;
          cb();
        }
      } finally {
        if (btnSubmitRegisterText) {
          btnSubmitRegisterText.textContent = prevBtnText;
        }
      }
    });
  }

  if (btnCancelRegister) {
    btnCancelRegister.addEventListener('click', () => {
      pendingPostRegistrationCallback = null;
      pendingScorePayload = null;
      closeRegistrationModal();
    });
  }

  if (btnLeaderboardHome) {
    btnLeaderboardHome.addEventListener('click', () => {
      openLeaderboardModal(state.difficulty);
    });
  }

  if (btnLeaderboardResults) {
    btnLeaderboardResults.addEventListener('click', () => {
      returnToResultsOnClose = true;
      resultsModal.classList.remove('active');
      openLeaderboardModal(state.difficulty);
    });
  }

  if (btnChangeUser) {
    btnChangeUser.addEventListener('click', () => {
      openRegistrationModal({ prefill: true });
    });
  }

  if (btnResultsChangeUser) {
    btnResultsChangeUser.addEventListener('click', () => {
      openRegistrationModal({ prefill: true });
    });
  }

  if (btnSetupMenuIcon) {
    btnSetupMenuIcon.addEventListener('click', () => {
      btnInfo.click();
    });
  }

  if (btnResultsMenuIcon) {
    btnResultsMenuIcon.addEventListener('click', () => {
      returnToResultsOnClose = true;
      resultsModal.classList.remove('active');
      syncSettingsUI();
      if (settingsModal) {
        settingsModal.classList.add('active');
      }
    });
  }

  if (btnLbChangeUser) {
    btnLbChangeUser.addEventListener('click', () => {
      leaderboardModal.classList.remove('active');
      openRegistrationModal({
        prefill: true,
        onComplete: () => openLeaderboardModal(activeLeaderboardTab),
      });
    });
  }

  if (btnCloseLeaderboard) {
    btnCloseLeaderboard.addEventListener('click', () => {
      if (returnToResultsOnClose) {
        returnToResultsOnClose = false;
        leaderboardModal.classList.remove('active');
        document.body.classList.add('results-active');
        resultsModal.classList.add('active');
      } else {
        navigateToScreen('home');
      }
    });
  }

  if (btnRefreshLeaderboard) {
    btnRefreshLeaderboard.addEventListener('click', () => {
      loadLeaderboardTab(activeLeaderboardTab);
    });
  }

  if (leaderboardTabs) {
    leaderboardTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.lb-tab');
      if (!tab) return;
      loadLeaderboardTab(tab.dataset.lbDiff);
    });
  }

  // --- Initial Boot ---
  loadPersistedSettings();
  syncPlayerProfileUI();
  initIosInstallPrompt();
  syncNetworkModeUI();
  syncSettingsUI();
  resizeCanvas();
  createNodes();
  updateHUD();
  state.lastFrameTime = performance.now();

  // If app loads while OFFLINE, bypass the difficulty selection screen and launch Survival Sweep immediately
  if (!navigator.onLine) {
    startGame();
  }

  requestAnimationFrame(tick);
})();
