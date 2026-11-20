import { useTheme } from '@/context/theme'

// Categorical slots 1–3, stepped separately for each surface (validated reference palette).
const LIGHT = { series: ['#15a34a', '#0d9488', '#d97706'], grid: '#dfe6e4', axis: '#61716d', surface: '#ffffff' }
const DARK = { series: ['#3ee05f', '#2dd4bf', '#f5c542'], grid: '#1f2b2c', axis: '#84918f', surface: '#111a1b' }

export function useChartColors() {
  const { theme } = useTheme()
  return theme === 'dark' ? DARK : LIGHT
}
