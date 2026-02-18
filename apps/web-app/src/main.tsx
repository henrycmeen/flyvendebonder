import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import { ErrorBoundary } from '@/components/error-boundary'
import { logToClient } from '@/lib/client-logger'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={150}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </TooltipProvider>
  </StrictMode>,
)

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as { message?: string; stack?: string } | string | Error | undefined;
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Ukjent rejection";
  const details = reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason;
  console.error("Unhandled promise rejection", reason);
  logToClient("error", `Unhandled promise rejection: ${message}`, null, details);
});

window.addEventListener("error", (event) => {
  if (event.error instanceof Error) {
    console.error("Global JS-feil", event.error);
    logToClient("error", "Global JS-feil", null, {
      message: event.error.message,
      stack: event.error.stack,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
    return;
  }
  console.error("Global feil", event.message);
  logToClient("error", "Global JS-feil", null, event.message);
});
