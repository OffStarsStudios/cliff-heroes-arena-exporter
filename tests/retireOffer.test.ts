import { describe, expect, it } from 'vitest';
// @ts-expect-error - the server has no build step and ships as plain ESM.
import { isListPayload, withoutEntry } from '../server/liveops.mjs';
import liveJson from '../config/rollingOffer.json';

/**
 * Ending a rolling offer's event.
 *
 * A battle pass has an off state - a whole payload meaning "no season is
 * running" - and ending its event publishes that. A rolling offer has neither
 * and could not: its payload *is* every offer, so ending one event means
 * publishing the live schedule without that one entry. That depends on what
 * else is live at the moment it ends, so it is computed then rather than
 * recorded when the event was booked.
 *
 * The stakes are why this is tested rather than trusted: an offer's ID is what
 * every player's progress is filed under, so removing the wrong one drops those
 * players' records on their next launch.
 */

const live = JSON.stringify(liveJson);

describe('a feature whose payload is a list', () => {
  it('knows which domains those are', () => {
    expect(isListPayload('rollingOffer')).toBe(true);
    // The pass has a real off state, so it must not take this path.
    expect(isListPayload('battlePass')).toBe(false);
    expect(isListPayload('shop')).toBe(false);
  });
});

describe('removing one offer from what is live', () => {
  it('drops the offer the event owns and keeps the rest', () => {
    const result = withoutEntry('rollingOffer', live, 'offer.roll.1');
    expect(result.reason).toBe('removed');
    expect(result.payload.Offers.map((offer: { OfferID: string }) => offer.OfferID)).toEqual([
      'offer.roll.2',
    ]);
  });

  it('leaves everything else in the payload untouched', () => {
    const result = withoutEntry('rollingOffer', live, 'offer.roll.1');
    expect(result.payload.DefaultBackgroundArt).toBe(liveJson.DefaultBackgroundArt);
    expect(result.payload.Offers[0]).toEqual(liveJson.Offers[1]);
  });

  it('reads the live value whether it arrives as a string or an object', () => {
    const fromObject = withoutEntry('rollingOffer', liveJson, 'offer.roll.2');
    expect(fromObject.payload.Offers.map((offer: { OfferID: string }) => offer.OfferID)).toEqual([
      'offer.roll.1',
    ]);
  });

  it('refuses to empty the list', () => {
    // The client treats a schedule that resolves no offers as a broken payload
    // and keeps what it has, so publishing one would leave the offer live by
    // accident - worse than leaving it alone and saying so.
    const only = JSON.stringify({ ...liveJson, Offers: [liveJson.Offers[0]] });
    const result = withoutEntry('rollingOffer', only, 'offer.roll.1');
    expect(result.payload).toBeNull();
    expect(result.reason).toBe('would-empty');
  });

  it('says so when the offer is already gone', () => {
    const result = withoutEntry('rollingOffer', live, 'offer.roll.removed-by-hand');
    expect(result.payload).toBeNull();
    expect(result.reason).toBe('not-listed');
  });

  it('refuses rather than guesses when it has nothing safe to go on', () => {
    expect(withoutEntry('rollingOffer', live, '')).toBeNull();
    expect(withoutEntry('rollingOffer', live, null)).toBeNull();
    expect(withoutEntry('rollingOffer', 'not json at all', 'offer.roll.1')).toBeNull();
    expect(withoutEntry('rollingOffer', '{"Offers":"not an array"}', 'offer.roll.1')).toBeNull();
    expect(withoutEntry('battlePass', live, 'offer.roll.1')).toBeNull();
  });
});
