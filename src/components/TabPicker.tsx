import { SheetSelect } from './SheetSelect';
import type { TabSelection, TabSpec } from '../exporters/types';

interface TabPickerProps<S extends TabSelection> {
  hint: string;
  tabs: TabSpec<S>[];
  sheetNames: string[];
  selection: S;
  onChange: (selection: S) => void;
}

/** One dropdown per logical tab, each saying what the tab has to contain. */
export function TabPicker<S extends TabSelection>({
  hint,
  tabs,
  sheetNames,
  selection,
  onChange,
}: TabPickerProps<S>) {
  return (
    <>
      <p className="step__note">
        {hint} The exporter guessed these from the tab names - change any that look wrong.
      </p>
      <div className="grid-fields">
        {tabs.map((tab) => (
          <SheetSelect
            key={tab.key}
            label={tab.label}
            note={tab.note}
            value={selection[tab.key]}
            options={sheetNames}
            onChange={(value) => onChange({ ...selection, [tab.key]: value })}
          />
        ))}
      </div>
    </>
  );
}
