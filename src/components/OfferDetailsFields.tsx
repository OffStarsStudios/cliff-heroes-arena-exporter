import { useId, useState } from 'react';
import { Icon } from './Icon';
import { checkPresentation, type Presentation } from '../lib/liveops';
import { ART_FIELDS, artChoices, artNamed, type ArtField, type ArtSlot } from '../lib/offerArt';

interface OfferDetailsFieldsProps {
  value: Presentation;
  onChange: (next: Presentation) => void;
  disabled?: boolean;
  /**
   * The offer list's own default art, where it is known. An empty pick falls
   * back to it, and a default that is itself empty is a picture the game will
   * not draw - worth saying under the field rather than finding out in the game.
   */
  defaults?: Partial<Record<ArtField, string>>;
  /** Show every field's problem now, not only once it has been visited - after a save was refused, say. */
  showAllErrors?: boolean;
}

const DEFAULT_KEYS: Record<ArtField, string> = {
  BackgroundArt: 'DefaultBackgroundArt',
  TopBarArt: 'DefaultTopBarArt',
  RewardArt: 'DefaultRewardArt',
  ButtonArt: 'DefaultButtonArt',
};

/** The offer list's default art, read off a live `rollingOfferSettings` payload. */
export function artDefaultsOf(payload: unknown): Partial<Record<ArtField, string>> {
  if (payload === null || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  return Object.fromEntries(
    ART_FIELDS.map(({ field }) => [field, typeof record[DEFAULT_KEYS[field]] === 'string' ? record[DEFAULT_KEYS[field]] : '']),
  ) as Partial<Record<ArtField, string>>;
}

/**
 * What players see of a rolling offer: its text, and the four pictures it is
 * drawn with.
 *
 * One group, split in two - the words, then the art - because those are the
 * two things somebody checks separately. Every picture is picked from the art
 * the game actually has, so a typo cannot ship an offer drawn on nothing, and
 * the picture's address is shown under the pick so it can be matched to the
 * build. A name the library does not know (an offer published before it was
 * synced) is kept and flagged, never silently replaced.
 */
export function OfferDetailsFields({ value, onChange, disabled = false, defaults, showAllErrors = false }: OfferDetailsFieldsProps) {
  const ids = useId();
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const visit = (field: string) => setVisited((current) => (current.has(field) ? current : new Set(current).add(field)));
  const set = (patch: Partial<Presentation>) => onChange({ ...value, ...patch });

  const problems = checkPresentation(value);
  const nameError =
    (showAllErrors || visited.has('DisplayName')) && value.DisplayName.trim() === '' ? problems[0] ?? null : null;
  const textError = problems.find((problem) => problem.startsWith('The completion text')) ?? null;

  return (
    <fieldset className="formgroup" disabled={disabled}>
      <legend className="formgroup__legend">What players see</legend>

      <div className="grid-2">
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-name`}>
            Display name{' '}
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id={`${ids}-name`}
            type="text"
            value={value.DisplayName}
            placeholder="SPACE BINGE"
            required
            aria-invalid={nameError !== null}
            aria-describedby={`${ids}-name-note`}
            onChange={(event) => set({ DisplayName: event.target.value })}
            onBlur={() => visit('DisplayName')}
          />
          {nameError !== null ? (
            <span id={`${ids}-name-note`} className="field__error" role="alert">
              <Icon name="alert" size={12} />
              {nameError}
            </span>
          ) : (
            <span id={`${ids}-name-note`} className="field__note">
              Across the top of the offer page and on its menu button.
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${ids}-subtitle`}>
            Subtitle
          </label>
          <input
            id={`${ids}-subtitle`}
            type="text"
            value={value.Subtitle}
            placeholder="Claim each step to unlock the next."
            aria-describedby={`${ids}-subtitle-note`}
            onChange={(event) => set({ Subtitle: event.target.value })}
          />
          <span id={`${ids}-subtitle-note`} className="field__note">
            The line under the title.
          </span>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${ids}-completion`}>
          Completion text
        </label>
        <input
          id={`${ids}-completion`}
          type="text"
          value={value.CompletionText}
          placeholder="COMPLETE ALL STEPS TO UNLOCK {0}!"
          aria-invalid={textError !== null}
          aria-describedby={`${ids}-completion-note`}
          onChange={(event) => set({ CompletionText: event.target.value })}
        />
        {textError !== null ? (
          <span id={`${ids}-completion-note`} className="field__error" role="alert">
            <Icon name="alert" size={12} />
            {textError}
          </span>
        ) : (
          <span id={`${ids}-completion-note`} className="field__note">
            Along the bottom of the page. <span className="mono">{'{0}'}</span> becomes the prize name. Empty shows no
            line.
          </span>
        )}
      </div>

      <p className="formgroup__caption">Art</p>
      <div className="artgrid">
        {ART_FIELDS.map(({ field, slot, label, empty }) => (
          <ArtSelect
            key={field}
            id={`${ids}-${field}`}
            slot={slot}
            label={label}
            emptyLabel={empty}
            fallback={field === 'RewardArt' ? null : (defaults?.[field] ?? null)}
            value={value[field]}
            onChange={(name) => set({ [field]: name } as Partial<Presentation>)}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface ArtSelectProps {
  id: string;
  slot: ArtSlot;
  label: string;
  emptyLabel: string;
  /** The list default an empty pick falls back to: a name, '' for none, or null when unknown. */
  fallback: string | null;
  value: string;
  onChange: (name: string) => void;
}

/** One picture, picked from the game's own art, the ones made for this slot first. */
function ArtSelect({ id, slot, label, emptyLabel, fallback, value, onChange }: ArtSelectProps) {
  const { suggested, others } = artChoices(slot);
  const art = value === '' ? null : artNamed(value);
  const unknown = value !== '' && art === null;

  const note =
    value !== ''
      ? art?.address ?? null
      : slot === 'reward'
        ? 'Falls back to the completion reward’s picture.'
        : fallback === null
          ? 'Uses the offer list’s default.'
          : fallback === ''
            ? 'The offer list has no default, so nothing is drawn here.'
            : `Uses the default, ${fallback}.`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-invalid={unknown}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {unknown && <option value={value}>{value} (not in the art library)</option>}
        {suggested.length > 0 && (
          <optgroup label={`Made for the ${label.toLowerCase()}`}>
            {suggested.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={suggested.length > 0 ? 'Other offer art' : 'Offer art'}>
            {others.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {unknown ? (
        <span id={`${id}-note`} className="field__error">
          <Icon name="alert" size={12} />
          Not in the art library, so the game may draw nothing.
        </span>
      ) : (
        <span
          id={`${id}-note`}
          className={value !== '' ? 'field__note mono field__note--clip' : fallback === '' ? 'field__note field__note--warn' : 'field__note'}
          title={art?.file ?? undefined}
        >
          {note}
        </span>
      )}
    </div>
  );
}
