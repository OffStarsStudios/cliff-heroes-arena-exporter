import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExporterControls } from '../exporters/types';
import type { ExporterDomain } from '../domains/types';
import { recallSettings, rememberSettings } from '../lib/exporterSettings';
import { fetchLiveConfig } from '../lib/liveConfig';

interface UseExporterSettingsInput<TSettings> {
  domain: ExporterDomain;
  /** Absent for a config the sheet fully describes; the value is then `undefined`. */
  controls: ExporterControls<TSettings> | undefined;
  environmentId: string;
  /**
   * Whether edits are written back to this browser's memory for the config.
   *
   * True on the config's own page, where the panel is the place those fields
   * are decided. False when booking a live ops event: an event's header is
   * next season's, and quietly leaving it behind for whoever opens the page to
   * publish would be a worse surprise than typing it twice.
   */
  persist: boolean;
}

/** The live payload as last read, and which environment it was read from. */
interface LiveRead {
  environmentId: string;
  /** Null when the read failed: nothing is known about what is live. */
  payload: unknown | null;
  ok: boolean;
}

/**
 * The value of a page's own fields, and where it came from.
 *
 * Three sources, in order of authority: what this browser last had, then the
 * live payload, then the definition's own starting point. Seeding from live
 * matters more than it looks - it means opening the page shows the season the
 * game is actually running, so publishing without touching the panel
 * republishes that season rather than silently replacing it with a default.
 *
 * Some fields are never the page's to decide at all, and those follow live
 * whatever was stored: see `followLive`. They are re-read whenever the
 * environment changes and whenever `refreshLive` is called, so what the page
 * builds is built on what is live now rather than on what this browser saw
 * last week.
 *
 * Lives in a hook rather than on the page because two surfaces now collect the
 * same fields: the config's page, and the live ops booking form.
 */
export function useExporterSettings<TSettings>({
  domain,
  controls,
  environmentId,
  persist,
}: UseExporterSettingsInput<TSettings>): [TSettings, (next: TSettings) => void, () => void] {
  const stored = controls === undefined ? null : controls.revive(recallSettings(domain));
  const [value, setValue] = useState<TSettings>(
    () => stored ?? (controls === undefined ? (undefined as TSettings) : controls.initial),
  );
  const [live, setLive] = useState<LiveRead | null>(null);
  const [readId, setReadId] = useState(0);
  const refreshLive = useCallback(() => setReadId((id) => id + 1), []);
  // Seeding is a one-shot: once somebody has typed in the panel, a slow live
  // response must not reach back and overwrite what they typed.
  const seeded = useRef(stored !== null);

  useEffect(() => {
    if (controls === undefined) return;
    let cancelled = false;
    fetchLiveConfig(domain, environmentId)
      .then((view) => {
        if (cancelled) return;
        setLive({ environmentId, payload: view.live.json, ok: true });
        if (seeded.current) return;
        // Something stored that still fits wins. Something stored that no
        // longer does counts as nothing, and falls through to live.
        seeded.current = true;
        const fromLive = controls.fromLive(view.live.json);
        if (fromLive !== null) setValue(fromLive);
      })
      // A page whose fields have to be filled in by hand is a far better
      // outcome than one that will not load because ConfigCat is unreachable.
      .catch(() => {
        if (cancelled) return;
        seeded.current = true;
        setLive({ environmentId, payload: null, ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, [controls, domain, environmentId, readId]);

  const update = useCallback(
    (next: TSettings) => {
      seeded.current = true;
      setValue(next);
      if (persist) rememberSettings(domain, next);
    },
    [domain, persist],
  );

  // A read of another environment says nothing about this one, so until the
  // right one lands the live-owned fields are unknown rather than stale.
  const current = live !== null && live.environmentId === environmentId && live.ok ? { payload: live.payload } : null;
  const followed = useMemo(
    () => (controls?.followLive === undefined ? value : controls.followLive(value, current)),
    // `current` is rebuilt each render; what it stands for is `live` and the environment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controls, value, live, environmentId],
  );

  return [followed, update, refreshLive];
}
