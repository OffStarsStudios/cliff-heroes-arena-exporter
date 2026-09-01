/**
 * ConfigCat Management API client.
 *
 * Zero dependencies, same style as `gsheetHandler.mjs`. Every call is made
 * server-side: the credentials are organization-wide and can modify any
 * product, so they must never reach the browser bundle.
 *
 * Endpoint shapes come from the published Public Management API:
 *   GET   /v1/products
 *   GET   /v1/products/{productId}/configs
 *   GET   /v1/products/{productId}/environments
 *   GET   /v1/configs/{configId}/settings
 *   GET   /v1/configs/{configId}/environments/{environmentId}/values
 *   PATCH /v1/environments/{environmentId}/settings/{settingId}/value
 *
 * Only the read paths are used today. The write paths are listed so the next
 * phase does not have to rediscover them.
 */

const BASE = 'https://api.configcat.com';

export class ConfigCatError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'ConfigCatError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Reads credentials at call time rather than at import time, so a missing
 * variable produces a clear error from the request instead of a crash on boot.
 */
function credentials() {
  const user = process.env.CONFIGCAT_API_USER;
  const pass = process.env.CONFIGCAT_API_PASS;
  const missing = [];
  if (!user) missing.push('CONFIGCAT_API_USER');
  if (!pass) missing.push('CONFIGCAT_API_PASS');
  if (missing.length > 0) {
    throw new ConfigCatError(
      `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set. Add the ConfigCat Public API credentials to the environment.`,
      500,
    );
  }
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

/**
 * One Management API call. Returns the parsed body on success and throws a
 * ConfigCatError carrying the upstream status on failure, so handlers can pass
 * a meaningful status through instead of flattening everything to 500.
 */
export async function configcatRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: credentials(),
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let parsed = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const hint =
      response.status === 401
        ? 'The ConfigCat credentials were rejected. Check CONFIGCAT_API_USER and CONFIGCAT_API_PASS.'
        : response.status === 403
          ? 'The ConfigCat credentials are valid but not permitted to do this. It may be a plan limitation.'
          : `ConfigCat returned HTTP ${response.status}.`;
    throw new ConfigCatError(hint, response.status, parsed);
  }

  return parsed;
}

/** Non-throwing variant, for probing whether an endpoint is available at all. */
export async function tryRequest(path, options) {
  try {
    return { ok: true, status: 200, data: await configcatRequest(path, options) };
  } catch (error) {
    if (error instanceof ConfigCatError) {
      return { ok: false, status: error.status ?? 0, message: error.message, detail: error.detail };
    }
    return { ok: false, status: 0, message: error?.message ?? String(error) };
  }
}

/**
 * The account's shape: every product, with its configs and environments, and
 * the settings defined in each config.
 *
 * There is one product and one config here, so the nested fetches are cheap.
 * If that stops being true this should take a productId filter.
 */
export async function getTree() {
  const products = await configcatRequest('/v1/products');

  const detailed = await Promise.all(
    (products ?? []).map(async (product) => {
      const productId = product.productId;
      const [configs, environments] = await Promise.all([
        configcatRequest(`/v1/products/${productId}/configs`),
        configcatRequest(`/v1/products/${productId}/environments`),
      ]);

      const withSettings = await Promise.all(
        (configs ?? []).map(async (config) => {
          const settings = await configcatRequest(`/v1/configs/${config.configId}/settings`);
          return {
            configId: config.configId,
            name: config.name,
            settings: (settings ?? []).map((setting) => ({
              settingId: setting.settingId,
              key: setting.key,
              name: setting.name,
              settingType: setting.settingType,
            })),
          };
        }),
      );

      return {
        productId,
        name: product.name,
        configs: withSettings,
        environments: (environments ?? []).map((environment) => ({
          environmentId: environment.environmentId,
          name: environment.name,
        })),
      };
    }),
  );

  return { products: detailed };
}

