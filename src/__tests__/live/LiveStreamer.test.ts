/**
 * [RoomFortyRecorder] Go live: a stop that comes in while the app is still
 * asking the guild server for a stream (WoW closed, settings changed) must
 * win over the start.
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
jest.mock(
  'config/ConfigService',
  () => ({
    __esModule: true,
    default: {
      getInstance: () => ({
        get: (key: string) => (key === 'cloudSessionToken' ? 'token' : ''),
      }),
    },
  }),
  { virtual: true },
);
jest.mock(
  'utils/Poller',
  () => ({
    __esModule: true,
    default: { getInstance: () => ({ isWowRunning: () => true }) },
  }),
  { virtual: true },
);
jest.mock('../../main/cloudService', () => ({
  cloudService: { apiUrl: 'http://server/api' },
}));

let answer: (value: unknown) => void = () => {};
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    ),
    isAxiosError: () => false,
  },
}));

import LiveStreamer from '../../main/LiveStreamer';

const publish = { data: { whipUrl: 'http://mtx/whip', streamName: 'rf/me' } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  // A fresh instance each time.
  (LiveStreamer as unknown as { instance?: unknown }).instance = undefined;
});

test('a stop while connecting keeps the engine from starting', async () => {
  const live = LiveStreamer.getInstance();
  const starting = live.start();
  expect(live.getState().status).toBe('connecting');
  live.stop('WoW closed');
  expect(live.getState().status).toBe('off');
  answer(publish);
  await starting;
  await tick();
  expect(engine.StartStream).not.toHaveBeenCalled();
  expect(live.getState().status).toBe('off');
});

test('without a stop, the engine starts and goes live on its signal', async () => {
  const live = LiveStreamer.getInstance();
  const starting = live.start();
  answer(publish);
  await starting;
  expect(engine.StartStream).toHaveBeenCalledTimes(1);
  live.handleSignal({ type: 'stream', id: 'stream-start', code: 0 } as never);
  expect(live.getState().status).toBe('live');
  live.stop('Stopped by you');
});

test('an engine start after a stop is stopped again, not shown as live', async () => {
  const live = LiveStreamer.getInstance();
  const starting = live.start();
  answer(publish);
  await starting;
  live.stop('Stopped by you');
  engine.StopStream.mockClear();
  live.handleSignal({ type: 'stream', id: 'stream-start', code: 0 } as never);
  expect(live.getState().status).toBe('off');
  expect(engine.StopStream).toHaveBeenCalledTimes(1);
});
