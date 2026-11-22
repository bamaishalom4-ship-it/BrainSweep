/**
 * BrainSweep Hardened Leaderboard Backend — Google Apps Script (Phase 7)
 *
 * Target Google Sheet:
 * https://docs.google.com/spreadsheets/d/1r7rsCfeqHpvz9-Sv6PtTGDNBiTHy0evbkU3HeimjBCA/edit
 *
 * Sheets Used:
 * 1. "Leaderboard" (User Profiles, Best Single-Round Scores + Legacy Cumulative Totals + Marketing Opt-In):
 *    Columns:
 *    A: Username | B: Email | C: EasyScore (Cumulative) | D: MediumScore (Cumulative) | E: HardScore (Cumulative)
 *    F: EasyBest | G: EasyBestTimeMs | H: MediumBest | I: MediumBestTimeMs | J: HardBest | K: HardBestTimeMs
 *    L: MarketingOptIn | M: MarketingOptInAt | N: UpdatedAt
 *
 * 2. "RoundsLog" (Individual Validated Round Submissions for Today / This Week / All-Time Boards):
 *    Columns:
 *    A: TimestampIso | B: DateLagos | C: RoundId | D: Username | E: Difficulty | F: IsDaily | G: Score | H: TimeMs
 *
 * HOW TO REDEPLOY IN GOOGLE APPS SCRIPT:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this entire file into Code.gs and click Save.
 * 3. Click "Deploy" -> "Manage deployments" -> click the Pencil (Edit) icon on your active Web App.
 * 4. Under Version, select "New version", then click "Deploy".
 */

const SPREADSHEET_ID = '1r7rsCfeqHpvz9-Sv6PtTGDNBiTHy0evbkU3HeimjBCA';
const LEADERBOARD_SHEET_NAME = 'Leaderboard';
const ROUNDS_SHEET_NAME = 'RoundsLog';
const LEADS_SHEET_NAME = 'PublisherLeads';
const LEAD_ALERT_EMAIL = 'madebykubo@gmail.com';
const MIGRATION_DATE_ISO = '2026-11-22T00:00:00.000Z';

const LEADERBOARD_HEADERS = [
  'Username',
  'Email',
  'EasyScore',
  'MediumScore',
  'HardScore',
  'EasyBest',
  'EasyBestTimeMs',
  'MediumBest',
  'MediumBestTimeMs',
  'HardBest',
  'HardBestTimeMs',
  'MarketingOptIn',
  'MarketingOptInAt',
  'UpdatedAt',
  'legacy',
];

const ROUNDS_HEADERS = [
  'TimestampIso',
  'DateLagos',
  'RoundId',
  'Username',
  'Difficulty',
  'IsDaily',
  'Score',
  'TimeMs',
  'legacy',
];

const LEADS_HEADERS = [
  'TimestampIso',
  'DateLagos',
  'CompanyName',
  'WorkEmail',
  'Domain',
  'Difficulty',
  'Theme',
  'Pattern',
  'DailyMode',
  'SponsorText',
  'BrandColor',
  'BrandLogo',
  'CtaText',
  'CtaUrl',
  'Notes',
  'Status',
];

const ALLOWED_DIFFICULTIES = {
  easy: { base: 'easy', maxTargets: 12, isDaily: false },
  medium: { base: 'medium', maxTargets: 20, isDaily: false },
  hard: { base: 'hard', maxTargets: 25, isDaily: false },
  daily_easy: { base: 'easy', maxTargets: 12, isDaily: true },
  daily_medium: { base: 'medium', maxTargets: 20, isDaily: true },
  daily_hard: { base: 'hard', maxTargets: 25, isDaily: true },
};

const BASIC_PROFANITY_LIST = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'whore',
  'slut',
  'bastard',
  'penis',
  'vagina',
];

function parseSafeInt(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback || 0;
  const parsed = parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback || 0;
}

function getLagosDateString(dateObj) {
  const d = dateObj || new Date();
  return Utilities.formatDate(d, 'Africa/Lagos', 'yyyy-MM-dd');
}

