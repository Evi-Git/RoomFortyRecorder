// Thin stand-in for storage/CloudClient: the same pullDeskReady and
// pullDeskRequest (src/storage/CloudClient.ts), without the Electron, R2
// and websocket parts. Keep in step with the real ones when they change.
import axios from 'axios';
import { state } from './state';

export default class CloudClient {
  private static instance: CloudClient;

  public static viewAsRole: string | null = null;

  public static getInstance() {
    CloudClient.instance ??= new CloudClient();
    return CloudClient.instance;
  }

  public pullDeskReady() {
    return Boolean(state().token);
  }

  public async pullDeskRequest<T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    data?: unknown,
    options: {
      contentType?: string;
      timeout?: number;
      area?: string;
      responseType?: 'json' | 'arraybuffer';
    } = {},
  ): Promise<T> {
    const { apiUrl, guild, token } = state();
    const area = options.area ?? 'pulldesk';
    const url = `${apiUrl}/guild/${encodeURIComponent(guild)}/${area}${path}`;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (CloudClient.viewAsRole) {
      headers['X-View-As-Role'] = CloudClient.viewAsRole;
    }
    if (options.contentType) headers['Content-Type'] = options.contentType;
    const res = await axios.request({
      method,
      url,
      data,
      headers,
      timeout: options.timeout ?? 30000,
      maxBodyLength: 160 * 1024 * 1024,
      maxContentLength: 160 * 1024 * 1024,
      responseType: options.responseType ?? 'json',
    });
    return res.data as T;
  }
}
