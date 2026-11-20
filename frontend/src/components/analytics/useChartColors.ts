import { useTheme } from '@/context/theme'

// Categorical slots 1–3, stepped separately for each surface (validated reference palette).
const LIGHT = { series: ['#7a9e00', '#0a0a0a', '#9a9a95'], grid: '#e3e3e0', axis: '#6b6b67', surface: '#ffffff' }
const DARK = { series: ['#d4f53c', '#ffffff', '#7a7a7a'], grid: '#242424', axis: '#8e8e8e', surface: '#111111' }

export function useChartColors() {
  const { theme } = useTheme()
  return theme === 'dark' ? DARK : LIGHT
}
