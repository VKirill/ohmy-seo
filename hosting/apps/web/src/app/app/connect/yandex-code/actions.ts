'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { completeCodeConnection } from '@/lib/oauth/code-connection';

const COOKIE = 'ohmy_yandex_code';
const PAGE = '/app/connect/yandex-code';

export async function submitCodeConnection(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/');
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value ?? '';
  jar.set(COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/app/connect', maxAge: 0 });
  try { await completeCodeConnection(user.id, id, String(form.get('code') ?? '')); }
  catch { redirect(`${PAGE}?error=code`); }
  redirect('/app?connected=yandex');
}
