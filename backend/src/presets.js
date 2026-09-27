// Quick setup presets (backend/content/presets.json): a named question filter
// plus up to three coarse knobs a teacher may turn on it.
//
//   who       one audience, and optionally one of its levels. Written
//             "core" (every level) or "core:S1". Offered from the preset's
//             own audiences (and levels, if the preset fixes some).
//   emphasis  which Brennan & Resnick dimension to test: "all", "concepts",
//             "practices" or "perspectives". Becomes filter.nodes, so a
//             preset that already fixes nodes cannot offer it.
//   length    "full", or "short": filter.limit = shortLength, a pick
//             balanced across learning outcomes (selection.js).
//
// A choice compiles to an ordinary event filter, which then goes through
// selection.resolveSelection like any other. Preview and event creation
// share that path, so a card's count is the event's question count. The
// compiled filter always has one audience, so it fits the advanced picker.
//
// AI-scored types stay opt-in: a preset includes them only when it names
// them in filter.types and says "aiScored": true. content.js checks both.

const KNOBS = ["who", "emphasis", "length"];
const EMPHASIS = { all: null, concepts: "concept", practices: "practice", perspectives: "perspective" };
const EMPHASIS_LABELS = { all: "All three", concepts: "Concepts", practices: "Practices", perspectives: "Perspectives" };
const LENGTHS = ["full", "short"];
const PRESET_KEYS = ["id", "label", "description", "filter", "knobs", "aiScored", "levelRequired"];

function audienceById(content, id) {
  return content.audiences.find(audience => audience.id === id) || null;
}

function levelLabel(content, id) {
  const level = content.levels.find(item => item.id === id);
  return level ? level.label : id;
}

// The "who" values a preset offers, in order. The first is the default.
function whoOptions(preset, content) {
  const audiences = preset.filter.audiences && preset.filter.audiences.length ? preset.filter.audiences : ["core"];
  const options = [];

  audiences.forEach(audienceId => {
    const audience = audienceById(content, audienceId);

    if (!audience) {
      return;
    }

    const levels = audience.levels.filter(level => !preset.filter.levels || preset.filter.levels.includes(level));
    const shortName = audience.id === "core" ? "Core" : audience.label.split(" (")[0];

    if (!preset.levelRequired) {
      options.push({ value: audience.id, audience: audience.id, level: null, label: `${shortName}, all levels`, group: audience.label });
    }

    levels.forEach(level => {
      options.push({ value: `${audience.id}:${level}`, audience: audience.id, level, label: `${shortName} ${levelLabel(content, level)}`, group: audience.label });
    });
  });

  return options;
}

function defaultChoice(preset, content) {
  const choice = { id: preset.id };

  if (preset.knobs.includes("who")) {
    const first = whoOptions(preset, content)[0];
    choice.who = first ? first.value : null;
  }

  if (preset.knobs.includes("emphasis")) {
    choice.emphasis = "all";
  }

  if (preset.knobs.includes("length")) {
    choice.length = "full";
  }

  return choice;
}

function findPreset(content, id) {
  return (content.presets || []).find(preset => preset.id === id) || null;
}

// Turns { id, who?, emphasis?, length? } into { filter, errors }. The filter
// is not yet normalised; resolveSelection does that. Knobs the preset does
// not offer are refused rather than ignored.
function compilePreset(choice, content) {
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    return { filter: null, errors: ["preset must be an object like { \"id\": \"core-ct-check\" }"] };
  }

  const preset = findPreset(content, String(choice.id || ""));

  if (!preset) {
    return { filter: null, errors: [`unknown preset "${choice.id}"`] };
  }

  const errors = [];
  const filter = JSON.parse(JSON.stringify(preset.filter));

  Object.keys(choice).forEach(key => {
    if (key !== "id" && !KNOBS.includes(key)) {
      errors.push(`unknown preset key "${key}"`);
    } else if (key !== "id" && !preset.knobs.includes(key) && choice[key] !== undefined && choice[key] !== null) {
      errors.push(`preset "${preset.id}" has no ${key} setting`);
    }
  });

  if (preset.knobs.includes("who")) {
    const value = choice.who === undefined || choice.who === null ? defaultChoice(preset, content).who : String(choice.who);
    const option = whoOptions(preset, content).find(item => item.value === value);

    if (!option) {
      errors.push(`preset "${preset.id}" cannot be set to "${value}"`);
    } else {
      filter.audiences = [option.audience];

      if (option.level) {
        filter.levels = [option.level];
      }
    }
  }

  if (preset.knobs.includes("emphasis")) {
    const emphasis = choice.emphasis === undefined || choice.emphasis === null ? "all" : String(choice.emphasis);

    if (!Object.prototype.hasOwnProperty.call(EMPHASIS, emphasis)) {
      errors.push(`emphasis must be one of: ${Object.keys(EMPHASIS).join(", ")}`);
    } else if (EMPHASIS[emphasis]) {
      filter.nodes = [EMPHASIS[emphasis]];
    }
  }

  if (preset.knobs.includes("length")) {
    const length = choice.length === undefined || choice.length === null ? "full" : String(choice.length);

    if (!LENGTHS.includes(length)) {
      errors.push(`length must be one of: ${LENGTHS.join(", ")}`);
    } else if (length === "short") {
      filter.limit = content.presetShortLength;
    }
  }

  return { filter: errors.length ? null : filter, errors };
}

