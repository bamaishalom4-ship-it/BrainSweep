/**
 * BrainSweep — 60-Second Number Rush
 * Fast-paced moving-number puzzle & B2B engagement widget
 * Includes 100% Offline PWA Support, Daily Sweep, Streaks & Survival Sweep Mode
 */

(() => {
  // --- Central Config (Phase 0) ---
  function getAppConfig() {
    return window.BRAINSWEEP_CONFIG || {};
  }

  const DEFAULT_LEADERBOARD_API_URL =
    'https://script.google.com/macros/s/AKfycbziXn-4cNUEga8XpnoPAF22gOtCH9cIFaj2HojI1A4Aap_yNzCWkss37ne3U3kEic-A/exec';
  const USER_STORAGE_KEY = 'brainsweep_user';
  const LOCAL_LB_FALLBACK_KEY = 'brainsweep_local_lb_mirror_v1';
  const LOCAL_ROUNDS_FALLBACK_KEY = 'brainsweep_local_rounds_v1';
  const DAILY_HISTORY_KEY = 'brainsweep_daily_history_v1';
  const STREAK_STORAGE_KEY = 'brainsweep_streak_v1';
  const TUTORIAL_SEEN_KEY = 'brainsweep_tutorial_seen_v1';
  const FIRST_PLAY_KEY = 'brainsweep_first_play_v1';

  function getLeaderboardApiUrl() {
    const cfg = getAppConfig();
    if (
      cfg.leaderboardApiUrl &&
      String(cfg.leaderboardApiUrl).startsWith('https://script.google.com/')
    ) {
      return String(cfg.leaderboardApiUrl).trim();
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

  function trackEvent(name, props = {}) {
    if (window.BrainSweepAnalytics && typeof window.BrainSweepAnalytics.track === 'function') {
      window.BrainSweepAnalytics.track(name, props);
    }
  }

  function postEmbedEvent(type, payload = {}) {
    if (
      window.BrainSweepAnalytics &&
      typeof window.BrainSweepAnalytics.postEmbedMessage === 'function'
    ) {
      window.BrainSweepAnalytics.postEmbedMessage(type, payload);
    }
  }

  // --- Deterministic PRNG (mulberry32) & Africa/Lagos Date Helpers for Daily Sweep ---
  function getLagosDateString(dateObj = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(dateObj);
      const y = parts.find((p) => p.type === 'year')?.value || '2026';
      const m = parts.find((p) => p.type === 'month')?.value || '01';
      const d = parts.find((p) => p.type === 'day')?.value || '01';
      return `${y}-${m}-${d}`;
    } catch {
      const d = new Date(dateObj.getTime() + 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    }
  }

  function getPreviousLagosDateString(dateKey) {
    const [y, m, d] = String(dateKey || getLagosDateString())
      .split('-')
      .map((n) => parseInt(n, 10));
    const utc = Date.UTC(y || 2026, (m || 1) - 1, (d || 1) - 1, 12, 0, 0);
    return getLagosDateString(new Date(utc));
  }

  function getDailyPuzzleNumber(dateKey = getLagosDateString()) {
    const launchStr = (getAppConfig().dailyLaunchDate || '2026-11-01').trim();
    const parseUtcDay = (str) => {
      const [y, m, d] = str.split('-').map((n) => parseInt(n, 10));
      return Date.UTC(y || 2026, (m || 1) - 1, d || 1);
    };
    const diffDays = Math.floor((parseUtcDay(dateKey) - parseUtcDay(launchStr)) / 86400000);
    return Math.max(1, diffDays + 1);
  }

  function hashStringToSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRoundId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // --- 1. Difficulty Progression & Pool Ratios Configuration (Online Mode) ---
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
      decoyPenaltySec: 1.0,
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
      decoyPenaltySec: 1.5,
    },
    hard: {
      id: 'hard',
      label: 'Hard',
      poolSize: 50,
      targetCount: 25,
      distractorCount: 25,
      targetRatio: 0.5, // 50% (~2.4s per target)
      durationSec: 60,
      baseSpeed: 98, // High-velocity trajectories for 50-node pool
      maxRadius: 17,
      decoyPenaltySec: 2.0,
    },
  };

  // --- Offline "Survival Sweep" Mode Configuration ---
  const OFFLINE_SURVIVAL_CONFIG = {
    id: 'offline_survival',
    label: 'Survival Sweep (Offline)',
    activePoolSize: 17, // 1 active sequential target + 16 moving decoys on screen at any time
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
  const btnStartDailySweep = document.getElementById('btnStartDailySweep');
  const dailySweepBtnLabel = document.getElementById('dailySweepBtnLabel');
  const dailySweepStatusSub = document.getElementById('dailySweepStatusSub');
  const homeStreakBadge = document.getElementById('homeStreakBadge');
  const resStreakBadge = document.getElementById('resStreakBadge');
  const btnPlayAgain = document.getElementById('btnPlayAgain');
  const btnChangeConfig = document.getElementById('btnChangeConfig');
  const btnShareResult = document.getElementById('btnShareResult');
  const btnEmbedSponsorCta = document.getElementById('btnEmbedSponsorCta');
  const embedSponsorCtaText = document.getElementById('embedSponsorCtaText');
  const embedSponsorBar = document.getElementById('embedSponsorBar');
  const embedBrandLogoImg = document.getElementById('embedBrandLogoImg');
  const embedSponsorTextEl = document.getElementById('embedSponsorTextEl');
  const zeroScoreHelpWrap = document.getElementById('zeroScoreHelpWrap');
  const btnZeroScoreHowToPlay = document.getElementById('btnZeroScoreHowToPlay');
  const resSecondStatLabel = document.getElementById('resSecondStatLabel');
  const tapToPlayOverlay = document.getElementById('tapToPlayOverlay');
  const tapOverlayBadge = document.getElementById('tapOverlayBadge');
  const tapOverlayTitle = document.getElementById('tapOverlayTitle');
  const tapOverlaySub = document.getElementById('tapOverlaySub');
  const btnTapToPlayAction = document.getElementById('btnTapToPlayAction');
  const tutorialOverlay = document.getElementById('tutorialOverlay');
  const tutorialDemoNode = document.getElementById('tutorialDemoNode');
  const btnSkipTutorial = document.getElementById('btnSkipTutorial');
  const btnStartFromTutorial = document.getElementById('btnStartFromTutorial');
  const unlicensedEmbedOverlay = document.getElementById('unlicensedEmbedOverlay');
  const unlicensedSiteLink = document.getElementById('unlicensedSiteLink');

  const btnHint = document.getElementById('btnHint');
  const btnSound = document.getElementById('btnSound');
  const btnMenu = document.getElementById('btnMenu');
  const btnReset = document.getElementById('btnReset');
  const btnInfo = document.getElementById('btnInfo');
  const btnCloseInfo = document.getElementById('btnCloseInfo');

  // --- Game State ---
  const sound = new SoundEngine();

  const state = {
    status: 'menu', // 'menu' | 'ready' | 'tutorial' | 'playing' | 'paused' | 'ended'
    isOfflineMode: !navigator.onLine,
    isEmbedMode: false,
    embedLicensed: true,
    publisherDomain: '',
    isDailyMode: false,
    isDailyPractice: false,
    dailyDateKey: getLagosDateString(),
    roundId: '',
    difficulty: 'easy',
    pattern: 'spiral',
    theme: 'amber',
    brandColor: '',
    sponsorText: '',
    ctaText: '',
    ctaUrl: '',
    quickFlick: true,
    memoryMode: false,
    largeNumbers: false,
    reducedMotion: false,
    lastResultSummary: null,

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

  // --- Daily Sweep History & Consecutive Daily Streak Persistence ---
  function loadDailyHistory() {
    try {
      const raw = localStorage.getItem(DAILY_HISTORY_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function hasCompletedDailyToday(diff = state.difficulty) {
    const today = getLagosDateString();
    const history = loadDailyHistory();
    return Boolean(history[today] && history[today][diff]);
  }

  function recordDailyCompletion(diff, score, timeTaken, rank) {
    const today = getLagosDateString();
    try {
      const history = loadDailyHistory();
      if (!history[today]) history[today] = {};
      if (!history[today][diff]) {
        history[today][diff] = {
          score,
          timeTaken: Number(timeTaken.toFixed(2)),
          rank,
          completedAt: new Date().toISOString(),
        };
        localStorage.setItem(DAILY_HISTORY_KEY, JSON.stringify(history));
      }
    } catch {
      // ignore storage errors
    }
    return updateDailyStreakOnCompletion(today);
  }

  function loadDailyStreak() {
    try {
      const raw = localStorage.getItem(STREAK_STORAGE_KEY);
      if (!raw) return { current: 0, longest: 0, lastDate: '' };
      const parsed = JSON.parse(raw);
      return {
        current: Math.max(0, parseInt(parsed.current, 10) || 0),
        longest: Math.max(0, parseInt(parsed.longest, 10) || 0),
        lastDate: String(parsed.lastDate || ''),
      };
    } catch {
      return { current: 0, longest: 0, lastDate: '' };
    }
  }

  function getActiveStreakCount() {
    const s = loadDailyStreak();
    if (!s.lastDate) return 0;
    const today = getLagosDateString();
    const yesterday = getPreviousLagosDateString(today);
    if (s.lastDate === today || s.lastDate === yesterday) {
      return s.current;
    }
    return 0;
  }

  function updateDailyStreakOnCompletion(todayKey = getLagosDateString()) {
    const s = loadDailyStreak();
    if (s.lastDate !== todayKey) {
      const yesterday = getPreviousLagosDateString(todayKey);
      if (s.lastDate === yesterday) {
        s.current = (s.current || 0) + 1;
      } else {
        s.current = 1;
      }
      s.longest = Math.max(s.longest || 0, s.current);
      s.lastDate = todayKey;
      try {
        localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(s));
      } catch {
        // ignore storage errors
      }
    }
    syncDailyAndStreakUI();
    return s;
  }

  function syncDailyAndStreakUI() {
    const activeStreak = getActiveStreakCount();
    const streakText = `🔥 ${activeStreak}`;
    if (homeStreakBadge) {
      homeStreakBadge.textContent = streakText;
      homeStreakBadge.title = `Daily Sweep Streak: ${activeStreak} day${activeStreak === 1 ? '' : 's'}`;
    }
    if (resStreakBadge) {
      resStreakBadge.textContent = streakText;
    }

    const today = getLagosDateString();
    const puzzleNum = getDailyPuzzleNumber(today);
    const diffLabel = DIFFICULTIES[state.difficulty].label.toUpperCase();
    const history = loadDailyHistory();
    const todayRecord = history[today] && history[today][state.difficulty];

    if (dailySweepBtnLabel) {
      dailySweepBtnLabel.textContent = `⚡ DAILY SWEEP #${puzzleNum} (${diffLabel})`;
    }
    if (dailySweepStatusSub) {
      if (todayRecord) {
        dailySweepStatusSub.textContent = `Completed (${todayRecord.score}/${DIFFICULTIES[state.difficulty].targetCount} · ${todayRecord.rank}) • Tap for Practice`;
      } else {
        dailySweepStatusSub.textContent = 'Seeded Daily Board • 1 Scored Attempt';
      }
    }
    if (btnStartDailySweep) {
      btnStartDailySweep.hidden = state.isOfflineMode;
    }
  }

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
        extractedCount > 0 &&
        (extractedCount > (prev.extracted || 0) ||
          (extractedCount === prev.extracted && timeTaken < (prev.time || 60)));

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
      return {
        cumulativeTotal,
        isBetter,
        bestSingle: scores[diff].extracted,
      };
    } catch {
      return {
        cumulativeTotal: extractedCount,
        isBetter: extractedCount > 0,
        bestSingle: extractedCount,
      };
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

  const CAROUSEL_DIFFS = ['easy', 'medium', 'hard'];
  let homeCarouselIdx = 0;

  function renderHomeScoreCarouselStep(animate = false) {
    const homeBestScoreBlock = document.getElementById('homeBestScoreBlock');
    const homeBestScoreValue = document.getElementById('homeBestScoreValue');
    const homeBestScoreSub = document.getElementById('homeBestScoreSub');
    if (!homeBestScoreValue || !homeBestScoreSub) return;

    if (state.isOfflineMode) {
      homeBestScoreValue.textContent = String(getOfflineBestScore());
      homeBestScoreSub.textContent = 'OFFLINE MODE';
      return;
    }

    const diffKey = CAROUSEL_DIFFS[homeCarouselIdx % CAROUSEL_DIFFS.length];
    const scores = loadHighScores();
    const rec = scores[diffKey];
    const diffScore = rec ? parseInt(rec.total, 10) || rec.extracted || 0 : 0;

    homeBestScoreValue.textContent = String(diffScore);
    homeBestScoreSub.textContent = `${DIFFICULTIES[diffKey].label.toUpperCase()} MODE`;

    if (animate && !state.reducedMotion) {
      if (homeBestScoreBlock) {
        homeBestScoreBlock.classList.remove('score-cycle-anim');
        void homeBestScoreBlock.offsetWidth;
        homeBestScoreBlock.classList.add('score-cycle-anim');
      }
      homeBestScoreSub.classList.remove('score-cycle-anim');
      void homeBestScoreSub.offsetWidth;
      homeBestScoreSub.classList.add('score-cycle-anim');
    }
  }

  setInterval(() => {
    if (!setupModal || !setupModal.classList.contains('active') || state.isOfflineMode) {
      return;
    }
    homeCarouselIdx = (homeCarouselIdx + 1) % CAROUSEL_DIFFS.length;
    renderHomeScoreCarouselStep(true);
  }, 2400);

  function updateHighScoreBadges() {
    const scores = loadHighScores();

    ['easy', 'medium', 'hard'].forEach((diff) => {
      const cfg = DIFFICULTIES[diff];
      const el = document.getElementById(`best${diff.charAt(0).toUpperCase() + diff.slice(1)}`);
      const rec = scores[diff];
      const tot = rec ? parseInt(rec.total, 10) || rec.extracted || 0 : 0;
      if (!el) return;
      if (!rec) {
        el.textContent = `Best: —/${cfg.targetCount} (Total: 0 pts)`;
      } else {
        el.textContent = `Best: ${rec.extracted}/${cfg.targetCount} (Total: ${tot} pts)`;
      }
    });

    const offlineBest = getOfflineBestScore();
    if (bestOfflineEl) {
      bestOfflineEl.textContent = `Best Offline Score: ${offlineBest}`;
    }
    if (offlineStageBest) {
      offlineStageBest.textContent = `Best Offline Score: ${offlineBest}`;
    }

    renderHomeScoreCarouselStep(false);
    syncDailyAndStreakUI();
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
      prepareArenaWithTapOverlay({ mode: 'offline' });
      showArenaToast('OFFLINE MODE: SURVIVAL SWEEP', '#1c0a00');
    } else {
      showArenaToast('Connection Lost — Offline Mode Active', '#1c0a00');
    }
  });

  window.addEventListener('online', () => {
    syncNetworkModeUI();
    showArenaToast('Back Online — Standard Modes Unlocked', '#1c0a00');
  });

  // --- 2. Randomize Decoy Placement (Online "Gap" Rule, Seeded for Daily Sweep) ---
  function generateTargetAndDistractorLists(poolSize, targetCount, rng = Math.random) {
    const allNumbers = Array.from({ length: poolSize }, (_, idx) => idx + 1);

    const shuffled = [...allNumbers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
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
    const boost = state.theme === 'clear' || state.largeNumbers ? 1.15 : 1.0;
    const effectiveMax = maxAllowed + (state.theme === 'clear' || state.largeNumbers ? 4 : 0);
    const usableArea = Math.max(40000, (canvasWidth - 28) * (canvasHeight - 28));
    const idealRadius = Math.sqrt((usableArea * 0.155) / (count * Math.PI)) * boost;
    return Math.max(12, Math.min(effectiveMax, Math.floor(idealRadius)));
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
    const motionFactor = state.reducedMotion ? 0.6 : 1.0;
    const speed = baseSpeed * motionFactor * (0.9 + (indexSeed % 5) * 0.055);

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

    // 2. Spawn 16 moving decoy numbers alongside the target
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

    // Use deterministic seeded RNG for Daily Sweep (YYYY-MM-DD in Africa/Lagos + difficulty)
    const rng = state.isDailyMode
      ? mulberry32(hashStringToSeed(`${state.dailyDateKey}:${state.difficulty}`))
      : Math.random;

    const { targetNumbers, distractorNumbers, distractorSet } = generateTargetAndDistractorLists(
      cfg.poolSize,
      cfg.targetCount,
      rng
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
      const j = Math.floor(rng() * (i + 1));
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }

    const patternsPool = ['spiral', 'zigzag', 'random', 'wave'];
    const isHard = state.difficulty === 'hard';
    const motionFactor = state.reducedMotion ? 0.6 : 1.0;

    for (let i = 1; i <= count; i++) {
      const assignedPattern =
        state.pattern === 'mixed' ? patternsPool[(i - 1) % patternsPool.length] : state.pattern;

      const slot = slots[(i - 1) % slots.length];
      const jitterX = (rng() - 0.5) * cellW * 0.45;
      const jitterY = (rng() - 0.5) * cellH * 0.45;
      const x = Math.min(canvasWidth - pad, Math.max(pad, pad + (slot.c + 0.5) * cellW + jitterX));
      const y = Math.min(canvasHeight - pad, Math.max(pad, pad + (slot.r + 0.5) * cellH + jitterY));

      const angle = i * 2.399963 + (rng() - 0.5) * 0.5;
      const speed = cfg.baseSpeed * motionFactor * (0.9 + (i % 5) * 0.055);
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
    if (state.reducedMotion) return;
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
    if (state.reducedMotion) return;
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
    if (!ghostLayer || state.reducedMotion) return;

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
    if (!targetHudCard || state.reducedMotion) return;
    targetHudCard.classList.remove('target-pulse');
    void targetHudCard.offsetWidth;
    targetHudCard.classList.add('target-pulse');
  }

  // --- Helper: Dynamic Tray Hint (Phase 6.1) ---
  function formatUpcomingQueueText() {
    if (state.isOfflineMode) {
      return `Find #${state.nextTarget} — skip the decoys (−2.0s)!`;
    }
    if (state.memoryMode) {
      return `Memory Mode: Target ${state.currentStepIndex + 1} of ${state.targetCount}`;
    }
    return `Find #${state.nextTarget} — skip the decoys!`;
  }

  // --- Extraction Logic ---
  function isOutsideExtractionBoundary(x, y, radius) {
    const borderZone = Math.max(28, radius * 1.5);
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

    if (!state.reducedMotion) {
      extractionFrame.classList.add('extraction-flash');
      setTimeout(() => extractionFrame.classList.remove('extraction-flash'), 180);
    }

    const nowSec = performance.now() / 1000;
    const splitSec = Math.max(0.05, nowSec - state.lastExtractTimestamp);
    state.splits.push({ number: node.value, split: splitSec });
    state.lastExtractTimestamp = nowSec;

    const dropX = node.x;
    const dropY = node.y;

    state.currentStepIndex += 1;
    state.streak += 1;
    sound.playExtract(state.currentStepIndex, state.isOfflineMode ? 30 : state.targetCount);
    const activeTheme = getActiveThemeColors();
    spawnExtractParticles(dropX, dropY, activeTheme.primary);

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
      spawnFloatingText(dropX, dropY, `#${node.value} CLEAR!`, activeTheme.accent);
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
    // 1. High-sensitivity target priority: generous touch magnetic radius (+20px) for the active nextTarget
    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const n = state.nodes[i];
      if (n.extracted || n.value !== state.nextTarget) continue;
      const dist = Math.hypot(x - n.x, y - n.y);
      if (dist <= n.radius + 20) {
        return n;
      }
    }

    // 2. Fallback: find closest non-target node within standard touch radius (+10px)
    let bestCandidate = null;
    let bestDist = Infinity;

    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const n = state.nodes[i];
      if (n.extracted) continue;
      const dist = Math.hypot(x - n.x, y - n.y);
      const hitRadius = n.radius + 10;

      if (dist <= hitRadius && dist < bestDist) {
        bestDist = dist;
        bestCandidate = n;
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
      state.peakFlickSpeed = 0;

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

      if (!state.reducedMotion) {
        extractionFrame.classList.add('error-flash');
        setTimeout(() => extractionFrame.classList.remove('error-flash'), 220);
      }

      if (state.isOfflineMode) {
        // Apply -2s decoy timer penalty in Offline Survival Sweep
        state.timeRemaining = Math.max(
          0,
          state.timeRemaining - OFFLINE_SURVIVAL_CONFIG.distractorPenaltySec
        );
        updateTimerDisplay();
        showArenaToast(
          `Decoy! -2.0s Penalty (Find #${state.nextTarget})`,
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
      if (isGapDistractor) {
        // Phase 6.2: Online decoy penalty (-1.0s Easy, -1.5s Medium, -2.0s Hard)
        const penaltySec = DIFFICULTIES[state.difficulty].decoyPenaltySec || 1.0;
        state.timeRemaining = Math.max(0, state.timeRemaining - penaltySec);
        updateTimerDisplay();
        const msg = state.memoryMode
          ? `#${hitNode.value} is a Decoy! -${penaltySec.toFixed(1)}s`
          : `Decoy! -${penaltySec.toFixed(1)}s (Find #${state.nextTarget})`;
        showArenaToast(msg, '#3b0712');
        spawnFloatingText(hitNode.x, hitNode.y, `-${penaltySec.toFixed(1)}s!`, '#ff4d6d');
        updateHUD();
        if (state.timeRemaining <= 0) {
          finishGame(false);
        }
        return;
      }

      const msg = state.memoryMode
        ? `Out of order! Not #${hitNode.value}`
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
    const stepSpeed = Math.hypot(state.dragVelX, state.dragVelY);
    state.peakFlickSpeed = Math.max(state.peakFlickSpeed || 0, stepSpeed);
    state.pointerX = pos.x;
    state.pointerY = pos.y;

    const node = state.draggingNode;
    node.x = pos.x;
    node.y = pos.y;
    node.trail.push({ x: pos.x, y: pos.y });
    if (node.trail.length > 8) node.trail.shift();

    const dragDist = Math.hypot(pos.x - state.dragStartX, pos.y - state.dragStartY);

    if (
      (dragDist >= 8 && isOutsideExtractionBoundary(node.x, node.y, node.radius)) ||
      (state.quickFlick && dragDist >= 34)
    ) {
      completeNodeExtraction(node);
    }
  });

  function handlePointerRelease(e) {
    if (!state.draggingNode) return;
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;

    const node = state.draggingNode;
    const pos = getCanvasCoords(e);
    const dragDist = Math.hypot(pos.x - state.dragStartX, pos.y - state.dragStartY);
    const flickSpeed = Math.max(
      state.peakFlickSpeed || 0,
      Math.hypot(state.dragVelX, state.dragVelY)
    );

    if (
      isOutsideExtractionBoundary(node.x, node.y, node.radius) ||
      (state.quickFlick && (dragDist >= 18 || (dragDist >= 9 && flickSpeed >= 3.2)))
    ) {
      completeNodeExtraction(node);
    } else {
      node.trail = [];
      state.draggingNode = null;
      extractionFrame.classList.remove('dragging-active');
      showArenaToast('Flick or drag slightly to extract!', '#1c0a00');
    }
    state.pointerId = null;
  }

  canvas.addEventListener('pointerup', handlePointerRelease);
  canvas.addEventListener('pointercancel', handlePointerRelease);

  // --- Toast Helper ---
  let toastTimeout = null;
  function showArenaToast(text, bgColor = '') {
    const t = getActiveThemeColors();
    arenaFeedback.textContent = text;
    arenaFeedback.style.background = bgColor && bgColor !== '#1c0a00' ? bgColor : t.bg;
    arenaFeedback.style.color = t.primary;
    arenaFeedback.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      arenaFeedback.classList.remove('show');
    }, 1300);
  }

  // --- Clean, Eye-Friendly Rendering (Dynamic Theme Colors) ---
  function drawBackgroundGrid() {
    const t = getActiveThemeColors();
    ctx.save();
    ctx.strokeStyle = hexToRgba(t.border, 0.08);
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
      ? hexToRgba(t.border, 0.88)
      : hexToRgba(t.border, 0.28);
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
    const t = getActiveThemeColors();
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    drawBackgroundGrid();

    if (state.draggingNode) {
      const dn = state.draggingNode;
      const edgePt = nearestEdgePoint(dn.x, dn.y);

      ctx.save();
      if (dn.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(dn.trail[0].x, dn.trail[0].y);
        for (let idx = 1; idx < dn.trail.length; idx++) {
          ctx.lineTo(dn.trail[idx].x, dn.trail[idx].y);
        }
        ctx.strokeStyle = hexToRgba(t.accent, 0.65);
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.strokeStyle = hexToRgba(t.primary, 0.85);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(dn.x, dn.y);
      ctx.lineTo(edgePt.x, edgePt.y);
      ctx.stroke();

      if (state.quickFlick) {
        const dragDist = Math.hypot(dn.x - state.dragStartX, dn.y - state.dragStartY);
        const progress = Math.min(1, dragDist / 34);
        ctx.setLineDash([]);
        ctx.strokeStyle =
          progress >= 1 ? t.accent : hexToRgba(t.primary, 0.45);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(state.dragStartX, state.dragStartY, 34, 0, Math.PI * 2 * progress);
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
          ctx.strokeStyle = t.accent;
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
          ctx.fillStyle = t.primary;
          ctx.strokeStyle = t.accent;
          ctx.lineWidth = 2.5;
        } else if (isHinting) {
          ctx.fillStyle = t.primary;
          ctx.strokeStyle = t.accent;
          ctx.lineWidth = 2.5;
        } else {
          ctx.fillStyle = t.bg;
          ctx.strokeStyle = t.border;
          ctx.lineWidth = 1.8;
        }

        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDragging || isHinting ? t.bg : t.primary;
        const useClearFont = state.theme === 'clear' || state.largeNumbers;
        const fontSize = useClearFont
          ? Math.max(12, Math.round(r * 0.92))
          : Math.max(8, Math.round(r * 0.56));
        ctx.font = useClearFont
          ? `800 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
          : `${fontSize}px "Press Start 2P", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n.value), n.x, n.y + (useClearFont ? 0.5 : 1));

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
      // Offline Survival Sweep: prominent Extracted count + next target
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

  function hideArenaOverlays() {
    if (tapToPlayOverlay) tapToPlayOverlay.hidden = true;
    if (tutorialOverlay) tutorialOverlay.hidden = true;
  }

  function hasSeenTutorial() {
    try {
      return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1';
    } catch {
      return true;
    }
  }

  function markTutorialSeen() {
    try {
      localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
    } catch {
      // ignore storage errors
    }
  }

  function prepareRoundBoard({ daily = false } = {}) {
    syncNetworkModeUI();
    state.isDailyMode = Boolean(daily) && !state.isOfflineMode;
    state.dailyDateKey = getLagosDateString();
    state.isDailyPractice = state.isDailyMode && hasCompletedDailyToday(state.difficulty);
    state.roundId = createRoundId();

    const durationSec = state.isOfflineMode
      ? OFFLINE_SURVIVAL_CONFIG.durationSec
      : DIFFICULTIES[state.difficulty].durationSec;

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
    state.quickFlick = chkQuickFlick ? chkQuickFlick.checked : true;
    state.memoryMode = chkMemoryMode ? chkMemoryMode.checked : false;

    extractedSlots.innerHTML = '';
    if (ghostLayer) ghostLayer.innerHTML = '';

    closeAllOverlayModals();
    document.body.classList.remove('results-active');
    document.body.classList.add('playing-active');

    resizeCanvas();
    createNodes();
    trayStatusText.textContent = formatUpcomingQueueText();
    updateHUD();
    updateTimerDisplay();
  }

  function prepareArenaWithTapOverlay({ daily = false, mode = 'embed' } = {}) {
    if (!state.embedLicensed) return;
    prepareRoundBoard({ daily });
    state.status = 'ready';
    hideArenaOverlays();
    if (tapToPlayOverlay) {
      const puzzleNum = getDailyPuzzleNumber(state.dailyDateKey);
      if (tapOverlayBadge) {
        tapOverlayBadge.textContent = state.isOfflineMode
          ? 'OFFLINE MODE // SURVIVAL SWEEP'
          : state.isDailyMode
            ? `DAILY SWEEP #${puzzleNum}`
            : `60-SECOND NUMBER RUSH // ${DIFFICULTIES[state.difficulty].label.toUpperCase()}`;
      }
      if (tapOverlayTitle) {
        tapOverlayTitle.textContent = 'TAP TO PLAY';
      }
      if (tapOverlaySub) {
        tapOverlaySub.textContent = state.isOfflineMode
          ? 'Offline endless mode! Spot #1, #2, #3... and flick targets out. Skip decoys (−2.0s).'
          : `Spot the NEXT TARGET (#${state.nextTarget}), skip the decoys, and flick targets out before 60s runs out!`;
      }
      if (btnTapToPlayAction) {
        btnTapToPlayAction.textContent = 'TAP TO PLAY';
      }
      tapToPlayOverlay.hidden = false;
    }
    state.lastFrameTime = performance.now();
  }

  function pauseGameWithOverlay() {
    if (state.status !== 'playing') return;
    state.status = 'paused';
    state.draggingNode = null;
    extractionFrame.classList.remove('dragging-active');
    if (tapToPlayOverlay) {
      if (tapOverlayBadge) tapOverlayBadge.textContent = 'GAME PAUSED';
      if (tapOverlayTitle) tapOverlayTitle.textContent = 'PAUSED — TAP TO RESUME';
      if (tapOverlaySub) {
        tapOverlaySub.textContent = `Timer paused at ${hudTimer ? hudTimer.textContent : ''}. Tap below to continue your round.`;
      }
      if (btnTapToPlayAction) btnTapToPlayAction.textContent = 'TAP TO RESUME';
      tapToPlayOverlay.hidden = false;
    }
  }

  function beginActivePlay() {
    if (!state.embedLicensed) return;
    hideArenaOverlays();
    state.status = 'playing';

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

    const now = performance.now();
    state.lastFrameTime = now;
    state.lastExtractTimestamp = now / 1000;

    try {
      if (!localStorage.getItem(FIRST_PLAY_KEY)) {
        localStorage.setItem(FIRST_PLAY_KEY, '1');
        trackEvent('first_play', {
          difficulty: state.difficulty,
          is_daily: state.isDailyMode,
          is_offline: state.isOfflineMode,
        });
      }
    } catch {
      // ignore storage errors
    }

    trackEvent('game_start', {
      difficulty: state.difficulty,
      pattern: state.pattern,
      theme: state.theme,
      is_daily: state.isDailyMode,
      is_offline: state.isOfflineMode,
    });
    postEmbedEvent('start', {
      difficulty: state.difficulty,
      pattern: state.pattern,
      isDaily: state.isDailyMode,
    });
  }

  function startGame(options = {}) {
    if (!state.embedLicensed) return;
    const isDaily = options && typeof options.daily === 'boolean' ? options.daily : state.isDailyMode;
    const skipTutorialCheck = Boolean(options && options.skipTutorial);

    prepareRoundBoard({ daily: isDaily });

    // One-time skippable 5-second tutorial for first-time players
    if (!skipTutorialCheck && !hasSeenTutorial() && tutorialOverlay) {
      state.status = 'tutorial';
      if (tutorialDemoNode) {
        tutorialDemoNode.textContent = `#${state.nextTarget}`;
      }
      hideArenaOverlays();
      tutorialOverlay.hidden = false;
      state.lastFrameTime = performance.now();
      return;
    }

    beginActivePlay();
  }

  function finishGame(completedAll) {
    state.status = 'ended';
    hideArenaOverlays();
    document.body.classList.remove('playing-active');
    document.body.classList.add('results-active');
    state.draggingNode = null;
    extractionFrame.classList.remove('dragging-active');

    const resultBadge = document.getElementById('resultBadge');
    const resultHeadline = document.getElementById('resultHeadline');
    const resultSubheadline = document.getElementById('resultSubheadline');
    const resSessionScoreBanner = document.getElementById('resSessionScoreBanner');
    const resTotalScoreBanner = document.getElementById('resTotalScoreBanner');

    let shareScore = 0;
    let shareTargetTotal = state.targetCount;
    let shareTimeTaken = 60;
    let shareRank = '—';

    if (state.isOfflineMode) {
      const extractedCount = state.currentStepIndex;
      const bestOffline = saveOfflineBestScore(extractedCount);
      shareScore = extractedCount;
      shareTimeTaken = 60;

      if (extractedCount > 0) {
        sound.playVictory();
      } else {
        sound.playError();
      }

      resultBadge.textContent = 'OFFLINE MODE: SURVIVAL SWEEP';
      resultHeadline.textContent =
        extractedCount === 0
          ? "Time's Up! 0 Numbers Cleared"
          : `Time's up! You extracted ${extractedCount} numbers.`;
      resultSubheadline.textContent =
        extractedCount === 0
          ? 'No numbers cleared this round.'
          : `60-second endless sweep complete. Best Offline Score: ${bestOffline}.`;

      if (zeroScoreHelpWrap) zeroScoreHelpWrap.hidden = extractedCount > 0;
      if (resSecondStatLabel) resSecondStatLabel.textContent = 'BEST OFFLINE';

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
      const accuracyText =
        totalAttempts > 0 ? `${Math.round((extractedCount / totalAttempts) * 100)}%` : '—';
      document.getElementById('resAccuracy').textContent = accuracyText;
      document.getElementById('resCognitiveRank').textContent = `Best Offline: ${bestOffline}`;

      state.lastResultSummary = {
        mode: 'offline',
        score: extractedCount,
        bestOffline,
      };
    } else {
      const sessionScore = completedAll ? state.targetCount : state.currentStepIndex;
      const timeTaken = Math.min(
        state.totalDuration,
        Math.max(0.1, state.totalDuration - state.timeRemaining)
      );
      const timeTakenMs = Math.round(timeTaken * 1000);
      shareScore = sessionScore;
      shareTargetTotal = state.targetCount;
      shareTimeTaken = timeTaken;

      if (completedAll) {
        sound.playVictory();
      } else {
        sound.playError();
      }

      const highScoreRes = saveHighScore(
        state.difficulty,
        sessionScore,
        state.targetCount,
        timeTaken
      );
      const localCumulativeTotal = highScoreRes.cumulativeTotal;
      const isNewPersonalBest = highScoreRes.isBetter;

      recordGameStatistics(
        state.difficulty,
        sessionScore,
        state.targetCount,
        timeTaken,
        state.timeRemaining,
        completedAll
      );

      const totalAttempts = sessionScore + state.mistakes;
      const accuracyNum =
        totalAttempts > 0 ? Math.round((sessionScore / totalAttempts) * 100) : null;
      const accuracyText = accuracyNum !== null ? `${accuracyNum}%` : '—';

      const completionRatio = sessionScore / state.targetCount;
      let rank = 'C';
      if (sessionScore === 0) rank = '—';
      else if (completedAll && (accuracyNum === null || accuracyNum >= 95)) rank = 'S+ Elite';
      else if (completedAll) rank = 'S';
      else if (completionRatio >= 0.8) rank = 'A';
      else if (completionRatio >= 0.55) rank = 'B';
      shareRank = rank;

      if (state.isDailyMode && sessionScore > 0) {
        recordDailyCompletion(state.difficulty, sessionScore, timeTaken, rank);
        trackEvent('daily_sweep_complete', {
          difficulty: state.difficulty,
          score: sessionScore,
          time_sec: Number(timeTaken.toFixed(1)),
          completed_all: completedAll,
          practice: state.isDailyPractice,
        });
      }

      checkAchievements({
        sessionScore,
        difficulty: state.difficulty,
        completedAll,
        timeRemaining: state.timeRemaining,
        memoryMode: state.memoryMode,
        pattern: state.pattern,
        notify: true,
      });

      const cfg = DIFFICULTIES[state.difficulty];
      const puzzleNum = getDailyPuzzleNumber(state.dailyDateKey);

      if (state.isDailyMode) {
        resultBadge.textContent = state.isDailyPractice
          ? `DAILY SWEEP #${puzzleNum} // PRACTICE`
          : `DAILY SWEEP #${puzzleNum}`;
      } else {
        resultBadge.textContent = completedAll ? 'CHALLENGE CONQUERED' : 'TIME EXPIRED (60.0s)';
      }

      if (sessionScore === 0) {
        resultHeadline.textContent = `0 of ${state.targetCount} Cleared`;
        resultSubheadline.textContent = 'Your speed breakdown.';
      } else if (completedAll) {
        resultHeadline.textContent = `Cleared ${state.targetCount} Targets in ${timeTaken.toFixed(1)}s!`;
        resultSubheadline.textContent = `Your speed breakdown (${cfg.label} • Best: ${highScoreRes.bestSingle}/${state.targetCount}).`;
      } else {
        resultHeadline.textContent = `Extracted ${sessionScore} of ${state.targetCount} Targets`;
        resultSubheadline.textContent = `Your speed breakdown (${cfg.label} • Best: ${highScoreRes.bestSingle}/${state.targetCount}).`;
      }

      if (zeroScoreHelpWrap) zeroScoreHelpWrap.hidden = sessionScore > 0;
      if (resSecondStatLabel) resSecondStatLabel.textContent = 'TOTAL SCORE';

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
      document.getElementById('resAccuracy').textContent = accuracyText;
      document.getElementById('resCognitiveRank').textContent = `Sweep Rank: ${rank}`;

      state.lastResultSummary = {
        mode: state.isDailyMode ? 'daily' : 'standard',
        dailyNum: puzzleNum,
        difficulty: state.difficulty,
        diffLabel: cfg.label,
        score: sessionScore,
        targetCount: state.targetCount,
        timeTaken,
        rank,
        streak: getActiveStreakCount(),
      };

      trackEvent('game_end', {
        difficulty: state.difficulty,
        score: sessionScore,
        target_count: state.targetCount,
        time_sec: Number(timeTaken.toFixed(1)),
        completed_all: completedAll,
        rank,
        is_daily: state.isDailyMode,
      });
      postEmbedEvent('end', {
        difficulty: state.difficulty,
        score: sessionScore,
        targetCount: state.targetCount,
        timeTakenMs,
        rank,
        completedAll,
        isDaily: state.isDailyMode,
      });

      // Submit score (with smart registration timing & daily practice guard)
      handleGameEndLeaderboardSubmission({
        difficulty: state.difficulty,
        sessionScore,
        targetCount: state.targetCount,
        timeTakenMs,
        isDaily: state.isDailyMode,
        isDailyPractice: state.isDailyPractice,
        roundId: state.roundId,
        isNewPersonalBest,
      });
    }

    syncDailyAndStreakUI();

    if (btnEmbedSponsorCta) {
      btnEmbedSponsorCta.hidden = !(state.ctaUrl && state.ctaText);
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
        '<span style="color: var(--text-muted); font-size: 0.78rem;">Extract numbers to record speed splits.</span>';
    }

    setModalOpen(resultsModal, true);
  }

  // --- Viewport & Tab Visibility Observer (Pauses timer when scrolled offscreen or backgrounded) ---
  let isArenaInViewport = true;
  if ('IntersectionObserver' in window && arenaContainer) {
    const arenaObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isArenaInViewport = entry.isIntersecting;
          if (!isArenaInViewport && state.status === 'playing') {
            pauseGameWithOverlay();
          } else if (isArenaInViewport) {
            state.lastFrameTime = performance.now();
          }
        }
      },
      { threshold: 0.05 }
    );
    arenaObserver.observe(arenaContainer);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.status === 'playing') {
      pauseGameWithOverlay();
    } else if (!document.hidden) {
      state.lastFrameTime = performance.now();
    }
  });

  function tick(now) {
    if (!isArenaInViewport || document.hidden) {
      state.lastFrameTime = now;
      requestAnimationFrame(tick);
      return;
    }

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

    if (state.status !== 'paused' && state.status !== 'tutorial') {
      updateNodes(dt);
      updateEffects(dt);
    }
    render();

    requestAnimationFrame(tick);
  }

  // --- Persistent Settings, Color Themes, Accessibility & Focus-Trapped Modals ---
  const SETTINGS_STORAGE_KEY = 'brainsweep_settings_v1';
  const THEME_STORAGE_KEY = 'brainsweep_theme';

  const COLOR_THEMES = {
    amber: {
      id: 'amber',
      label: 'DEFAULT',
      bg: '#050200',
      primary: '#FC6200',
      border: '#FC6200',
      accent: '#FFA347',
    },
    green: {
      id: 'green',
      label: 'PHOSPHOR GREEN',
      bg: '#001100',
      primary: '#39FF14',
      border: '#00A819',
      accent: '#FFFFFF',
    },
    cyan: {
      id: 'cyan',
      label: 'CYBERPUNK CYAN',
      bg: '#0B0C10',
      primary: '#00E5FF',
      border: '#00E5FF',
      accent: '#FF4D9E',
    },
    magenta: {
      id: 'magenta',
      label: 'VAPORWAVE MAGENTA',
      bg: '#1A0B1F',
      primary: '#FF33D4',
      border: '#FF33D4',
      accent: '#FFE600',
    },
    clear: {
      id: 'clear',
      label: 'CLEAR (HIGH CONTRAST)',
      bg: '#0A0E14',
      primary: '#FFFFFF',
      border: '#38BDF8',
      accent: '#FACC15',
    },
  };

  function hexToRgba(hex, alpha = 1) {
    const clean = String(hex || '#FF8C00').replace('#', '');
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function getActiveThemeColors() {
    const base = COLOR_THEMES[state.theme] || COLOR_THEMES.amber;
    if (state.brandColor && /^#[0-9a-fA-F]{6}$/.test(state.brandColor)) {
      return {
        ...base,
        primary: state.brandColor,
        border: state.brandColor,
      };
    }
    return base;
  }

  function applyColorTheme(themeId, persist = true) {
    const validKey = COLOR_THEMES[themeId] ? themeId : 'amber';
    const theme = COLOR_THEMES[validKey];
    state.theme = validKey;

    const root = document.documentElement;
    root.setAttribute('data-theme', validKey);
    root.style.setProperty('--bg-color', theme.bg);
    root.style.setProperty('--primary-text', state.brandColor || theme.primary);
    root.style.setProperty('--border-color', state.brandColor || theme.border);
    root.style.setProperty('--accent-color', theme.accent);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', state.brandColor || theme.primary);
    }

    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, validKey);
      } catch {
        // ignore storage errors
      }
    }
    if (state.nodes.length > 0) {
      resizeCanvas();
    }
  }

  function applyAccessibilityFlags() {
    const root = document.documentElement;
    root.setAttribute('data-large-numbers', state.largeNumbers ? 'true' : 'false');
    root.setAttribute('data-reduced-motion', state.reducedMotion ? 'true' : 'false');
    if (state.nodes.length > 0) {
      resizeCanvas();
    }
  }

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
  const themeModal = document.getElementById('themeModal');
  const themeGrid = document.getElementById('themeGrid');
  const bottomNav = document.getElementById('bottomNav');

  const btnCloseLevelSelect = document.getElementById('btnCloseLevelSelect');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const btnCancelSettings = document.getElementById('btnCancelSettings');
  const btnCloseTrajectory = document.getElementById('btnCloseTrajectory');
  const btnCancelTrajectory = document.getElementById('btnCancelTrajectory');
  const btnCloseTheme = document.getElementById('btnCloseTheme');
  const btnCancelTheme = document.getElementById('btnCancelTheme');

  let returnToResultsOnClose = false;

  const btnSettingSound = document.getElementById('btnSettingSound');
  const btnSettingDifficulty = document.getElementById('btnSettingDifficulty');
  const btnSettingTrajectory = document.getElementById('btnSettingTrajectory');
  const btnSettingTheme = document.getElementById('btnSettingTheme');
  const btnSettingLargeNumbers = document.getElementById('btnSettingLargeNumbers');
  const btnSettingReducedMotion = document.getElementById('btnSettingReducedMotion');

  const settingSoundIconBox = document.getElementById('settingSoundIconBox');
  const settingSoundSvgOn = document.getElementById('settingSoundSvgOn');
  const settingSoundSvgOff = document.getElementById('settingSoundSvgOff');
  const settingSoundValue = document.getElementById('settingSoundValue');
  const settingDifficultyValue = document.getElementById('settingDifficultyValue');
  const settingTrajectoryValue = document.getElementById('settingTrajectoryValue');
  const settingThemeValue = document.getElementById('settingThemeValue');
  const settingLargeNumbersValue = document.getElementById('settingLargeNumbersValue');
  const settingLargeNumbersIconBox = document.getElementById('settingLargeNumbersIconBox');
  const settingReducedMotionValue = document.getElementById('settingReducedMotionValue');
  const settingReducedMotionIconBox = document.getElementById('settingReducedMotionIconBox');
  const homeStartDiffLabel = document.getElementById('homeStartDiffLabel');

  // --- Accessible Modal Management (inert + aria-hidden + focus trap/restore) ---
  const modalTriggerStack = new WeakMap();
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getOpenModals() {
    return Array.from(document.querySelectorAll('.modal-backdrop.active'));
  }

  function setModalOpen(modalEl, shouldOpen) {
    if (!modalEl) return;
    if (shouldOpen) {
      if (!modalEl.classList.contains('active') && document.activeElement instanceof HTMLElement) {
        modalTriggerStack.set(modalEl, document.activeElement);
      }
      modalEl.removeAttribute('inert');
      modalEl.setAttribute('aria-hidden', 'false');
      modalEl.classList.add('active');
      const focusable = modalEl.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusable.length > 0 && modalEl !== setupModal) {
        setTimeout(() => {
          try {
            focusable[0].focus();
          } catch {
            // ignore focus errors
          }
        }, 30);
      }
    } else {
      const wasOpen = modalEl.classList.contains('active');
      modalEl.classList.remove('active');
      modalEl.setAttribute('aria-hidden', 'true');
      modalEl.setAttribute('inert', '');
      if (wasOpen) {
        const prevEl = modalTriggerStack.get(modalEl);
        modalTriggerStack.delete(modalEl);
        if (prevEl && document.contains(prevEl) && typeof prevEl.focus === 'function') {
          const stillHasModal = getOpenModals().length > 0;
          if (!stillHasModal || prevEl.closest('.modal-backdrop.active')) {
            try {
              prevEl.focus();
            } catch {
              // ignore focus errors
            }
          }
        }
      }
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const openModals = getOpenModals();
    if (openModals.length === 0) return;
    const topModal = openModals[openModals.length - 1];
    const focusables = Array.from(topModal.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null && !el.closest('[hidden]')
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !topModal.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last || !topModal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  });

  function loadPersistedSettings() {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      applyColorTheme(savedTheme || 'amber', false);
    } catch {
      applyColorTheme('amber', false);
    }

    const prefersReduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.reducedMotion = Boolean(prefersReduced);

    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
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
          if (typeof parsed.largeNumbers === 'boolean') {
            state.largeNumbers = parsed.largeNumbers;
          }
          if (typeof parsed.reducedMotion === 'boolean') {
            state.reducedMotion = parsed.reducedMotion;
          }
        }
      }
    } catch {
      // ignore storage errors
    }
    applyAccessibilityFlags();
  }

  function savePersistedSettings() {
    try {
      const payload = {
        soundEnabled: sound.enabled,
        difficulty: state.difficulty,
        pattern: state.pattern,
        quickFlick: chkQuickFlick ? chkQuickFlick.checked : true,
        memoryMode: chkMemoryMode ? chkMemoryMode.checked : false,
        largeNumbers: state.largeNumbers,
        reducedMotion: state.reducedMotion,
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

    // 2. Sync Accessibility Toggles (Large Numbers & Reduced Motion)
    if (settingLargeNumbersValue) {
      settingLargeNumbersValue.textContent = state.largeNumbers ? 'ON' : 'OFF';
      settingLargeNumbersValue.classList.toggle('off', !state.largeNumbers);
    }
    if (settingLargeNumbersIconBox) {
      settingLargeNumbersIconBox.classList.toggle('muted', !state.largeNumbers);
    }
    if (settingReducedMotionValue) {
      settingReducedMotionValue.textContent = state.reducedMotion ? 'ON' : 'OFF';
      settingReducedMotionValue.classList.toggle('off', !state.reducedMotion);
    }
    if (settingReducedMotionIconBox) {
      settingReducedMotionIconBox.classList.toggle('muted', !state.reducedMotion);
    }

    // 3. Sync Difficulty, Trajectory & Theme UI
    const diffUpper = DIFFICULTIES[state.difficulty].label.toUpperCase();
    const patUpper = PATTERN_LABELS[state.pattern] || 'SPIRAL VORTEX';
    const activeTheme = getActiveThemeColors();

    if (settingDifficultyValue) {
      settingDifficultyValue.textContent = diffUpper;
    }
    if (settingTrajectoryValue) {
      settingTrajectoryValue.textContent = patUpper;
    }
    if (settingThemeValue) {
      settingThemeValue.textContent = activeTheme.label;
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

    if (themeGrid) {
      themeGrid.querySelectorAll('.theme-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.themeId === state.theme);
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
    setModalOpen(setupModal, false);
    if (levelSelectModal) setModalOpen(levelSelectModal, false);
    if (settingsModal) setModalOpen(settingsModal, false);
    if (trajectoryModal) setModalOpen(trajectoryModal, false);
    if (themeModal) setModalOpen(themeModal, false);
    if (infoModal) setModalOpen(infoModal, false);
    if (leaderboardModal) setModalOpen(leaderboardModal, false);
    const statsModalEl = document.getElementById('statisticsModal');
    if (statsModalEl) setModalOpen(statsModalEl, false);
    const achModalEl = document.getElementById('achievementsModal');
    if (achModalEl) setModalOpen(achModalEl, false);
    if (resultsModal) setModalOpen(resultsModal, false);
  }

  function navigateToScreen(tabName) {
    hideArenaOverlays();
    document.body.classList.remove('playing-active');
    document.body.classList.remove('results-active');
    if (state.status === 'playing' || state.status === 'paused' || state.status === 'ready' || state.status === 'tutorial') {
      state.status = 'menu';
      state.draggingNode = null;
      extractionFrame.classList.remove('dragging-active');
    }

    if (tabName === 'leaderboard') {
      closeAllOverlayModals();
      setBottomNavActiveTab('leaderboard');
      syncPlayerProfileUI();
      setModalOpen(leaderboardModal, true);
      loadLeaderboardTab(state.difficulty || 'easy', activeLeaderboardBoard);
      return;
    }

    closeAllOverlayModals();
    setBottomNavActiveTab(tabName);

    if (tabName === 'levels' && levelSelectModal) {
      syncSettingsUI();
      setModalOpen(levelSelectModal, true);
    } else if (tabName === 'help' && infoModal) {
      setModalOpen(infoModal, true);
    } else if (tabName === 'settings' && settingsModal) {
      syncSettingsUI();
      setModalOpen(settingsModal, true);
    } else {
      // Default: 'home'
      setBottomNavActiveTab('home');
      syncNetworkModeUI();
      syncSettingsUI();
      setModalOpen(setupModal, true);
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
      startGame({ daily: false });
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
      setModalOpen(trajectoryModal, false);
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
        setModalOpen(trajectoryModal, true);
      }
    });
  }

  if (btnCloseTrajectory) {
    btnCloseTrajectory.addEventListener('click', () => {
      setModalOpen(trajectoryModal, false);
    });
  }

  if (btnCancelTrajectory) {
    btnCancelTrajectory.addEventListener('click', () => {
      setModalOpen(trajectoryModal, false);
    });
  }

  if (btnSettingTheme) {
    btnSettingTheme.addEventListener('click', () => {
      syncSettingsUI();
      if (themeModal) {
        setModalOpen(themeModal, true);
      }
    });
  }

  if (btnSettingLargeNumbers) {
    btnSettingLargeNumbers.addEventListener('click', () => {
      state.largeNumbers = !state.largeNumbers;
      applyAccessibilityFlags();
      savePersistedSettings();
      syncSettingsUI();
    });
  }

  if (btnSettingReducedMotion) {
    btnSettingReducedMotion.addEventListener('click', () => {
      state.reducedMotion = !state.reducedMotion;
      applyAccessibilityFlags();
      savePersistedSettings();
      syncSettingsUI();
    });
  }

  if (themeGrid) {
    themeGrid.addEventListener('click', (e) => {
      const chip = e.target.closest('.theme-chip');
      if (!chip) return;
      const selectedTheme = chip.dataset.themeId;
      applyColorTheme(selectedTheme, true);
      syncSettingsUI();
      if (themeModal) {
        setModalOpen(themeModal, false);
      }
    });
  }

  if (btnCloseTheme) {
    btnCloseTheme.addEventListener('click', () => {
      setModalOpen(themeModal, false);
    });
  }

  if (btnCancelTheme) {
    btnCancelTheme.addEventListener('click', () => {
      setModalOpen(themeModal, false);
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
      if (settingsModal) setModalOpen(settingsModal, false);
      document.body.classList.add('results-active');
      setModalOpen(resultsModal, true);
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
    startGame({ daily: false });
  });

  if (btnStartDailySweep) {
    btnStartDailySweep.addEventListener('click', () => {
      sound.init();
      startGame({ daily: true });
    });
  }

  if (btnTapToPlayAction) {
    btnTapToPlayAction.addEventListener('click', () => {
      sound.init();
      if (state.status === 'paused') {
        hideArenaOverlays();
        state.status = 'playing';
        state.lastFrameTime = performance.now();
      } else {
        // From 'ready' state (embed/offline/daily landing), check tutorial once or begin play
        if (!hasSeenTutorial() && tutorialOverlay && !state.isEmbedMode) {
          state.status = 'tutorial';
          if (tutorialDemoNode) tutorialDemoNode.textContent = `#${state.nextTarget}`;
          hideArenaOverlays();
          tutorialOverlay.hidden = false;
        } else {
          beginActivePlay();
        }
      }
    });
  }

  if (btnSkipTutorial) {
    btnSkipTutorial.addEventListener('click', () => {
      markTutorialSeen();
      beginActivePlay();
    });
  }

  if (btnStartFromTutorial) {
    btnStartFromTutorial.addEventListener('click', () => {
      sound.init();
      markTutorialSeen();
      beginActivePlay();
    });
  }

  if (btnZeroScoreHowToPlay) {
    btnZeroScoreHowToPlay.addEventListener('click', () => {
      returnToResultsOnClose = true;
      setModalOpen(resultsModal, false);
      setModalOpen(infoModal, true);
    });
  }

  function buildShareText() {
    const siteUrl = (getAppConfig().siteUrl || 'https://brainsweep-tau.vercel.app').replace(/\/+$/, '');
    const s = state.lastResultSummary;
    if (!s) {
      return `Play BrainSweep — 60-Second Number Rush!\n${siteUrl}`;
    }
    if (s.mode === 'offline') {
      return `BrainSweep Survival Sweep ⚡ ${s.score} numbers in 60s (Best: ${s.bestOffline})\n${siteUrl}`;
    }
    if (s.mode === 'daily') {
      return `BrainSweep Daily #${s.dailyNum} ⚡ ${s.score}/${s.targetCount} in ${s.timeTaken.toFixed(1)}s · Rank ${s.rank} · 🔥${s.streak}\n${siteUrl}?daily=1`;
    }
    return `BrainSweep (${s.diffLabel}) ⚡ ${s.score}/${s.targetCount} in ${s.timeTaken.toFixed(1)}s · Rank ${s.rank}\n${siteUrl}`;
  }

  if (btnShareResult) {
    btnShareResult.addEventListener('click', async () => {
      const shareText = buildShareText();
      trackEvent('share_click', {
        mode: state.lastResultSummary ? state.lastResultSummary.mode : 'standard',
        difficulty: state.difficulty,
      });

      const originalLabel = btnShareResult.textContent;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'BrainSweep',
            text: shareText,
          });
          return;
        } catch {
          // User dismissed or share unavailable — fall through to clipboard copy
        }
      }

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareText);
        } else {
          const ta = document.createElement('textarea');
          ta.value = shareText;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        btnShareResult.textContent = 'COPIED TO CLIPBOARD!';
        setTimeout(() => {
          btnShareResult.textContent = originalLabel;
        }, 2000);
      } catch {
        btnShareResult.textContent = 'COPY FAILED';
        setTimeout(() => {
          btnShareResult.textContent = originalLabel;
        }, 1800);
      }
    });
  }

  if (btnEmbedSponsorCta) {
    btnEmbedSponsorCta.addEventListener('click', () => {
      trackEvent('embed_cta_click', {
        cta_label: state.ctaText || 'sponsor',
      });
      postEmbedEvent('cta_click', {
        url: state.ctaUrl || '',
        text: state.ctaText || '',
      });
    });
  }

  btnPlayAgain.addEventListener('click', () => {
    sound.init();
    startGame({ daily: state.isDailyMode, skipTutorial: true });
  });

  btnChangeConfig.addEventListener('click', () => {
    navigateToScreen('home');
  });

  btnMenu.addEventListener('click', () => {
    navigateToScreen('home');
  });

  btnReset.addEventListener('click', () => {
    sound.init();
    setModalOpen(infoModal, false);
    startGame({ daily: state.isDailyMode, skipTutorial: true });
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
      setModalOpen(infoModal, true);
    } else {
      navigateToScreen('help');
    }
  });

  btnCloseInfo.addEventListener('click', () => {
    setModalOpen(infoModal, false);
    if (returnToResultsOnClose) {
      returnToResultsOnClose = false;
      document.body.classList.add('results-active');
      setModalOpen(resultsModal, true);
    } else if (prevStatusBeforeInfo === 'playing' && state.status === 'paused') {
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
        setModalOpen(trajectoryModal, false);
      } else if (themeModal && themeModal.classList.contains('active')) {
        setModalOpen(themeModal, false);
      } else if (leaderboardModal && leaderboardModal.classList.contains('active')) {
        btnCloseLeaderboard.click();
      } else if (levelSelectModal && levelSelectModal.classList.contains('active')) {
        btnCloseLevelSelect.click();
      } else if (settingsModal && settingsModal.classList.contains('active')) {
        btnCloseSettings.click();
      } else if (statisticsModal && statisticsModal.classList.contains('active')) {
        btnCloseStatistics.click();
      } else if (achievementsModal && achievementsModal.classList.contains('active')) {
        btnCloseAchievements.click();
      } else if (infoModal.classList.contains('active')) {
        btnCloseInfo.click();
      } else if (state.status === 'playing' || state.status === 'paused') {
        btnMenu.click();
      }
    }
  });

  // --- iOS PWA Installation Prompt ---
  const IOS_INSTALL_DISMISSED_KEY = 'brainsweep_ios_install_dismissed_v1';

  function initIosInstallPrompt() {
    const iosBanner = document.getElementById('iosInstallBanner');
    const btnCloseIos = document.getElementById('btnCloseIosBanner');
    if (!iosBanner || state.isEmbedMode) return;

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

  // --- Global Leaderboard (Today / Week / All-Time Best) & Smart Player Registration ---
  const registerModal = document.getElementById('registerModal');
  const registerForm = document.getElementById('registerForm');
  const regUsernameInput = document.getElementById('regUsername');
  const regEmailInput = document.getElementById('regEmail');
  const regMarketingOptIn = document.getElementById('regMarketingOptIn');
  const regErrorMsg = document.getElementById('regErrorMsg');
  const btnCancelRegister = document.getElementById('btnCancelRegister');
  const btnSubmitRegisterText = document.getElementById('btnSubmitRegisterText');

  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardBoardTabs = document.getElementById('leaderboardBoardTabs');
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
  let activeLeaderboardBoard = 'alltime'; // 'today' | 'week' | 'alltime'
  let pendingPostRegistrationCallback = null;
  let pendingCancelRegistrationCallback = null;
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
          marketingOptIn: Boolean(parsed.marketingOptIn),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  function saveUserToLocalStorage(username, email, marketingOptIn = false) {
    const cleanUser = {
      username: String(username).trim(),
      email: String(email).trim().toLowerCase(),
      marketingOptIn: Boolean(marketingOptIn),
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

  // Local mirror helpers for offline/fallback leaderboards
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

  function loadLocalRoundsMirror() {
    try {
      const raw = localStorage.getItem(LOCAL_ROUNDS_FALLBACK_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLocalRoundsMirror(rounds) {
    try {
      localStorage.setItem(LOCAL_ROUNDS_FALLBACK_KEY, JSON.stringify(rounds.slice(-300)));
    } catch {
      // ignore
    }
  }

  function upsertLocalLeaderboardMirror({
    username,
    email,
    difficulty,
    sessionScore,
    timeTakenMs = 60000,
    isDaily = false,
    exactTotal,
  }) {
    const rows = loadLocalLeaderboardMirror();
    const normUser = username.trim().toLowerCase();
    const normEmail = email.trim().toLowerCase();
    const existing = rows.find((r) => String(r.username).trim().toLowerCase() === normUser);
    const addScore = Math.max(0, parseInt(sessionScore, 10) || 0);
    const cleanTimeMs = Math.max(100, parseInt(timeTakenMs, 10) || 60000);

    const cumKey =
      difficulty === 'medium'
        ? 'mediumScore'
        : difficulty === 'hard'
          ? 'hardScore'
          : 'easyScore';
    const bestKey =
      difficulty === 'medium'
        ? 'mediumBest'
        : difficulty === 'hard'
          ? 'hardBest'
          : 'easyBest';
    const timeKey =
      difficulty === 'medium'
        ? 'mediumBestTimeMs'
        : difficulty === 'hard'
          ? 'hardBestTimeMs'
          : 'easyBestTimeMs';

    if (addScore > 0) {
      const rounds = loadLocalRoundsMirror();
      rounds.push({
        ts: Date.now(),
        dateLagos: getLagosDateString(),
        username: username.trim(),
        difficulty,
        isDaily: Boolean(isDaily),
        score: addScore,
        timeMs: cleanTimeMs,
      });
      saveLocalRoundsMirror(rounds);
    }

    if (existing) {
      if (existing.email && existing.email.toLowerCase() !== normEmail) {
        return {
          status: 'error',
          code: 'USERNAME_TAKEN',
          message: 'Username already taken. Please choose another.',
        };
      }
      const prevTotal = Math.max(0, parseInt(existing[cumKey], 10) || 0);
      const newTotal =
        exactTotal !== undefined ? Math.max(0, parseInt(exactTotal, 10) || 0) : prevTotal + addScore;
      existing[cumKey] = newTotal;

      const prevBest = Math.max(0, parseInt(existing[bestKey], 10) || 0);
      const prevTime = Math.max(100, parseInt(existing[timeKey], 10) || 60000);
      if (addScore > prevBest || (addScore === prevBest && addScore > 0 && cleanTimeMs < prevTime)) {
        existing[bestKey] = addScore;
        existing[timeKey] = cleanTimeMs;
      }
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
      easyBest: difficulty === 'easy' ? addScore : 0,
      easyBestTimeMs: difficulty === 'easy' ? cleanTimeMs : 60000,
      mediumBest: difficulty === 'medium' ? addScore : 0,
      mediumBestTimeMs: difficulty === 'medium' ? cleanTimeMs : 60000,
      hardBest: difficulty === 'hard' ? addScore : 0,
      hardBestTimeMs: difficulty === 'hard' ? cleanTimeMs : 60000,
    });
    saveLocalLeaderboardMirror(rows);
    return { status: 'ok', created: true, sessionScore: addScore, newTotal: initialTotal };
  }

  function getLocalTop50ForBoard(board, difficulty) {
    if (board === 'today' || board === 'week') {
      const rounds = loadLocalRoundsMirror();
      const todayKey = getLagosDateString();
      const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const bestByUser = {};

      rounds.forEach((r) => {
        if (!r || !r.username || r.difficulty !== difficulty || (Number(r.score) || 0) <= 0) return;
        if (board === 'today' && (!r.isDaily || r.dateLagos !== todayKey)) return;
        if (board === 'week' && Number(r.ts) < weekCutoff) return;

        const key = String(r.username).trim().toLowerCase();
        const prev = bestByUser[key];
        const score = Number(r.score) || 0;
        const timeMs = Number(r.timeMs) || 60000;
        if (!prev || score > prev.score || (score === prev.score && timeMs < prev.timeMs)) {
          bestByUser[key] = { username: r.username, score, timeMs };
        }
      });

      return Object.values(bestByUser)
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.timeMs - b.timeMs))
        .slice(0, 50)
        .map((r, idx) => ({
          position: idx + 1,
          username: r.username,
          score: r.score,
          timeMs: r.timeMs,
        }));
    }

    const rows = loadLocalLeaderboardMirror();
    const maxTargets = (DIFFICULTIES[difficulty] && DIFFICULTIES[difficulty].targetCount) || 12;
    const cumKey =
      difficulty === 'medium'
        ? 'mediumScore'
        : difficulty === 'hard'
          ? 'hardScore'
          : 'easyScore';
    const bestKey =
      difficulty === 'medium'
        ? 'mediumBest'
        : difficulty === 'hard'
          ? 'hardBest'
          : 'easyBest';
    const timeKey =
      difficulty === 'medium'
        ? 'mediumBestTimeMs'
        : difficulty === 'hard'
          ? 'hardBestTimeMs'
          : 'easyBestTimeMs';

    return rows
      .map((r) => {
        const best =
          Number(r[bestKey]) || Math.min(maxTargets, Number(r[cumKey]) || 0);
        const timeMs = Number(r[timeKey]) || 60000;
        return { username: r.username, score: best, timeMs };
      })
      .filter((r) => r.username && r.score > 0)
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.timeMs - b.timeMs))
      .slice(0, 50)
      .map((r, idx) => ({
        position: idx + 1,
        username: r.username,
        score: r.score,
        timeMs: r.timeMs,
      }));
  }

  function applyBackendTotalToUI(diff, newTotal) {
    if (!Number.isFinite(newTotal)) return;
    const resTotalScoreBanner = document.getElementById('resTotalScoreBanner');
    const resTimeBox = document.getElementById('resTime');
    if (resTotalScoreBanner) {
      resTotalScoreBanner.textContent = `Total Score: ${newTotal}`;
    }
    if (resTimeBox && !state.isOfflineMode) {
      resTimeBox.textContent = String(newTotal);
    }
    try {
      const scores = loadHighScores();
      if (scores[diff]) {
        scores[diff].total = newTotal;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
        updateHighScoreBadges();
      }
      const diffStats = loadDifficultyStats(diff);
      if (diffStats && newTotal > (Number(diffStats.totalScore) || 0)) {
        diffStats.totalScore = newTotal;
        saveDifficultyStats(diff, diffStats);
      }
    } catch {
      // ignore
    }
  }

  // Helper: fetch with 8-second timeout (Phase 7)
  async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Send POST request to Google Apps Script Web App
  async function postScoreToBackend({
    username,
    email,
    difficulty,
    sessionScore,
    timeTakenMs = 60000,
    isDaily = false,
    roundId = '',
    marketingOptIn = false,
    action = 'submit',
  }) {
    const cleanSessionScore = Math.max(0, parseInt(sessionScore, 10) || 0);
    const cleanTimeMs = Math.max(100, parseInt(timeTakenMs, 10) || 60000);

    if (!isApiUrlConfigured()) {
      return upsertLocalLeaderboardMirror({
        username,
        email,
        difficulty,
        sessionScore: cleanSessionScore,
        timeTakenMs: cleanTimeMs,
        isDaily,
      });
    }

    const apiUrl = getLeaderboardApiUrl();
    const response = await fetchWithTimeout(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          action,
          username: username.trim(),
          email: email.trim().toLowerCase(),
          difficulty: isDaily ? `daily_${difficulty || 'easy'}` : difficulty || 'easy',
          isDaily: Boolean(isDaily),
          sessionScore: cleanSessionScore,
          score: cleanSessionScore,
          timeTakenMs: cleanTimeMs,
          roundId: roundId || createRoundId(),
          marketingOptIn: Boolean(marketingOptIn),
        }),
      },
      8000
    );

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
        timeTakenMs: cleanTimeMs,
        isDaily,
        exactTotal: backendTotal,
      });
      if (data.newTotal === undefined) {
        data.newTotal = mirrorResult.newTotal;
      }
    }
    return data;
  }

  // Fetch Top 50 for a board & difficulty tab from Google Apps Script Web App (8s timeout)
  async function fetchLeaderboardEntries(board, difficulty) {
    if (!isApiUrlConfigured()) {
      return getLocalTop50ForBoard(board, difficulty);
    }

    const apiUrl = getLeaderboardApiUrl();
    const sep = apiUrl.includes('?') ? '&' : '?';
    const url = `${apiUrl}${sep}board=${encodeURIComponent(board)}&difficulty=${encodeURIComponent(difficulty)}`;
    const response = await fetchWithTimeout(url, { method: 'GET' }, 8000);
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

  function openRegistrationModal({ prefill = true, onComplete = null, onCancel = null } = {}) {
    if (!registerModal) return;
    clearRegistrationError();
    pendingPostRegistrationCallback = onComplete;
    pendingCancelRegistrationCallback = onCancel;

    const existing = getSavedUser();
    if (prefill && existing) {
      regUsernameInput.value = existing.username;
      regEmailInput.value = existing.email;
      if (regMarketingOptIn) regMarketingOptIn.checked = Boolean(existing.marketingOptIn);
    } else {
      regUsernameInput.value = '';
      regEmailInput.value = '';
      if (regMarketingOptIn) regMarketingOptIn.checked = false;
    }

    setModalOpen(registerModal, true);
    setTimeout(() => regUsernameInput.focus(), 60);
  }

  function closeRegistrationModal() {
    if (!registerModal) return;
    setModalOpen(registerModal, false);
    clearRegistrationError();
  }

  function renderLeaderboardSkeleton() {
    if (!leaderboardTableBody) return;
    leaderboardTableBody.innerHTML = Array.from({ length: 5 })
      .map(
        () =>
          '<tr class="lb-skeleton-row"><td colspan="4"><div class="lb-skeleton-bar"></div></td></tr>'
      )
      .join('');
  }

  function renderLeaderboardRows(entries) {
    if (!leaderboardTableBody) return;
    leaderboardTableBody.innerHTML = '';

    if (!entries || entries.length === 0) {
      const emptyMsg =
        activeLeaderboardBoard === 'today'
          ? 'No Daily Sweep scores today yet. Play ⚡ DAILY SWEEP from Home to be #1!'
          : 'No scores recorded for this difficulty yet. Be #1!';
      leaderboardTableBody.innerHTML = `<tr><td colspan="4" class="lb-status-cell">${emptyMsg}</td></tr>`;
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

      const tdTime = document.createElement('td');
      tdTime.className = 'col-time';
      const timeMs = Number(item.timeMs);
      tdTime.textContent = Number.isFinite(timeMs) && timeMs > 0 ? `${(timeMs / 1000).toFixed(1)}s` : '—';

      tr.appendChild(tdPos);
      tr.appendChild(tdName);
      tr.appendChild(tdPts);
      tr.appendChild(tdTime);
      leaderboardTableBody.appendChild(tr);
    });
  }

  let pendingSubmissionPromise = null;

  async function loadLeaderboardTab(difficulty = activeLeaderboardTab, board = activeLeaderboardBoard) {
    activeLeaderboardTab = difficulty;
    activeLeaderboardBoard = board;

    if (leaderboardBoardTabs) {
      leaderboardBoardTabs.querySelectorAll('.lb-board-tab').forEach((btn) => {
        const isMatch = btn.dataset.lbBoard === board;
        btn.classList.toggle('active', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
    }

    if (leaderboardTabs) {
      leaderboardTabs.querySelectorAll('.lb-tab').forEach((btn) => {
        const isMatch = btn.dataset.lbDiff === difficulty;
        btn.classList.toggle('active', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
    }

    renderLeaderboardSkeleton();

    // Wait briefly if a just-finished round score submission is still in flight
    if (pendingSubmissionPromise) {
      try {
        await Promise.race([
          pendingSubmissionPromise,
          new Promise((resolve) => setTimeout(resolve, 3500)),
        ]);
      } catch {
        // ignore submission wait error
      }
    }

    try {
      const entries = await fetchLeaderboardEntries(board, difficulty);
      renderLeaderboardRows(entries);
    } catch {
      const fallbackEntries = getLocalTop50ForBoard(board, difficulty);
      renderLeaderboardRows(fallbackEntries);
    }
  }

  function openLeaderboardModal(defaultDiff = state.difficulty, defaultBoard = activeLeaderboardBoard) {
    syncPlayerProfileUI();
    setModalOpen(leaderboardModal, true);
    loadLeaderboardTab(defaultDiff || 'easy', defaultBoard || 'alltime');
  }

  function handleGameEndLeaderboardSubmission({
    difficulty,
    sessionScore,
    targetCount,
    timeTakenMs,
    isDaily,
    isDailyPractice,
    roundId,
    isNewPersonalBest,
  }) {
    // Do not submit 0-score rounds or repeat daily practice attempts
    if (sessionScore <= 0 || isDailyPractice) {
      return;
    }

    const user = getSavedUser();
    if (user) {
      const subPromise = postScoreToBackend({
        username: user.username,
        email: user.email,
        difficulty,
        sessionScore,
        timeTakenMs,
        isDaily,
        roundId,
        marketingOptIn: user.marketingOptIn,
        action: 'submit_score',
      })
        .then((res) => {
          if (res && res.status === 'ok' && res.newTotal !== undefined) {
            applyBackendTotalToUI(difficulty, Number(res.newTotal));
          }
        })
        .catch(() => {
          // Ensure local mirror still captures the round if offline/timeout
          upsertLocalLeaderboardMirror({
            username: user.username,
            email: user.email,
            difficulty,
            sessionScore,
            timeTakenMs,
            isDaily,
          });
        })
        .finally(() => {
          if (pendingSubmissionPromise === subPromise) {
            pendingSubmissionPromise = null;
          }
        });
      pendingSubmissionPromise = subPromise;
    } else if (!state.isEmbedMode) {
      // Phase 6.7 Smart Registration Timing:
      // Never prompt on 0 score. Only prompt when >= 50% targets cleared OR new personal best.
      const meetsHalfTargets = sessionScore >= Math.ceil((targetCount || 12) * 0.5);
      if (meetsHalfTargets || isNewPersonalBest) {
        pendingScorePayload = {
          difficulty,
          sessionScore,
          timeTakenMs,
          isDaily,
          roundId,
        };
        openRegistrationModal({
          prefill: false,
          onComplete: () => {
            pendingScorePayload = null;
          },
        });
      }
    }
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearRegistrationError();

      const username = (regUsernameInput.value || '').trim();
      const email = (regEmailInput.value || '').trim().toLowerCase();
      const marketingOptIn = Boolean(regMarketingOptIn && regMarketingOptIn.checked);

      if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        showRegistrationError('Username must be 3–16 characters (letters, numbers, or underscore).');
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        showRegistrationError('Please enter a valid email address.');
        return;
      }

      const prevBtnText = btnSubmitRegisterText ? btnSubmitRegisterText.textContent : 'SAVE SCORE';
      if (btnSubmitRegisterText) {
        btnSubmitRegisterText.textContent = 'VERIFYING...';
      }

      const diffToSubmit = pendingScorePayload ? pendingScorePayload.difficulty : state.difficulty;
      const sessionScoreToSubmit = pendingScorePayload ? pendingScorePayload.sessionScore : 0;
      const timeTakenMsToSubmit = pendingScorePayload ? pendingScorePayload.timeTakenMs : 60000;
      const isDailyToSubmit = pendingScorePayload ? pendingScorePayload.isDaily : false;
      const roundIdToSubmit = pendingScorePayload ? pendingScorePayload.roundId : createRoundId();

      try {
        const result = await postScoreToBackend({
          username,
          email,
          difficulty: diffToSubmit,
          sessionScore: sessionScoreToSubmit,
          timeTakenMs: timeTakenMsToSubmit,
          isDaily: isDailyToSubmit,
          roundId: roundIdToSubmit,
          marketingOptIn,
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

        saveUserToLocalStorage(username, email, marketingOptIn);
        trackEvent('leaderboard_register', { marketing_opt_in: marketingOptIn });
        pendingScorePayload = null;
        pendingCancelRegistrationCallback = null;
        closeRegistrationModal();

        if (typeof pendingPostRegistrationCallback === 'function') {
          const cb = pendingPostRegistrationCallback;
          pendingPostRegistrationCallback = null;
          cb();
        }
      } catch {
        const localCheck = upsertLocalLeaderboardMirror({
          username,
          email,
          difficulty: diffToSubmit,
          sessionScore: sessionScoreToSubmit,
          timeTakenMs: timeTakenMsToSubmit,
          isDaily: isDailyToSubmit,
        });
        if (localCheck.code === 'USERNAME_TAKEN') {
          showRegistrationError('Username already taken. Please choose another.');
          return;
        }
        if (localCheck.newTotal !== undefined) {
          applyBackendTotalToUI(diffToSubmit, Number(localCheck.newTotal));
        }
        saveUserToLocalStorage(username, email, marketingOptIn);
        trackEvent('leaderboard_register', { marketing_opt_in: marketingOptIn });
        pendingScorePayload = null;
        pendingCancelRegistrationCallback = null;
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
      const cancelCb = pendingCancelRegistrationCallback;
      pendingCancelRegistrationCallback = null;
      pendingPostRegistrationCallback = null;
      pendingScorePayload = null;
      closeRegistrationModal();
      if (typeof cancelCb === 'function') {
        cancelCb();
      }
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
      setModalOpen(resultsModal, false);
      openLeaderboardModal(state.difficulty, state.isDailyMode ? 'today' : activeLeaderboardBoard);
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
      setModalOpen(resultsModal, false);
      syncSettingsUI();
      if (settingsModal) {
        setModalOpen(settingsModal, true);
      }
    });
  }

  if (btnLbChangeUser) {
    btnLbChangeUser.addEventListener('click', () => {
      const tabToRestore = activeLeaderboardTab;
      const boardToRestore = activeLeaderboardBoard;
      setModalOpen(leaderboardModal, false);
      openRegistrationModal({
        prefill: true,
        onComplete: () => openLeaderboardModal(tabToRestore, boardToRestore),
        onCancel: () => {
          syncPlayerProfileUI();
          setModalOpen(leaderboardModal, true);
        },
      });
    });
  }

  if (btnCloseLeaderboard) {
    btnCloseLeaderboard.addEventListener('click', () => {
      if (returnToResultsOnClose) {
        returnToResultsOnClose = false;
        setModalOpen(leaderboardModal, false);
        document.body.classList.add('results-active');
        setModalOpen(resultsModal, true);
      } else {
        navigateToScreen('home');
      }
    });
  }

  if (btnRefreshLeaderboard) {
    btnRefreshLeaderboard.addEventListener('click', () => {
      loadLeaderboardTab(activeLeaderboardTab, activeLeaderboardBoard);
    });
  }

  if (leaderboardBoardTabs) {
    leaderboardBoardTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.lb-board-tab');
      if (!tab) return;
      loadLeaderboardTab(activeLeaderboardTab, tab.dataset.lbBoard);
    });
  }

  if (leaderboardTabs) {
    leaderboardTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.lb-tab');
      if (!tab) return;
      loadLeaderboardTab(tab.dataset.lbDiff, activeLeaderboardBoard);
    });
  }

  // --- B2B Embed Mode (?embed=true), Sanitized Sponsor Params & Consent Banner ---
  const COOKIE_CONSENT_STORAGE_KEY = 'brainsweep_cookie_consent_v1';

  function sanitizePlainText(input, maxLen) {
    return String(input || '')
      .replace(/[\u0000-\u001F\u007F<>]/g, '')
      .trim()
      .slice(0, maxLen);
  }

  function sanitizeHttpsUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // invalid URL
    }
    return '';
  }

  function applyEmbedUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const embedParam = params.get('embed');
      state.isEmbedMode = embedParam === 'true' || embedParam === '1';

      const dailyParam = params.get('daily');
      if (dailyParam === '1' || dailyParam === 'true') {
        state.isDailyMode = true;
      }

      const domainParam = params.get('domain');
      if (domainParam) {
        state.publisherDomain = domainParam.trim();
      }

      const diffParam = (params.get('difficulty') || '').toLowerCase();
      if (diffParam && DIFFICULTIES[diffParam]) {
        state.difficulty = diffParam;
      }

      const patParam = (params.get('pattern') || '').toLowerCase();
      if (patParam && PATTERN_LABELS[patParam]) {
        state.pattern = patParam;
      }

      const themeParam = (params.get('theme') || '').toLowerCase();
      if (themeParam && COLOR_THEMES[themeParam]) {
        applyColorTheme(themeParam, false);
      }

      // Sanitized Sponsor Parameters (Phase 5.3)
      const rawBrandColor = (params.get('brand_color') || '').trim();
      const hexCandidate = rawBrandColor.startsWith('#') ? rawBrandColor : `#${rawBrandColor}`;
      if (rawBrandColor && /^#[0-9a-fA-F]{6}$/.test(hexCandidate)) {
        state.brandColor = hexCandidate;
        applyColorTheme(state.theme, false);
      }

      const safeLogoUrl = sanitizeHttpsUrl(params.get('brand_logo'));
      const safeSponsorText = sanitizePlainText(params.get('sponsor_text'), 40);
      if ((safeLogoUrl || safeSponsorText) && embedSponsorBar) {
        if (safeLogoUrl && embedBrandLogoImg) {
          embedBrandLogoImg.src = safeLogoUrl;
          embedBrandLogoImg.hidden = false;
        }
        if (safeSponsorText && embedSponsorTextEl) {
          state.sponsorText = safeSponsorText;
          embedSponsorTextEl.textContent = safeSponsorText;
        }
        embedSponsorBar.hidden = false;
      }

      const safeCtaText = sanitizePlainText(params.get('cta_text'), 24);
      const safeCtaUrl = sanitizeHttpsUrl(params.get('cta_url'));
      if (safeCtaText && safeCtaUrl && btnEmbedSponsorCta && embedSponsorCtaText) {
        state.ctaText = safeCtaText;
        state.ctaUrl = safeCtaUrl;
        btnEmbedSponsorCta.href = safeCtaUrl;
        embedSponsorCtaText.textContent = safeCtaText;
      }

      if (state.isEmbedMode) {
        document.documentElement.setAttribute('data-embed', 'true');
        document.body.classList.add('embed-mode');

        // Domain license check (Phase 4)
        if (
          window.BrainSweepAnalytics &&
          typeof window.BrainSweepAnalytics.checkEmbedDomainLicense === 'function'
        ) {
          const license = window.BrainSweepAnalytics.checkEmbedDomainLicense();
          state.embedLicensed = Boolean(license.allowed);
          if (!state.embedLicensed && unlicensedEmbedOverlay) {
            if (unlicensedSiteLink && getAppConfig().siteUrl) {
              unlicensedSiteLink.href = getAppConfig().siteUrl;
            }
            closeAllOverlayModals();
            unlicensedEmbedOverlay.hidden = false;
          }
        }

        trackEvent('embed_load', {
          difficulty: state.difficulty,
          pattern: state.pattern,
          theme: state.theme,
          is_daily: state.isDailyMode,
        });
        postEmbedEvent('ready', {
          difficulty: state.difficulty,
          pattern: state.pattern,
          theme: state.theme,
          isDaily: state.isDailyMode,
        });
      }
    } catch {
      // ignore URL parsing errors
    }
  }

  function initCookieConsentBanner() {
    const banner = document.getElementById('cookieConsentBanner');
    const btnAccept = document.getElementById('btnAcceptCookies');
    const btnDecline = document.getElementById('btnDeclineCookies');
    if (!banner || !btnAccept) return;

    // Never show consent banner in embed mode (Phase 2 & 5.2)
    if (state.isEmbedMode) {
      banner.hidden = true;
      return;
    }

    let consentVal = '';
    try {
      consentVal = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) || '';
    } catch {
      consentVal = '';
    }

    if (consentVal === 'accepted') {
      if (
        window.BrainSweepAnalytics &&
        typeof window.BrainSweepAnalytics.enableAfterConsent === 'function'
      ) {
        window.BrainSweepAnalytics.enableAfterConsent();
      }
    } else if (consentVal !== 'declined') {
      banner.hidden = false;
    }

    btnAccept.addEventListener('click', () => {
      banner.hidden = true;
      try {
        localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'accepted');
      } catch {
        // ignore storage errors
      }
      if (
        window.BrainSweepAnalytics &&
        typeof window.BrainSweepAnalytics.enableAfterConsent === 'function'
      ) {
        window.BrainSweepAnalytics.enableAfterConsent();
      }
    });

    if (btnDecline) {
      btnDecline.addEventListener('click', () => {
        banner.hidden = true;
        try {
          localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'declined');
        } catch {
          // ignore storage errors
        }
      });
    }
  }

  // --- Hamburger Menu & Single-Page Statistics Architecture (stats_easy, stats_medium, stats_hard) ---
  const STATS_DIFF_ORDER = ['easy', 'medium', 'hard'];
  let viewDifficulty = 'easy';

  const btnHamburgerMenu = document.getElementById('btnHamburgerMenu');
  const hamburgerDropdown = document.getElementById('hamburgerDropdown');
  const hamburgerMenuWrap = document.getElementById('hamburgerMenuWrap');
  const btnOpenStatistics = document.getElementById('btnOpenStatistics');

  const statisticsModal = document.getElementById('statisticsModal');
  const statisticsCard = document.getElementById('statisticsCard');
  const btnCloseStatistics = document.getElementById('btnCloseStatistics');
  const btnStatsPrevDiff = document.getElementById('btnStatsPrevDiff');
  const btnStatsNextDiff = document.getElementById('btnStatsNextDiff');
  const statsDifficultyTitle = document.getElementById('statsDifficultyTitle');

  function getStatsStorageKey(diff) {
    const cleanDiff = DIFFICULTIES[diff] ? diff : 'easy';
    return `stats_${cleanDiff}`;
  }

  function createDefaultDifficultyStats(diff) {
    const cfg = DIFFICULTIES[diff] || DIFFICULTIES.easy;
    // Seed from existing high score record if player has prior games before stats tracking
    const legacyScores = loadHighScores();
    const legacy = legacyScores[diff];
    const seedTotal = legacy ? parseInt(legacy.total, 10) || legacy.extracted || 0 : 0;
    const seedLast = legacy ? parseInt(legacy.extracted, 10) || 0 : 0;

    return {
      hasPlayed: seedTotal > 0,
      lastSessionScore: seedLast,
      lastTargetTotal: cfg.targetCount,
      lastPaceSec:
        legacy && seedLast > 0 && legacy.time > 0
          ? Number((Number(legacy.time) / seedLast).toFixed(2))
          : null,
      totalScore: seedTotal,
      gamesPlayed: seedTotal > 0 ? Math.max(1, Math.ceil(seedTotal / cfg.targetCount)) : 0,
      perfectRuns: seedLast >= cfg.targetCount ? 1 : 0,
      totalNumbersExtracted: seedTotal,
      totalTargetsAvailable:
        seedTotal > 0
          ? Math.max(cfg.targetCount, Math.ceil(seedTotal / cfg.targetCount) * cfg.targetCount)
          : 0,
      fastestPerfectTimeRemainingSec:
        seedLast >= cfg.targetCount && legacy && legacy.time < cfg.durationSec
          ? Number(Math.max(0, cfg.durationSec - Number(legacy.time)).toFixed(1))
          : null,
      totalTimePlayedSec:
        seedTotal > 0 && legacy && legacy.time
          ? Number(
              (
                Math.max(1, Math.ceil(seedTotal / cfg.targetCount)) * Number(legacy.time)
              ).toFixed(1)
            )
          : 0,
    };
  }

  function loadDifficultyStats(diff) {
    const cleanDiff = DIFFICULTIES[diff] ? diff : 'easy';
    const key = getStatsStorageKey(cleanDiff);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return createDefaultDifficultyStats(cleanDiff);
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return createDefaultDifficultyStats(cleanDiff);
      }
      return {
        ...createDefaultDifficultyStats(cleanDiff),
        ...parsed,
      };
    } catch {
      return createDefaultDifficultyStats(cleanDiff);
    }
  }

  function saveDifficultyStats(diff, statsObj) {
    const cleanDiff = DIFFICULTIES[diff] ? diff : 'easy';
    const key = getStatsStorageKey(cleanDiff);
    try {
      localStorage.setItem(key, JSON.stringify(statsObj));
    } catch {
      // ignore storage errors
    }
  }

  function recordGameStatistics(
    diff,
    sessionScore,
    targetTotal,
    timeTaken,
    timeRemaining,
    completedAll
  ) {
    const cleanDiff = DIFFICULTIES[diff] ? diff : 'easy';
    const stats = loadDifficultyStats(cleanDiff);
    const cleanScore = Math.max(0, parseInt(sessionScore, 10) || 0);
    const cleanTargetTotal = Math.max(1, parseInt(targetTotal, 10) || DIFFICULTIES[cleanDiff].targetCount);
    const cleanTimeTaken = Math.max(0.1, Number(timeTaken) || 60);
    const cleanTimeRem = Math.max(0, Number(timeRemaining) || 0);

    stats.hasPlayed = true;
    stats.lastSessionScore = cleanScore;
    stats.lastTargetTotal = cleanTargetTotal;
    stats.lastPaceSec =
      cleanScore > 0 ? Number((cleanTimeTaken / cleanScore).toFixed(2)) : null;

    stats.totalScore = (Number(stats.totalScore) || 0) + cleanScore;
    stats.gamesPlayed = (Number(stats.gamesPlayed) || 0) + 1;
    if (completedAll) {
      stats.perfectRuns = (Number(stats.perfectRuns) || 0) + 1;
      const remRounded = Number(cleanTimeRem.toFixed(1));
      stats.fastestPerfectTimeRemainingSec =
        stats.fastestPerfectTimeRemainingSec === null ||
        stats.fastestPerfectTimeRemainingSec === undefined
          ? remRounded
          : Math.max(Number(stats.fastestPerfectTimeRemainingSec), remRounded);
    }

    stats.totalNumbersExtracted = (Number(stats.totalNumbersExtracted) || 0) + cleanScore;
    stats.totalTargetsAvailable = (Number(stats.totalTargetsAvailable) || 0) + cleanTargetTotal;
    stats.totalTimePlayedSec = Number(
      ((Number(stats.totalTimePlayedSec) || 0) + cleanTimeTaken).toFixed(1)
    );

    saveDifficultyStats(cleanDiff, stats);
  }

  function formatPlayDuration(totalSeconds) {
    const secNum = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const hours = Math.floor(secNum / 3600);
    const minutes = Math.floor((secNum % 3600) / 60);
    const seconds = secNum % 60;

    if (hours > 0) {
      return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `0m ${seconds}s`;
  }

  function renderStatisticsView(diff = viewDifficulty) {
    const cleanDiff = DIFFICULTIES[diff] ? diff : state.difficulty || 'easy';
    viewDifficulty = cleanDiff;
    const cfg = DIFFICULTIES[cleanDiff];
    const stats = loadDifficultyStats(cleanDiff);
    const diffIdx = STATS_DIFF_ORDER.indexOf(cleanDiff);

    if (statsDifficultyTitle) {
      statsDifficultyTitle.textContent = cfg.label.toUpperCase();
    }
    if (btnStatsPrevDiff) {
      btnStatsPrevDiff.disabled = diffIdx <= 0;
    }
    if (btnStatsNextDiff) {
      btnStatsNextDiff.disabled = diffIdx >= STATS_DIFF_ORDER.length - 1;
    }

    // Card 1: LAST GAME
    const elLastScore = document.getElementById('statLastSessionScore');
    const elLastRate = document.getElementById('statLastExtractionRate');
    const elLastPace = document.getElementById('statLastPace');

    const lastScore = Number(stats.lastSessionScore) || 0;
    const lastTargets = Number(stats.lastTargetTotal) || cfg.targetCount;
    if (elLastScore) {
      elLastScore.textContent = `${lastScore} ${lastScore === 1 ? 'point' : 'points'}`;
    }
    if (elLastRate) {
      elLastRate.textContent = `${lastScore} / ${lastTargets} targets`;
    }
    if (elLastPace) {
      elLastPace.textContent =
        stats.lastPaceSec !== null &&
        stats.lastPaceSec !== undefined &&
        Number(stats.lastPaceSec) > 0
          ? `${Number(stats.lastPaceSec).toFixed(1)}s`
          : '—';
    }

    // Card 2: YOUR STATS
    const elTotalScore = document.getElementById('statTotalScore');
    const elGamesPlayed = document.getElementById('statGamesPlayed');
    const elPerfectRuns = document.getElementById('statPerfectRuns');
    const elOverallRate = document.getElementById('statOverallExtractionRate');
    const elTotalExtracted = document.getElementById('statTotalExtracted');
    const elFastestPerfect = document.getElementById('statFastestPerfectRun');
    const elAvgPace = document.getElementById('statAveragePace');
    const elTotalTime = document.getElementById('statTotalTimePlayed');

    const totalScore = Number(stats.totalScore) || 0;
    const gamesPlayed = Number(stats.gamesPlayed) || 0;
    const perfectRuns = Number(stats.perfectRuns) || 0;
    const totalExtracted = Number(stats.totalNumbersExtracted) || 0;
    const totalAvailable = Number(stats.totalTargetsAvailable) || 0;
    const totalTimeSec = Number(stats.totalTimePlayedSec) || 0;

    const overallRatePct =
      totalAvailable > 0
        ? Math.min(100, Math.round((totalExtracted / totalAvailable) * 100))
        : 0;

    if (elTotalScore) elTotalScore.textContent = String(totalScore);
    if (elGamesPlayed) elGamesPlayed.textContent = String(gamesPlayed);
    if (elPerfectRuns) elPerfectRuns.textContent = String(perfectRuns);
    if (elOverallRate) elOverallRate.textContent = `${overallRatePct}%`;
    if (elTotalExtracted) elTotalExtracted.textContent = String(totalExtracted);

    if (elFastestPerfect) {
      elFastestPerfect.textContent =
        stats.fastestPerfectTimeRemainingSec !== null &&
        stats.fastestPerfectTimeRemainingSec !== undefined
          ? `Cleared with ${Number(stats.fastestPerfectTimeRemainingSec).toFixed(1)}s remaining`
          : '—';
    }

    if (elAvgPace) {
      elAvgPace.textContent =
        totalExtracted > 0 && totalTimeSec > 0
          ? `${(totalTimeSec / totalExtracted).toFixed(1)}s`
          : '—';
    }

    if (elTotalTime) {
      elTotalTime.textContent = formatPlayDuration(totalTimeSec);
    }
  }

  function closeHamburgerDropdown() {
    if (!hamburgerDropdown || !btnHamburgerMenu) return;
    hamburgerDropdown.hidden = true;
    btnHamburgerMenu.setAttribute('aria-expanded', 'false');
  }

  function toggleHamburgerDropdown() {
    if (!hamburgerDropdown || !btnHamburgerMenu) return;
    const willOpen = hamburgerDropdown.hidden;
    hamburgerDropdown.hidden = !willOpen;
    btnHamburgerMenu.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  function openStatisticsModal() {
    closeHamburgerDropdown();
    // Default State: open Statistics on the difficulty the user is currently set to
    viewDifficulty = DIFFICULTIES[state.difficulty] ? state.difficulty : 'easy';
    renderStatisticsView(viewDifficulty);
    closeAllOverlayModals();
    if (statisticsModal) {
      setModalOpen(statisticsModal, true);
    }
  }

  if (btnHamburgerMenu) {
    btnHamburgerMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHamburgerDropdown();
    });
  }

  if (btnOpenStatistics) {
    btnOpenStatistics.addEventListener('click', () => {
      openStatisticsModal();
    });
  }

  document.addEventListener('click', (e) => {
    if (
      hamburgerDropdown &&
      !hamburgerDropdown.hidden &&
      hamburgerMenuWrap &&
      !hamburgerMenuWrap.contains(e.target)
    ) {
      closeHamburgerDropdown();
    }
  });

  if (btnCloseStatistics) {
    btnCloseStatistics.addEventListener('click', () => {
      navigateToScreen('home');
    });
  }

  if (btnStatsPrevDiff) {
    btnStatsPrevDiff.addEventListener('click', () => {
      const idx = STATS_DIFF_ORDER.indexOf(viewDifficulty);
      if (idx > 0) {
        viewDifficulty = STATS_DIFF_ORDER[idx - 1];
        renderStatisticsView(viewDifficulty);
      }
    });
  }

  if (btnStatsNextDiff) {
    btnStatsNextDiff.addEventListener('click', () => {
      const idx = STATS_DIFF_ORDER.indexOf(viewDifficulty);
      if (idx !== -1 && idx < STATS_DIFF_ORDER.length - 1) {
        viewDifficulty = STATS_DIFF_ORDER[idx + 1];
        renderStatisticsView(viewDifficulty);
      }
    });
  }

  // Horizontal swipe gesture on Statistics card to switch between Easy, Medium, and Hard
  if (statisticsCard) {
    let touchStartX = null;
    let touchStartY = null;
    statisticsCard.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches && e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      },
      { passive: true }
    );
    statisticsCard.addEventListener(
      'touchend',
      (e) => {
        if (touchStartX === null || !e.changedTouches || e.changedTouches.length === 0) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        touchStartX = null;
        touchStartY = null;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          const idx = STATS_DIFF_ORDER.indexOf(viewDifficulty);
          if (dx < 0 && idx < STATS_DIFF_ORDER.length - 1) {
            viewDifficulty = STATS_DIFF_ORDER[idx + 1];
            renderStatisticsView(viewDifficulty);
          } else if (dx > 0 && idx > 0) {
            viewDifficulty = STATS_DIFF_ORDER[idx - 1];
            renderStatisticsView(viewDifficulty);
          }
        }
      },
      { passive: true }
    );
  }

  // --- Achievements System (15 Achievements + Progress Bars + Unlock Toasts) ---
  const ACHIEVEMENTS_STORAGE_KEY = 'brainsweep_achievements_v1';

  const btnOpenAchievements = document.getElementById('btnOpenAchievements');
  const achievementsModal = document.getElementById('achievementsModal');
  const btnCloseAchievements = document.getElementById('btnCloseAchievements');
  const achievementsList = document.getElementById('achievementsList');
  const achievementsCountBadge = document.getElementById('achievementsCountBadge');
  const achievementToast = document.getElementById('achievementToast');
  const achievementToastText = document.getElementById('achievementToastText');

  const ACHIEVEMENTS_LIST = [
    // Milestones (Games Played)
    {
      id: 'initiate',
      title: 'INITIATE',
      description: 'Complete your first game.',
      icon: '⚡',
      unlocked: false,
      target: 1,
      showProgress: true,
      getCurrent: (ctx) => ctx.totalGames,
    },
    {
      id: 'warming_up',
      title: 'WARMING UP',
      description: 'Play 10 games.',
      icon: '🔥',
      unlocked: false,
      target: 10,
      showProgress: true,
      getCurrent: (ctx) => ctx.totalGames,
    },
    {
      id: 'dedicated',
      title: 'DEDICATED',
      description: 'Play 50 games.',
      icon: '🎖️',
      unlocked: false,
      target: 50,
      showProgress: true,
      getCurrent: (ctx) => ctx.totalGames,
    },
    {
      id: 'brainiac',
      title: 'BRAINIAC',
      description: 'Play 100 games.',
      icon: '🧠',
      unlocked: false,
      target: 100,
      showProgress: true,
      getCurrent: (ctx) => ctx.totalGames,
    },
    {
      id: 'cognitive_athlete',
      title: 'SWEEP LEGEND',
      description: 'Play 500 games.',
      icon: '👑',
      unlocked: false,
      target: 500,
      showProgress: true,
      getCurrent: (ctx) => ctx.totalGames,
    },

    // Extraction & Score
    {
      id: 'first_blood',
      title: 'FIRST BLOOD',
      description: 'Extract your first number.',
      icon: '🎯',
      unlocked: false,
      target: 1,
      showProgress: true,
      getCurrent: (ctx) => ctx.totalExtracted,
    },
    {
      id: 'digit_destroyer',
      title: 'DIGIT DESTROYER',
      description: 'Extract 1,000 numbers in total.',
      icon: '💥',
      unlocked: false,
      target: 1000,
      showProgress: true,
      getCurrent: (ctx) => ctx.totalExtracted,
    },
    {
      id: 'the_cleaner',
      title: 'THE CLEANER',
      description: 'Extract 20 numbers in a single round.',
      icon: '🧹',
      unlocked: false,
      target: 20,
      showProgress: true,
      getCurrent: (ctx) => ctx.maxSingleRoundExtracted,
    },
    {
      id: 'max_capacity',
      title: 'MAX CAPACITY',
      description: 'Extract 25 numbers in a single round (Requires Hard mode).',
      icon: '🚀',
      unlocked: false,
      target: 25,
      showProgress: true,
      getCurrent: (ctx) => ctx.maxHardRoundExtracted,
    },

    // Speed & Precision
    {
      id: 'quick_draw',
      title: 'QUICK DRAW',
      description: 'Finish a game with more than 15 seconds remaining.',
      icon: '⏱️',
      unlocked: false,
      target: 1,
      showProgress: false,
      getCurrent: (ctx) => (ctx.bestTimeRemaining > 15 ? 1 : 0),
    },
    {
      id: 'speed_demon',
      title: 'SPEED DEMON',
      description: 'Finish a game with more than 30 seconds remaining.',
      icon: '☄️',
      unlocked: false,
      target: 1,
      showProgress: false,
      getCurrent: (ctx) => (ctx.bestTimeRemaining > 30 ? 1 : 0),
    },
    {
      id: 'flawless',
      title: 'FLAWLESS',
      description: 'Achieve a Perfect Run (extract all targets) on Easy mode.',
      icon: '💎',
      unlocked: false,
      target: 1,
      showProgress: false,
      getCurrent: (ctx) => (ctx.easyPerfectRuns >= 1 ? 1 : 0),
    },
    {
      id: 'unstoppable',
      title: 'UNSTOPPABLE',
      description: 'Achieve a Perfect Run on Hard mode.',
      icon: '🛡️',
      unlocked: false,
      target: 1,
      showProgress: false,
      getCurrent: (ctx) => (ctx.hardPerfectRuns >= 1 ? 1 : 0),
    },

    // Special Modes
    {
      id: 'memory_master',
      title: 'MEMORY MASTER',
      description: 'Score at least 10 points with "Working Memory Mode" enabled.',
      icon: '👁️',
      unlocked: false,
      target: 10,
      showProgress: true,
      getCurrent: (ctx) => ctx.bestMemoryModeScore,
    },
    {
      id: 'chaos_agent',
      title: 'CHAOS AGENT',
      description: 'Play a game using the "Hybrid Chaos" trajectory pattern.',
      icon: '🔀',
      unlocked: false,
      target: 1,
      showProgress: false,
      getCurrent: (ctx) => (ctx.playedHybridChaos ? 1 : 0),
    },

    // Daily Streaks (Phase 6.4)
    {
      id: 'streak_3',
      title: '3-DAY STREAK',
      description: 'Complete Daily Sweep 3 days in a row.',
      icon: '🔥',
      unlocked: false,
      target: 3,
      showProgress: true,
      getCurrent: (ctx) => ctx.longestDailyStreak,
    },
    {
      id: 'streak_7',
      title: '7-DAY STREAK',
      description: 'Complete Daily Sweep 7 days in a row.',
      icon: '🌟',
      unlocked: false,
      target: 7,
      showProgress: true,
      getCurrent: (ctx) => ctx.longestDailyStreak,
    },
  ];

  function loadAchievementsStorage() {
    try {
      const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
      if (!raw) {
        return {
          unlockedIds: {},
          maxSingleRoundExtracted: 0,
          maxHardRoundExtracted: 0,
          bestMemoryModeScore: 0,
          playedHybridChaos: false,
        };
      }
      const parsed = JSON.parse(raw);
      return {
        unlockedIds: (parsed && parsed.unlockedIds) || {},
        maxSingleRoundExtracted: Number(parsed && parsed.maxSingleRoundExtracted) || 0,
        maxHardRoundExtracted: Number(parsed && parsed.maxHardRoundExtracted) || 0,
        bestMemoryModeScore: Number(parsed && parsed.bestMemoryModeScore) || 0,
        playedHybridChaos: Boolean(parsed && parsed.playedHybridChaos),
      };
    } catch {
      return {
        unlockedIds: {},
        maxSingleRoundExtracted: 0,
        maxHardRoundExtracted: 0,
        bestMemoryModeScore: 0,
        playedHybridChaos: false,
      };
    }
  }

  function saveAchievementsStorage(data) {
    try {
      localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore storage errors
    }
  }

  function buildAchievementContext(storedMeta) {
    const easyStats = loadDifficultyStats('easy');
    const medStats = loadDifficultyStats('medium');
    const hardStats = loadDifficultyStats('hard');
    const legacyScores = loadHighScores();

    const totalGames =
      (Number(easyStats.gamesPlayed) || 0) +
      (Number(medStats.gamesPlayed) || 0) +
      (Number(hardStats.gamesPlayed) || 0);

    const totalExtracted =
      (Number(easyStats.totalNumbersExtracted) || 0) +
      (Number(medStats.totalNumbersExtracted) || 0) +
      (Number(hardStats.totalNumbersExtracted) || 0);

    const easyBestSingle = Math.max(
      Number(easyStats.lastSessionScore) || 0,
      Number(legacyScores.easy && legacyScores.easy.extracted) || 0
    );
    const medBestSingle = Math.max(
      Number(medStats.lastSessionScore) || 0,
      Number(legacyScores.medium && legacyScores.medium.extracted) || 0
    );
    const hardBestSingle = Math.max(
      Number(hardStats.lastSessionScore) || 0,
      Number(legacyScores.hard && legacyScores.hard.extracted) || 0
    );

    const maxSingleRoundExtracted = Math.max(
      Number(storedMeta.maxSingleRoundExtracted) || 0,
      easyBestSingle,
      medBestSingle,
      hardBestSingle
    );

    const maxHardRoundExtracted = Math.max(
      Number(storedMeta.maxHardRoundExtracted) || 0,
      hardBestSingle
    );

    const bestTimeRemaining = Math.max(
      Number(easyStats.fastestPerfectTimeRemainingSec) || 0,
      Number(medStats.fastestPerfectTimeRemainingSec) || 0,
      Number(hardStats.fastestPerfectTimeRemainingSec) || 0
    );

    const streakData = loadDailyStreak();
    return {
      totalGames,
      totalExtracted,
      maxSingleRoundExtracted,
      maxHardRoundExtracted,
      bestTimeRemaining,
      easyPerfectRuns: Number(easyStats.perfectRuns) || 0,
      hardPerfectRuns: Number(hardStats.perfectRuns) || 0,
      bestMemoryModeScore: Number(storedMeta.bestMemoryModeScore) || 0,
      playedHybridChaos: Boolean(storedMeta.playedHybridChaos),
      longestDailyStreak: Math.max(Number(streakData.longest) || 0, getActiveStreakCount()),
    };
  }

  let achievementToastTimer = null;
  function showAchievementUnlockToast(newlyUnlockedTitles) {
    if (!achievementToast || !achievementToastText || !newlyUnlockedTitles.length) return;
    const label =
      newlyUnlockedTitles.length === 1
        ? `Achievement Unlocked: ${newlyUnlockedTitles[0]}`
        : `${newlyUnlockedTitles.length} Achievements Unlocked! (${newlyUnlockedTitles[0]})`;

    achievementToastText.textContent = label;
    achievementToast.hidden = false;

    if (achievementToastTimer) {
      clearTimeout(achievementToastTimer);
    }
    achievementToastTimer = setTimeout(() => {
      achievementToast.hidden = true;
    }, 3400);
  }

  function checkAchievements(sessionContext = null) {
    const stored = loadAchievementsStorage();

    if (sessionContext && typeof sessionContext === 'object') {
      const score = Math.max(0, parseInt(sessionContext.sessionScore, 10) || 0);
      if (score > stored.maxSingleRoundExtracted) {
        stored.maxSingleRoundExtracted = score;
      }
      if (sessionContext.difficulty === 'hard' && score > stored.maxHardRoundExtracted) {
        stored.maxHardRoundExtracted = score;
      }
      if (sessionContext.memoryMode && score > stored.bestMemoryModeScore) {
        stored.bestMemoryModeScore = score;
      }
      if (sessionContext.pattern === 'mixed') {
        stored.playedHybridChaos = true;
      }
    }

    const ctx = buildAchievementContext(stored);
    const newlyUnlocked = [];

    ACHIEVEMENTS_LIST.forEach((ach) => {
      const currentVal = ach.getCurrent(ctx);
      const isNowUnlocked = Boolean(stored.unlockedIds[ach.id]) || currentVal >= ach.target;
      if (isNowUnlocked && !stored.unlockedIds[ach.id]) {
        stored.unlockedIds[ach.id] = true;
        newlyUnlocked.push(ach.title);
      }
      ach.unlocked = isNowUnlocked;
    });

    saveAchievementsStorage(stored);

    if (sessionContext && sessionContext.notify && newlyUnlocked.length > 0) {
      showAchievementUnlockToast(newlyUnlocked);
    }

    renderAchievementsList();
    return newlyUnlocked;
  }

  function renderAchievementsList() {
    if (!achievementsList) return;
    const stored = loadAchievementsStorage();
    const ctx = buildAchievementContext(stored);

    let unlockedCount = 0;
    achievementsList.innerHTML = '';

    ACHIEVEMENTS_LIST.forEach((ach) => {
      const currentVal = ach.getCurrent(ctx);
      const isUnlocked = Boolean(stored.unlockedIds[ach.id]) || currentVal >= ach.target;
      ach.unlocked = isUnlocked;
      if (isUnlocked) unlockedCount += 1;

      const row = document.createElement('div');
      row.className = `achievement-row${isUnlocked ? '' : ' locked'}`;
      row.setAttribute('role', 'listitem');

      // Left Circular Icon + Padlock Overlay if Locked
      const iconCircle = document.createElement('div');
      iconCircle.className = 'achievement-icon-circle';

      const glyph = document.createElement('span');
      glyph.className = 'achievement-glyph';
      glyph.textContent = ach.icon;
      iconCircle.appendChild(glyph);

      if (!isUnlocked) {
        const lockOverlay = document.createElement('span');
        lockOverlay.className = 'achievement-lock-overlay';
        lockOverlay.setAttribute('aria-label', 'Locked');
        lockOverlay.innerHTML =
          '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
        iconCircle.appendChild(lockOverlay);
      }

      // Right Content: Title, Status Pill, Description & Progress Bar
      const content = document.createElement('div');
      content.className = 'achievement-content';

      const titleRow = document.createElement('div');
      titleRow.className = 'achievement-title-row';

      const titleEl = document.createElement('strong');
      titleEl.className = 'achievement-title';
      titleEl.textContent = ach.title;

      const statusTag = document.createElement('span');
      statusTag.className = 'achievement-status-tag';
      statusTag.textContent = isUnlocked ? 'UNLOCKED' : 'LOCKED';

      titleRow.appendChild(titleEl);
      titleRow.appendChild(statusTag);

      const descEl = document.createElement('p');
      descEl.className = 'achievement-desc';
      descEl.textContent = ach.description;

      content.appendChild(titleRow);
      content.appendChild(descEl);

      // Show progress bar inside locked achievements when applicable
      if (!isUnlocked && ach.showProgress && ach.target > 1) {
        const clampedCurrent = Math.max(0, Math.min(ach.target, Math.floor(currentVal)));
        const pct = Math.max(0, Math.min(100, Math.round((clampedCurrent / ach.target) * 100)));

        const progWrap = document.createElement('div');
        progWrap.className = 'achievement-progress-wrap';

        const progTrack = document.createElement('div');
        progTrack.className = 'achievement-progress-track';

        const progFill = document.createElement('div');
        progFill.className = 'achievement-progress-fill';
        progFill.style.width = `${pct}%`;
        progTrack.appendChild(progFill);

        const progText = document.createElement('span');
        progText.className = 'achievement-progress-text';
        progText.textContent = `${clampedCurrent} / ${ach.target}`;

        progWrap.appendChild(progTrack);
        progWrap.appendChild(progText);
        content.appendChild(progWrap);
      }

      row.appendChild(iconCircle);
      row.appendChild(content);
      achievementsList.appendChild(row);
    });

    if (achievementsCountBadge) {
      achievementsCountBadge.textContent = `UNLOCKED: ${unlockedCount} / ${ACHIEVEMENTS_LIST.length}`;
    }
  }

  function openAchievementsModal() {
    closeHamburgerDropdown();
    checkAchievements({ notify: false });
    closeAllOverlayModals();
    if (achievementsModal) {
      setModalOpen(achievementsModal, true);
    }
  }

  if (btnOpenAchievements) {
    btnOpenAchievements.addEventListener('click', () => {
      openAchievementsModal();
    });
  }

  if (btnCloseAchievements) {
    btnCloseAchievements.addEventListener('click', () => {
      navigateToScreen('home');
    });
  }

  // --- Initial Boot ---
  loadPersistedSettings();
  applyEmbedUrlParams();
  syncPlayerProfileUI();
  initIosInstallPrompt();
  initCookieConsentBanner();
  syncNetworkModeUI();
  syncSettingsUI();
  syncDailyAndStreakUI();
  checkAchievements({ notify: false });
  resizeCanvas();
  createNodes();
  updateHUD();
  state.lastFrameTime = performance.now();

  // Phase 5.1: Never auto-start the timer on load.
  // In Embed Mode, Offline Mode, or ?daily=1 deep link, show the TAP TO PLAY overlay.
  if (!state.embedLicensed) {
    closeAllOverlayModals();
  } else if (state.isEmbedMode) {
    prepareArenaWithTapOverlay({ daily: state.isDailyMode, mode: 'embed' });
  } else if (!navigator.onLine) {
    prepareArenaWithTapOverlay({ daily: false, mode: 'offline' });
  } else if (state.isDailyMode) {
    prepareArenaWithTapOverlay({ daily: true, mode: 'daily' });
  } else {
    try {
      const bootParams = new URLSearchParams(window.location.search || '');
      if (bootParams.get('screen') === 'help' || window.location.hash === '#help') {
        navigateToScreen('help');
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      } else {
        setModalOpen(setupModal, true);
      }
    } catch {
      setModalOpen(setupModal, true);
    }
  }

  requestAnimationFrame(tick);
})();
