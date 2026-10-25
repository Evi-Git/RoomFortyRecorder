import axios from 'axios';
import { app } from 'electron';
import ConfigService from 'config/ConfigService';
import { cloudService } from './cloudService';

/**
 * [RoomFortyRecorder] The bug button: sends a short report to the guild
 * server, which posts it to the bug channel in Discord. Signed in with the
 * raider's Discord session so the report says who sent it.
 */
export default async function sendBugReport(
  text: string,
  page: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = ConfigService.getInstance().get<string>('cloudSessionToken');
  if (!token) {
    return { ok: false, error: 'Sign in with Discord first (Cloud settings).' };
  }

  try {
    await axios.post(
      `${cloudService.apiUrl}/bug-report`,
      { text, page, version: app.getVersion() },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
    );
    return { ok: true };
  } catch (error) {
    const data = axios.isAxiosError(error) ? error.response?.data : undefined;
    const message =
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : '') || 'Could not reach the guild server.';
    console.warn('[BugReport] Failed:', message);
    return { ok: false, error: message };
  }
}