function normalizeSheetDateLagos(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Africa/Lagos', 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, 'Africa/Lagos', 'yyyy-MM-dd');
  }
  return str;
}

function normalizeSheetTimestampMs(val) {
  if (!val) return NaN;
  if (val instanceof Date) return val.getTime();
  return Date.parse(String(val));
}

function normalizeSheetBool(val) {
  return val === true || String(val || '').trim().toLowerCase() === 'true';
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function errorResponse(errorCode, message) {
  return jsonResponse({
    ok: false,
    status: 'error',
    error: errorCode,
    code: String(errorCode || 'server_error').toUpperCase(),
    message: message || errorCode,
  });
}

function getOrInitLeaderboardSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(LEADERBOARD_SHEET_NAME) || ss.getSheets()[0];
  if (!sheet) {
    sheet = ss.insertSheet(LEADERBOARD_SHEET_NAME);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(LEADERBOARD_HEADERS);
  } else {
    const numCols = Math.max(sheet.getLastColumn(), LEADERBOARD_HEADERS.length);
    const firstRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];
    if (String(firstRow[0]).trim() !== 'Username') {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, LEADERBOARD_HEADERS.length).setValues([LEADERBOARD_HEADERS]);
    } else if (sheet.getLastColumn() < LEADERBOARD_HEADERS.length || String(firstRow[14] || '').trim() !== 'legacy') {
      sheet.getRange(1, 1, 1, LEADERBOARD_HEADERS.length).setValues([LEADERBOARD_HEADERS]);
    }
  }
  return sheet;
}

function getOrInitRoundsSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(ROUNDS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ROUNDS_SHEET_NAME);
    sheet.appendRow(ROUNDS_HEADERS);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(ROUNDS_HEADERS);
  } else {
    const numCols = Math.max(sheet.getLastColumn(), ROUNDS_HEADERS.length);
    const firstRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];
    if (sheet.getLastColumn() < ROUNDS_HEADERS.length || String(firstRow[8] || '').trim() !== 'legacy') {
      sheet.getRange(1, 1, 1, ROUNDS_HEADERS.length).setValues([ROUNDS_HEADERS]);
    }
  }
  return sheet;
}

/**
 * ONE-TIME MIGRATION FUNCTION (run manually once from Apps Script Editor):
 * Flags legacy rows where score === targetCount AND timeMs === 60000 (or converted from
 * old cumulative totals) created before MIGRATION_DATE_ISO with legacy = TRUE.
 * Does NOT delete any rows.
 */
