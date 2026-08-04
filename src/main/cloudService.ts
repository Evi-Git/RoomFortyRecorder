const stripTrailingSlash = (value: string | undefined, fallback: string) =>
  (value?.trim() || fallback).replace(/\/+$/, '');

const getPollUrl = (value: string | undefined) =>
  value === '' ? '' : stripTrailingSlash(value, '');

const multipartSizeMb = Number.parseInt(
  process.env.WCR_CLOUD_MULTIPART_SIZE_MB || '5120',
  10,
);

/**
 * Build-time endpoints for the guild's private cloud server.
 *
 * The default points at a local server for development. Set these values when
 * building the distributed guild client to point at the server's Tailscale or
 * HTTPS hostname.
 */
export const cloudService = {
  apiUrl: stripTrailingSlash(
    process.env.WCR_CLOUD_API_URL,
    'http://127.0.0.1:8787/api',
  ),
  pollUrl: getPollUrl(process.env.WCR_CLOUD_POLL_URL),
  websiteUrl: stripTrailingSlash(
    process.env.WCR_CLOUD_WEBSITE_URL,
    'http://127.0.0.1:8787',
  ),
  multipartSizeBytes:
    Number.isFinite(multipartSizeMb) && multipartSizeMb > 0
      ? multipartSizeMb * 1024 ** 2
      : 5 * 1024 ** 3,
};
