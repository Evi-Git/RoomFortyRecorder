// ?entry=logs-explorer loads /entries/logs-explorer.js
const entry =
  new URLSearchParams(location.search).get('entry') || 'logs-explorer';
const s = document.createElement('script');
s.type = 'module';
s.src = `/entries/${entry}.js`;
document.body.appendChild(s);
