// Account roles (ADR 0004, decided by Akmal on 2026-09-27). users.role has
// existed since the original app and always held "teacher"; an admin (head of
// department) can now read every teacher's events, so the column decides what
// an account may see and must only ever hold a known role.
//
// SQLite cannot add a CHECK constraint to an existing table without
// rebuilding it, so two triggers refuse any other value on insert and update.
// Any role other than "admin" already stored (none is expected: the original
// code only wrote "teacher") becomes "teacher", the narrower of the two.

module.exports = {
  up(db) {
    db.exec(`
      UPDATE users SET role = 'teacher' WHERE role IS NULL OR role NOT IN ('teacher', 'admin');

      CREATE TRIGGER users_role_check_insert
      BEFORE INSERT ON users
      WHEN NEW.role NOT IN ('teacher', 'admin')
      BEGIN
        SELECT RAISE(ABORT, 'users.role must be teacher or admin');
      END;

      CREATE TRIGGER users_role_check_update
      BEFORE UPDATE OF role ON users
      WHEN NEW.role NOT IN ('teacher', 'admin')
      BEGIN
        SELECT RAISE(ABORT, 'users.role must be teacher or admin');
      END;
    `);
  }
};