/**
 * Unwraps a setting value.
 *
 * The v1 API returns the value directly. The v2 API wraps it in a typed
 * object - `{ stringValue: "..." }` - because a v2 setting can also carry
 * targeting rules and percentage options. Both shapes reduce to the same
 * thing here, since every setting in this config is a plain string.
 */
function unwrapValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;
  for (const key of ['stringValue', 'boolValue', 'intValue', 'doubleValue']) {
    if (key in raw) return raw[key];
  }
  return raw;
}

/**
 * Live values for every setting in one config and environment.
 *
 * Tries v2 first and falls back to v1. Configs created after ConfigCat's V2
 * format landed are rejected by the v1 values endpoint, and configs older than
 * it are not served by v2, so which one works is a property of the config
 * rather than something to hard-code. The fallback keeps this working either
 * way, and the successful version is reported so it is visible which was used.
 *
 * Byte sizes are included because payload size against ConfigCat's limits is
 * something this phase is meant to measure, and it is free to report here.
 */
export async function getValues(configId, environmentId) {
  const path = (version) => `/${version}/configs/${configId}/environments/${environmentId}/values`;

  let response = null;
  let apiVersion = 'v2';
  const attempt = await tryRequest(path('v2'));

  if (attempt.ok) {
    response = attempt.data;
  } else {
    const fallback = await tryRequest(path('v1'));
    if (!fallback.ok) {
      // Report the v2 failure: it is the one expected to work for this config,
      // so its message is the more useful of the two.
      throw new ConfigCatError(
        `${attempt.message} (v2 responded ${attempt.status}, v1 responded ${fallback.status})`,
        attempt.status || fallback.status || 502,
        attempt.detail ?? fallback.detail,
      );
    }
    response = fallback.data;
    apiVersion = 'v1';
  }

  const entries = Array.isArray(response)
    ? response
    : (response?.settingValues ?? response?.settings ?? []);

  const settings = entries.map((entry) => {
    const setting = entry.setting ?? {};
    const value = unwrapValue(entry.value);
    const text = typeof value === 'string' ? value : null;
    let parsed = null;
    let parseError = null;
    if (text !== null) {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parseError = error?.message ?? String(error);
      }
    }
    return {
      settingId: setting.settingId ?? entry.settingId ?? null,
      key: setting.key ?? null,
      name: setting.name ?? null,
      settingType: setting.settingType ?? null,
      value,
      bytes: text === null ? null : Buffer.byteLength(text, 'utf8'),
      /** Parsed payload for string settings that hold JSON, else null. */
      json: parsed,
      /** Set when a string setting was expected to hold JSON but does not. */
      parseError,
    };
  });

  return {
    configId,
    environmentId,
    apiVersion,
    settings,
    totalBytes: settings.reduce((sum, setting) => sum + (setting.bytes ?? 0), 0),
  };
}

/**
 * What this account can actually do, answered from the account rather than
 * from documentation.
 *
 * The dashboard shows a SAVE & PUBLISH CHANGES bar, but that alone does not
 * say whether changes are staged server-side or merely batched in the browser.
 * The distinction decides the whole write design: with server-side staging an
 * API write is pending until published, and a teammate's unpublished edit
 * could be shipped by our publish call. Without it, an API write goes live at
 * the next SDK poll and our own diff gate is the only thing standing in front
 * of the live game.
 */
export async function probe(productId) {
  const changeRequests = await tryRequest(
    `/v2/products/${productId}/change-requests?pageSize=1`,
  );

  return {
    productId,
    changeRequests: {
      available: changeRequests.ok,
      status: changeRequests.status,
      message: changeRequests.ok
        ? 'Change Requests are available: writes can be staged and published as a unit.'
        : changeRequests.status === 403
          ? 'Change Requests are not available on this plan. API writes take effect at the next SDK poll, with no staged state in between.'
          : changeRequests.message,
      /** Present only when available, so we can see whether anything is staged now. */
      sample: changeRequests.ok ? changeRequests.data : null,
    },
  };
}
