// A teacher may change an event's questions while it has no live attempt: none
// at all, or every attempt reset (ADR 0003 §10, amended 2026-09-29). The change
// goes in the same history as the settings, as the field 'questions', with the
// old and new selection as text. SQLite cannot alter a CHECK constraint, so the
// table is rebuilt with the wider list of fields and its rows copied across.

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE event_setting_changes_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id),
        changed_by INTEGER NOT NULL REFERENCES users(id),
        field TEXT NOT NULL
          CHECK (field IN ('title', 'feedback_mode', 'navigation_mode', 'duration_minutes', 'start_at', 'end_at', 'questions')),
        old_value TEXT,
        new_value TEXT,
        changed_at TEXT NOT NULL
      );
      INSERT INTO event_setting_changes_v2 (id, event_id, changed_by, field, old_value, new_value, changed_at)
        SELECT id, event_id, changed_by, field, old_value, new_value, changed_at FROM event_setting_changes;
      DROP TABLE event_setting_changes;
      ALTER TABLE event_setting_changes_v2 RENAME TO event_setting_changes;
      CREATE INDEX IF NOT EXISTS idx_event_setting_changes_event ON event_setting_changes (event_id, id);
    `);
  }
};
