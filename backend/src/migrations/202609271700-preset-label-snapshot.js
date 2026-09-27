// Freezes a preset's display label and knob wording at the moment an event
// is created (ADR 0003 §11, decided by Akmal on 2026-09-27). Before this,
// the "From preset: …" line was rebuilt from the current
// backend/content/presets.json on every read, so renaming or removing a
// preset changed what an older event's card said.
//
// preset_label  the summary presets.describeChoice gave at creation time
//               (for example "Loops and conditionals (RGSynapse Secondary 1,
//               short)"), or null for an event with no preset.
//
// Backfilled here from the current presets.json for every event that already
// has a preset_id, since that file is the closest available record of what
// the teacher saw when they created it.

const presets = require("../presets");

module.exports = {
  up(db, ctx = {}) {
    db.exec("ALTER TABLE events ADD COLUMN preset_label TEXT");

    const rows = db.prepare("SELECT id, preset_id, preset_options_json FROM events WHERE preset_id IS NOT NULL").all();
    const update = db.prepare("UPDATE events SET preset_label = ? WHERE id = ?");

    rows.forEach(row => {
      const options = row.preset_options_json ? JSON.parse(row.preset_options_json) : {};
      update.run(presets.describeChoice(ctx.content, row.preset_id, options), row.id);
    });
  }
};
