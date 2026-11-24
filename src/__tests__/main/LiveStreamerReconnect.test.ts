/**
 * Go live state machine: drop → reconnecting → back live, Stop while waiting,
 * an expired sign-in found while reconnecting. The engine (noobs), config,
 * WoW poller and network are mocked.
 */

const engine = {
  StartStream: jest.fn(),
  StopStream: jest.fn(),
  GetStreamStatus: jest.fn(() => ({ active: false, bytes: 0 })),
  ListVideoEncoders: jest.fn(() => ['obs_x264']),
  GetPreviewInfo: jest.fn(() => ({ canvasWidth: 1920, canvasHeight: 1080 })),
};
jest.mock('noobs', () => ({ __esModule: true, default: engine }), {
  virtual: true,
});

let wowRunning = true;
jest.mock(
  'utils/Poller',
  () => ({
    __esModule: true,
    default: { getInstance: () => ({ isWowRunning: () => wowRunning }) },
  }),
  { virtual: true },
);
jest.mock(
  'config/ConfigService',
  () => ({
    __esModule: true,
    default: { getInstance: () => ({ get: () => undefined }) },
  }),
  { virtual: true },
);
jest.mock('../../main/secretStore', () => ({
  getSessionToken: jest.fn(async () => 'token'),
}));
jest.mock('../../main/cloudService', () => ({
  cloudService: { apiUrl: 'https://guild.test/api' },
}));

const get = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => get(...args),
    isAxiosError: (e: unknown) =>
      Boolean(e && typeof e === 'object' && 'response' in e),
  },
}));

import LiveStreamer from '../../main/LiveStreamer';

const publishOk = {
  data: { whipUrl: 'https://live.test/rf/me/whip', streamName: 'me' },
};
type EngineSignal = Parameters<LiveStreamer['handleSignal']>[0];
const signal = (id: string, code = 0, error?: string) =>
  ({ type: 'stream', id, code, error }) as EngineSignal;

/** Let pending promises (token, publish request) settle. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const fresh = () => {
  // A new instance per test: reset the singleton.
  (LiveStreamer as unknown as { instance?: LiveStreamer }).instance = undefined;
  return LiveStreamer.getInstance();
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  wowRunning = true;
  get.mockResolvedValue(publishOk);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const goLive = async (live: LiveStreamer) => {
  await live.start();
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(1);
  live.handleSignal(signal('stream-start'));
  expect(live.getState().status).toBe('live');
};

it('reconnects after a drop and goes back live', async () => {
  const live = fresh();
  await goLive(live);

  live.handleSignal(signal('stream-stop', -5));
  expect(live.getState()).toMatchObject({
    status: 'reconnecting',
    note: 'Connection dropped. Reconnecting (try 1)…',
  });
  expect(live.isActive()).toBe(true);

  jest.advanceTimersByTime(2_000);
  await settle();
  expect(get).toHaveBeenCalledTimes(2); // checks the sign-in again
  expect(engine.StartStream).toHaveBeenCalledTimes(2);

  live.handleSignal(signal('stream-start'));
  expect(live.getState().status).toBe('live');

  // A later drop starts counting from try 1 again.
  live.handleSignal(signal('stream-stop', -5));
  expect(live.getState().note).toBe(
    'Connection dropped. Reconnecting (try 1)…',
  );
});

it('waits longer after each failed try', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));

  jest.advanceTimersByTime(2_000);
  await settle();
  live.handleSignal(signal('stream-stop', -2));
  expect(live.getState().note).toBe(
    'Connection dropped. Reconnecting (try 2)…',
  );

  jest.advanceTimersByTime(4_999);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(1);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(3);
});

it('Stop while reconnecting cancels the next try', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));

  await live.toggle(); // the raider presses Stop
  expect(live.getState().status).toBe('off');

  jest.advanceTimersByTime(60_000);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(1);
});

it('Stop while a reconnect try is asking the guild server wins', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));

  let answer: (value: unknown) => void = () => {};
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  jest.advanceTimersByTime(2_000);
  await settle();
  live.stop('Stopped by you');
  answer(publishOk);
  await settle();

  expect(engine.StartStream).toHaveBeenCalledTimes(1);
  expect(live.getState().status).toBe('off');
});

it('stops trying when the sign-in expired meanwhile', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));

  get.mockRejectedValueOnce({
    response: {
      status: 401,
      data: { error: 'Invalid or expired Discord session' },
    },
  });
  jest.advanceTimersByTime(2_000);
  await settle();

  expect(live.getState()).toMatchObject({
    status: 'error',
    error:
      'Your Discord sign-in expired. Sign in again in Cloud settings, then go live.',
  });
  jest.advanceTimersByTime(60_000);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(1);
});

it('keeps trying while the guild server is unreachable', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));

  get.mockRejectedValueOnce({ code: 'ECONNREFUSED' });
  jest.advanceTimersByTime(2_000);
  await settle();
  expect(live.getState()).toMatchObject({
    status: 'reconnecting',
    note: 'Connection dropped. Reconnecting (try 2)…',
  });

  jest.advanceTimersByTime(5_000);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(2);
});

it('goes off instead of reconnecting when WoW has closed', async () => {
  const live = fresh();
  await goLive(live);
  wowRunning = false;
  live.handleSignal(signal('stream-stop', -5));
  expect(live.getState().status).toBe('off');
});

it('a normal stop (code 0) is just off', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', 0));
  expect(live.getState().status).toBe('off');
  jest.advanceTimersByTime(60_000);
  expect(engine.StartStream).toHaveBeenCalledTimes(1);
});

it('shows the server reason when the first Go live is refused', async () => {
  const live = fresh();
  get.mockRejectedValueOnce({
    response: {
      status: 401,
      data: { error: 'You no longer have a Room Forty role' },
    },
  });
  await live.start();
  await settle();
  expect(live.getState()).toMatchObject({
    status: 'error',
    error:
      "The guild server won't let you go live: You no longer have a Room Forty role",
  });
  expect(engine.StartStream).not.toHaveBeenCalled();
});
