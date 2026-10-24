import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/Dialog/Dialog';
import { Button } from './components/Button/Button';
import { Dispatch, ReactNode, SetStateAction, useState } from 'react';
import { AppState } from 'main/types';
import { ClipboardCopy, ExternalLink, FileText, Package } from 'lucide-react';
import Spinner from './components/Spinner/Spinner';
import { Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';

type IProps = {
  children: ReactNode;
  appState: AppState;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
};

const ipc = window.electron.ipcRenderer;

const DiagnosticsDialog = (props: IProps) => {
  const { children, appState, setPreviewEnabled } = props;
  const { language } = appState;
  const [open, setOpen] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [bundlePath, setBundlePath] = useState('');
  const [logDir, setLogDir] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  const loadLogDir = async () => {
    try {
      const result = await ipc.getLogDiagnostics();
      setLogDir(result.dir);
    } catch {
      setLogDir('');
    }
  };

  const copyIconLogLines = async () => {
    setCopyStatus('Reading logs…');
    try {
      const result = await ipc.getLogDiagnostics();
      setLogDir(result.dir);
      if (result.error) {
        setCopyStatus(`Could not read the logs: ${result.error}`);
        return;
      }
      const text = [
        `Log folder: ${result.dir}`,
        `Files: ${result.files.join(', ') || '(none)'}`,
        ...result.lines,
      ].join('\n');
      ipc.sendMessage('writeClipboard', [text]);
      setCopyStatus(
        result.lines.length
          ? `Copied ${result.lines.length} lines. Paste them into the chat.`
          : 'Copied, but no icon lines were found yet. Open a raider breakdown first.',
      );
    } catch (error) {
      setCopyStatus(`Could not read the logs: ${String(error)}`);
    }
  };

  const openLogPath = () => {
    ipc.sendMessage('logPath', ['open']);
    setOpen(false);
  };

  const renderOpenLogFolder = () => {
    return (
      <Button
        id="log-button"
        type="button"
        onClick={openLogPath}
        variant="outline"
      >
        <FileText size={20} className="mr-2" />
        {getLocalePhrase(language, Phrase.DiagnosticsOpenLogButton)}
      </Button>
    );
  };

  const createDiagsBundle = async () => {
    setZipping(true);

    try {
      const bundlePath = await ipc.createDiagsBundle();
      setBundlePath(bundlePath);
    } catch (error) {
      console.error('Failed to create diagnostics bundle:', error);
      throw error;
    } finally {
      setZipping(false);
    }
  };

  const openBundleLocation = () => {
    ipc.openSystemExplorer(bundlePath);
    setOpen(false);
  };

  const renderCreateDiagsBundle = () => {
    return (
      <Button
        id="create-diags-button"
        type="button"
        onClick={createDiagsBundle}
        variant={zipping ? 'outline' : 'default'}
        disabled={zipping}
      >
        {zipping ? (
          <>
            <Spinner size={'20px'} className="pr-2" />
            {getLocalePhrase(language, Phrase.DiagnosticsZippingInProgress)}
          </>
        ) : (
          <>
            <Package size={20} className="mr-2" />
            {getLocalePhrase(language, Phrase.DiagnosticsCreateBundleButton)}
          </>
        )}
      </Button>
    );
  };

  const renderOpenBundleLocation = () => {
    return (
      <Button
        id="open-bundle-location-button"
        type="button"
        onClick={openBundleLocation}
      >
        <ExternalLink size={20} className="mr-2" />
        {getLocalePhrase(language, Phrase.DiagnosticsOpenBundleCreated)}
      </Button>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        setPreviewEnabled(!open);
        if (open) {
          setZipping(false);
          setBundlePath('');
          setCopyStatus('');
          void loadLogDir();
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {getLocalePhrase(language, Phrase.Diagnostics)}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-foreground">
          {getLocalePhrase(language, Phrase.DiagnosticsDialogDescription)}
        </p>

        <div className="flex flex-row items-start gap-4 w-full items-center justify-center">
          {renderOpenLogFolder()}
          {bundlePath ? renderOpenBundleLocation() : renderCreateDiagsBundle()}
        </div>

        <div className="flex flex-col items-center gap-2 w-full">
          <Button
            id="copy-icon-log-button"
            type="button"
            variant="outline"
            onClick={() => void copyIconLogLines()}
          >
            <ClipboardCopy size={20} className="mr-2" />
            Copy icon log lines
          </Button>
          {copyStatus && (
            <p className="text-sm text-foreground text-center">{copyStatus}</p>
          )}
          {logDir && (
            <p className="text-xs text-foreground-lighter break-all select-text text-center">
              {logDir}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DiagnosticsDialog;
