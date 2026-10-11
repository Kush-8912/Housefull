import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import './index.css';

// On phones toasts drop from the top, so they never cover the
// checkout bar along the bottom of the event page.
const phone = window.matchMedia('(max-width: 639px)');
const subscribe = (cb) => { phone.addEventListener('change', cb); return () => phone.removeEventListener('change', cb); };

function Toasts() {
  const isPhone = useSyncExternalStore(subscribe, () => phone.matches);
  return (
    <Toaster
      theme="dark"
      position={isPhone ? 'top-center' : 'bottom-center'}
      toastOptions={{
        classNames: {
          toast: '!rounded-[4px] !border !border-line-strong !bg-ink-850 !font-sans !text-fg !shadow-2xl !shadow-black/50',
          description: '!text-muted',
          success: '!border-l-2 !border-l-go [&_[data-icon]]:!text-go',
          error: '!border-l-2 !border-l-stop [&_[data-icon]]:!text-stop',
          warning: '!border-l-2 !border-l-warn [&_[data-icon]]:!text-warn',
        },
      }}
    />
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toasts />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
