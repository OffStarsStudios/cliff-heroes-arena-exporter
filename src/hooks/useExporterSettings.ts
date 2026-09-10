import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * The value of a page's own fields, and where it came from.
 *
 * Three sources, in order of authority: what this browser last had, then the
 * live payload, then the definition's own starting point. Seeding from live
 * matters more than it looks - it means opening the page shows the season the
 * game is actually running, so publishing without touching the panel
 * republishes that season rather than silently replacing it with a default.
 *
 * Lives in a hook rather than on the page because two surfaces now collect the
 * same fields: the config's page, and the live ops booking form.
 */
export function useExporterSettings<TSettings>({
  domain,
  controls,
  environmentId,
  persist,
}: UseExporterSettingsInput<TSettings>): [TSettings, (next: TSettings) => void] {
  const stored = controls === undefined ? null : controls.revive(recallSettings(domain));
  const [value, setValue] = useState<TSettings>(
    () => stored ?? (controls === undefined ? (undefined as TSettings) : controls.initial),
  );
  // Seeding is a one-shot: once somebody has typed in the panel, a slow live
  // response must not reach back and overwrite what they typed.
  const seeded = useRef(false);

  useEffect(() => {
    if (controls === undefined || seeded.current) return;
    // Something stored that still fits wins. Something stored that no longer
    // does counts as nothing, and falls through to the live season below.
    if (stored !== null) {
      seeded.current = true;
      return;
    }
    let cancelled = false;
    fetchLiveConfig(domain, environmentId)
      .then((view) => {
        if (cancelled || seeded.current) return;
        const fromLive = controls.fromLive(view.live.json);
        seeded.current = true;
        if (fromLive !== null) setValue(fromLive);
      })
      // A page whose fields have to be filled in by hand is a far better
      // outcome than one that will not load because ConfigCat is unreachable.
      .catch(() => {
        seeded.current = true;
      });
    return () => {
      cancelled = true;
    };
    // `stored` is read once, on the first run; `seeded` closes the effect after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, domain, environmentId]);

  const update = useCallback(
    (next: TSettings) => {
      seeded.current = true;
      setValue(next);
      if (persist) rememberSettings(domain, next);
    },
    [domain, persist],
  );

  return [value, update];
}
