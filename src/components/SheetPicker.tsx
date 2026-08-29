import { SheetSelect } from './SheetSelect';
import type { SheetSelection } from '../lib/sheetSelect';

interface SheetPickerProps {
  sheetNames: string[];
  selection: SheetSelection;
  onChange: (selection: SheetSelection) => void;
}

export function SheetPicker({ sheetNames, selection, onChange }: SheetPickerProps) {
  return (
    <>
      <p className="step__note">
        The exporter guessed these from the tab names. Change any that look wrong - the preview and
        the counts below update as you go.
      </p>
      <div className="grid-fields">
        <SheetSelect
          label="Progression"
          note="One row per trophy milestone, with its arena and reward columns."
          value={selection.progression}
          options={sheetNames}
          onChange={(progression) => onChange({ ...selection, progression })}
        />
        <SheetSelect
          label="Arenas lookup"
          note="Maps each arena name to its ArenaID."
          value={selection.arenas}
          options={sheetNames}
          onChange={(arenas) => onChange({ ...selection, arenas })}
        />
        <SheetSelect
          label="Rewards lookup"
          note="Maps each reward name to its RewardID."
          value={selection.rewards}
          options={sheetNames}
          onChange={(rewards) => onChange({ ...selection, rewards })}
        />
      </div>
    </>
  );
}
