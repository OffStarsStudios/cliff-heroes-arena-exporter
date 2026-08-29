import { SheetSelect } from './SheetSelect';
import type { HeroSheetSelection } from '../lib/sheetSelect';

interface HeroSheetPickerProps {
  sheetNames: string[];
  selection: HeroSheetSelection;
  onChange: (selection: HeroSheetSelection) => void;
}

export function HeroSheetPicker({ sheetNames, selection, onChange }: HeroSheetPickerProps) {
  return (
    <>
      <p className="step__note">
        Hero stats are joined from four tabs. The exporter guessed these from the tab names - change
        any that look wrong.
      </p>
      <div className="grid-fields">
        <SheetSelect
          label="Heroes lookup"
          note="Maps each hero name to its hero ID."
          value={selection.heroes}
          options={sheetNames}
          onChange={(heroes) => onChange({ ...selection, heroes })}
        />
        <SheetSelect
          label="Base stats"
          note="Level 1 health, speed and grip per hero, plus rarity."
          value={selection.baseStats}
          options={sheetNames}
          onChange={(baseStats) => onChange({ ...selection, baseStats })}
        />
        <SheetSelect
          label="Stats level factors"
          note="Per-level multipliers applied on top of the base stats."
          value={selection.levelFactors}
          options={sheetNames}
          onChange={(levelFactors) => onChange({ ...selection, levelFactors })}
        />
        <SheetSelect
          label="Power settings"
          note="Cooldown and the special parameters each hero's power uses."
          value={selection.powerSettings}
          options={sheetNames}
          onChange={(powerSettings) => onChange({ ...selection, powerSettings })}
        />
      </div>
    </>
  );
}
