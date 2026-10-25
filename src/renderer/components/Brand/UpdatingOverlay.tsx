import { useEffect, useState } from 'react';
import KeyholeMark from './KeyholeMark';

const ipc = window.electron.ipcRenderer;

/**
 * [RoomFortyRecorder] Full-window brand screen shown while an update installs
 * until the installer's progress window takes over (it reopens the app).
 */
const UpdatingOverlay = () => {
  const [version, setVersion] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const off = ipc.on('appUpdating', (v) =>
      setVersion(typeof v === 'string' ? v : null),
    );
    return () => {
      if (off) off();
    };
  }, []);

  if (version === undefined) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-y-5"
      style={{ background: '#171412', color: '#E6DED1' }}
    >
      <div
        className="flex items-center justify-center rounded-2xl"
        style={{
          width: 96,
          height: 96,
          background: '#39322D',
          color: '#CCA85C',
          boxShadow: '0 0 0 1px rgba(204,168,92,0.35)',
        }}
      >
        <KeyholeMark size={64} />
      </div>
      <div
        className="text-2xl"
        style={{ fontFamily: '"Source Serif 4", Georgia, serif' }}
      >
        Updating Room Forty Toolkit{version ? ` to ${version}` : ''}
      </div>
      <div
        className="w-64 h-1.5 rounded-full overflow-hidden"
        style={{ background: '#39322D' }}
      >
        <div
          className="rf-updating-bar h-full rounded-full"
          style={{ background: '#CCA85C' }}
        />
      </div>
      <div className="text-sm" style={{ color: 'rgba(230,222,209,0.65)' }}>
        The installer window takes over in a moment and reopens the app when
        it&apos;s done.
      </div>
      <style>{`
        .rf-updating-bar { width: 35%; animation: rf-updating 1.4s ease-in-out infinite; }
        @keyframes rf-updating {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(290%); }
        }
      `}</style>
    </div>
  );
};

export default UpdatingOverlay;
