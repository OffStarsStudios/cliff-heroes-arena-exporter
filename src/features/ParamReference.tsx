import { useId, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { POWER_PARAM_NAMES } from '../lib/powerParams';

/**
 * The parameter names the power settings tab is allowed to use. Kept on its own
 * page so it can be linked to from a failing hero export.
 */
export function ParamReference() {
  const [query, setQuery] = useState('');
  const searchId = useId();

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return POWER_PARAM_NAMES;
    return POWER_PARAM_NAMES.filter((name) => name.toLowerCase().includes(needle));
  }, [query]);

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className="page__badge page__badge--heroes" aria-hidden="true">
            <Icon name="book" size={17} />
          </span>
          Power parameters
        </h1>
        <p className="page__lead">
          Special parameter names in the power settings tab are checked against this list. Case and
          spacing do not matter; anything not on the list is reported as an error instead of being
          exported.
        </p>
      </header>

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">Accepted names</h2>
          <span className="card__hint">
            {matches.length} of {POWER_PARAM_NAMES.length} shown
          </span>
        </header>
        <div className="card__body stack-sm">
          <div className="field" style={{ maxWidth: 320 }}>
            <label className="field__label" htmlFor={searchId}>
              Filter
            </label>
            <input
              id={searchId}
              type="text"
              placeholder="Type part of a parameter name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {matches.length === 0 ? (
            <p className="empty">
              No parameter matches &ldquo;{query}&rdquo;. That name would be rejected on export.
            </p>
          ) : (
            <div className="param-list" style={{ maxHeight: 'none' }}>
              {matches.map((name) => (
                <span key={name} className="param">
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
