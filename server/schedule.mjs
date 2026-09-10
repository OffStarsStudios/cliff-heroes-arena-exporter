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
  phaseOf,
  windowForEvent,
} from './liveops.mjs';
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
  return { version: 1, updatedAt: null, entries: [] };
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

function record(entry, action, ok, message) {
  entry.history = [
    ...(entry.history ?? []),
    { at: new Date().toISOString(), action, ok, message: message ?? null },
  ].slice(-20);
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
  if (end !== null && !Number.isNaN(end) && !(liveOps ? hasOff : hasDefault)) {
    problems.push(
      liveOps
        ? 'This feature has no off state recorded, so there would be nothing to publish when the event ends and the feature would stay in the game after it was over. Record the off state first.'
        : 'This config has no default recorded, so there is nothing to fall back to when the window ends. Set the default first - the current live value is usually the right one.',
    );
  }

  const clashing = entries.filter(
    (entry) =>
      entry.id !== candidate.id &&
      entry.domain === candidate.domain &&
      entry.environmentId === candidate.environmentId &&
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

export async function createEntry(input) {
  const { store, sha } = await loadSchedule();
  const liveops = input.liveops ?? null;
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
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy ?? 'back office',
    history: [],
  };

  const problems = [
    ...checkEntry(entry, { entries: store.entries, hasDefault, hasOff }),
    ...(liveops === null ? [] : checkEvent(liveops, { startsAt: entry.startsAt, endsAt: entry.endsAt })),
  ];
  if (problems.length > 0) return { ok: false, problems };

  record(entry, 'created', true, `Scheduled for ${entry.startsAt}.`);
  store.entries = [...store.entries, entry];
  await saveSchedule(store, sha, `Schedule ${entry.domain}: ${entry.label || entry.id}`);
  return { ok: true, entry };
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
 * doing anything yet, so all of it is editable. A live one is already serving
 * its payload: moving its start or swapping its config underneath the game is
 * not an edit, it is a publish, so those are refused and the end time, the name
 * and the note are not. Anything omitted keeps the value it had, which is what
 * lets the form send only what somebody touched.
 */
export async function updateEntry(input) {
  const { store, sha } = await loadSchedule();
  const current = store.entries.find((entry) => entry.id === input.id);
  if (current === undefined) return { ok: false, problems: [`No schedule with id "${input.id}".`] };
  if (isTerminal(current)) {
    return { ok: false, problems: [`That window is already ${current.state} and cannot be edited.`] };
  }

  const started = current.state === 'active';
  const liveops =
    current.liveops === null || current.liveops === undefined
      ? null
      : { ...current.liveops, ...(input.liveops ?? {}) };

  const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
  const window =
    liveops === null
      ? { startsAt: input.startsAt ?? current.startsAt, endsAt }
      : windowForEvent(liveops, endsAt ?? null);

  const payload = input.payload === undefined ? current.payload : input.payload;

  if (started) {
    const problems = [];
    if (window.startsAt !== current.startsAt) {
      problems.push(
        'This event is already live, so its start cannot be moved. End it and book a new one if it should start again later.',
      );
    }
    if (input.payload !== undefined && hashValue(toStoredValue(payload)) !== current.payloadHash) {
      problems.push(
        'This event is already live, so its config cannot be swapped from here. Publish the change on the config page, or end the event and book it again.',
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

  const hasDefault = (await loadDefault(next.domain)) !== null;
  const hasOff = liveops === null ? false : (await loadOff(next.domain)) !== null;
  const problems = [
    ...checkEntry(next, { entries: store.entries, hasDefault, hasOff, started }),
    ...(liveops === null ? [] : checkEvent(liveops, { startsAt: next.startsAt, endsAt: next.endsAt })),
  ];
  if (problems.length > 0) return { ok: false, problems };

  record(next, 'edited', true, `Rescheduled for ${next.startsAt}.`);
  store.entries = store.entries.map((entry) => (entry.id === next.id ? next : entry));
  await saveSchedule(store, sha, `Edit ${next.domain} schedule: ${next.label || next.id}`);
  return { ok: true, entry: next };
}

export async function cancelEntry(id, reason) {
  const { store, sha } = await loadSchedule();
  const entry = store.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return { ok: false, problems: [`No schedule with id "${id}".`] };
  if (isTerminal(entry)) return { ok: false, problems: [`That window is already ${entry.state}.`] };

  // Cancelling a window that is currently live has to put the config back, or
  // "cancel" would mean "leave the promotion up forever".
  let revert = null;
  if (entry.state === 'active') {
    revert = await endWindow(entry, store, 'cancelled');
  }

  entry.state = 'cancelled';
  record(entry, 'cancelled', true, reason ?? 'Cancelled from the back office.');
  await saveSchedule(store, sha, `Cancel schedule ${entry.domain}: ${entry.label || entry.id}`);
  return { ok: true, entry, revert };
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
 */
export function windowFor(entries, domain, environmentId, now) {
  const applicable = entries
    .filter(
      (entry) =>
        entry.domain === domain &&
        entry.environmentId === environmentId &&
        !isTerminal(entry) &&
        Date.parse(entry.startsAt) <= now &&
        (entry.endsAt === null || Date.parse(entry.endsAt) > now),
    )
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { winner: applicable[0] ?? null, losers: applicable.slice(1) };
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
 * staged in the ConfigCat dashboard. The one difference from a person pressing
 * the button is that there is no baseline hash - the window was planned days
 * ago and the live value is expected to have moved since.
 */
async function publishPayload({ environmentId, payload, note, gitPath, settingKey }) {
  const response = await applyPublish({
    configId: CONFIG_ID,
    environmentId,
    productId: PRODUCT_ID,
    entries: [{ settingKey, payload, gitPath, note }],
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
 * Takes a window down.
 *
 * The target is the next window that should be live, if one is, and otherwise
 * the domain's default. Crucially it first checks that the live value is still
 * what this window put there: a human fix published over a scheduled promotion
 * must not be undone by the promotion expiring.
 */
async function endWindow(entry, store, becauseOf) {
  const now = Date.now();
  const successor = windowFor(
    store.entries.filter((candidate) => candidate.id !== entry.id),
    entry.domain,
    entry.environmentId,
    now,
  ).winner;

  // A core config goes back to its last known-good version. A live ops
  // feature has no previous version to want - the season is over - so it goes
  // back to the payload that means "not running". Getting this wrong would
  // restart last season the moment this one ended.
  const liveOps = isLiveOpsEntry(entry);
  const fallback =
    successor !== null
      ? successor.payload
      : liveOps
        ? await loadOff(entry.domain)
        : await loadDefault(entry.domain);

  if (fallback === null || fallback === undefined) {
    record(
      entry,
      'end-skipped',
      false,
      liveOps
        ? 'The event ended but no off state is recorded, so the feature was left live rather than removed from a running game. Record the off state for this feature.'
        : 'The window ended but no default config is recorded, so the config was left as it is rather than removed from a running game. Record a default for this config.',
    );
    return { reverted: false, reason: liveOps ? 'no-off-state' : 'no-default' };
  }

  // Is the live value still ours to take back?
  const values = await getValues(CONFIG_ID, entry.environmentId);
  const live = values.settings.find((setting) => setting.key === entry.settingKey);
  const liveHash = hashValue(typeof live?.value === 'string' ? live.value : null);
  if (liveHash !== entry.payloadHash) {
    record(
      entry,
      'end-skipped',
      false,
      'The live value is no longer what this window published, so somebody changed it by hand. Leaving their change in place rather than reverting it.',
    );
    return { reverted: false, reason: 'changed-by-hand' };
  }

  const target =
    successor !== null
      ? `the "${successor.label || successor.id}" window`
      : liveOps
        ? 'the off state, so the feature is no longer in the game'
        : 'the default config';
  const { result } = await publishPayload({
    entry,
    environmentId: entry.environmentId,
    payload: fallback,
    settingKey: entry.settingKey,
    gitPath: entry.gitPath,
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
export async function tick({ now = Date.now() } = {}) {
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
      const outcome = await endWindow(entry, store, 'reached its end time');
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

  // Then apply whatever should be live now.
  const groups = new Map();
  for (const entry of liveEntries(store)) {
    groups.set(`${entry.domain} ${entry.environmentId}`, {
      domain: entry.domain,
      environmentId: entry.environmentId,
    });
  }

  for (const group of groups.values()) {
    const { winner, losers } = windowFor(store.entries, group.domain, group.environmentId, now);

    for (const loser of losers) {
      loser.state = 'superseded';
      record(loser, 'superseded', false, `Overtaken by "${winner.label || winner.id}", which started later.`);
      actions.push({ id: loser.id, domain: loser.domain, action: 'supersede', ok: true });
      changed = true;
    }

    if (winner === null || winner.state === 'active') continue;

    try {
      const { result } = await publishPayload({
        entry: winner,
        environmentId: winner.environmentId,
        payload: winner.payload,
        settingKey: winner.settingKey,
        gitPath: winner.gitPath,
        note:
          `Scheduled window "${winner.label || winner.id}" started` +
          (winner.endsAt === null ? '.' : `, ending ${winner.endsAt}.`) +
          (winner.note === null || winner.note === undefined ? '' : ` ${winner.note}`),
      });

      const ok = result.status === 'written' || result.status === 'unchanged';
      if (ok) {
        winner.state = 'active';
        winner.activatedAt = new Date(now).toISOString();
        record(winner, 'started', true, `Published to ${winner.environmentName ?? winner.environmentId}.`);
      } else {
        winner.startAttempts = (winner.startAttempts ?? 0) + 1;
        const giveUp = winner.startAttempts >= MAX_ATTEMPTS;
        if (giveUp) winner.state = 'failed';
        record(
          winner,
          'start-failed',
          false,
          `${result.message ?? 'The publish failed.'}${giveUp ? ' Giving up after ' + winner.startAttempts + ' attempts.' : ' Retrying on the next tick.'}`,
        );
      }
      actions.push({ id: winner.id, domain: winner.domain, action: 'start', ok, detail: result.status });
    } catch (error) {
      winner.startAttempts = (winner.startAttempts ?? 0) + 1;
      const giveUp = winner.startAttempts >= MAX_ATTEMPTS;
      // Left scheduled, so a ConfigCat blip or a colleague's open change
      // request delays the window by one tick rather than cancelling it.
      if (giveUp) winner.state = 'failed';
      record(
        winner,
        'start-failed',
        false,
        `${error?.message ?? String(error)}${giveUp ? ' Giving up after ' + winner.startAttempts + ' attempts.' : ' Retrying on the next tick.'}`,
      );
      actions.push({ id: winner.id, domain: winner.domain, action: 'start', ok: false, detail: error?.message });
    }
    changed = true;
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
      liveops: entry.liveops ?? null,
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
