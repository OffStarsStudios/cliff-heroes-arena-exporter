/**
 * Scheduled publishing.
 *
 * A live-ops team wants to say "this shop goes up on Friday at 18:00 and comes
 * down on Monday at 09:00" once, and then stop thinking about it. That is the
 * whole feature. Everything else in this module exists to make it safe to
 * leave running unattended.
 *
 * Storage is the git repository, through the Contents API. There is no
 * database here and adding one for eight configs and a handful of windows
 * would be the wrong trade: the repo gives durability, an audit trail, a diff
 * for every change to the schedule itself, and it is the same store that
 * already records what was published. `schedules/schedules.json` is one file
 * on purpose - one file is one sha, so a concurrent write conflicts loudly
 * instead of interleaving.
 *
 * The guardrails, and why each one exists:
 *
 *   A window that ends must have somewhere to go back to. That is the default
 *   config, per domain. Without one, taking a promotion down would mean
 *   deleting a config out from under a running game, so scheduling an ending
 *   window is refused until a default is recorded.
 *
 *   Windows for one domain and environment may not overlap. Two schedules
 *   fighting over one setting is not a thing anyone means to configure.
 *
 *   Nothing is reverted that does not still look like what the schedule put
 *   there. If someone published by hand over a scheduled window, the end of
 *   that window leaves their change alone and says so, rather than silently
 *   undoing a deliberate fix.
 *
 *   A tick that misses its moment still does the right thing. The heartbeat is
 *   external and can be late or skipped entirely, so activation is written as
 *   "what should be live right now", not "what changed since last time". A
 *   window whose whole span was missed is closed as missed, never applied
 *   late.
 */

import { getValues } from './configcat.mjs';
import { diffJson, describeChange, summarizeDiff } from './diff.mjs';
import { CONFIG_TARGET, branchName, commitJson, gitAvailable, readJson, repoName } from './git.mjs';
import {
  LIVEOPS_DOMAINS,
  checkEvent,
  isLiveOpsEntry,
  loadOff,
  needsOffState,
  phaseOf,
  subjectOfEntry,
  windowForEvent,
} from './liveops.mjs';
import {
  LIVEOPS_FEATURES,
  REASON_TEXT,
  RETIRE_AFTER_DAYS,
  baseOf,
  checkPresentation,
  featureFor,
  mintRunId,
  readPayload,
  runIdFor,
} from './liveopsFeatures.mjs';
import { applyPublish, hashValue, toStoredValue } from './publish.mjs';

export const SCHEDULE_PATH = 'schedules/schedules.json';

/**
 * The schedule lives on its own branch, and the reason is not a git one.
 *
 * The heartbeat writes `lastTickAt` on every tick, quiet ones included,
 * because "the scheduler has not run since Tuesday" is the failure this whole
 * feature exists to make visible. At a tick every five minutes that is ~288
 * commits a day - and every commit to the deployed branch queues a Vercel
 * deployment, against a plan that allows a hundred a day. The allowance was
 * gone by mid-afternoon and real deploys were refused for the rest of it.
 *
 * A `vercel.json` ignoreCommand does not fix that: the Ignored Build Step runs
 * after a deployment slot is claimed, so a skipped build still counts. The
 * only thing that works is for these commits never to reach a branch Vercel
 * watches. So they do not.
 *
 * Set `GITHUB_SCHEDULE_REPO` as well if the branch ever turns out not to be
 * enough - the schedule is happy in another repository, and nothing else here
 * has to change.
 */
export const SCHEDULE_TARGET = {
  repo: process.env.GITHUB_SCHEDULE_REPO ?? undefined,
  branch: process.env.GITHUB_SCHEDULE_BRANCH ?? 'schedules',
};

/** Publish target per domain. Mirrors `src/domains/types.ts`; kept here so the server has no build step. */
export const SETTING_KEYS = {
  heroes: 'heroesSettings',
  trophyRoad: 'trophyRoadSettings',
  bots: 'botsSettings',
  heroUpgrade: 'heroUpgradeSettings',
  matchTrophy: 'matchTrophySettings',
  arenas: 'arenasSettings',
  shop: 'shopSettings',
  battlePass: 'battlePassSettings',
  rollingOffer: 'rollingOfferSettings',
};

export const GIT_PATHS = {
  heroes: 'config/heroes.json',
  trophyRoad: 'config/trophyRoad.json',
  bots: 'config/bots.json',
  heroUpgrade: 'config/heroUpgrade.json',
  matchTrophy: 'config/matchTrophy.json',
  arenas: 'config/arenas.json',
  shop: 'config/shop.json',
  battlePass: 'config/battlePass.json',
  rollingOffer: 'config/rollingOffer.json',
};

export const DOMAINS = Object.keys(SETTING_KEYS);

export function defaultPath(domain) {
  return `config/defaults/${domain}.json`;
}

/** A window longer than this is far more likely to be a typo than a plan. */
const MAX_WINDOW_DAYS = 180;

/** How late a start may be and still be treated as "now" rather than missed. */
const CATCH_UP_GRACE_MS = 15 * 60 * 1000;

/* ---------------------------------------------------------------- store -- */

function emptyStore() {
  return { version: 1, updatedAt: null, entries: [], mintedRunIds: [] };
}

/**
 * The whole schedule, plus the sha it was read at.
 *
 * Every write sends that sha back, so two people editing the schedule at once
 * get a conflict rather than one of them quietly winning.
 */
export async function loadSchedule() {
  const { value, sha } = await readJson(SCHEDULE_PATH, emptyStore(), SCHEDULE_TARGET);
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  return { store: { ...emptyStore(), ...value, entries }, sha };
}

export async function saveSchedule(store, sha, message) {
  const result = await commitJson({
    path: SCHEDULE_PATH,
    value: { ...store, updatedAt: new Date().toISOString() },
    message,
    sha: sha ?? undefined,
    target: SCHEDULE_TARGET,
  });
  if (!result.committed) {
    throw new Error(`The schedule could not be saved to ${repoName()}: ${result.reason}`);
  }
  return result;
}

/** The fallback payload for a domain, or null when none has been recorded. */
export async function loadDefault(domain) {
  const { value, existed } = await readJson(defaultPath(domain), null, CONFIG_TARGET);
  return existed ? value : null;
}

export async function saveDefault(domain, payload, note) {
  const result = await commitJson({
    path: defaultPath(domain),
    value: payload,
    message: `Set the default ${domain} config\n\n${note ?? 'Recorded from the back office as the fallback when no schedule is active.'}`,
    target: CONFIG_TARGET,
  });
  if (!result.committed) {
    throw new Error(`The default config could not be saved: ${result.reason}`);
  }
  return result;
}

/* ----------------------------------------------------------- the model -- */

