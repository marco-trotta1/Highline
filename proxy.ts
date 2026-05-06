import { NextRequest, NextResponse } from 'next/server';

const REALM = 'Highline';

function unauthorized(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
    },
  });
}

function parseBasicAuth(header: string | null): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;

  try {
    const decoded = atob(header.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function hasAccess(request: NextRequest): boolean {
  const expectedUser = process.env.HIGHLINE_ACCESS_USER;
  const expectedPassword = process.env.HIGHLINE_ACCESS_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return true;
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'));
  return (
    credentials?.user === expectedUser &&
    credentials.password === expectedPassword
  );
}

export function proxy(request: NextRequest) {
  if (!hasAccess(request)) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
