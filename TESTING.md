# BrainSweep Leaderboard Backend — Verification & Security Testing Guide

**Endpoint URL** (`config.js -> leaderboardApiUrl`):
```
https://script.google.com/macros/s/AKfycbziXn-4cNUEga8XpnoPAF22gOtCH9cIFaj2HojI1A4Aap_yNzCWkss37ne3U3kEic-A/exec
```

> **Before deploying a new Apps Script version:**
> 1. In Google Sheets, click **File → Download → Microsoft Excel (.xlsx)** (or **Make a copy**) to back up your Sheet.
> 2. Copy your current Apps Script `Code.gs` into a local backup file before pasting the new [apps-script/Code.gs](apps-script/Code.gs).
> 3. Deploy via **Deploy → Manage deployments → Edit (pencil icon) → Version: New version → Deploy** so the Web App URL does **not** change.
> 4. In the Apps Script editor, select **`cleanLegacyRows`** from the function dropdown and click **Run** once to flag pre-migration rows (`legacy = TRUE`) without deleting them.

---

## Copy-Paste `curl` Validation Tests

Set your endpoint variable once (PowerShell or Bash):

**Bash / macOS / Linux / Git Bash:**
```bash
API="https://script.google.com/macros/s/AKfycbziXn-4cNUEga8XpnoPAF22gOtCH9cIFaj2HojI1A4Aap_yNzCWkss37ne3U3kEic-A/exec"
```

### 1. Score too high (`score_out_of_range`)
Easy mode max targets = `12`. Submitting `13` must fail:
```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"QA_Tester1","difficulty":"easy","score":13,"timeMs":25000,"roundId":"qa-over-1"}'
```
Expected: `{"ok":false,"status":"error","error":"score_out_of_range",...}`

### 2. Completion time too fast (`implausible_time`)
Minimum plausible time = `score * 350ms` (for 10 targets = `3500ms`). Submitting `1000ms` must fail:
```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"QA_Tester1","difficulty":"easy","score":10,"timeMs":1000,"roundId":"qa-fast-1"}'
```
Expected: `{"ok":false,"status":"error","error":"implausible_time",...}`

### 3. Bad nickname — too short, HTML tag, or profanity (`invalid_nickname` / `profanity_blocked`)
```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"<b>X</b>","difficulty":"easy","score":5,"timeMs":15000,"roundId":"qa-badname-1"}'
```
Expected: `{"ok":false,"status":"error","error":"invalid_nickname",...}`

```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"shithead99","difficulty":"easy","score":5,"timeMs":15000,"roundId":"qa-prof-1"}'
```
Expected: `{"ok":false,"status":"error","error":"profanity_blocked",...}`

### 4. Valid submission (email optional) + Duplicate `roundId` (`duplicate_round_id`)
First call succeeds:
```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"QA_Tester1","playerId":"qa-fp-1","difficulty":"easy","score":8,"timeMs":28000,"roundId":"qa-dup-test-001"}'
```
Expected: `{"ok":true,"status":"ok","username":"QA_Tester1","difficulty":"easy",...}`

Re-sending the exact same `roundId` must be rejected:
```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"QA_Tester1","playerId":"qa-fp-1","difficulty":"easy","score":8,"timeMs":28000,"roundId":"qa-dup-test-001"}'
```
Expected: `{"ok":false,"status":"error","error":"duplicate_round_id",...}`

### 5. Rapid repeat rate limit (`rate_limited_20s`)
Immediately send a *different* `roundId` for the same `playerId` within 20 seconds:
```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"QA_Tester1","playerId":"qa-fp-1","difficulty":"easy","score":9,"timeMs":29000,"roundId":"qa-rapid-test-002"}'
```
Expected: `{"ok":false,"status":"error","error":"rate_limited_20s",...}`

### 6. Daily vs. Normal board separation & no emails leaked
Submit a Daily Sweep run (use a fresh `playerId` so the 20s cooldown doesn't trigger):
```bash
curl -sL -X POST "$API" -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"nickname":"QA_Daily1","playerId":"qa-daily-fp-1","difficulty":"daily_easy","isDaily":true,"score":11,"timeMs":31000,"roundId":"qa-daily-test-001"}'
```
Verify GET endpoints:
```bash
# Must echo difficulty: "daily_easy" and contain QA_Daily1 (NOT QA_Tester1)
curl -sL "$API?board=today&difficulty=daily_easy"

# Must echo difficulty: "easy", exclude legacy rows (Comet/Zeezatou/zaki), contain QA_Tester1 (NOT QA_Daily1), and NEVER contain any email field
curl -sL "$API?board=alltime&difficulty=easy"
```

---

## Cleaning Up Test Rows Afterwards
1. Open your BrainSweep Google Sheet.
2. In the **`Leaderboard`** tab, delete the rows for **`QA_Tester1`** and **`QA_Daily1`** (right-click row numbers → **Delete row**).
3. In the **`RoundsLog`** tab, delete any rows whose `RoundId` starts with `qa-` (`qa-dup-test-001`, `qa-daily-test-001`).
4. Do **not** delete flagged `legacy = TRUE` rows (`Comet`, `Zeezatou`, `zaki`) — they stay archived in the sheet and are automatically excluded from all GET boards.