// Structural checks, run by content.js at boot. normalizeFilter is passed in
// (from selection.js) to check each preset's filter like an event filter.
// isAiType tells whether a question type is AI-scored.
function validatePresets(file, content, { normalizeFilter, isAiType }, errors) {
  const where = "presets.json";

  if (!Number.isInteger(file.shortLength) || file.shortLength < 1) {
    errors.push(`${where}: shortLength must be a positive integer`);
  }

  if (!Array.isArray(file.presets) || !file.presets.length) {
    errors.push(`${where}: presets must be a non-empty list`);
    return;
  }

  const ids = new Set();

  file.presets.forEach(preset => {
    const label = `${where}: preset "${preset && preset.id}"`;

    if (!preset || typeof preset !== "object") {
      errors.push(`${where}: every preset must be an object`);
      return;
    }

    Object.keys(preset).forEach(key => {
      if (!PRESET_KEYS.includes(key)) {
        errors.push(`${label} has unknown key "${key}"`);
      }
    });

    if (typeof preset.id !== "string" || !/^[a-z0-9-]+$/.test(preset.id) || ids.has(preset.id)) {
      errors.push(`${label} id must be unique and kebab-case`);
    }
    ids.add(preset.id);

    ["label", "description"].forEach(field => {
      if (typeof preset[field] !== "string" || !preset[field].trim()) {
        errors.push(`${label} needs a ${field}`);
      }
    });

    if (!Array.isArray(preset.knobs) || preset.knobs.some(knob => !KNOBS.includes(knob)) || new Set(preset.knobs).size !== preset.knobs.length) {
      errors.push(`${label} knobs must be a list drawn from: ${KNOBS.join(", ")}`);
      return;
    }

    const { filter, errors: filterErrors } = normalizeFilter(preset.filter, content);
    filterErrors.forEach(message => errors.push(`${label} filter: ${message}`));

    if (!filter) {
      return;
    }

    if (filter.questionIds) {
      errors.push(`${label} must choose questions by tags, not by questionIds`);
    }

    if (filter.audiences.length > 1 && !preset.knobs.includes("who")) {
      errors.push(`${label} spans several audiences, so it needs the "who" knob`);
    }

    if (filter.nodes && preset.knobs.includes("emphasis")) {
      errors.push(`${label} fixes nodes, so it cannot offer the "emphasis" knob`);
    }

    if (filter.limit && preset.knobs.includes("length")) {
      errors.push(`${label} fixes a limit, so it cannot offer the "length" knob`);
    }

    if (preset.levelRequired !== undefined && (typeof preset.levelRequired !== "boolean" || !preset.knobs.includes("who"))) {
      errors.push(`${label} levelRequired must be true or false, and needs the "who" knob`);
    }

    if (preset.aiScored !== undefined && typeof preset.aiScored !== "boolean") {
      errors.push(`${label} aiScored must be true or false`);
    }

    const namesAi = (filter.types || []).some(isAiType);

    if (namesAi && preset.aiScored !== true) {
      errors.push(`${label} includes AI-scored types, so it must say "aiScored": true`);
    }

    if (preset.aiScored === true && !namesAi) {
      errors.push(`${label} says "aiScored": true but names no AI-scored type in filter.types`);
    }

    // Stored normalised, so compiled choices start from canonical filters.
    preset.filter = filter;
  });
}

// What GET /api/presets sends: everything the quick setup cards need.
function describePresets(content) {
  return (content.presets || []).map(preset => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    aiScored: Boolean(preset.aiScored),
    knobs: preset.knobs.slice(),
    whoOptions: preset.knobs.includes("who") ? whoOptions(preset, content) : [],
    defaults: defaultChoice(preset, content)
  }));
}

module.exports = {
  KNOBS,
  EMPHASIS,
  EMPHASIS_LABELS,
  LENGTHS,
  whoOptions,
  defaultChoice,
  compilePreset,
  validatePresets,
  describePresets
};
