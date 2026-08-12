import { cloudService } from '../../main/cloudService';

test('private guild cloud defaults to the local server', () => {
  expect(cloudService.apiUrl).toBe('http://127.0.0.1:8787/api');
  expect(cloudService.pollUrl).toBe('');
  expect(cloudService.websiteUrl).toBe('http://127.0.0.1:8787');
  expect(cloudService.multipartSizeBytes).toBe(5 * 1024 ** 3);
});
