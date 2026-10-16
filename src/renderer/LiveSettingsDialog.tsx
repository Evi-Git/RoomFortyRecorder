import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/Dialog/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/Select/Select';
import Label from './components/Label/Label';
import { getConfigValue, setConfigValue } from './useSettings';

/**
 * [RoomFortyRecorder] Go live stream quality: resolution, frame rate and
 * bitrate. Separate from the recording settings; applies the next time the
 * raider goes live.
 */

const RESOLUTIONS = [
  { value: '720', label: '720p' },
  { value: '900', label: '900p' },
  { value: '1080', label: '1080p (default)' },
  { value: '1440', label: '1440p' },
  { value: 'source', label: 'Same as recording' },
];

const BITRATES = [3000, 5000, 7000, 10000, 15000, 20000];

// Suggested bitrate for a smooth picture at each resolution and frame rate.
const suggestedKbps = (resolution: string, fps: number) => {
  const height = resolution === 'source' ? 1440 : Number(resolution);
  const base = height >= 1440 ? 12000 : height >= 1080 ? 7000 : 5000;
  return fps > 40 ? base : Math.round(base * 0.65);
};

interface IProps {
  children: React.ReactNode;
}

const LiveSettingsDialog = ({ children }: IProps) => {
  const [open, setOpen] = React.useState(false);
  const [resolution, setResolution] = React.useState('1080');
  const [fps, setFps] = React.useState('full');
  const [bitrate, setBitrate] = React.useState(7000);
  const [recordingFps, setRecordingFps] = React.useState(60);

  React.useEffect(() => {
    if (!open) return;
    setResolution(getConfigValue<string>('liveResolution') || '1080');
    setFps(getConfigValue<string>('liveFps') || 'full');
    setBitrate(getConfigValue<number>('liveBitrate') || 7000);
    setRecordingFps(getConfigValue<number>('obsFPS') || 60);
  }, [open]);

  const streamFps = fps === 'half' ? recordingFps / 2 : recordingFps;
  const suggested = suggestedKbps(resolution, streamFps);
  const mbps = (kbps: number) => `${(kbps / 1000).toFixed(0)} Mbps`;

  const update = (key: string, value: string | number) => {
    setConfigValue(key, value);
    if (key === 'liveResolution') setResolution(String(value));
    if (key === 'liveFps') setFps(String(value));
    if (key === 'liveBitrate') setBitrate(Number(value));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Go live quality</DialogTitle>
          <DialogDescription>
            What viewers receive when you go live. Your recordings aren&apos;t
            affected. Changes apply the next time you click Go live.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-y-4 text-foreground-lighter">
          <div className="flex flex-col gap-y-1">
            <Label>Resolution</Label>
            <Select
              value={resolution}
              onValueChange={(v) => update('liveResolution', v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-foreground/60">
              Only ever scaled down. If your recording is smaller, it streams at
              the recording size.
            </p>
          </div>

          <div className="flex flex-col gap-y-1">
            <Label>Frame rate</Label>
            <Select value={fps} onValueChange={(v) => update('liveFps', v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">
                  {recordingFps} fps (same as recording)
                </SelectItem>
                <SelectItem value="half">
                  {Math.round(recordingFps / 2)} fps (half, less upload)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-foreground/60">
              To change the recording frame rate itself, use Scene settings.
            </p>
          </div>

          <div className="flex flex-col gap-y-1">
            <Label>Bitrate</Label>
            <Select
              value={String(bitrate)}
              onValueChange={(v) => update('liveBitrate', Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BITRATES.map((kbps) => (
                  <SelectItem key={kbps} value={String(kbps)}>
                    {mbps(kbps)}
                    {kbps === 7000 ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-foreground/60">
              Suggested for these settings: about {mbps(suggested)}. Your upload
              speed needs comfortable headroom above this.
              {bitrate < suggested * 0.7 &&
                ' The current bitrate is low for this resolution, so fast scenes may look blocky.'}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LiveSettingsDialog;
