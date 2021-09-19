import { stringify } from 'query-string';
import { ConfigService } from '@nestjs/config';
import configuration from '../../config/configuration';
import { IAppSettings } from '../../../types/global';

const appSettings = new ConfigService(configuration()).get<IAppSettings>(
  'APP_SETTINGS',
);

/**
 * Substitutes client and query in jUrl.
 * @param {string} url jUrl resource
 * @param {object} query query parameters
 * @returns {string} url.
 */
export const createUrlWithQuery = (
  url: string,
  query: Record<string, unknown> = {},
): string => {
  return `${url}?${stringify({ ...appSettings.client })}&${stringify({
    ...query,
  })}`;
};
