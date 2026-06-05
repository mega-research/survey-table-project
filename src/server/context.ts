import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { db } from '@/db';
import { createClient } from '@/lib/supabase/server';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface ORPCContext {
  db: typeof db;
  supabase: SupabaseClient;
  user: AuthUser | null;
}

/**
 * RSC와 procedure 양쪽이 재사용하는 요청 컨텍스트.
 * supabase 세션을 한 번 읽어 user를 채운다(없으면 null).
 */
export async function createContext(): Promise<ORPCContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    db,
    supabase,
    user: user ? { id: user.id, email: user.email ?? null } : null,
  };
}
