import {
  addFailure,
  classifyUpload,
  describeUploadError,
  FULL_TEXT,
  LINK_EXPIRED_TEXT,
  UNREACHABLE_TEXT,
  MAX_FAILURES,
  removeFailure,
  removeFailureForPath,
  SIGN_IN_TEXT,
  StallError,
  STALLED_TEXT,
  TAKEN_TEXT,
  UploadFailure,
  uploadName,
} from '../../main/uploadFailures';
import { withRetry } from '../../main/pullUploadRetry';

const http = (status: number, error?: string) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data: error ? { error } : undefined },
});

describe('classifyUpload', () => {
  it('retries a stall and a dropped connection', () => {
    expect(classifyUpload(new StallError())).toBe('retry');
    expect(classifyUpload({ isAxiosError: true, code: 'ECONNRESET' })).toBe(
      'retry',
    );
  });

  it('does not retry what the server refused', () => {
    expect(classifyUpload(http(409))).toBe('fatal');
    expect(classifyUpload(http(413))).toBe('fatal');
    expect(classifyUpload(http(403))).toBe('fatal');
    expect(classifyUpload(http(503))).toBe('retry');
  });

  it('retries R2 RequestTimeout but not other 400s', () => {
    const r2 = {
      isAxiosError: true,
      response: {
        status: 400,
        data: '<Error><Code>RequestTimeout</Code></Error>',
      },
    };
    expect(classifyUpload(r2)).toBe('retry');
    expect(classifyUpload(http(400))).toBe('fatal');
  });
});

describe('describeUploadError', () => {
  it('409 uses the server text, else the default', () => {
    expect(
      describeUploadError(http(409, 'Another member is uploading.')),
    ).toEqual({ kind: 'taken', message: 'Another member is uploading.' });
    expect(describeUploadError(http(409)).message).toBe(TAKEN_TEXT);
  });

  it('413 says storage is full for the storage limit', () => {
    expect(
      describeUploadError(http(413, 'Guild storage limit reached')),
    ).toEqual({ kind: 'full', message: FULL_TEXT });
    expect(describeUploadError(http(413)).message).toBe(FULL_TEXT);
    expect(
      describeUploadError(
        http(413, 'That file is too big (the limit is 5 GB).'),
      ).message,
    ).toBe('That file is too big (the limit is 5 GB).');
  });

  it('401 and bare 403 ask to sign in; a 403 with a reason shows it', () => {
    expect(describeUploadError(http(401))).toEqual({
      kind: 'auth',
      message: SIGN_IN_TEXT,
    });
    expect(describeUploadError(http(403)).message).toBe(LINK_EXPIRED_TEXT);
    expect(
      describeUploadError(
        http(403, 'You can only replace your own recordings.'),
      ).message,
    ).toBe('You can only replace your own recordings.');
  });

  it('stalls, timeouts and no answer read as a stalled upload', () => {
    expect(describeUploadError(new StallError())).toEqual({
      kind: 'stalled',
      message: STALLED_TEXT,
    });
    expect(
      describeUploadError({
        isAxiosError: true,
        code: 'ECONNRESET',
        config: { url: 'https://r2.example/v.mp4?X-Amz-Signature=1' },
      }).kind,
    ).toBe('stalled');
  });

  it('no answer from the guild server itself reads as unreachable', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNABORTED']) {
      expect(
        describeUploadError({
          isAxiosError: true,
          code,
          config: { url: 'https://api.example/guild/x/upload' },
        }),
      ).toEqual({ kind: 'server', message: UNREACHABLE_TEXT });
    }
    expect(
      describeUploadError(new Error('timeout of 30000ms exceeded')).message,
    ).toBe(UNREACHABLE_TEXT);
  });

  it('5xx is a server problem; a missing file is a file problem', () => {
    expect(describeUploadError(http(502)).kind).toBe('server');
    expect(describeUploadError({ code: 'ENOENT', message: 'x' }).kind).toBe(
      'file',
    );
  });

  it('anything else falls back to friendly text', () => {
    expect(describeUploadError(new Error('Something odd')).message).toBe(
      'Something odd',
    );
    expect(describeUploadError(undefined).message).toBeTruthy();
  });
});

const failure = (path: string, at: number): UploadFailure => ({
  id: `${at}|${path}`,
  path,
  name: path,
  kind: 'other',
  message: 'm',
  at,
});

describe('failure list', () => {
  it('puts the newest first and replaces the same file', () => {
    let list: UploadFailure[] = [];
    list = addFailure(list, failure('a.mp4', 1));
    list = addFailure(list, failure('b.mp4', 2));
    list = addFailure(list, failure('a.mp4', 3));
    expect(list.map((f) => f.path)).toEqual(['a.mp4', 'b.mp4']);
    expect(list[0].at).toBe(3);
  });

  it('keeps at most MAX_FAILURES', () => {
    let list: UploadFailure[] = [];
    for (let i = 0; i < MAX_FAILURES + 5; i += 1) {
      list = addFailure(list, failure(`${i}.mp4`, i));
    }
    expect(list).toHaveLength(MAX_FAILURES);
    expect(list[0].path).toBe(`${MAX_FAILURES + 4}.mp4`);
  });

  it('removes by id or by path', () => {
    const list = [failure('a.mp4', 1), failure('b.mp4', 2)];
    expect(removeFailure(list, '1|a.mp4').map((f) => f.path)).toEqual([
      'b.mp4',
    ]);
    expect(removeFailureForPath(list, 'b.mp4').map((f) => f.path)).toEqual([
      'a.mp4',
    ]);
  });
});

describe('uploadName', () => {
  it('prefers the encounter, then the zone, then the file name', () => {
    expect(
      uploadName({ encounterName: "Ula'tek", difficulty: 'Heroic' }, 'x.mp4'),
    ).toBe("Ula'tek (Heroic)");
    expect(uploadName({ zoneName: 'Raid' }, 'C:\\v\\x.mp4')).toBe('Raid');
    expect(uploadName(null, 'C:\\v\\Kill 1.mp4')).toBe('Kill 1');
  });
});

describe('withRetry for uploads', () => {
  it('stops after maxAttempts and never retries a fatal error', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValue(new StallError());
    await expect(
      withRetry(fn, { sleep, classify: classifyUpload, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(StallError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const fatal = jest.fn().mockRejectedValue(http(409));
    await expect(
      withRetry(fatal, { sleep, classify: classifyUpload, maxAttempts: 3 }),
    ).rejects.toBeDefined();
    expect(fatal).toHaveBeenCalledTimes(1);
  });

  it('succeeds after a stall', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new StallError())
      .mockResolvedValue('ok');
    await expect(
      withRetry(fn, {
        sleep: async () => {},
        classify: classifyUpload,
        maxAttempts: 3,
      }),
    ).resolves.toBe('ok');
  });
});
