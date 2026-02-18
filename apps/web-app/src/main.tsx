import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={150}>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
