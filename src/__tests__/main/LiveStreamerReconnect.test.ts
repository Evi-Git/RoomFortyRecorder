/**
 * Go live state machine: drop → reconnecting → back live, Stop while waiting,
 * an expired sign-in found while reconnecting. The engine (noobs), config,
 * WoW poller and network are mocked.
 */

let engineActive = false;
const engine = {
  StartStream: jest.fn(),
  StopStream: jest.fn(),
  GetStreamStatus: jest.fn(() => ({ active: engineActive, bytes: 0 })),
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
  engineActive = false;
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

  // Live for 30 s: a later drop starts counting from try 1 again.
  jest.advanceTimersByTime(30_000);
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

it('a stream that drops right after connecting keeps counting', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  jest.advanceTimersByTime(2_000);
  await settle();
  live.handleSignal(signal('stream-start'));
  jest.advanceTimersByTime(3_000); // up for 3 s only
  live.handleSignal(signal('stream-stop', -5));
  expect(live.getState().note).toBe(
    'Connection dropped. Reconnecting (try 2)…',
  );
});

it('gives up five minutes after the drop', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  for (let i = 0; i < 30 && live.getState().status === 'reconnecting'; i += 1) {
    jest.advanceTimersByTime(30_000);
    await settle();
    live.handleSignal(signal('stream-stop', -2));
  }
  const state = live.getState();
  expect(state.status).toBe('error');
  expect(state.error).toMatch(/Gave up after \d+ tries/);
  const tries = engine.StartStream.mock.calls.length - 1;
  expect(tries).toBeGreaterThanOrEqual(10);
  expect(tries).toBeLessThanOrEqual(13);
});

it('a first Go live that never connects gives up after 3 more tries', async () => {
  const live = fresh();
  await live.start();
  await settle();
  live.handleSignal(signal('stream-stop', -2));
  expect(live.getState()).toMatchObject({
    status: 'reconnecting',
    wasLive: false,
  });
  for (let i = 0; i < 3; i += 1) {
    jest.advanceTimersByTime(30_000);
    await settle();
    live.handleSignal(signal('stream-stop', -2));
  }
  expect(live.getState().status).toBe('error');
  expect(engine.StartStream).toHaveBeenCalledTimes(4);
});

it('a try with no answer from the live server counts as failed', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  jest.advanceTimersByTime(2_000);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(2);

  jest.advanceTimersByTime(45_000); // no signal at all
  expect(live.getState()).toMatchObject({
    status: 'reconnecting',
    note: 'Connection dropped. Reconnecting (try 2)…',
  });
  jest.advanceTimersByTime(5_000);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(3);
});

it('a late start from a timed-out try cancels the next try', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  jest.advanceTimersByTime(2_000);
  await settle();
  jest.advanceTimersByTime(45_000);
  live.handleSignal(signal('stream-start')); // the old try made it after all
  expect(live.getState().status).toBe('live');
  jest.advanceTimersByTime(60_000);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(2);
});

it('a start that arrives after Stop is stopped', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  jest.advanceTimersByTime(2_000);
  await settle();
  live.stop('Stopped by you');
  engine.StopStream.mockClear();
  live.handleSignal(signal('stream-start'));
  expect(engine.StopStream).toHaveBeenCalledTimes(1);
  expect(live.getState().status).toBe('off');
});

it('gives up when the engine refuses to start during a reconnect', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  engine.StartStream.mockImplementationOnce(() => {
    throw new Error('A stream is already running');
  });
  jest.advanceTimersByTime(2_000);
  await settle();
  expect(live.getState()).toMatchObject({
    status: 'error',
    error: 'A stream is already running',
  });
});

it('goes off when WoW closes while a try is waiting', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  wowRunning = false;
  jest.advanceTimersByTime(2_000);
  await settle();
  expect(live.getState().status).toBe('off');
  expect(engine.StartStream).toHaveBeenCalledTimes(1);
});

it('stopAndWait waits for a start that is still connecting', async () => {
  const live = fresh();
  await live.start();
  await settle();
  // Connecting: the engine isn't active yet and hasn't answered.
  let done = false;
  const waiting = live.stopAndWait('Settings changed', 5_000).then(() => {
    done = true;
  });
  await settle();
  jest.advanceTimersByTime(300);
  await settle();
  expect(done).toBe(false);

  live.handleSignal(signal('stream-start')); // stopped right away
  jest.advanceTimersByTime(200);
  await settle();
  await waiting;
  expect(done).toBe(true);
  expect(engine.StopStream).toHaveBeenCalled();
});

it('a drop followed by a refusal still gets one more try', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  jest.advanceTimersByTime(2_000);
  await settle();
  live.handleSignal(signal('stream-stop', -3));
  expect(live.getState().status).toBe('reconnecting');
  jest.advanceTimersByTime(5_000);
  await settle();
  live.handleSignal(signal('stream-stop', -3));
  expect(live.getState().status).toBe('error');
});

it('a timed-out try that goes live while the next try asks the server: no second stream', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  jest.advanceTimersByTime(2_000);
  await settle(); // try A started
  jest.advanceTimersByTime(45_000); // A timed out
  let answer: (value: unknown) => void = () => {};
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  jest.advanceTimersByTime(5_000);
  await settle(); // try B is asking the guild server
  engineActive = true;
  live.handleSignal(signal('stream-start')); // A made it after all
  answer(publishOk);
  await settle();
  expect(engine.StartStream).toHaveBeenCalledTimes(2); // no StartStream for B
  expect(live.getState().status).toBe('live');
});

it('a try that connected just as the time ran out is not stopped', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -5));
  jest.advanceTimersByTime(2_000);
  await settle();
  engine.StopStream.mockClear();
  engineActive = true; // connected; its signal is still queued
  jest.advanceTimersByTime(45_000);
  expect(engine.StopStream).not.toHaveBeenCalled();
  live.handleSignal(signal('stream-start'));
  expect(live.getState().status).toBe('live');
});

it('Stop also ends a stream the engine still runs after an error', async () => {
  const live = fresh();
  await goLive(live);
  live.handleSignal(signal('stream-stop', -6)); // gives up at once
  expect(live.getState().status).toBe('error');
  engineActive = true; // somehow still running
  engine.StopStream.mockClear();
  live.stop('WoW closed');
  expect(engine.StopStream).toHaveBeenCalledTimes(1);
  expect(live.getState().status).toBe('off');
});

it('Go live right after Stop waits for the old stream to finish stopping', async () => {
  jest.useRealTimers();
  const live = fresh();
  engineActive = true; // the previous stream is still shutting down
  setTimeout(() => {
    engineActive = false;
  }, 300);
  await live.start();
  expect(engine.StartStream).toHaveBeenCalledTimes(1);
  expect(live.getState().status).toBe('connecting');
});

it('says so when the old stream never finishes stopping', async () => {
  jest.useRealTimers();
  const live = fresh();
  engineActive = true;
  await live.start();
  expect(engine.StartStream).not.toHaveBeenCalled();
  expect(live.getState()).toMatchObject({
    status: 'error',
    error: 'The last stream is still stopping. Try again in a moment.',
  });
}, 10_000);
