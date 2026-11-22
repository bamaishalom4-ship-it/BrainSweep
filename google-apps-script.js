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

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
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
    } else if (sheet.getLastColumn() < LEADERBOARD_HEADERS.length) {
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
  }
  return sheet;
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
 *   ?difficulty=easy | medium | hard (default: easy)
 * Returns top 50 entries: { position, username, score, timeMs } — NEVER returns emails.
 */
function doGet(e) {
  try {
    const rawDiff = String((e && e.parameter && e.parameter.difficulty) || 'easy')
      .trim()
      .toLowerCase();
    const diffCfg = ALLOWED_DIFFICULTIES[rawDiff] || ALLOWED_DIFFICULTIES.easy;
    const baseDiff = diffCfg.base;
    const board = String((e && e.parameter && e.parameter.board) || 'alltime')
      .trim()
      .toLowerCase();

    if (board === 'today' || board === 'week') {
      const roundsSheet = getOrInitRoundsSheet();
      const lastRow = roundsSheet.getLastRow();
      if (lastRow <= 1) {
        return jsonResponse({ status: 'ok', board, difficulty: baseDiff, entries: [] });
      }
      const rows = roundsSheet
        .getRange(2, 1, lastRow - 1, ROUNDS_HEADERS.length)
        .getValues();
      const todayLagos = getLagosDateString(new Date());
      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

      const bestByUser = {};
      for (let i = 0; i < rows.length; i++) {
        const tsIso = String(rows[i][0] || '');
        const dateLagos = String(rows[i][1] || '');
        const uname = String(rows[i][3] || '').trim();
        const rowDiff = String(rows[i][4] || '').trim().toLowerCase();
        const isDaily = String(rows[i][5]) === 'true' || rows[i][5] === true;
        const score = parseSafeInt(rows[i][6], 0);
        const timeMs = parseSafeInt(rows[i][7], 60000);

        if (!uname || score <= 0 || rowDiff !== baseDiff) continue;

        if (board === 'today') {
          if (!isDaily || dateLagos !== todayLagos) continue;
        } else if (board === 'week') {
          const tsMs = Date.parse(tsIso);
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

      return jsonResponse({ status: 'ok', board, difficulty: baseDiff, entries: top50 });
    }

    // Default board: 'alltime' (Best single round per user, tie-broken by faster timeMs)
    const sheet = getOrInitLeaderboardSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({ status: 'ok', board: 'alltime', difficulty: baseDiff, entries: [] });
    }

    const data = sheet
      .getRange(2, 1, lastRow - 1, LEADERBOARD_HEADERS.length)
      .getValues();
    const cumCol = baseDiff === 'medium' ? 3 : baseDiff === 'hard' ? 4 : 2;
    const bestCol = baseDiff === 'medium' ? 7 : baseDiff === 'hard' ? 9 : 5;
    const timeCol = baseDiff === 'medium' ? 8 : baseDiff === 'hard' ? 10 : 6;
    const maxTargets = diffCfg.maxTargets;

    const entries = [];
    for (let i = 0; i < data.length; i++) {
      const uname = String(data[i][0] || '').trim();
      if (!uname) continue;

      let bestScore = parseSafeInt(data[i][bestCol], 0);
      const cumScore = parseSafeInt(data[i][cumCol], 0);
      // Fallback migration for legacy rows before EasyBest column existed
      if (bestScore === 0 && cumScore > 0) {
        bestScore = Math.min(maxTargets, cumScore);
      }
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
      status: 'ok',
      board: 'alltime',
      difficulty: baseDiff,
      entries: top50,
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      code: 'SERVER_ERROR',
      message: String(err && err.message ? err.message : err),
    });
  }
}

