import '../mock';
import React from 'react';
import { createRoot } from 'react-dom/client';
import LogsExplorer from 'renderer/logs/LogsExplorer';

// A made-up pull; the real data comes from /log.gz via the mock.
const meta = {
  id: 'harness-pull',
  label: 'Harness pull',
  encounterId: 0,
  difficultyId: 16,
  startedAt: Date.UTC(2026, 0, 1, 20, 0, 0),
  result: 'kill',
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <div style={{ padding: 16 }}>
    <LogsExplorer metas={[meta]} watch={null} fallback={() => null} />
  </div>,
);