function cleanLegacyRows() {
  const migrationMs = Date.parse(MIGRATION_DATE_ISO);
  let flaggedLeaderboard = 0;
  let flaggedRounds = 0;

  // 1. Flag legacy rows in Leaderboard sheet
  const lbSheet = getOrInitLeaderboardSheet();
  const lbLast = lbSheet.getLastRow();
  if (lbLast > 1) {
    const lbData = lbSheet
      .getRange(2, 1, lbLast - 1, LEADERBOARD_HEADERS.length)
      .getValues();
    for (let i = 0; i < lbData.length; i++) {
      const row = lbData[i];
      const updatedMs = normalizeSheetTimestampMs(row[13]);
      const isBeforeMigration = !Number.isFinite(updatedMs) || updatedMs < migrationMs;

      const easyCum = parseSafeInt(row[2], 0);
      const medCum = parseSafeInt(row[3], 0);
      const hardCum = parseSafeInt(row[4], 0);

      const easyBest = parseSafeInt(row[5], 0);
      const easyTime = parseSafeInt(row[6], 60000) || 60000;
      const medBest = parseSafeInt(row[7], 0);
      const medTime = parseSafeInt(row[8], 60000) || 60000;
      const hardBest = parseSafeInt(row[9], 0);
      const hardTime = parseSafeInt(row[10], 60000) || 60000;

      const isConvertedFromCumulative =
        (easyBest === 0 && easyCum > 0) ||
        (medBest === 0 && medCum > 0) ||
        (hardBest === 0 && hardCum > 0);
      const isExact60kCap =
        (easyBest === 12 && easyTime === 60000) ||
        (medBest === 20 && medTime === 60000) ||
        (hardBest === 25 && hardTime === 60000);

      const isLegacy = isBeforeMigration && (isConvertedFromCumulative || isExact60kCap);
      lbSheet.getRange(i + 2, 15).setValue(isLegacy);
      if (isLegacy) flaggedLeaderboard += 1;
    }
  }

  // 2. Flag legacy rows in RoundsLog sheet
  const rSheet = getOrInitRoundsSheet();
  const rLast = rSheet.getLastRow();
  if (rLast > 1) {
    const rData = rSheet.getRange(2, 1, rLast - 1, ROUNDS_HEADERS.length).getValues();
    for (let i = 0; i < rData.length; i++) {
      const row = rData[i];
      const tsMs = normalizeSheetTimestampMs(row[0]);
      const isBeforeMigration = !Number.isFinite(tsMs) || tsMs < migrationMs;
      const diffKey = String(row[4] || '').trim().toLowerCase();
      const diffCfg = ALLOWED_DIFFICULTIES[diffKey] || ALLOWED_DIFFICULTIES.easy;
      const score = parseSafeInt(row[6], 0);
      const timeMs = parseSafeInt(row[7], 60000) || 60000;

      const isLegacy = isBeforeMigration && timeMs === 60000 && score === diffCfg.maxTargets;
      rSheet.getRange(i + 2, 9).setValue(isLegacy);
      if (isLegacy) flaggedRounds += 1;
    }
  }

  Logger.log(
    `cleanLegacyRows complete. Flagged Leaderboard rows: ${flaggedLeaderboard}, RoundsLog rows: ${flaggedRounds}`
  );
  return { ok: true, flaggedLeaderboard, flaggedRounds };
}

function getOrInitLeadsSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(LEADS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LEADS_SHEET_NAME);
    sheet.appendRow(LEADS_HEADERS);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(LEADS_HEADERS);
  }
  return sheet;
}

function sanitizeLeadField(val, maxLen) {
  return String(val || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLen || 200);
}

