import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { beginCodeConnection } from '@/lib/oauth/code-connection';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const base = process.env.APP_URL!;
  if (req.headers.get('origin') !== new URL(base).origin) {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  }
  return startCodeAuthorization();
}

// Opening the link in a new tab (including embedded browsers) uses GET.
export async function GET(req: NextRequest) {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.redirect(`${process.env.APP_URL}/app/connect/yandex-code`, 303);
  }
  return startCodeAuthorization();
}

async function startCodeAuthorization() {
  const base = process.env.APP_URL!;
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${base}/connect`, 303);
  try {
    const attempt = await beginCodeConnection(user.id);
    const response = NextResponse.redirect(attempt.url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set('ohmy_yandex_code', attempt.id, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/app/connect', maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.redirect(`${base}/app/connect/yandex-code?error=start`, 303);
  }
}
