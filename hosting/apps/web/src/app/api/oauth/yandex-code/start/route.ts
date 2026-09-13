import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { beginCodeConnection } from '@/lib/oauth/code-connection';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const base = process.env.APP_URL!;
  if (req.headers.get('origin') !== new URL(base).origin) {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${base}/`, 303);
  try {
    const attempt = await beginCodeConnection(user.id);
    const response = NextResponse.redirect(attempt.url, 303);
    response.cookies.set('ohmy_yandex_code', attempt.id, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/app/connect', maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.redirect(`${base}/app/connect/yandex-code?error=start`, 303);
  }
}
