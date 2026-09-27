// Which quick setup preset an event came from (ADR 0003 §11).
//
// preset_id            the preset's id from backend/content/presets.json, or
//                      null for an event made from the advanced picker alone,
//                      the legacy question set, or before this migration.
// preset_options_json  the knob values chosen on the card, as
//                      { who?, emphasis?, length? }, or null.
// preset_customised    1 when the teacher then changed the questions in
//                      Customise, so the event's filter is no longer exactly
//                      what the preset gives.
//
// The event's filter_json stays the record of which questions it has; these
// columns only say where that filter came from.

module.exports = {
  up(db) {
    db.exec(`
      ALTER TABLE events ADD COLUMN preset_id TEXT;
      ALTER TABLE events ADD COLUMN preset_options_json TEXT;
      ALTER TABLE events ADD COLUMN preset_customised INTEGER NOT NULL DEFAULT 0
        CHECK (preset_customised IN (0, 1));
    `);
  }
};
