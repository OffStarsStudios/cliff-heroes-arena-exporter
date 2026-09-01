/**
 * The ConfigCat account this console manages.
 *
 * These identifiers are not secrets - they name resources, and the credentials
 * that can act on them stay server-side. Keeping them here means the console
 * has sensible defaults without a round trip, while `/api/configcat/tree`
 * remains the authority if anything is ever added or renamed.
 */

export const ACCOUNT = {
  productId: '08ded206-3476-460f-8afc-6b9c417ebedd',
  productName: 'Cliff Heroes',
  configId: '08dee35e-a4d3-4e5e-8157-f96d209ff503',
  configName: 'CliffHeroes',
} as const;

export interface KnownEnvironment {
  environmentId: string;
  name: string;
  /**
   * Whether the shipped game reads this environment.
   *
   * This is the single most important fact in the console and it is not
   * derivable from the API. Today the live game reads **Test**, not
   * Production, which inverts the usual assumption: a mistake in Test reaches
   * players, and Production is the safe place to rehearse.
   *
   * When the game switches over, change this - every confirmation gate in the
   * console keys off it rather than off the environment's name.
   */
  readByLiveGame: boolean;
}

export const ENVIRONMENTS: KnownEnvironment[] = [
  {
    environmentId: '08ded206-347f-4a76-8b9d-e895d64f72f2',
    name: 'Test Environment',
    readByLiveGame: true,
  },
  {
    environmentId: '08ded206-3493-4e4a-8887-4352505a075f',
    name: 'Production Environment',
    readByLiveGame: false,
  },
];

/** The environment the game reads, or null if none is marked. */
export function liveEnvironment(): KnownEnvironment | null {
  return ENVIRONMENTS.find((environment) => environment.readByLiveGame) ?? null;
}

export function isLiveEnvironment(environmentId: string): boolean {
  return ENVIRONMENTS.some(
    (environment) => environment.environmentId === environmentId && environment.readByLiveGame,
  );
}

export function environmentName(environmentId: string): string {
  return (
    ENVIRONMENTS.find((environment) => environment.environmentId === environmentId)?.name ??
    environmentId
  );
}
