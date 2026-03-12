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
import { ApiError } from '@/lib/api'
import { setupBrowserDiagnostics } from '@/lib/browser-diagnostics'

setupBrowserDiagnostics()

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
  if (reason instanceof ApiError && reason.status === 0 && reason.message === "Request avbrutt") {
    event.preventDefault();
    return;
  }
  if (reason instanceof DOMException && reason.name === "AbortError") {
    event.preventDefault();
    return;
  }
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

window.addEventListener(
  "error",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const isImage = target instanceof HTMLImageElement;
    const isScript = target instanceof HTMLScriptElement;
    const isStylesheet = target instanceof HTMLLinkElement && target.rel === "stylesheet";
    if (!isImage && !isScript && !isStylesheet) return;

    const source =
      (target instanceof HTMLImageElement || target instanceof HTMLScriptElement ? target.src : target.href) || "(ukjent)";
    const tag = target.tagName.toLowerCase();
    const message = `Ressursfeil: ${tag} ${source}`;
    console.error(message);
    logToClient("error", message);
  },
  true,
);