function newId() {
  // Short, sortable, and unique enough for a handful of windows a week.
  return `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const TERMINAL = new Set(['completed', 'cancelled', 'missed', 'failed', 'superseded']);

export function isTerminal(entry) {
  return TERMINAL.has(entry.state);
}

/** Windows that could still do something, for overlap checks and for the tick. */
export function liveEntries(store) {
  return store.entries.filter((entry) => !isTerminal(entry));
}

function overlaps(a, b) {
  const aStart = Date.parse(a.startsAt);
  const aEnd = a.endsAt === null ? Infinity : Date.parse(a.endsAt);
  const bStart = Date.parse(b.startsAt);
  const bEnd = b.endsAt === null ? Infinity : Date.parse(b.endsAt);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The slot a window owns, which is what two windows must not both hold at once.
 *
 * For a core config and for a feature whose payload is one event - a battle
 * pass season - that is the setting itself. For a feature whose payload is a
 * list, each event is one entry of it: two rolling offers run side by side, and
 * only two bookings of the *same* offer collide.
 */
function slotOf(entry) {
  const setting = `${entry.domain} ${entry.environmentId}`;
  if (!isLiveOpsEntry(entry) || featureFor(entry.domain)?.unit !== 'list') return setting;
  // By base, not by run: two runs of one offer at once would be two identical
  // buttons on the menu, which is a clash even though their IDs differ.
  return `${setting} ${baseOf(subjectOfEntry(entry)) ?? ''}`;
}

function record(entry, action, ok, message) {
  entry.history = [
    ...(entry.history ?? []),
    { at: new Date().toISOString(), action, ok, message: message ?? null },
  ].slice(-20);
}

/**
 * Writes an event's window into the config it carries.
 *
 * The event's dates are the one answer: a season's start and length, an
 * offer's start and hours, are set from them whenever a booking is made or
 * moved. So moving an event on the calendar can never publish a config that
 * still runs on the old dates, and nobody has to reload a sheet to move one.
 */
function alignToWindow(entry) {
  const feature = featureFor(entry.domain);
  const subjectId = entry.liveops?.subjectId ?? null;
  if (feature === null || subjectId === null || entry.payload === null || entry.payload === undefined) return;
  const aligned = feature.withWindow(entry.payload, subjectId, { startsAt: entry.liveops.opensAt, endsAt: entry.endsAt });
  if (aligned === null) return;
  entry.payload = aligned;
  entry.payloadHash = hashValue(toStoredValue(aligned));
}

/**
 * Every event ID a new run must not reuse: whatever this feature has booked in
 * this environment, in any state, and whatever is live. The live read is best
 * effort - the schedule alone still catches every run booked here.
 */
async function takenIds(feature, domain, environmentId, store) {
  const ids = store.entries
    .filter((entry) => entry.domain === domain && entry.environmentId === environmentId)
    .map((entry) => subjectOfEntry(entry))
    .filter((id) => id !== null);
  ids.push(...(store.mintedRunIds ?? []));
  try {
    const live = await readLive(environmentId, feature.settingKey);
    ids.push(...feature.eventsIn(live.payload).map((event) => event.subjectId));
  } catch {
    // Unreadable is not a reason to refuse a booking.
  }
  return ids;
}

/**
 * Writes a run ID into the register of every run ID ever minted.
 *
 * A booking stays in the schedule for good, but a run published straight from
 * a page has no booking - and once it is retired it is not in ConfigCat either.
 * Nothing would then remember its ID, and a later run opening on the same day
 * could be minted the same one. The game's server keeps a player's progress
 * under an ID for ever, so that run would open with the old run's progress.
 * The register is what makes a minted ID never come back.
 */
function rememberRun(store, id) {
  const known = store.mintedRunIds ?? [];
  if (!known.includes(id)) store.mintedRunIds = [...known, id];
}

/**
 * Puts a new booking out under a run ID of its own.
 *
 * The sheet names the base; the run key is the day it opens. Written onto the
 * payload and the booking together, once - after this, moving the booking's
 * dates never renames it, because that would hand its players a fresh chain
 * halfway through the run.
 */
async function assignRun(entry, store) {
  const feature = featureFor(entry.domain);
  const incoming = subjectOfEntry(entry);
  if (feature === null || incoming === null) return [];
  const runId = mintRunId(incoming, entry.liveops.opensAt, await takenIds(feature, entry.domain, entry.environmentId, store));
  if (runId === null) return [`Every run ID for ${baseOf(incoming)} on that day is taken.`];
  const renamed = feature.withSubjectId(entry.payload, incoming, runId);
  if (renamed === null) return [`The config does not carry the ${feature.noun} "${incoming}".`];
  entry.payload = renamed;
  entry.payloadHash = hashValue(toStoredValue(renamed));
  entry.liveops = { ...entry.liveops, baseId: baseOf(incoming), subjectId: runId };
  rememberRun(store, runId);
  return [];
}

/**
 * Brings a config a sheet built - which names the base - onto the run it is
 * for. Null when the sheet is a different event altogether.
 */
function ontoRun(feature, payload, runId) {
  const base = baseOf(runId);
  const from =
    feature.partOf(payload, base) !== null ? base : feature.partOf(payload, runId) !== null ? runId : null;
  return from === null ? null : feature.withSubjectId(payload, from, runId);
}

/** Writes an offer's text and art into a payload, or says why not. */
function presented(feature, payload, subjectId, presentation) {
  if (presentation === undefined || typeof feature.withPresentation !== 'function') return { payload, problems: [] };
  const problems = checkPresentation(presentation);
  if (problems.length > 0) return { payload, problems };
  const next = feature.withPresentation(payload, subjectId, presentation);
  return next === null
    ? { payload, problems: [`The config does not carry the ${feature.noun} "${subjectId}".`] }
    : { payload: next, problems: [] };
}

/* ------------------------------------------------------------ guardrails -- */

/**
 * Everything that must be true before a window is accepted.
 *
 * Returned as a list rather than thrown one at a time, so the form can show
 * every problem at once instead of the user fixing them in sequence.
 */
export function checkEntry(candidate, { entries, hasDefault, hasOff, now = Date.now(), started = false }) {
  const problems = [];
  const liveOps = isLiveOpsEntry(candidate);

  if (!DOMAINS.includes(candidate.domain)) {
    problems.push(`"${candidate.domain}" is not a config this console publishes.`);
  }
  if (typeof candidate.environmentId !== 'string' || candidate.environmentId === '') {
    problems.push('A target environment is required.');
  }
  if (candidate.payload === undefined || candidate.payload === null) {
    problems.push('A window needs the config it should publish.');
  }

  const start = Date.parse(candidate.startsAt ?? '');
  if (Number.isNaN(start)) {
    problems.push('The start time is not a valid date.');
  } else if (started) {
    // An entry that is already live legitimately started in the past. It is
    // still edited through this function, because everything else here - the
    // overlap rule, the fallback rule - applies to it exactly as before.
  } else if (start < now - CATCH_UP_GRACE_MS) {
    problems.push(
      'The start time is in the past. A window that already ended would never run, and one that already started would jump the game forward without anyone watching, so schedule it from now on or publish it directly instead.',
    );
  }

  let end = null;
  if (candidate.endsAt !== null && candidate.endsAt !== undefined) {
    end = Date.parse(candidate.endsAt);
    if (Number.isNaN(end)) {
      problems.push('The end time is not a valid date.');
    } else if (!Number.isNaN(start) && end <= start) {
      problems.push('The end time is not after the start time.');
    } else if (!Number.isNaN(start) && end - start > MAX_WINDOW_DAYS * 86400000) {
      problems.push(
        `The window is longer than ${MAX_WINDOW_DAYS} days. That is usually a typo in the year. Leave the end time empty for a change that should simply stay.`,
      );
    }
  }

  // The one guardrail that is really a design decision: a window that comes
  // down has to have something to come down to. Where that is depends on what
  // kind of window it is - a core config goes back to its last known-good
  // version, a live ops feature goes away entirely - so the question is the
  // same one and the answer is not.
  // Every live ops booking has to say which event inside the payload it owns:
  // it is what gets merged in when it opens, taken out when it ends, and what
  // the calendar matches against what ConfigCat is serving.
  const feature = liveOps ? featureFor(candidate.domain) : null;
  if (liveOps && feature === null) {
    problems.push(`"${candidate.domain}" is not a live ops feature, so it cannot be booked as an event.`);
  } else if (liveOps && subjectOfEntry(candidate) === null) {
    problems.push(
      `This event does not record which ${feature.noun} it publishes, so there would be nothing to merge in when ` +
        `it opens or take out when it ends. Load its sheet so the booking knows which one it owns.`,
    );
  }

  // A feature whose payload is a list needs no off state and could not have
  // one: ending one of its events changes that entry and leaves the rest.
  if (end !== null && !Number.isNaN(end) && !(liveOps ? !needsOffState(candidate.domain) || hasOff : hasDefault)) {
    problems.push(
      liveOps
        ? 'This feature has no off state recorded, so there would be nothing to publish when the event ends and the feature would stay in the game after it was over. Record the off state first.'
        : 'This config has no default recorded, so there is nothing to fall back to when the window ends. Set the default first - the current live value is usually the right one.',
    );
  }

  const slot = slotOf(candidate);
  const clashing = entries.filter(
    (entry) =>
      entry.id !== candidate.id &&
      slotOf(entry) === slot &&
      !isTerminal(entry) &&
      overlaps(entry, candidate),
  );
  for (const clash of clashing) {
    problems.push(
      `It overlaps "${clash.label ?? clash.id}" (${clash.startsAt} to ${clash.endsAt ?? 'open ended'}). Two windows cannot own the same config at the same time.`,
    );
  }

  return problems;
}

/* -------------------------------------------------------------- writing -- */

/**
 * Books a window, or - with `startNow` - books a live ops event and puts it
 * live straight away.
 *
 * Starting now is the calendar's "publish it now": the event is recorded the
 * same way a booked one is, so it shows on the calendar, keeps its history and
 * is taken down at its end, and the only difference is that nobody waits five
 * minutes for the heartbeat to publish it.
 */
export async function createEntry(input) {
  const { store, sha } = await loadSchedule();
  const now = Date.now();
  const startNow = input.startNow === true && input.liveops !== null && input.liveops !== undefined;
  const liveops =
    input.liveops === null || input.liveops === undefined
      ? null
      : {
          ...input.liveops,
          // Floored to the minute, because that is as precise as the client's
          // own start stamp is.
          ...(startNow ? { opensAt: new Date(Math.floor(now / 60000) * 60000).toISOString() } : {}),
        };
  const hasDefault = (await loadDefault(input.domain)) !== null;
  const hasOff = liveops === null ? false : (await loadOff(input.domain)) !== null;

  // A live ops event names the moment players see it, and that is now the
  // moment its config is written: the window and the event are the same span.
  // Entries booked while the form still asked for preview hours start that
  // much earlier, which is why the window is worked out rather than copied.
  const window = liveops === null
    ? { startsAt: input.startsAt, endsAt: input.endsAt ?? null }
    : windowForEvent(liveops, input.endsAt ?? null);

  const entry = {
    id: input.id ?? newId(),
    domain: input.domain,
    settingKey: SETTING_KEYS[input.domain],
    gitPath: GIT_PATHS[input.domain],
    environmentId: input.environmentId,
    environmentName: input.environmentName ?? null,
    label: input.label ?? '',
    note: input.note ?? null,
    payload: input.payload,
    payloadHash: hashValue(toStoredValue(input.payload)),
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    liveops,
    state: 'scheduled',
    createdAt: new Date(now).toISOString(),
    createdBy: input.createdBy ?? 'back office',
    history: [],
  };
  // Written down on the booking, so every later reader - the heartbeat, the
  // calendar - asks the same question of the same answer.
  const eventProblems = [];
  if (liveops !== null) {
    entry.liveops = { ...liveops, subjectId: subjectOfEntry(entry) };
    eventProblems.push(...(await assignRun(entry, store)));
    const feature = featureFor(entry.domain);
    if (eventProblems.length === 0 && typeof feature?.presentationOf === 'function') {
      // Text and art from the form, or else what the config already carries -
      // held to the same rules either way, since players see it all the same.
      const presentation =
        input.presentation ?? feature.presentationOf(entry.payload, entry.liveops.subjectId) ?? undefined;
      const outcome = presented(feature, entry.payload, entry.liveops.subjectId, presentation);
      eventProblems.push(...outcome.problems);
      entry.payload = outcome.payload;
      entry.payloadHash = hashValue(toStoredValue(outcome.payload));
    }
    alignToWindow(entry);
  }

  const problems = [
    ...eventProblems,
    ...checkEntry(entry, { entries: store.entries, hasDefault, hasOff, now }),
    ...(liveops === null ? [] : checkEvent(entry.liveops, { startsAt: entry.startsAt, endsAt: entry.endsAt }, entry.domain)),
  ];
  if (problems.length > 0) return { ok: false, problems };

  record(entry, 'created', true, startNow ? 'Booked to start now.' : `Scheduled for ${entry.startsAt}.`);
  store.entries = [...store.entries, entry];

  let started = null;
  if (startNow) {
    // Published before the booking is saved, and saved either way: a publish
    // refused by a colleague's open change request is retried by the next
    // tick, exactly as a booked event would be.
    started = await startWindow(entry, new Date(now));
  }

  await saveSchedule(
    store,
    sha,
    `${startNow ? 'Start' : 'Schedule'} ${entry.domain}: ${entry.label || entry.id}`,
  );
  return { ok: true, entry, started };
}

/**
 * Edits a window that has not finished yet.
 *
 * Wanted the moment a calendar exists: a season slips a week, a name is wrong,
 * a sheet gets a fix. The alternative was cancel-and-rebook, which loses the
 * entry's history and - for a live window - takes the feature out of the game
 * in between.
 *
 * What may change depends on whether it has started. A scheduled window is not
 * doing anything yet, so all of it is editable. A live core window is already
 * serving its payload, so moving its start or swapping its config is refused.
 * A live ops event that is live is different: its window and its config are
 * inside the payload the game is reading, so changing either *is* publishing,
 * and that is what happens - straight away, through `publishLiveEvent`.
 * Anything omitted keeps the value it had, which is what lets the form send
 * only what somebody touched.
 */
export async function updateEntry(input) {
  const { store, sha } = await loadSchedule();
  const current = store.entries.find((entry) => entry.id === input.id);
  if (current === undefined) return { ok: false, problems: [`No schedule with id "${input.id}".`] };
  if (isTerminal(current)) {
    return { ok: false, problems: [`That window is already ${current.state} and cannot be edited.`] };
  }

  const started = current.state === 'active';
  // The run a booking was given is its identity. A sheet reloaded onto it names
  // the base, and that is not a reason to rename the run.
  const runId = isLiveOpsEntry(current) ? subjectOfEntry(current) : null;
  const liveops =
    current.liveops === null || current.liveops === undefined
      ? null
      : { ...current.liveops, ...(input.liveops ?? {}), ...(runId === null ? {} : { subjectId: runId }) };

  const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
  const window =
    liveops === null
      ? { startsAt: input.startsAt ?? current.startsAt, endsAt }
      : windowForEvent(liveops, endsAt ?? null);

  const feature = liveops === null ? null : featureFor(current.domain);
  let payload = current.payload;
  if (input.payload !== undefined) {
    payload = feature === null || runId === null ? input.payload : ontoRun(feature, input.payload, runId);
    if (payload === null) {
      return {
        ok: false,
        problems: [
          `That config is not ${baseOf(runId)}, which is what this event runs. Book a new event for a different ${feature.noun}.`,
        ],
      };
    }
  }
  if (feature !== null && runId !== null && input.presentation !== undefined) {
    const outcome = presented(feature, payload, runId, input.presentation);
    if (outcome.problems.length > 0) return { ok: false, problems: outcome.problems };
    payload = outcome.payload;
  }
  const payloadChanged = hashValue(toStoredValue(payload)) !== current.payloadHash;

  if (started && liveops !== null && (payloadChanged || window.endsAt !== current.endsAt || window.startsAt !== current.startsAt)) {
    const published = await publishLiveEvent({
      domain: current.domain,
      environmentId: current.environmentId,
      subjectId: runId,
      payload: payloadChanged ? payload : undefined,
      window: { startsAt: liveops.opensAt, endsAt: window.endsAt },
      reason: `Live event "${input.label ?? current.label ?? current.id}" edited from the back office.`,
      details: { label: input.label, note: input.note, category: input.liveops?.category, sourceUrl: input.liveops?.sourceUrl },
    });
    return published;
  }

  if (started) {
    const problems = [];
    if (window.startsAt !== current.startsAt) {
      problems.push(
        'This window is already live, so its start cannot be moved. Take it down and book a new one if it should start again later.',
      );
    }
    if (payloadChanged) {
      problems.push(
        'This window is already live, so its config cannot be swapped from here. Publish the change on the config page instead.',
      );
    }
    if (problems.length > 0) return { ok: false, problems };
  }

  const next = {
    ...current,
    label: input.label ?? current.label,
    note: input.note === undefined ? current.note : input.note,
    environmentName: input.environmentName ?? current.environmentName,
    payload,
    payloadHash: hashValue(toStoredValue(payload)),
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    liveops,
  };
  if (liveops !== null) {
    next.liveops = { ...liveops, subjectId: subjectOfEntry(next) };
    alignToWindow(next);
  }

  const hasDefault = (await loadDefault(next.domain)) !== null;
  const hasOff = liveops === null ? false : (await loadOff(next.domain)) !== null;
  const problems = [
    ...checkEntry(next, { entries: store.entries, hasDefault, hasOff, started }),
    ...(liveops === null ? [] : checkEvent(next.liveops, { startsAt: next.startsAt, endsAt: next.endsAt }, next.domain)),
  ];
  if (problems.length > 0) return { ok: false, problems };

  record(next, 'edited', true, `Rescheduled for ${next.startsAt}.`);
  store.entries = store.entries.map((entry) => (entry.id === next.id ? next : entry));
  await saveSchedule(store, sha, `Edit ${next.domain} schedule: ${next.label || next.id}`);
  return { ok: true, entry: next };
}

/**
 * Stops a window.
 *
 * One that has not started is simply called off. One that is live has to take
 * its config back out, or "cancel" would mean "leave the promotion up for
 * ever": a core window goes back to its default, and a live ops event is
 * ended the same way the calendar's End now ends it - at once, whatever else
 * has happened to the payload since.
 */
export async function cancelEntry(id, reason) {
  const { store, sha } = await loadSchedule();
  const entry = store.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return { ok: false, problems: [`No schedule with id "${id}".`] };
  if (isTerminal(entry)) return { ok: false, problems: [`That window is already ${entry.state}.`] };

  if (entry.state === 'active' && isLiveOpsEntry(entry)) {
    const ended = await endLiveEvent({
      domain: entry.domain,
      environmentId: entry.environmentId,
      subjectId: subjectOfEntry(entry),
      mode: 'end',
      reason: reason ?? 'Cancelled from the back office.',
    });
    if (ended.ok) return { ...ended, entry: ended.cancelled.find((candidate) => candidate.id === id) ?? entry };
    // Nothing of this event is left running - somebody took it out already, or
    // its window has closed - so there is nothing to publish, only a booking
    // to call off.
    if (ended.reason !== 'not-listed' && ended.reason !== 'already-ended') return ended;
  }

  let revert = null;
  if (entry.state === 'active' && !isLiveOpsEntry(entry)) {
    revert = await endWindow(entry, store, 'cancelled');
  }

  entry.state = 'cancelled';
  record(entry, 'cancelled', true, reason ?? 'Cancelled from the back office.');
  await saveSchedule(store, sha, `Cancel schedule ${entry.domain}: ${entry.label || entry.id}`);
  return { ok: true, entry, revert };
}

/**
 * Erases a live ops booking - its calendar card and its history - from the
 * schedule.
 *
 * Only a booking with nothing in the game: one still to come, or one that is
 * over. A running one is refused rather than ended here, because taking an
 * event out of the game is End now's job and asks its own question first.
 *
 * Its run ID goes into the register before the booking goes. The booking was
 * one of the places that remembered the ID, and the game's server may still
 * hold players' progress under it, so erasing the booking must not free the ID
 * for a later run.
 */
export async function deleteEntry(id) {
  const { store, sha } = await loadSchedule();
  const entry = store.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return { ok: false, problems: [`No schedule with id "${id}".`] };
  if (!isLiveOpsEntry(entry)) {
    return { ok: false, problems: ['Only a live ops booking can be deleted. A config window keeps its history.'] };
  }
  if (entry.state !== 'scheduled' && !isTerminal(entry)) {
    return { ok: false, problems: [`"${entry.label || entry.id}" is ${entry.state}. End it or call it off first.`] };
  }

  const runId = subjectOfEntry(entry);
  if (runId !== null) rememberRun(store, runId);
  store.entries = store.entries.filter((candidate) => candidate.id !== id);
  await saveSchedule(store, sha, `Delete schedule ${entry.domain}: ${entry.label || entry.id}`);
  return { ok: true, entry };
}

/* ------------------------------------------------------- live ops events -- */

/**
 * The live value of one setting, read fresh, with the hash a publish is
 * checked against so nothing written in between is overwritten.
 */
async function readLive(environmentId, settingKey) {
  const values = await getValues(CONFIG_ID, environmentId);
  if (values.unreadable !== null) {
    throw new Error(`The live config could not be read: ${values.unreadable.reason}`);
  }
  const setting = values.settings.find((candidate) => candidate.key === settingKey);
  if (setting === undefined) throw new Error(`ConfigCat has no setting with the key "${settingKey}".`);
  const text = typeof setting.value === 'string' ? setting.value : null;
  return { text, payload: readPayload(text), hash: hashValue(text) };
}

/**
 * Refuses when the event somebody is acting on is not the event that is live.
 *
 * Checked on the event's own part of the payload, not the whole setting: two
 * people ending two different rolling offers at once are not in each other's
 * way, but one ending an offer another has just re-cut should hear about it.
 */
function changedSince(feature, live, subjectId, expected) {
  if (expected === undefined) return false;
  return diffJson(feature.partOf(live, subjectId), expected ?? null).length > 0;
}

/**
 * Settles the bookings of an event that was just changed by hand.
 *
 * Ending it cancels the booking that was running it, so the heartbeat does not
 * try to take it down again later. Editing it keeps the booking and brings it
 * onto what was published, so its end time and its "is this still ours" check
 * both follow the edit.
 */
async function settleBookings({ domain, environmentId, subjectId, action, payload, window, details, message }) {
  if (!gitAvailable()) return [];
  const { store, sha } = await loadSchedule();
  const touched = store.entries.filter(
    (entry) =>
      entry.domain === domain &&
      entry.environmentId === environmentId &&
      entry.state === 'active' &&
      isLiveOpsEntry(entry) &&
      subjectOfEntry(entry) === subjectId,
  );
  if (touched.length === 0) return [];

  for (const entry of touched) {
    if (action === 'end') {
      entry.state = 'cancelled';
      record(entry, 'ended', true, message);
    } else {
      entry.payload = payload;
      entry.payloadHash = hashValue(toStoredValue(payload));
      if (window !== undefined) {
        entry.endsAt = window.endsAt;
        if (window.startsAt !== null) entry.liveops = { ...entry.liveops, opensAt: window.startsAt };
      }
      if (details?.label !== undefined) entry.label = details.label;
      if (details?.note !== undefined) entry.note = details.note;
      if (details?.category !== undefined) entry.liveops = { ...entry.liveops, category: details.category };
      if (details?.sourceUrl !== undefined && details.sourceUrl !== null) {
        entry.liveops = { ...entry.liveops, sourceUrl: details.sourceUrl };
      }
      record(entry, 'edited-live', true, message);
    }
  }
  await saveSchedule(
    store,
    sha,
    `${action === 'end' ? 'End' : 'Edit'} live ${domain} event ${subjectId}`,
  );
  return touched;
}

/**
 * Takes one live ops event out of the game now.
 *
 * Works on whatever ConfigCat is serving, booked or not - an offer published
 * from its page, a season somebody pasted into the dashboard. That is the
 * point: a misconfigured offer has to come down the minute somebody notices,
 * not at its end time, and not by somebody opening ConfigCat to hand-edit a
 * JSON string.
 *
 * `mode: 'end'` closes the event (off state for a season, a closed window for
 * an offer) and is always safe. `mode: 'remove'` takes an offer out of the
 * list for good, which retires its progress, and is what tidies up an offer
 * that has already run.
 */
export async function endLiveEvent({ domain, environmentId, subjectId, mode = 'end', expected, reason, now = Date.now() }) {
  const feature = featureFor(domain);
  if (feature === null) return { ok: false, problems: [`"${domain}" is not a live ops feature.`] };
  if (typeof subjectId !== 'string' || subjectId === '') {
    return { ok: false, problems: ['Which event to end is required.'] };
  }
  if (typeof environmentId !== 'string' || environmentId === '') {
    return { ok: false, problems: ['A target environment is required.'] };
  }

  const off = feature.unit === 'whole' ? await loadOff(domain) : null;
  const live = await readLive(environmentId, feature.settingKey);
  if (changedSince(feature, live.payload, subjectId, expected)) {
    return {
      ok: false,
      problems: ['That event changed in ConfigCat after you opened it. Refresh and look at it again before ending it.'],
    };
  }

  const outcome =
    mode === 'remove'
      ? feature.withoutPart(live.payload, subjectId, { off })
      : feature.endedNow(live.payload, subjectId, { now, off });
  if (outcome.payload === null) {
    return {
      ok: false,
      reason: outcome.reason,
      problems: [REASON_TEXT[outcome.reason] ?? `Nothing was changed (${outcome.reason}).`],
    };
  }

  const verb = mode === 'remove' ? 'removed from the config' : 'ended';
  const { result } = await publishPayload({
    environmentId,
    payload: outcome.payload,
    settingKey: feature.settingKey,
    gitPath: GIT_PATHS[domain],
    baselineHash: live.hash,
    note: `Live ${feature.noun} "${subjectId}" ${verb} by hand. ${reason ?? ''}`.trim(),
  });
  const ok = result.status === 'written' || result.status === 'unchanged';
  if (!ok) return { ok: false, problems: [result.message ?? `The publish did not go through (${result.status}).`], result };

  const cancelled = await settleBookings({
    domain,
    environmentId,
    subjectId,
    action: 'end',
    message: `${feature.noun[0].toUpperCase()}${feature.noun.slice(1)} ${verb} by hand${reason ? `: ${reason}` : '.'}`,
  });
  return { ok: true, result, cancelled };
}

/**
 * Republishes one live ops event now: a new window, a new config from its
 * sheet, or both.
 *
 * Merged into what is live at the moment of publishing, so the other offers
 * running beside this one are carried through as they are now rather than as
 * they were when the sheet was loaded.
 */
export async function publishLiveEvent({
  domain,
  environmentId,
  subjectId: requested,
  payload: incoming,
  window,
  presentation,
  resolveRun = false,
  expected,
  reason,
  details,
  now = Date.now(),
}) {
  const feature = featureFor(domain);
  if (feature === null) return { ok: false, problems: [`"${domain}" is not a live ops feature.`] };
  if (typeof requested !== 'string' || requested === '') {
    return { ok: false, problems: ['Which event to change is required.'] };
  }
  if (incoming === undefined && window === undefined && presentation === undefined) {
    return { ok: false, problems: ['Nothing to change: send a new window, a new config, or both.'] };
  }

  const live = await readLive(environmentId, feature.settingKey);

  // A feature's page names the base, and the run is worked out here, against
  // what is live at this moment: the run in the game if there is one, a new
  // run if not. The calendar names the exact run it opened.
  let subjectId = requested;
  let freshRun = false;
  if (resolveRun) {
    const ownEvent = incoming === undefined ? undefined : feature.eventsIn(incoming).find((event) => baseOf(event.subjectId) === baseOf(requested));
    const taken = gitAvailable() ? await takenIds(feature, domain, environmentId, (await loadSchedule()).store) : [];
    const run = runIdFor(feature, {
      baseId: requested,
      live: live.payload,
      opensAt: window?.startsAt ?? ownEvent?.startsAt ?? now,
      now,
      taken,
    });
    if (run.id === null) return { ok: false, problems: [`Every run ID for ${baseOf(requested)} on that day is taken.`] };
    subjectId = run.id;
    freshRun = run.fresh;
  }

  if (changedSince(feature, live.payload, subjectId, expected)) {
    return {
      ok: false,
      problems: ['That event changed in ConfigCat after you opened it. Refresh and look at it again before changing it.'],
    };
  }

  const payload = incoming === undefined ? undefined : ontoRun(feature, incoming, subjectId);
  if (incoming !== undefined && payload === null) {
    return { ok: false, problems: [`The config does not carry the ${feature.noun} "${baseOf(subjectId)}".`] };
  }

  let next = payload === undefined ? live.payload : feature.withPart(live.payload, payload, subjectId);
  if (next === null) {
    return { ok: false, problems: [`The config does not carry the ${feature.noun} "${subjectId}".`] };
  }
  if (payload === undefined && feature.partOf(next, subjectId) === null) {
    return { ok: false, problems: [REASON_TEXT['not-listed']] };
  }
  if (presentation !== undefined) {
    const outcome = presented(feature, next, subjectId, presentation);
    if (outcome.problems.length > 0) return { ok: false, problems: outcome.problems };
    next = outcome.payload;
  }
  if (window !== undefined) {
    if (window.endsAt === null && !feature.evergreen) {
      return { ok: false, problems: [`A ${feature.noun} needs an end.`] };
    }
    if (window.startsAt !== null && window.endsAt !== null && Date.parse(window.endsAt) <= Date.parse(window.startsAt)) {
      return { ok: false, problems: ['The event ends before it opens.'] };
    }
    next = feature.withWindow(next, subjectId, window);
    if (next === null) return { ok: false, problems: ['That window cannot be written into this config.'] };
  }

  const { response, result } = await publishPayload({
    environmentId,
    payload: next,
    settingKey: feature.settingKey,
    gitPath: GIT_PATHS[domain],
    baselineHash: live.hash,
    note: `Live ${feature.noun} "${subjectId}" ${payload === undefined ? 'changed by hand' : 'published'}. ${reason ?? ''}`.trim(),
  });
  const ok = result.status === 'written' || result.status === 'unchanged';
  if (!ok) return { ok: false, problems: [result.message ?? `The publish did not go through (${result.status}).`], result };

  if (freshRun && gitAvailable()) {
    // After the publish, so a refused publish mints nothing - and never allowed
    // to turn a publish that went through into an error.
    try {
      const { store, sha } = await loadSchedule();
      rememberRun(store, subjectId);
      await saveSchedule(store, sha, `Record run ${subjectId}, published from its page`);
    } catch (error) {
      console.error(`[schedule] ${subjectId} went live but could not be added to the run register:`, error);
    }
  }

  const updated = await settleBookings({
    domain,
    environmentId,
    subjectId,
    action: 'edit',
    payload: next,
    window,
    details,
    message: window === undefined ? 'Config republished by hand.' : `Republished by hand to run until ${window.endsAt ?? 'further notice'}.`,
  });
  return { ok: true, result, response, subjectId, entry: updated[0] ?? null };
}

/* ----------------------------------------------------------------- tick -- */

/**
 * What should be live for one domain and environment at `now`. Exported for
 * its tests: this one function decides what the game serves.
 *
 * Written as a question about the present rather than a diff against the last
 * run, because the heartbeat is external and may be late, early or missing.
 * If two windows somehow both apply, the one that started most recently wins
 * and the other is marked superseded rather than left to fight.
 *
 * For a feature whose payload is a list, pass the event's `subjectId`: each
 * offer is its own slot, and two offers running together are not a contest.
 */
export function windowFor(entries, domain, environmentId, now, subjectId) {
  const applicable = entries
    .filter(
      (entry) =>
        entry.domain === domain &&
        entry.environmentId === environmentId &&
        (subjectId === undefined || subjectOfEntry(entry) === subjectId) &&
        !isTerminal(entry) &&
        Date.parse(entry.startsAt) <= now &&
        (entry.endsAt === null || Date.parse(entry.endsAt) > now),
    )
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { winner: applicable[0] ?? null, losers: applicable.slice(1) };
}

/** The subject that scopes a window's slot, or undefined when the whole setting is the slot. */
function slotSubject(entry) {
  return isLiveOpsEntry(entry) && featureFor(entry.domain)?.unit === 'list' ? subjectOfEntry(entry) : undefined;
}

/**
 * The account this console manages. Mirrors `src/domains/account.ts`; the env
 * vars override it so a second product never needs a code change.
 */
const CONFIG_ID = process.env.CONFIGCAT_CONFIG_ID ?? '08dee35e-a4d3-4e5e-8157-f96d209ff503';
const PRODUCT_ID = process.env.CONFIGCAT_PRODUCT_ID ?? '08ded206-3476-460f-8afc-6b9c417ebedd';

/**
 * A scheduled write is still a publish: read back and verified, noted in the
 * audit log, committed to git, and refused while somebody has unpublished work
 * staged in the ConfigCat dashboard. A window planned days ago carries no
 * baseline hash - the live value is expected to have moved since - but a
 * change computed from the live value a moment ago does, so nothing written in
 * between is overwritten.
 */
async function publishPayload({ environmentId, payload, note, gitPath, settingKey, baselineHash }) {
  const response = await applyPublish({
    configId: CONFIG_ID,
    environmentId,
    productId: PRODUCT_ID,
    entries: [{ settingKey, payload, gitPath, note, baselineHash }],
  });
  return { response, result: response.results[0] };
}

/**
 * How many ticks a window may fail before it is given up on.
 *
 * A scheduled change must survive a ConfigCat blip or a colleague's change
 * request being open for an hour. Marking a window failed on its first bad
 * tick would mean a five-minute outage silently cancels a weekend promotion,
 * so failures are retried and only become terminal once they look permanent.
 */
const MAX_ATTEMPTS = 6;

/**
 * Puts a window's config live.
 *
 * A feature whose payload is a list is merged in at this moment, from the
 * booking's own entry, into whatever else is live now. Publishing the list as
 * it was when the event was booked would retire every offer added since.
 */
async function startWindow(entry, at) {
  const now = at.getTime();
  try {
    let payload = entry.payload;
    let baselineHash;
    const feature = isLiveOpsEntry(entry) ? featureFor(entry.domain) : null;
    if (feature?.unit === 'list') {
      const live = await readLive(entry.environmentId, entry.settingKey);
      payload = feature.withPart(live.payload, entry.payload, subjectOfEntry(entry));
      baselineHash = live.hash;
      if (payload === null) throw new Error(`The booked config does not carry "${subjectOfEntry(entry)}".`);
    }

    const { result } = await publishPayload({
      environmentId: entry.environmentId,
      payload,
      settingKey: entry.settingKey,
      gitPath: entry.gitPath,
      baselineHash,
      note:
        `Scheduled window "${entry.label || entry.id}" started` +
        (entry.endsAt === null ? '.' : `, ending ${entry.endsAt}.`) +
        (entry.note === null || entry.note === undefined ? '' : ` ${entry.note}`),
    });

    const ok = result.status === 'written' || result.status === 'unchanged';
    if (ok) {
      entry.state = 'active';
      entry.activatedAt = new Date(now).toISOString();
      // What actually went live, which for a merged list is not what was booked.
      entry.payload = payload;
      entry.payloadHash = hashValue(toStoredValue(payload));
      record(entry, 'started', true, `Published to ${entry.environmentName ?? entry.environmentId}.`);
    } else {
      entry.startAttempts = (entry.startAttempts ?? 0) + 1;
      const giveUp = entry.startAttempts >= MAX_ATTEMPTS;
      if (giveUp) entry.state = 'failed';
      record(
        entry,
        'start-failed',
        false,
        `${result.message ?? 'The publish failed.'}${giveUp ? ' Giving up after ' + entry.startAttempts + ' attempts.' : ' Retrying on the next tick.'}`,
      );
    }
    return { ok, detail: result.status };
  } catch (error) {
    entry.startAttempts = (entry.startAttempts ?? 0) + 1;
    const giveUp = entry.startAttempts >= MAX_ATTEMPTS;
    // Left scheduled, so a ConfigCat blip or a colleague's open change
    // request delays the window by one tick rather than cancelling it.
    if (giveUp) entry.state = 'failed';
    record(
      entry,
      'start-failed',
      false,
      `${error?.message ?? String(error)}${giveUp ? ' Giving up after ' + entry.startAttempts + ' attempts.' : ' Retrying on the next tick.'}`,
    );
    return { ok: false, detail: error?.message };
  }
}

/**
 * Takes a window down at its end.
 *
 * The target is the next window that should be live, if one is, and otherwise
 * the domain's fallback. Crucially it first checks that the live value is
 * still what this window put there: a human fix published over a scheduled
 * promotion must not be undone by the promotion expiring.
 */
async function endWindow(entry, store, becauseOf, now = Date.now()) {
  const liveOps = isLiveOpsEntry(entry);
  const feature = liveOps ? featureFor(entry.domain) : null;
  const subjectId = liveOps ? subjectOfEntry(entry) : undefined;

  const successor = windowFor(
    store.entries.filter((candidate) => candidate.id !== entry.id),
    entry.domain,
    entry.environmentId,
    now,
    slotSubject(entry),
  ).winner;

  const values = await getValues(CONFIG_ID, entry.environmentId);
  const live = values.settings.find((setting) => setting.key === entry.settingKey);
  const liveText = typeof live?.value === 'string' ? live.value : null;

  // Is the live value still ours to take back? For a live ops event only its
  // own part is asked about: other offers coming and going beside it is not
  // somebody overriding this one.
  const ours =
    feature === null
      ? hashValue(liveText) === entry.payloadHash
      : diffJson(feature.partOf(readPayload(liveText), subjectId), feature.partOf(entry.payload, subjectId)).length === 0;
  if (!ours) {
    record(
      entry,
      'end-skipped',
      false,
      feature !== null && feature.partOf(readPayload(liveText), subjectId) === null
        ? REASON_TEXT['not-listed']
        : 'The live value is no longer what this window published, so somebody changed it by hand. Leaving their change in place rather than reverting it.',
    );
    return { reverted: false, reason: 'changed-by-hand' };
  }

  // A core config goes back to its last known-good version. A live ops
  // feature has no previous version to want - the season is over - so its
  // event is taken out of the payload: the off state for a season, the list
  // without it for an offer. Getting this wrong would restart last season the
  // moment this one ended.
  let fallback;
  let target;
  if (successor !== null && feature === null) {
    fallback = successor.payload;
    target = `the "${successor.label || successor.id}" window`;
  } else if (successor !== null) {
    fallback = feature.withPart(readPayload(liveText), successor.payload, subjectOfEntry(successor));
    target = `the "${successor.label || successor.id}" event`;
  } else if (feature !== null && feature.unit === 'list') {
    // An offer run that ends stays listed with its window closed. It is never
    // coming back under this ID, but it is kept for a week, so a real-money step
    // bought in its last minutes can still be granted when the app next opens -
    // and then retired by the heartbeat's own sweep.
    const outcome = feature.endedNow(readPayload(liveText), subjectId, { now });
    if (outcome.payload === null) {
      const done = outcome.reason === 'already-ended' || outcome.reason === 'not-listed';
      record(
        entry,
        'ended',
        done,
        outcome.reason === 'already-ended'
          ? `Its window closed on its own. It stays listed for ${RETIRE_AFTER_DAYS} days, then is retired.`
          : REASON_TEXT[outcome.reason] ?? `Nothing was changed (${outcome.reason}).`,
      );
      return { reverted: done, reason: outcome.reason };
    }
    fallback = outcome.payload;
    target = `"${subjectId}" with its window closed, retired ${RETIRE_AFTER_DAYS} days after it ended`;
  } else if (feature !== null) {
    const off = feature.unit === 'whole' ? await loadOff(entry.domain) : null;
    const outcome = feature.withoutPart(readPayload(liveText), subjectId, { off });
    if (outcome.payload === null) {
      // An offer that is the last one listed stays listed: its window has
      // closed in the payload on its own, so the client already hides it.
      const harmless = outcome.reason === 'would-empty' || outcome.reason === 'not-listed';
      record(
        entry,
        'end-skipped',
        harmless,
        outcome.reason === 'would-empty'
          ? `"${subjectId}" is the only ${feature.noun} listed, and the client ignores an empty list - so it stays listed with its window closed, which keeps it off the menu.`
          : REASON_TEXT[outcome.reason] ?? `Nothing was removed (${outcome.reason}).`,
      );
      return { reverted: harmless, reason: outcome.reason };
    }
    fallback = outcome.payload;
    target =
      feature.unit === 'list'
        ? `the config without "${subjectId}", so that ${feature.noun} is retired and the rest carry on`
        : 'the off state, so the feature is no longer in the game';
  } else {
    fallback = await loadDefault(entry.domain);
    target = 'the default config';
    if (fallback === null) {
      record(
        entry,
        'end-skipped',
        false,
        'The window ended but no default config is recorded, so the config was left as it is rather than removed from a running game. Record a default for this config.',
      );
      return { reverted: false, reason: 'no-default' };
    }
  }

  const { result } = await publishPayload({
    environmentId: entry.environmentId,
    payload: fallback,
    settingKey: entry.settingKey,
    gitPath: entry.gitPath,
    baselineHash: feature === null ? undefined : hashValue(liveText),
    note: `Scheduled window "${entry.label || entry.id}" ended (${becauseOf}); restoring ${target}.`,
  });

  const ok = result.status === 'written' || result.status === 'unchanged';
  record(entry, 'ended', ok, ok ? `Restored ${target}.` : result.message ?? 'The revert failed.');
  return { reverted: ok, reason: ok ? 'reverted' : 'failed', to: successor?.id ?? 'default', result };
}

/**
 * One heartbeat.
 *
 * Idempotent by construction: it publishes only when the live value differs
 * from what should be live, so running it twice a minute or once a day are
 * both correct, only differently prompt.
 */
/**
 * Every environment this console publishes to. Mirrors `src/domains/account.ts`;
 * `CONFIGCAT_ENVIRONMENT_IDS` (comma separated) overrides it.
 */
export const ENVIRONMENT_IDS = process.env.CONFIGCAT_ENVIRONMENT_IDS
  ? process.env.CONFIGCAT_ENVIRONMENT_IDS.split(',').map((id) => id.trim()).filter(Boolean)
  : ['08ded206-347f-4a76-8b9d-e895d64f72f2', '08ded206-3493-4e4a-8887-4352505a075f'];

/** How often the heartbeat looks for ended runs to retire. Hourly is plenty for a seven-day grace. */
const RETIRE_SWEEP_MS = 3600 * 1000;

/**
 * Retires ended runs `RETIRE_AFTER_DAYS` after their window closed.
 *
 * Read off what ConfigCat is serving rather than off the schedule, so an offer
 * published straight from its page is retired the same way a booked one is.
 * Each environment is its own publish, so one that cannot be written this hour
 * does not hold the others back; it is tried again on the next sweep.
 */
async function retireEndedRuns(store, now, environments) {
  const actions = [];
  for (const feature of Object.values(LIVEOPS_FEATURES)) {
    if (typeof feature.retiredBy !== 'function') continue;
    const targets = new Set([
      ...environments,
      ...store.entries.filter((entry) => entry.domain === feature.domain).map((entry) => entry.environmentId),
    ]);
    for (const environmentId of targets) {
      try {
        const live = await readLive(environmentId, feature.settingKey);
        const { payload, retired } = feature.retiredBy(live.payload, { now });
        if (payload === null || retired.length === 0) continue;
        const { result } = await publishPayload({
          environmentId,
          payload,
          settingKey: feature.settingKey,
          gitPath: GIT_PATHS[feature.domain],
          baselineHash: live.hash,
          note: `Retired ${retired.join(', ')}: ended more than ${RETIRE_AFTER_DAYS} days ago, and a re-run is a new ID.`,
        });
        const ok = result.status === 'written' || result.status === 'unchanged';
        for (const entry of store.entries) {
          if (entry.domain === feature.domain && entry.environmentId === environmentId && retired.includes(subjectOfEntry(entry))) {
            record(entry, 'retired', ok, ok ? `Retired from ${feature.settingKey}.` : result.message ?? 'The retirement did not go through.');
          }
        }
        actions.push({ domain: feature.domain, environmentId, action: 'retire', ok, detail: retired.join(', ') });
      } catch (error) {
        actions.push({ domain: feature.domain, environmentId, action: 'retire', ok: false, detail: error?.message ?? String(error) });
      }
    }
  }
  return actions;
}

export async function tick({ now = Date.now(), environments = ENVIRONMENT_IDS } = {}) {
  if (!gitAvailable()) {
    return {
      ok: false,
      ran: false,
      at: new Date(now).toISOString(),
      actions: [],
      problem:
        'The scheduler needs GITHUB_TOKEN to read its schedule. Nothing was published. Fix the token and the next tick catches up on its own.',
    };
  }

  const { store, sha } = await loadSchedule();
  const actions = [];
  let changed = false;

  // Close out anything whose whole span went by without ever being applied.
  // Applying it now would drop a finished promotion onto players.
  for (const entry of liveEntries(store)) {
    if (entry.state !== 'scheduled') continue;
    if (entry.endsAt === null || Date.parse(entry.endsAt) > now) continue;
    entry.state = 'missed';
    record(entry, 'missed', false, 'The whole window passed without the scheduler running, so it was closed unapplied rather than published late.');
    actions.push({ id: entry.id, domain: entry.domain, action: 'missed', ok: false });
    changed = true;
  }

  // End first, then start, so a hand-off between two adjacent windows does not
  // flash the default config in between.
  for (const entry of liveEntries(store)) {
    if (entry.state !== 'active') continue;
    if (entry.endsAt === null || Date.parse(entry.endsAt) > now) continue;
    try {
      const outcome = await endWindow(entry, store, 'reached its end time', now);
      // A revert that was deliberately skipped - no default, or a human change
      // over the top - is a finished window, not a failed one. Both are
      // recorded in the history and neither is worth retrying.
      entry.state = 'completed';
      actions.push({ id: entry.id, domain: entry.domain, action: 'end', ok: outcome.reverted, detail: outcome.reason });
    } catch (error) {
      entry.endAttempts = (entry.endAttempts ?? 0) + 1;
      const giveUp = entry.endAttempts >= MAX_ATTEMPTS;
      // Stays active so the next tick tries again: a config left up past its
      // end time is a problem that fixes itself in five minutes, whereas one
      // marked failed stays up until somebody notices.
      if (giveUp) entry.state = 'failed';
      record(
        entry,
        'end-failed',
        false,
        `${error?.message ?? String(error)}${giveUp ? ' Giving up after ' + entry.endAttempts + ' attempts.' : ' Retrying on the next tick.'}`,
      );
      actions.push({ id: entry.id, domain: entry.domain, action: 'end', ok: false, detail: error?.message });
    }
    changed = true;
  }

  // Then apply whatever should be live now, one slot at a time.
  const groups = new Map();
  for (const entry of liveEntries(store)) {
    groups.set(slotOf(entry), {
      domain: entry.domain,
      environmentId: entry.environmentId,
      subjectId: slotSubject(entry),
    });
  }

  for (const group of groups.values()) {
    const { winner, losers } = windowFor(store.entries, group.domain, group.environmentId, now, group.subjectId);

    for (const loser of losers) {
      loser.state = 'superseded';
      record(loser, 'superseded', false, `Overtaken by "${winner.label || winner.id}", which started later.`);
      actions.push({ id: loser.id, domain: loser.domain, action: 'supersede', ok: true });
      changed = true;
    }

    if (winner === null || winner.state === 'active') continue;

    const started = await startWindow(winner, new Date(now));
    actions.push({ id: winner.id, domain: winner.domain, action: 'start', ok: started.ok, detail: started.detail });
    changed = true;
  }

  // Last, so a run ended by this tick is judged on the value it just wrote.
  const lastSweep = store.lastRetireSweepAt === undefined || store.lastRetireSweepAt === null ? NaN : Date.parse(store.lastRetireSweepAt);
  if (Number.isNaN(lastSweep) || now - lastSweep >= RETIRE_SWEEP_MS) {
    const retirements = await retireEndedRuns(store, now, environments);
    store.lastRetireSweepAt = new Date(now).toISOString();
    if (retirements.some((action) => action.ok)) changed = true;
    actions.push(...retirements);
  }

  store.lastTickAt = new Date(now).toISOString();
  // The heartbeat time is worth recording even on a quiet tick: "the scheduler
  // has not run since Tuesday" is the failure this whole feature has to make
  // visible, and it is invisible if only eventful ticks are written down.
  await saveSchedule(
    store,
    sha,
    changed
      ? `Scheduler: ${actions.map((action) => `${action.action} ${action.domain}`).join(', ')}`
      : 'Scheduler heartbeat',
  );

  return { ok: true, ran: true, at: store.lastTickAt, actions, changed };
}

/* ------------------------------------------------------------- readback -- */

/**
 * The schedule as the console shows it: every window, plus which config each
 * domain falls back to and whether that fallback exists at all.
 */
export async function describeSchedule({ now = Date.now() } = {}) {
  // A missing or refused token means the scheduler cannot work, not that the
  // page should fail. The console answers with an empty schedule and the
  // reason, so the dashboard can say what is wrong instead of showing a
  // network error where the windows should be.
  if (!gitAvailable()) {
    return {
      entries: [],
      defaults: {},
      off: {},
      lastTickAt: null,
      heartbeatStale: true,
      repo: repoName(SCHEDULE_TARGET),
      branch: branchName(SCHEDULE_TARGET),
      now: new Date(now).toISOString(),
      unavailable:
        'GITHUB_TOKEN is not set in this environment, so the scheduler has nowhere to keep its schedules. Nothing is scheduled and nothing can be.',
    };
  }

  let store;
  try {
    ({ store } = await loadSchedule());
  } catch (error) {
    return {
      entries: [],
      defaults: {},
      off: {},
      lastTickAt: null,
      heartbeatStale: true,
      repo: repoName(SCHEDULE_TARGET),
      branch: branchName(SCHEDULE_TARGET),
      now: new Date(now).toISOString(),
      unavailable: error?.message ?? String(error),
    };
  }

  const defaults = {};
  await Promise.all(
    DOMAINS.map(async (domain) => {
      try {
        const value = await loadDefault(domain);
        defaults[domain] = { present: value !== null, hash: value === null ? null : hashValue(toStoredValue(value)) };
      } catch (error) {
        defaults[domain] = { present: false, hash: null, error: error?.message ?? String(error) };
      }
    }),
  );

  // The off states get the same treatment as the defaults: the calendar has
  // to be able to say "this feature cannot be scheduled yet, and here is why"
  // before anyone fills in a form.
  const off = {};
  await Promise.all(
    LIVEOPS_DOMAINS.map(async (domain) => {
      if (!needsOffState(domain)) {
        off[domain] = { present: true, hash: null, needed: false };
        return;
      }
      try {
        const value = await loadOff(domain);
        off[domain] = { present: value !== null, hash: value === null ? null : hashValue(toStoredValue(value)) };
      } catch (error) {
        off[domain] = { present: false, hash: null, error: error?.message ?? String(error) };
      }
    }),
  );

  const entries = store.entries.map((entry) => {
    const start = Date.parse(entry.startsAt);
    const end = entry.endsAt === null ? null : Date.parse(entry.endsAt);
    return {
      // The payload is deliberately not sent: a schedule list should be cheap
      // to load, and a whole hero table per row would make it anything but.
      id: entry.id,
      domain: entry.domain,
      settingKey: entry.settingKey,
      environmentId: entry.environmentId,
      environmentName: entry.environmentName,
      label: entry.label,
      note: entry.note,
      payloadHash: entry.payloadHash,
      payloadBytes: Buffer.byteLength(toStoredValue(entry.payload), 'utf8'),
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      state: entry.state,
      createdAt: entry.createdAt,
      createdBy: entry.createdBy,
      activatedAt: entry.activatedAt ?? null,
      // Non-zero means the window is being retried, which reads very
      // differently from a window that has simply not started yet.
      attempts: (entry.startAttempts ?? 0) + (entry.endAttempts ?? 0),
      history: entry.history ?? [],
      // Present only on windows booked from the live ops calendar. Its absence
      // is what tells every reader this is an ordinary config window.
      liveops: entry.liveops ? describeEvent(entry) : null,
      phase: entry.liveops ? phaseOf(entry, now) : null,
      startsInMs: start - now,
      endsInMs: end === null ? null : end - now,
    };
  });

  const lastTick = store.lastTickAt ?? null;
  const staleMs = lastTick === null ? null : now - Date.parse(lastTick);

  return {
    entries,
    defaults,
    off,
    lastTickAt: lastTick,
    // Anything past an hour means the heartbeat is not arriving, and a
    // schedule nobody is running is worse than no schedule at all.
    heartbeatStale: staleMs === null || staleMs > 3600000,
    repo: repoName(SCHEDULE_TARGET),
    // Worth surfacing: "why is my schedule not in main" is a question this
    // answers before anybody has to go looking for it.
    branch: branchName(SCHEDULE_TARGET),
    now: new Date(now).toISOString(),
  };
}

/**
 * A booking's live ops block as the calendar reads it. The text and art an
 * offer was booked with ride along, because the list is sent without payloads
 * and the form has to open a booked offer on what it will publish.
 */
function describeEvent(entry) {
  const subjectId = subjectOfEntry(entry);
  const feature = featureFor(entry.domain);
  const presentation =
    subjectId === null || typeof feature?.presentationOf !== 'function'
      ? null
      : feature.presentationOf(entry.payload, subjectId);
  return { ...entry.liveops, subjectId, baseId: subjectId === null ? null : baseOf(subjectId), presentation };
}

/** The full payload of one window, for the diff view. */
export async function readEntryPayload(id) {
  const { store } = await loadSchedule();
  const entry = store.entries.find((candidate) => candidate.id === id);
  return entry === undefined ? null : entry.payload;
}

/** What one window would change relative to the value live right now. */
export async function previewEntry(id) {
  const { store } = await loadSchedule();
  const entry = store.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return null;

  const values = await getValues(CONFIG_ID, entry.environmentId);
  const live = values.settings.find((setting) => setting.key === entry.settingKey);
  const changes = diffJson(live?.json ?? null, entry.payload);

  return {
    id: entry.id,
    settingKey: entry.settingKey,
    summary: summarizeDiff(changes),
    changes: changes.slice(0, 200).map((change) => ({ ...change, description: describeChange(change) })),
    truncated: Math.max(0, changes.length - 200),
  };
}
