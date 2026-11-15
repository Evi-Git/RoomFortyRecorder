import '../mock';
import { createRoot } from 'react-dom/client';
import App from 'renderer/App';

// Same as src/renderer/index.tsx.
createRoot(document.getElementById('root') as HTMLElement).render(<App />);
