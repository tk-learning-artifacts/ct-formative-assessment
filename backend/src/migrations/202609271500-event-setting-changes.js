// Teachers may change an event's settings after creating it, even once
// students have started (ADR 0003 §10). Each change is recorded here, one
// row per field: who changed it, when, and the old and new values as text
// (null for a value that was not set, such as no time limit). The teacher's
// results view shows this history.
//
// Fields: title, feedback_mode, navigation_mode, duration_minutes, start_at,
// end_at. The question set is never edited, so it never appears here.

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_setting_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id),
        changed_by INTEGER NOT NULL REFERENCES users(id),
        field TEXT NOT NULL
          CHECK (field IN ('title', 'feedback_mode', 'navigation_mode', 'duration_minutes', 'start_at', 'end_at')),
        old_value TEXT,
        new_value TEXT,
        changed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_event_setting_changes_event ON event_setting_changes (event_id, id);
    `);
  }
};
