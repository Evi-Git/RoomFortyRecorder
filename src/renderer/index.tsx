import { createRoot } from 'react-dom/client';
import App from './App';

// A load the Content-Security-Policy (index.ejs, csp.js) blocked shows up in
// the app log; the main process forwards "[CSP]" console lines.
document.addEventListener('securitypolicyviolation', (e) => {
  console.warn('[CSP] blocked', e.violatedDirective, e.blockedURI);
});

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(<App />);
