import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MobileApp } from './mobile/MobileApp';
import './fonts';
import './styles.css';
import './fx.css';

/** Phones get the mobile mode; ?m=1 forces it, and "Full editor" in it saves the choice to stay on the desktop editor. */
function wantsMobile() {
  const q = new URLSearchParams(location.search);
  if (q.has('m')) return q.get('m') !== '0';
  let pref = '';
  try {
    pref = localStorage.getItem('studio.ui') || '';
  } catch {}
  if (pref) return pref === 'mobile';
  return matchMedia('(max-width: 820px) and (pointer: coarse)').matches;
}

const mobile = wantsMobile();
if (mobile) {
  try {
    if (new URLSearchParams(location.search).get('m') === '1') localStorage.removeItem('studio.ui');
  } catch {}
}
createRoot(document.getElementById('root')!).render(mobile ? <MobileApp /> : <App />);
