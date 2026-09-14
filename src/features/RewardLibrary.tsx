import { useId, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { REWARDS, type Reward, type RewardFamily } from '../lib/rewards';

/**
 * Every reward the game can hand over, as the name a sheet calls it by and the
 * ID the game answers to.
 *
 * This is the vocabulary every config shares, and the reason it has a page of
 * its own is that it is not knowable from any config. Rewards are not authored
 * anywhere in the game: `RewardSettings.Init` derives them at runtime from the
 * heroes, skins, arenas, currencies and lootboxes that exist. So a designer
 * wanting to know what they are allowed to give away previously had to read
 * another sheet's Rewards tab and hope it was complete - and none of them were,
 * because each listed only what it happened to use.
 *
 * The list is generated straight from the game by `npm run sync:rewards`, and
 * every exporter checks the IDs it resolves against it. What is on this page is
 * exactly what will publish.
 */

const FAMILY_ORDER: RewardFamily[] = ['currency', 'hero', 'skin', 'arena', 'lootbox'];

const FAMILY_LABELS: Record<RewardFamily, string> = {
  currency: 'Currencies',
  hero: 'Heroes',
  skin: 'Skins',
  arena: 'Arenas',
  lootbox: 'Lootboxes',
};

/**
 * What each family is, in the one line worth saying about it. Aimed at the
 * question a designer actually has - "can I give this away, and what happens
 * if I do" - rather than restating the name.
 */
const FAMILY_NOTES: Record<RewardFamily, string> = {
  currency: 'Paid straight into the player’s balance. An amount is always worth setting.',
  hero: 'Unlocks the hero. A player who already owns them is handed cards instead.',
  skin: 'Unlocks that hero’s skin. Default skins are not rewards - they are already worn.',
  arena: 'Opens the arena. These are normally handed out by the trophy road rather than sold.',
  lootbox: 'Grants boxes to open. The amount is how many.',
};

export function RewardLibrary() {
  const [query, setQuery] = useState('');
  const searchId = useId();

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return REWARDS;
    // The ID is searched as well as the name: a reward is often looked up here
    // because it turned up as an ID in a payload or an error message.
    return REWARDS.filter(
      (reward) => reward.name.toLowerCase().includes(needle) || reward.id.toLowerCase().includes(needle),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const out: { family: RewardFamily; rewards: Reward[] }[] = [];
    for (const family of FAMILY_ORDER) {
      const rewards = matches.filter((reward) => reward.family === family);
      if (rewards.length > 0) out.push({ family, rewards });
    }
    return out;
  }, [matches]);

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className="page__badge page__badge--shop" aria-hidden="true">
            <Icon name="medal" size={17} />
          </span>
          Reward library
        </h1>
        <p className="page__lead">
          Every reward the game can hand over. A sheet names a reward by the name in the left column;
          the exporter resolves it to the ID on the right through that sheet&rsquo;s Rewards tab, and
          refuses anything this list does not have. IDs are never built from names.
        </p>
      </header>

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">Where this comes from</h2>
        </header>
        <div className="card__body stack-sm">
          <p className="card__note">
            Rewards are not authored anywhere in the game. The client derives them when it starts,
            one per hero, per non-default skin, per arena, per currency and per lootbox &mdash; so the
            only list that can be trusted is one derived the same way. This one is, by{' '}
            <code>npm run sync:rewards</code> reading the game&rsquo;s own assets. Re-run it after a
            build gains a hero or a skin; without <code>--write</code> it fails when the checked-in
            list has drifted, so it works as a gate in CI.
          </p>
        </div>
      </section>

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">The rewards</h2>
          <span className="card__hint">
            {matches.length === REWARDS.length
              ? `${REWARDS.length} rewards`
              : `${matches.length} of ${REWARDS.length} shown`}
          </span>
        </header>
        <div className="card__body stack-sm">
          <div className="field" style={{ maxWidth: 360 }}>
            <label className="field__label" htmlFor={searchId}>
              Filter
            </label>
            <input
              id={searchId}
              type="text"
              placeholder="Part of a name or an ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {grouped.length === 0 ? (
            <p className="empty">
              Nothing matches &ldquo;{query}&rdquo;. A sheet naming that would be refused on export.
            </p>
          ) : (
            grouped.map(({ family, rewards }) => (
              <div key={family} className="stack-sm">
                <h3 className="step__section-title">
                  {FAMILY_LABELS[family]} <span className="card__hint">{rewards.length}</span>
                </h3>
                <p className="card__note">{FAMILY_NOTES[family]}</p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Name in a sheet</th>
                        <th scope="col">Reward ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rewards.map((reward) => (
                        <tr key={reward.id}>
                          <td>{reward.name}</td>
                          <td className="mono">{reward.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
