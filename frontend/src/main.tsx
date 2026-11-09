import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import { AuthProvider } from './context/AuthProvider'
import { applyTheme, initialTheme } from './context/theme'
import { ThemeProvider } from './context/ThemeProvider'
import { useTheme } from './context/theme'
import { createQueryClient } from './services/queryClient'
import './index.css'

// Apply the theme before the first paint (no inline scripts: CSP is default-src 'self').
applyTheme(initialTheme())

const queryClient = createQueryClient()

function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} richColors closeButton position="bottom-right" />
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
        <ThemedToaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
