#!/usr/bin/env bash
# Backfill Azure Batch TTS for all provider databases sequentially.
# Run via: bash scripts/backfill-tts-all.sh >> backfill-tts.log 2>&1 &
# Progress: tail -f backfill-tts.log  |  check SQLite counts directly.
set -euo pipefail

DB_DIR="/home/azadmin/ReadWise/prisma/provider-dbs"
APP_DIR="/home/azadmin/ReadWise"
BATCH_LIMIT=200
SLEEP_BETWEEN_PASSES=5  # seconds between passes within a DB
SLEEP_BETWEEN_DBS=10    # seconds between databases

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Databases in ascending article count order with their article status
# Format: "db-basename|status"
DATABASES=(
  "scientific-american|DRAFT"
  "smithsonian-magazine|PUBLISHED"
  "mit-technology-review|DRAFT"
  "wired|DRAFT"
  "bbc-features|DRAFT"
  "national-geographic|DRAFT"
  "time|DRAFT"
  "new-yorker|DRAFT"
  "the-conversation|DRAFT"
)

for entry in "${DATABASES[@]}"; do
  DB_NAME="${entry%%|*}"
  STATUS="${entry##*|}"
  DB_FILE="${DB_DIR}/${DB_NAME}.db"

  if [ ! -f "$DB_FILE" ]; then
    log "SKIP $DB_NAME — file not found"
    continue
  fi

  TOTAL=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM Article WHERE status='${STATUS,,}' OR status='${STATUS}';" 2>/dev/null || echo 0)
  log "START $DB_NAME | total=$TOTAL | status=$STATUS"

  pass=0
  while true; do
    DONE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM ArticleSpeech;" 2>/dev/null || echo 0)
    REMAINING=$((TOTAL - DONE))
    if [ "$REMAINING" -le 0 ]; then
      log "COMPLETE $DB_NAME | done=$DONE/$TOTAL"
      break
    fi

    pass=$((pass + 1))
    log "PASS $pass | $DB_NAME | done=$DONE/$TOTAL remaining=$REMAINING"

    cd "$APP_DIR"
    DATABASE_URL="file:${DB_FILE}" \
      npm run speech:batch -- \
        --all \
        --status "$STATUS" \
        --limit "$BATCH_LIMIT" \
        --lowest-storage \
      2>&1 | grep -E "Selected|submitted|Succeeded|Failed|Done\.|saved|Error|Warning" || true

    sleep "$SLEEP_BETWEEN_PASSES"
  done

  log "VERIFY $DB_NAME"
  FINAL=$(sqlite3 "$DB_FILE" \
    "SELECT COUNT(*) FROM ArticleSpeech WHERE words IS NOT NULL AND words != '[]' AND words != '' AND mediaAssetId IS NOT NULL;" \
    2>/dev/null || echo 0)
  log "VERIFIED $DB_NAME | with_words_and_media=$FINAL/$TOTAL"

  sleep "$SLEEP_BETWEEN_DBS"
done

log "ALL DATABASES COMPLETE"
