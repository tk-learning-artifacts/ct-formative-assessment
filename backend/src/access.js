// Who may do what to an event (ADR 0004). Every teacher route that takes an
// event id asks eventAccess, through eventForRequest in app.js, so the rule
// lives here and nowhere else.
//
// teacher  their own events only; another teacher's event does not exist
//          as far as they can tell (404).
// admin    a head of department: everything a teacher can do with their own
//          events, plus reading every other teacher's events (results, the
//          outcomes summary, the settings history, attempt details).
//          Changing another teacher's event is refused (403): reset,
//          release, Edit settings and marking stay with the owner.
//
// To give admins full control of every event instead (the alternative in
// ADR 0004), make canManage return true for an admin. The teacher page
// reads can_manage from each event, so it needs no change.

const ROLES = ["teacher", "admin"];

function isAdmin(user) {
  return Boolean(user) && user.role === "admin";
}

function owns(user, event) {
  return Boolean(user) && Boolean(event) && event.created_by === user.sub;
}

function canRead(user, event) {
  return owns(user, event) || (Boolean(event) && isAdmin(user));
}

function canManage(user, event) {
  return owns(user, event);
}

// "manage", "read" or null (the caller must not learn the event exists).
function eventAccess(user, event) {
  if (canManage(user, event)) {
    return "manage";
  }

  return canRead(user, event) ? "read" : null;
}

module.exports = {
  ROLES,
  isAdmin,
  owns,
  canRead,
  canManage,
  eventAccess
};
