import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabasePublicEnv } from '@/lib/supabase/env';
import type { Database } from '@/types/database';

export function createClient(): SupabaseClient<Database> {
  const { url, anonKey } = getSupabasePublicEnv();

  return createBrowserClient<Database, 'public'>(url, anonKey);
}
