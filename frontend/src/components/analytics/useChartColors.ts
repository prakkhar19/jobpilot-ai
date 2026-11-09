import { useTheme } from '@/context/theme'

// Categorical slots 1–3, stepped separately for each surface (validated reference palette).
const LIGHT = { series: ['#2a78d6', '#eb6834', '#1baf7a'], grid: '#e4e7ec', axis: '#667085', surface: '#ffffff' }
const DARK = { series: ['#3987e5', '#d95926', '#199e70'], grid: '#252a35', axis: '#8a93a3', surface: '#12151c' }

export function useChartColors() {
  const { theme } = useTheme()
  return theme === 'dark' ? DARK : LIGHT
}