/**
 * doPost(e)
 * Validates & records score submissions with rate limiting, duplicate roundId prevention,
 * plausible time checks, and marketing opt-in storage.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(rawBody);

    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const rawDiff = String(body.difficulty || 'easy').trim().toLowerCase();
    const action = String(body.action || 'submit').trim().toLowerCase();
    const roundId = String(body.roundId || '').trim();
    const marketingOptIn = Boolean(body.marketingOptIn);

    // 1. Validate Username (3-16 chars, alphanumeric/underscore, no profanity)
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      return jsonResponse({
        status: 'error',
        code: 'INVALID_USERNAME',
        message: 'Username must be 3–16 characters (letters, numbers, or underscore).',
      });
    }
    if (containsProfanity(username)) {
      return jsonResponse({
        status: 'error',
        code: 'PROFANITY_DETECTED',
        message: 'Please choose an appropriate username.',
      });
    }

    // 2. Validate Email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({
        status: 'error',
        code: 'INVALID_EMAIL',
        message: 'Please provide a valid email address.',
      });
    }

    // 3. Validate Difficulty
    if (!ALLOWED_DIFFICULTIES[rawDiff]) {
      return jsonResponse({
        status: 'error',
        code: 'INVALID_DIFFICULTY',
        message: 'Invalid difficulty mode.',
      });
    }
    const diffCfg = ALLOWED_DIFFICULTIES[rawDiff];
    const baseDiff = diffCfg.base;
    const isDaily = Boolean(body.isDaily) || diffCfg.isDaily;

    // 4. Validate Session Score (0..maxTargets)
    const rawScore =
      body.sessionScore !== undefined ? body.sessionScore : body.score;
    const sessionScore = Number(rawScore);
    if (
      !Number.isInteger(sessionScore) ||
      sessionScore < 0 ||
      sessionScore > diffCfg.maxTargets
    ) {
      return jsonResponse({
        status: 'error',
        code: 'INVALID_SCORE',
        message: `Score must be an integer between 0 and ${diffCfg.maxTargets}.`,
      });
    }

    // 5. Validate Plausible Completion Time (>= 300ms per extracted target when sessionScore > 0)
    const timeTakenMs = parseSafeInt(body.timeTakenMs, 60000);
    const minPlausibleMs = sessionScore > 0 ? Math.max(1200, sessionScore * 300) : 0;
    if (sessionScore > 0 && timeTakenMs < minPlausibleMs) {
      return jsonResponse({
        status: 'error',
        code: 'IMPLAUSIBLE_TIME',
        message: 'Round completion time is below the minimum plausible threshold.',
      });
    }

    const cache = CacheService.getScriptCache();
    const unameLower = username.toLowerCase();
    const todayLagos = getLagosDateString(new Date());

    // 6. Duplicate roundId check & 45-second rate limit (when submitting a round score > 0)
    if (sessionScore > 0) {
      if (roundId) {
        const roundCacheKey = `round_${roundId}`;
        if (cache.get(roundCacheKey)) {
          return jsonResponse({
            status: 'error',
            code: 'DUPLICATE_ROUND',
            message: 'This round has already been submitted.',
          });
        }
      }

      const rateCacheKey = `rate_${unameLower}`;
      if (action !== 'register' && cache.get(rateCacheKey)) {
        return jsonResponse({
          status: 'error',
          code: 'RATE_LIMITED',
          message: 'Please wait 45 seconds before submitting another score.',
        });
      }

      if (isDaily) {
        const dailyCacheKey = `daily_${todayLagos}_${baseDiff}_${unameLower}`;
        if (cache.get(dailyCacheKey)) {
          return jsonResponse({
            status: 'error',
            code: 'DAILY_ALREADY_SUBMITTED',
            message: 'You have already submitted your scored Daily Sweep for today.',
          });
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

    // Check username ownership by email
    if (foundRowNumber !== -1) {
      const existingEmail = String(rowValues[1] || '').trim().toLowerCase();
      if (existingEmail && existingEmail !== email) {
        return jsonResponse({
          status: 'error',
          code: 'USERNAME_TAKEN',
          message: 'Username already taken. Please choose another.',
        });
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
          const rDate = String(rData[i][1] || '');
          const rId = String(rData[i][2] || '');
          const rUser = String(rData[i][3] || '').trim().toLowerCase();
          const rDiff = String(rData[i][4] || '').trim().toLowerCase();
          const rDaily = String(rData[i][5]) === 'true' || rData[i][5] === true;

          if (roundId && rId === roundId) {
            return jsonResponse({
              status: 'error',
              code: 'DUPLICATE_ROUND',
              message: 'This round has already been recorded.',
            });
          }
          if (isDaily && rDaily && rDate === todayLagos && rUser === unameLower && rDiff === baseDiff) {
            return jsonResponse({
              status: 'error',
              code: 'DAILY_ALREADY_SUBMITTED',
              message: 'Daily Sweep score already recorded for today.',
            });
          }
        }
      }
    }

    const nowIso = new Date().toISOString();
    let newTotal = sessionScore;
    let bestScore = sessionScore;
    let bestTimeMs = timeTakenMs;

    if (foundRowNumber !== -1) {
      const existingCum = parseSafeInt(rowValues[cumCol], 0);
      newTotal = existingCum + sessionScore;

      const prevBest = parseSafeInt(rowValues[bestCol], 0);
      const prevTime = parseSafeInt(rowValues[timeCol], 60000) || 60000;
      if (
        sessionScore > prevBest ||
        (sessionScore === prevBest && sessionScore > 0 && timeTakenMs < prevTime)
      ) {
        bestScore = sessionScore;
        bestTimeMs = timeTakenMs;
      } else {
        bestScore = prevBest;
        bestTimeMs = prevTime;
      }

      sheet.getRange(foundRowNumber, cumCol + 1).setValue(newTotal);
      sheet.getRange(foundRowNumber, bestCol + 1).setValue(bestScore);
      sheet.getRange(foundRowNumber, timeCol + 1).setValue(bestTimeMs);
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
        baseDiff === 'easy' ? sessionScore : 0,
        baseDiff === 'easy' ? timeTakenMs : 60000,
        baseDiff === 'medium' ? sessionScore : 0,
        baseDiff === 'medium' ? timeTakenMs : 60000,
        baseDiff === 'hard' ? sessionScore : 0,
        baseDiff === 'hard' ? timeTakenMs : 60000,
        marketingOptIn,
        marketingOptIn ? nowIso : '',
        nowIso,
      ];
      sheet.appendRow(newRow);
    }

    if (sessionScore > 0) {
      roundsSheet.appendRow([
        nowIso,
        todayLagos,
        roundId || Utilities.getUuid(),
        username,
        baseDiff,
        isDaily,
        sessionScore,
        timeTakenMs,
      ]);

      if (roundId) {
        cache.put(`round_${roundId}`, '1', 21600);
      }
      cache.put(`rate_${unameLower}`, '1', 45);
      if (isDaily) {
        cache.put(`daily_${todayLagos}_${baseDiff}_${unameLower}`, '1', 21600);
      }
    }

    return jsonResponse({
      status: 'ok',
      username,
      difficulty: baseDiff,
      isDaily,
      sessionScore,
      newTotal,
      bestScore,
      bestTimeMs,
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      code: 'SERVER_ERROR',
      message: String(err && err.message ? err.message : err),
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}