function handlePublisherLeadSubmission(body) {
  const companyName = sanitizeLeadField(body.companyName, 80);
  const workEmail = sanitizeLeadField(body.workEmail, 100).toLowerCase();
  const domain = sanitizeLeadField(body.domain, 120)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  const difficulty = sanitizeLeadField(body.difficulty, 20);
  const theme = sanitizeLeadField(body.theme, 20);
  const pattern = sanitizeLeadField(body.pattern, 20);
  const dailyMode = Boolean(body.daily);
  const sponsorText = sanitizeLeadField(body.sponsorText, 40);
  const brandColor = sanitizeLeadField(body.brandColor, 10);
  const brandLogo = sanitizeLeadField(body.brandLogo, 240);
  const ctaText = sanitizeLeadField(body.ctaText, 24);
  const ctaUrl = sanitizeLeadField(body.ctaUrl, 240);
  const notes = sanitizeLeadField(body.notes, 400);

  if (companyName.length < 2) {
    return jsonResponse({
      status: 'error',
      code: 'INVALID_COMPANY',
      message: 'Please enter your company or brand name.',
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    return jsonResponse({
      status: 'error',
      code: 'INVALID_EMAIL',
      message: 'Please enter a valid work email address.',
    });
  }
  if (domain.length < 3) {
    return jsonResponse({
      status: 'error',
      code: 'INVALID_DOMAIN',
      message: 'Please enter your website domain (e.g. yoursite.com).',
    });
  }

  const cache = CacheService.getScriptCache();
  const rateKey = `lead_${workEmail}`;
  if (cache.get(rateKey)) {
    return jsonResponse({
      status: 'error',
      code: 'RATE_LIMITED',
      message: 'Your inquiry was already received. Please wait a minute before submitting again.',
    });
  }

  const nowIso = new Date().toISOString();
  const todayLagos = getLagosDateString(new Date());
  const leadsSheet = getOrInitLeadsSheet();
  leadsSheet.appendRow([
    nowIso,
    "'" + todayLagos,
    companyName,
    workEmail,
    domain,
    difficulty,
    theme,
    pattern,
    dailyMode,
    sponsorText,
    brandColor,
    brandLogo,
    ctaText,
    ctaUrl,
    notes,
    'NEW',
  ]);

  cache.put(rateKey, '1', 60);

  // Send instant email alert (wrapped in try/catch so sheet write always succeeds)
  let emailSent = false;
  try {
    const subject = `[BrainSweep B2B Lead] ${companyName} (${domain})`;
    const bodyText = [
      'New BrainSweep B2B Publisher Embed / License Request:',
      '',
      `Company / Brand: ${companyName}`,
      `Work Email: ${workEmail}`,
      `Website Domain: ${domain}`,
      `Date (Lagos): ${todayLagos}`,
      '',
      '--- Configured Embed Settings ---',
      `Difficulty: ${difficulty || 'easy'}`,
      `Theme: ${theme || 'amber'}`,
      `Pattern: ${pattern || 'spiral'}`,
      `Daily Sweep Mode: ${dailyMode ? 'Yes' : 'No'}`,
      `Sponsor Text: ${sponsorText || '—'}`,
      `Brand Color: ${brandColor || '—'}`,
      `Brand Logo: ${brandLogo || '—'}`,
      `CTA Text: ${ctaText || '—'}`,
      `CTA URL: ${ctaUrl || '—'}`,
      '',
      '--- Campaign / Traffic Notes ---',
      notes || '—',
      '',
      'Logged in Google Sheet tab: PublisherLeads',
    ].join('\n');

    MailApp.sendEmail({
      to: LEAD_ALERT_EMAIL,
      replyTo: workEmail,
      subject,
      body: bodyText,
    });
    emailSent = true;
  } catch (mailErr) {
    // MailApp permission may need one-time authorization in Apps Script editor
    emailSent = false;
  }

  return jsonResponse({
    status: 'ok',
    saved: true,
    emailSent,
    message: 'Request received! We will follow up shortly.',
  });
}

function containsProfanity(username) {
  const lower = String(username || '').toLowerCase();
  for (let i = 0; i < BASIC_PROFANITY_LIST.length; i++) {
    if (lower.indexOf(BASIC_PROFANITY_LIST[i]) !== -1) {
      return true;
    }
  }
  return false;
}

/**
 * doGet(e)
 * Query params:
 *   ?board=today | week | alltime (default: alltime)
 *   ?difficulty=easy | medium | hard | daily_easy | daily_medium | daily_hard (default: easy)
 * Excludes legacy=TRUE rows from all boards. Daily and normal runs are strictly separated.
 * Returns top 50 entries: { position, username, score, timeMs } — NEVER returns emails.
 */
function doGet(e) {
  try {
    const rawDiff = String((e && e.parameter && e.parameter.difficulty) || 'easy')
      .trim()
      .toLowerCase();
    const diffCfg = ALLOWED_DIFFICULTIES[rawDiff] || ALLOWED_DIFFICULTIES.easy;
    const requestedDiff = ALLOWED_DIFFICULTIES[rawDiff] ? rawDiff : 'easy';
    const baseDiff = diffCfg.base;
    const isDailyReq = diffCfg.isDaily;
    const board = String((e && e.parameter && e.parameter.board) || 'alltime')
      .trim()
      .toLowerCase();

    // Daily boards or today/week boards read strictly from RoundsLog (excluding legacy rows)
    if (board === 'today' || board === 'week' || isDailyReq) {
      const roundsSheet = getOrInitRoundsSheet();
      const lastRow = roundsSheet.getLastRow();
      if (lastRow <= 1) {
        return jsonResponse({
          ok: true,
          status: 'ok',
          board,
          difficulty: requestedDiff,
          entries: [],
        });
      }
      const rows = roundsSheet
        .getRange(2, 1, lastRow - 1, ROUNDS_HEADERS.length)
        .getValues();
      const todayLagos = getLagosDateString(new Date());
      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

      const bestByUser = {};
      for (let i = 0; i < rows.length; i++) {
        const isLegacyRow = normalizeSheetBool(rows[i][8]);
        if (isLegacyRow) continue;

        const tsMs = normalizeSheetTimestampMs(rows[i][0]);
        const dateLagos = normalizeSheetDateLagos(rows[i][1]);
        const uname = String(rows[i][3] || '').trim();
        const rowDiff = String(rows[i][4] || '').trim().toLowerCase();
        const isDailyRow =
          normalizeSheetBool(rows[i][5]) || rowDiff.indexOf('daily_') === 0;
        const rowBaseDiff = rowDiff.replace(/^daily_/, '');
        const score = parseSafeInt(rows[i][6], 0);
        const timeMs = parseSafeInt(rows[i][7], 60000);

        if (!uname || score <= 0 || rowBaseDiff !== baseDiff) continue;

        // Strict separation: daily_* queries ONLY return daily runs; normal queries NEVER include daily runs
        if (isDailyReq && !isDailyRow) continue;
        if (!isDailyReq && isDailyRow) continue;

        if (board === 'today') {
          if (dateLagos !== todayLagos) continue;
        } else if (board === 'week') {
          if (Number.isFinite(tsMs) && tsMs < sevenDaysAgoMs) continue;
        }

        const key = uname.toLowerCase();
        const prev = bestByUser[key];
        if (
          !prev ||
          score > prev.score ||
          (score === prev.score && timeMs < prev.timeMs)
        ) {
          bestByUser[key] = { username: uname, score, timeMs };
        }
      }

      const list = Object.keys(bestByUser).map((k) => bestByUser[k]);
      list.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.timeMs - b.timeMs;
      });

      const top50 = list.slice(0, 50).map((item, idx) => ({
        position: idx + 1,
        username: item.username,
        score: item.score,
        timeMs: item.timeMs,
      }));

      return jsonResponse({
        ok: true,
        status: 'ok',
        board,
        difficulty: requestedDiff,
        entries: top50,
      });
    }

    // Normal 'alltime' board (Best single normal round per user, excluding legacy rows)
    const sheet = getOrInitLeaderboardSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({
        ok: true,
        status: 'ok',
        board: 'alltime',
        difficulty: requestedDiff,
        entries: [],
      });
    }

    const data = sheet
      .getRange(2, 1, lastRow - 1, LEADERBOARD_HEADERS.length)
      .getValues();
    const bestCol = baseDiff === 'medium' ? 7 : baseDiff === 'hard' ? 9 : 5;
    const timeCol = baseDiff === 'medium' ? 8 : baseDiff === 'hard' ? 10 : 6;

    const entries = [];
    for (let i = 0; i < data.length; i++) {
      const isLegacyRow = normalizeSheetBool(data[i][14]);
      if (isLegacyRow) continue;

      const uname = String(data[i][0] || '').trim();
      if (!uname) continue;

      const bestScore = parseSafeInt(data[i][bestCol], 0);
      const bestTimeMs = parseSafeInt(data[i][timeCol], 60000) || 60000;

      if (bestScore > 0) {
        entries.push({
          username: uname,
          score: bestScore,
          timeMs: bestTimeMs,
        });
      }
    }

    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.timeMs - b.timeMs;
    });

    const top50 = entries.slice(0, 50).map((item, idx) => ({
      position: idx + 1,
      username: item.username,
      score: item.score,
      timeMs: item.timeMs,
    }));

    return jsonResponse({
      ok: true,
      status: 'ok',
      board: 'alltime',
      difficulty: requestedDiff,
      entries: top50,
    });
  } catch (err) {
    return errorResponse(
      'server_error',
      String(err && err.message ? err.message : err)
    );
  }
}

