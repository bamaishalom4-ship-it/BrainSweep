/**
 * BrainSweep Global Leaderboard — Google Apps Script Backend
 *
 * Target Google Sheet:
 * https://docs.google.com/spreadsheets/d/1r7rsCfeqHpvz9-Sv6PtTGDNBiTHy0evbkU3HeimjBCA/edit
 *
 * Sheet Columns (Row 1 Headers):
 * A: Username | B: Email | C: EasyScore | D: MediumScore | E: HardScore
 *
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Open your Google Sheet:
 *    https://docs.google.com/spreadsheets/d/1r7rsCfeqHpvz9-Sv6PtTGDNBiTHy0evbkU3HeimjBCA/edit
 * 2. In the top menu, click Extensions -> Apps Script.
 * 3. Delete any code in Code.gs and paste this entire file.
 * 4. Click Save (disk icon).
 * 5. Click "Deploy" (top right) -> "New deployment".
 * 6. Click the gear icon next to "Select type" -> choose "Web app".
 * 7. Set:
 *    - Description: BrainSweep Leaderboard API
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 * 8. Click "Deploy", authorize access when prompted, and copy the resulting
 *    "Web app URL" (ends with /exec).
 * 9. Paste that Web app URL into LEADERBOARD_API_URL at the top of game.js.
 */

const SPREADSHEET_ID = '1r7rsCfeqHpvz9-Sv6PtTGDNBiTHy0evbkU3HeimjBCA';
const SHEET_NAME = 'Leaderboard';
const HEADERS = ['Username', 'Email', 'EasyScore', 'MediumScore', 'HardScore'];

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
 * Returns the top 50 scores for a specific difficulty ('easy', 'medium', or 'hard'),
 * sorted descending by highest score for that difficulty.
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
      const rawScore = Number(row[colIdx]);
      const score = Number.isFinite(rawScore) ? rawScore : 0;

      if (username && score > 0) {
        entries.push({
          username: username,
          score: score,
        });
      }
    }

    // Sort descending by score
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
 * Receives JSON payload: { username, email, difficulty, score, action }
 * - Enforces case-insensitive unique usernames.
 * - If username exists with a DIFFERENT email, returns USERNAME_TAKEN error.
 * - If username exists with the SAME email, updates score ONLY IF the new score
 *   is higher than the existing score for that difficulty.
 * - If username does not exist, appends a new row and saves the initial score.
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
    const newScore = Math.max(0, Number(body.score) || 0);

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

      // Same user: update score ONLY IF newScore > existingScore for that difficulty
      const existingScore = Number(existingRowData[colIdx]) || 0;
      let updated = false;
      if (newScore > existingScore) {
        sheet.getRange(foundRowIndex, colIdx + 1).setValue(newScore);
        updated = true;
      }

      return jsonResponse({
        status: 'ok',
        updated: updated,
        username: String(existingRowData[0]).trim(),
        difficulty: difficulty,
        bestScore: Math.max(existingScore, newScore),
      });
    }

    // Username does not exist: create a new row
    const newRow = [username, email, 0, 0, 0];
    if (newScore > 0) {
      newRow[colIdx] = newScore;
    }
    sheet.appendRow(newRow);

    return jsonResponse({
      status: 'ok',
      created: true,
      username: username,
      difficulty: difficulty,
      bestScore: newScore,
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: err && err.message ? err.message : 'Failed to save score.',
    });
  } finally {
    lock.releaseLock();
  }
}
