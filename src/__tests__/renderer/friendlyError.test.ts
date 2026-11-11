import { friendlyError } from '../../renderer/friendlyError';

test('common server and network errors read plainly', () => {
  expect(friendlyError('Unknown API route: GET /analyze-presets')).toMatch(
    /update-server\.cmd/,
  );
  expect(friendlyError('connect ECONNREFUSED 127.0.0.1:8787')).toMatch(
    /Couldn't reach the guild server/,
  );
  expect(friendlyError('timeout of 30000ms exceeded')).toMatch(/too long/);
  expect(friendlyError('Request failed with status code 502')).toMatch(
    /down or restarting/,
  );
  expect(
    friendlyError(
      'Sign in with Discord in Cloud settings to use the pull desk.',
    ),
  ).toMatch(/Sign in/);
});

test('anything else is kept as it is', () => {
  expect(friendlyError('No meters for this pull yet')).toBe(
    'No meters for this pull yet',
  );
  expect(friendlyError('')).toBe('Something went wrong.');
});