/**
 * doPost(e)
 * Validates & records score submissions with 20s cooldown + 60/day rate limits,
 * required unique roundId, plausible time bounds (score*350..60000ms), HTML-stripped
 * nicknames (2-16 chars) with profanity filter, optional email, and marketing opt-in.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(rawBody);
    const action = String(body.action || 'submit').trim().toLowerCase();

    // Handle B2B Publisher Lead / Commercial License Requests from /developers
    if (action === 'publisher_lead') {
      return handlePublisherLeadSubmission(body);
    }

    // 1. Validate Nickname / Username (strip HTML, 2-16 chars, no profanity)
    const rawName = String(
      body.nickname !== undefined ? body.nickname : body.username || ''
    );
    const strippedName = rawName.replace(/<[^>]*>/g, '').trim();
    if (
      strippedName.length < 2 ||
      strippedName.length > 16 ||
      !/^[A-Za-z0-9_ -]{2,16}$/.test(strippedName)
    ) {
      return errorResponse(
        'invalid_nickname',
        'Nickname must be 2–16 characters (letters, numbers, spaces, hyphen, or underscore).'
      );
    }
    if (containsProfanity(strippedName)) {
      return errorResponse(
        'profanity_blocked',
        'Please choose an appropriate nickname.'
      );
    }
    const username = strippedName;

    // 2. Email is OPTIONAL (validate only if provided; never returned in any GET)
    const email = String(body.email || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse('invalid_email', 'Please provide a valid email address.');
    }

    // 3. Validate Difficulty
    const rawDiff = String(body.difficulty || 'easy').trim().toLowerCase();
    if (!ALLOWED_DIFFICULTIES[rawDiff]) {
      return errorResponse('invalid_difficulty', 'Invalid difficulty mode.');
    }
    const diffCfg = ALLOWED_DIFFICULTIES[rawDiff];
    const baseDiff = diffCfg.base;
    const isDaily = Boolean(body.isDaily) || diffCfg.isDaily;
    const storedDiff = isDaily ? `daily_${baseDiff}` : baseDiff;

    // 4. Validate Session Score (integer, 0 <= score <= maxTargets)
    const rawScore =
      body.sessionScore !== undefined ? body.sessionScore : body.score;
    const sessionScore = Number(rawScore);
    if (
      rawScore === undefined ||
      rawScore === null ||
      rawScore === '' ||
      !Number.isInteger(sessionScore) ||
      sessionScore < 0 ||
      sessionScore > diffCfg.maxTargets
    ) {
      return errorResponse(
        'score_out_of_range',
        `Score must be an integer between 0 and ${diffCfg.maxTargets}.`
      );
    }

    // 5. Validate Plausible Completion Time (score * 350ms <= timeMs <= 60000ms)
    const rawTime =
      body.timeMs !== undefined ? body.timeMs : body.timeTakenMs;
    const timeTakenMs =
      rawTime !== undefined && rawTime !== null && rawTime !== ''
        ? Number(rawTime)
        : 60000;
    const minPlausibleMs = sessionScore > 0 ? sessionScore * 350 : 0;
    if (
      sessionScore > 0 &&
      (!Number.isFinite(timeTakenMs) ||
        timeTakenMs < minPlausibleMs ||
        timeTakenMs > 60000)
    ) {
      return errorResponse(
        'implausible_time',
        `Completion time must be between ${minPlausibleMs}ms and 60000ms.`
      );
    }
    const cleanTimeMs = Math.round(
      Number.isFinite(timeTakenMs) ? Math.min(60000, Math.max(0, timeTakenMs)) : 60000
    );

    const roundId = String(body.roundId || '').trim();
    const marketingOptIn = Boolean(body.marketingOptIn);
    const cache = CacheService.getScriptCache();
    const props = PropertiesService.getScriptProperties();
    const unameLower = username.toLowerCase();
    const todayLagos = getLagosDateString(new Date());
    const playerKey = String(
      body.playerId || `${unameLower}_${String(body.fingerprint || '')}`
    )
      .trim()
      .toLowerCase()
      .slice(0, 64);

    // 6. Required unique roundId + 20s cooldown + 60/day rate limit (when score > 0)
    if (sessionScore > 0) {
      if (!roundId) {
        return errorResponse(
          'missing_round_id',
          'A unique roundId is required for score submissions.'
        );
      }

      const roundCacheKey = `round_${roundId}`;
      if (cache.get(roundCacheKey)) {
        return errorResponse(
          'duplicate_round_id',
          'This roundId has already been submitted.'
        );
      }

      const rate20Key = `rate20_${playerKey}`;
      if (action !== 'register' && cache.get(rate20Key)) {
        return errorResponse(
          'rate_limited_20s',
          'Please wait 20 seconds before submitting another score.'
        );
      }

      const dayCountKey = `daycount_${todayLagos}_${playerKey}`;
      const currentDayCount = parseSafeInt(props.getProperty(dayCountKey), 0);
      if (currentDayCount >= 60) {
        return errorResponse(
          'daily_rate_limit_exceeded',
          'Daily submission limit (60 per day) reached.'
        );
      }

      if (isDaily) {
        const dailyCacheKey = `daily_${todayLagos}_${storedDiff}_${unameLower}`;
        if (cache.get(dailyCacheKey)) {
          return errorResponse(
            'daily_already_submitted',
            'You have already submitted your scored Daily Sweep for today.'
          );
        }
      }
    }

    const sheet = getOrInitLeaderboardSheet();
    const lastRow = sheet.getLastRow();
    const cumCol = baseDiff === 'medium' ? 3 : baseDiff === 'hard' ? 4 : 2;
    const bestCol = baseDiff === 'medium' ? 7 : baseDiff === 'hard' ? 9 : 5;
    const timeCol = baseDiff === 'medium' ? 8 : baseDiff === 'hard' ? 10 : 6;

    let foundRowNumber = -1;
    let rowValues = null;

    if (lastRow > 1) {
      const data = sheet
        .getRange(2, 1, lastRow - 1, LEADERBOARD_HEADERS.length)
        .getValues();
      for (let i = 0; i < data.length; i++) {
        const existingUser = String(data[i][0] || '').trim();
        if (existingUser.toLowerCase() === unameLower) {
          foundRowNumber = i + 2;
          rowValues = data[i];
          break;
        }
      }
    }

    // Check username ownership by email (when both existing and incoming emails exist)
    if (foundRowNumber !== -1 && email) {
      const existingEmail = String(rowValues[1] || '').trim().toLowerCase();
      if (existingEmail && existingEmail !== email) {
        return errorResponse(
          'username_taken',
          'Username already taken. Please choose another.'
        );
      }
    }

    // Check RoundsLog sheet for duplicate roundId or duplicate Daily submission
    const roundsSheet = getOrInitRoundsSheet();
    if (sessionScore > 0) {
      const rLast = roundsSheet.getLastRow();
      if (rLast > 1) {
        const rData = roundsSheet
          .getRange(2, 1, rLast - 1, ROUNDS_HEADERS.length)
          .getValues();
        for (let i = rData.length - 1; i >= 0; i--) {
          const rDate = normalizeSheetDateLagos(rData[i][1]);
          const rId = String(rData[i][2] || '');
          const rUser = String(rData[i][3] || '').trim().toLowerCase();
          const rDiff = String(rData[i][4] || '').trim().toLowerCase();
          const rBaseDiff = rDiff.replace(/^daily_/, '');
          const rDaily =
            normalizeSheetBool(rData[i][5]) || rDiff.indexOf('daily_') === 0;

          if (roundId && rId === roundId) {
            return errorResponse(
              'duplicate_round_id',
              'This roundId has already been recorded.'
            );
          }
          if (
            isDaily &&
            rDaily &&
            rDate === todayLagos &&
            rUser === unameLower &&
            rBaseDiff === baseDiff
          ) {
            return errorResponse(
              'daily_already_submitted',
              'Daily Sweep score already recorded for today.'
            );
          }
        }
      }
    }

    const nowIso = new Date().toISOString();
    let newTotal = sessionScore;
    let bestScore = sessionScore;
    let bestTimeMs = cleanTimeMs;

    if (foundRowNumber !== -1) {
      const existingCum = parseSafeInt(rowValues[cumCol], 0);
      newTotal = existingCum + sessionScore;

      const prevBest = parseSafeInt(rowValues[bestCol], 0);
      const prevTime = parseSafeInt(rowValues[timeCol], 60000) || 60000;

      // Normal all-time best only updates on normal (!isDaily) rounds so daily & normal never mix
      if (
        !isDaily &&
        (sessionScore > prevBest ||
          (sessionScore === prevBest && sessionScore > 0 && cleanTimeMs < prevTime))
      ) {
        bestScore = sessionScore;
        bestTimeMs = cleanTimeMs;
      } else {
        bestScore = prevBest;
        bestTimeMs = prevTime;
      }

      sheet.getRange(foundRowNumber, cumCol + 1).setValue(newTotal);
      if (!isDaily) {
        sheet.getRange(foundRowNumber, bestCol + 1).setValue(bestScore);
        sheet.getRange(foundRowNumber, timeCol + 1).setValue(bestTimeMs);
        // Submitting a real new non-daily round unflags legacy for this player
        sheet.getRange(foundRowNumber, 15).setValue(false);
      }
      if (marketingOptIn) {
        sheet.getRange(foundRowNumber, 12).setValue(true);
        sheet.getRange(foundRowNumber, 13).setValue(nowIso);
      }
      sheet.getRange(foundRowNumber, 14).setValue(nowIso);
    } else {
      const newRow = [
        username,
        email,
        baseDiff === 'easy' ? sessionScore : 0,
        baseDiff === 'medium' ? sessionScore : 0,
        baseDiff === 'hard' ? sessionScore : 0,
        !isDaily && baseDiff === 'easy' ? sessionScore : 0,
        !isDaily && baseDiff === 'easy' ? cleanTimeMs : 60000,
        !isDaily && baseDiff === 'medium' ? sessionScore : 0,
        !isDaily && baseDiff === 'medium' ? cleanTimeMs : 60000,
        !isDaily && baseDiff === 'hard' ? sessionScore : 0,
        !isDaily && baseDiff === 'hard' ? cleanTimeMs : 60000,
        marketingOptIn,
        marketingOptIn ? nowIso : '',
        nowIso,
        false, // legacy = FALSE
      ];
      sheet.appendRow(newRow);
    }

    if (sessionScore > 0) {
      roundsSheet.appendRow([
        nowIso,
        "'" + todayLagos,
        roundId,
        username,
        storedDiff,
        isDaily,
        sessionScore,
        cleanTimeMs,
        false, // legacy = FALSE
      ]);

      cache.put(`round_${roundId}`, '1', 21600);
      cache.put(`rate20_${playerKey}`, '1', 20);
      const dayCountKey = `daycount_${todayLagos}_${playerKey}`;
      const nextCount = parseSafeInt(props.getProperty(dayCountKey), 0) + 1;
      props.setProperty(dayCountKey, String(nextCount));
      if (isDaily) {
        cache.put(`daily_${todayLagos}_${storedDiff}_${unameLower}`, '1', 21600);
      }
    }

    return jsonResponse({
      ok: true,
      status: 'ok',
      username,
      difficulty: storedDiff,
      isDaily,
      sessionScore,
      timeMs: cleanTimeMs,
      newTotal,
      bestScore,
      bestTimeMs,
    });
  } catch (err) {
    return errorResponse(
      'server_error',
      String(err && err.message ? err.message : err)
    );
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}
