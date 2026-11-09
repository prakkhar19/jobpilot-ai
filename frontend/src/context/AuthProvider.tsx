import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { onUnauthorized } from '@/services/api'
import { authService } from '@/services/auth'
import type { AuthStatus, User } from '@/types/api'
import { AUTH_QUERY_KEY, AuthContext, type AuthContextValue } from './auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: AUTH_QUERY_KEY, queryFn: authService.status, staleTime: 60_000, retry: 1 })

  const setStatus = useCallback(
    (s: AuthStatus) => {
      qc.setQueryData(AUTH_QUERY_KEY, s)
    },
    [qc],
  )

  useEffect(() => {
    onUnauthorized(() => {
      const prev = qc.getQueryData<AuthStatus>(AUTH_QUERY_KEY)
      if (prev?.user) {
        // Session expired or revoked: drop cached private data and fall back to the login screen.
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_QUERY_KEY[0] })
        qc.setQueryData<AuthStatus>(AUTH_QUERY_KEY, { ...prev, user: null, csrf_token: null })
      }
    })
    return () => onUnauthorized(null)
  }, [qc])

  const login = useCallback(
    async (email: string, password: string) => {
      const s = await authService.login(email, password)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_QUERY_KEY[0] })
      setStatus(s)
      return s
    },
    [qc, setStatus],
  )

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      const s = await authService.register(email, password, fullName)
      setStatus(s)
      return s
    },
    [setStatus],
  )

  const logout = useCallback(async () => {
    try {
      await authService.logout()
    } finally {
      const prev = qc.getQueryData<AuthStatus>(AUTH_QUERY_KEY)
      qc.clear()
      qc.setQueryData<AuthStatus>(AUTH_QUERY_KEY, {
        registration_open: prev?.registration_open ?? false,
        single_user_mode: prev?.single_user_mode ?? false,
        demo_mode: prev?.demo_mode ?? false,
        user: null,
        csrf_token: null,
      })
    }
  }, [qc])

  const setUser = useCallback(
    (user: User) => {
      const prev = qc.getQueryData<AuthStatus>(AUTH_QUERY_KEY)
      if (prev) qc.setQueryData<AuthStatus>(AUTH_QUERY_KEY, { ...prev, user })
    },
    [qc],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      status: query.data,
      user: query.data?.user ?? null,
      loading: query.isPending,
      error: query.error,
      login,
      register,
      logout,
      setUser,
      refresh: query.refetch,
    }),
    [query.data, query.isPending, query.error, query.refetch, login, register, logout, setUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
