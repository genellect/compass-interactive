import { supabase } from '../../lib/supabaseClient'

type EdgeFunctionInvokeOptions = NonNullable<
  Parameters<typeof supabase.functions.invoke>[1]
>

export function invokeEdgeFunction<T>(
  functionName: string,
  options: EdgeFunctionInvokeOptions,
) {
  return supabase.functions.invoke<T>(functionName, options)
}
