import { createContext, useContext } from 'react'
import type { AuthStatus, User } from '@/types/api'

export interface AuthContextValue {
  status: AuthStatus | undefined
  user: User | null
  loading: boolean
  error: unknown
  login: (email: string, password: string) => Promise<AuthStatus>
  register: (email: string, password: string, fullName: string) => Promise<AuthStatus>
  logout: () => Promise<void>
  setUser: (user: User) => void
  refresh: () => Promise<unknown>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export const AUTH_QUERY_KEY = ['auth', 'status'] as const

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
