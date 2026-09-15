import { OFFER_ART } from './offerArt.generated';

/**
 * The offer art library: what the art pickers offer, and how a name is checked.
 *
 * The list itself is generated from the game (see `scripts/syncOfferArt.ts`), so
 * a picker can only offer a picture the build can actually load.
 */

/** Which part of an offer a picture is drawn as. */
export type ArtSlot = 'background' | 'topBar' | 'reward' | 'button';

export interface OfferArt {
  /** What a payload names it by: the addressable address without `OfferImages/`. */
  name: string;
  address: string;
  /** The source file in the game repo, when it could be found. */
  file: string | null;
  /** The slot its name suggests, or null when it says nothing. */
  slot: ArtSlot | null;
}

export { OFFER_ART };

/** The payload field each slot is written to, and what an empty choice means for it. */
export const ART_FIELDS = [
  { field: 'BackgroundArt', slot: 'background', label: 'Background', empty: 'Default background' },
  { field: 'TopBarArt', slot: 'topBar', label: 'Top bar', empty: 'Default top bar' },
  { field: 'RewardArt', slot: 'reward', label: 'Prize picture', empty: "The prize's own picture" },
  { field: 'ButtonArt', slot: 'button', label: 'Menu button', empty: 'Default button' },
] as const;

export type ArtField = (typeof ART_FIELDS)[number]['field'];

export function artNamed(name: string): OfferArt | null {
  return OFFER_ART.find((art) => art.name === name) ?? null;
}

/** A slot's pictures, the ones meant for it first. */
export function artChoices(slot: ArtSlot): { suggested: OfferArt[]; others: OfferArt[] } {
  return {
    suggested: OFFER_ART.filter((art) => art.slot === slot),
    others: OFFER_ART.filter((art) => art.slot !== slot),
  };
}
