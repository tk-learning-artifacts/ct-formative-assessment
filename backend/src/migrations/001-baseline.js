// Version 1: the schema exactly as the original CT Quest shipped it.
// Databases created before migrations existed already have these tables and
// report user_version 0, so every statement is IF NOT EXISTS and this step is
// a no-op for them. A fresh database gets the tables here and then continues
// through the later migrations like any upgraded one.

module.exports = {
  version: 1,
  name: "baseline",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'teacher',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        join_code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        selection_mode TEXT NOT NULL DEFAULT 'ALL',
        duration_minutes INTEGER,
        start_at TEXT,
        end_at TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS event_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        question_order INTEGER NOT NULL,
        question_json TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        student_name TEXT NOT NULL,
        student_group TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started',
        started_at TEXT NOT NULL,
        submitted_at TEXT,
        score INTEGER,
        max_score INTEGER,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        chosen_index INTEGER,
        correct_index INTEGER NOT NULL,
        earned_points INTEGER NOT NULL,
        max_points INTEGER NOT NULL,
        FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
      );
    `);
  }
};
