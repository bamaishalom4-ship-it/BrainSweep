/**
 * BrainSweep Cumulative Score Leaderboard — Google Apps Script Backend
 *
 * Target Google Sheet:
 * https://docs.google.com/spreadsheets/d/1r7rsCfeqHpvz9-Sv6PtTGDNBiTHy0evbkU3HeimjBCA/edit
 *
 * Sheet Columns (Row 1 Headers):
 * A: Username | B: Email | C: EasyScore | D: MediumScore | E: HardScore
 *
 * HOW TO UPDATE YOUR DEPLOYED SCRIPT:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Replace the code in Code.gs with this updated script and click Save (disk icon).
 * 3. Click "Deploy" -> "Manage deployments".
 * 4. Click the pencil (Edit) icon on your active Web App deployment.
 * 5. Under "Version", select "New version", then click "Deploy".
 *    (This updates your existing Web App URL in-place!).
 */

const SPREADSHEET_ID = '1r7rsCfeqHpvz9-Sv6PtTGDNBiTHy0evbkU3HeimjBCA';
const SHEET_NAME = 'Leaderboard';
const HEADERS = ['Username', 'Email', 'EasyScore', 'MediumScore', 'HardScore'];

/**
 * Helper: Safely parse any cell value (blank, string, number) as a non-negative integer.
 */
function parseSafeInt(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Helper: Get or initialize the leaderboard sheet with required headers.
 */
function getOrInitSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(HEADERS);
  } else {
    const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (String(firstRow[0]).trim() !== 'Username') {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }
  }

  return sheet;
}

/**
 * Helper: Map difficulty parameter ('easy' | 'medium' | 'hard') to 0-based column index.
 * Columns: 0=Username, 1=Email, 2=EasyScore, 3=MediumScore, 4=HardScore
 */
function getDifficultyColumnIndex(difficulty) {
  const norm = String(difficulty || 'easy').trim().toLowerCase();
  if (norm === 'medium') return 3;
  if (norm === 'hard') return 4;
  return 2; // default 'easy'
}

/**
 * Helper: Build a JSON ContentService response.
 */
function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Function 1: doGet(e)
 * Returns the top 50 players for a specific difficulty ('easy', 'medium', or 'hard'),
 * sorted descending by highest cumulative score.
 *
 * Query params:
 *   ?difficulty=easy | medium | hard
 */
function doGet(e) {
  try {
    const sheet = getOrInitSheet();
    const difficulty = (e && e.parameter && e.parameter.difficulty) || 'easy';
    const colIdx = getDifficultyColumnIndex(difficulty);

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({
        status: 'ok',
        difficulty: String(difficulty).toLowerCase(),
        entries: [],
      });
    }

    const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    const entries = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const username = String(row[0] || '').trim();
      const totalScore = parseSafeInt(row[colIdx]);

      if (username && totalScore > 0) {
        entries.push({
          username: username,
          score: totalScore,
        });
      }
    }

    // Sort descending by highest cumulative score
    entries.sort(function (a, b) {
      return b.score - a.score;
    });

    // Return top 50
    const top50 = entries.slice(0, 50).map(function (item, idx) {
      return {
        position: idx + 1,
        username: item.username,
        score: item.score,
      };
    });

    return jsonResponse({
      status: 'ok',
      difficulty: String(difficulty).toLowerCase(),
      entries: top50,
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: err && err.message ? err.message : 'Failed to fetch leaderboard.',
    });
  }
}

/**
 * Function 2: doPost(e)
 * Receives JSON payload: { username, email, difficulty, sessionScore }
 * - Finds the user's row by Username (case-insensitive check).
 * - If username exists with a DIFFERENT email, returns USERNAME_TAKEN error.
 * - If username exists with the SAME email:
 *     NewTotal = ExistingScore + sessionScore
 *   Updates the user's specific difficulty column with NewTotal.
 * - If username does not exist:
 *   Creates a new row and saves sessionScore as the initial total.
 * - Returns JSON containing { status: 'ok', sessionScore, newTotal }.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(rawBody);

    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const difficulty = String(body.difficulty || 'easy').trim().toLowerCase();

    // Support both sessionScore and score keys safely as integers
    const rawSession =
      body.sessionScore !== undefined ? body.sessionScore : body.score;
    const sessionScore = parseSafeInt(rawSession);

    if (!username || !email) {
      return jsonResponse({
        status: 'error',
        code: 'INVALID_INPUT',
        message: 'Username and email are required.',
      });
    }

    const sheet = getOrInitSheet();
    const colIdx = getDifficultyColumnIndex(difficulty); // 2, 3, or 4 (0-based)
    const lastRow = sheet.getLastRow();

    let foundRowIndex = -1; // 1-based sheet row index
    let existingRowData = null;

    if (lastRow > 1) {
      const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
      const targetUserLower = username.toLowerCase();

      for (let i = 0; i < data.length; i++) {
        const rowUser = String(data[i][0] || '').trim().toLowerCase();
        if (rowUser === targetUserLower) {
          foundRowIndex = i + 2; // +2 because data starts at row 2
          existingRowData = data[i];
          break;
        }
      }
    }

    if (foundRowIndex !== -1 && existingRowData) {
      const existingEmail = String(existingRowData[1] || '').trim().toLowerCase();

      // Case-insensitive username collision with a different email address
      if (existingEmail && existingEmail !== email) {
        return jsonResponse({
          status: 'error',
          code: 'USERNAME_TAKEN',
          message: 'Username already taken. Please choose another.',
        });
      }

      // Cumulative Math: NewTotal = ExistingScore + sessionScore
      const existingScore = parseSafeInt(existingRowData[colIdx]);
      const newTotal = existingScore + sessionScore;

      sheet.getRange(foundRowIndex, colIdx + 1).setValue(newTotal);

      return jsonResponse({
        status: 'ok',
        updated: true,
        username: String(existingRowData[0]).trim(),
        difficulty: difficulty,
        sessionScore: sessionScore,
        previousTotal: existingScore,
        newTotal: newTotal,
      });
    }

    // Username does not exist: create a new row and save sessionScore as initial total
    const newRow = [username, email, 0, 0, 0];
    newRow[colIdx] = sessionScore;
    sheet.appendRow(newRow);

    return jsonResponse({
      status: 'ok',
      created: true,
      username: username,
      difficulty: difficulty,
      sessionScore: sessionScore,
      previousTotal: 0,
      newTotal: sessionScore,
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: err && err.message ? err.message : 'Failed to save cumulative score.',
    });
  } finally {
    lock.releaseLock();
  }
}
