import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from '@/services/api'

interface Options<TData, TVars> {
  mutationFn: (vars: TVars) => Promise<TData>
  success?: string | ((data: TData, vars: TVars) => string | null)
  error?: string
  invalidate?: QueryKey[]
  onSuccess?: (data: TData, vars: TVars) => void
}

/** useMutation + toast on success/failure + query invalidation. */
export function useMutationToast<TData = unknown, TVars = void>(opts: Options<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    mutationFn: opts.mutationFn,
    onSuccess: (data, vars) => {
      const msg = typeof opts.success === 'function' ? opts.success(data, vars) : opts.success
      if (msg) toast.success(msg)
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key })
      opts.onSuccess?.(data, vars)
    },
    onError: (err) => {
      toast.error(opts.error ?? 'Action failed', { description: errorMessage(err) })
    },
  })
}
