import { createSign } from 'node:crypto';

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri: string;
  auth_uri: string;
}

export function parseServiceAccountJson(jsonString: string): ServiceAccountKey {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonString) as Record<string, unknown>;
  } catch {
    throw new Error('parseServiceAccountJson: invalid JSON');
  }

  if (raw['type'] !== 'service_account') {
    throw new Error(
      `parseServiceAccountJson: "type" must be "service_account", got "${raw['type']}"`
    );
  }

  const required = ['project_id', 'private_key_id', 'private_key', 'client_email', 'client_id'] as const;
  for (const field of required) {
    if (!raw[field] || typeof raw[field] !== 'string') {
      throw new Error(`parseServiceAccountJson: missing or invalid field "${field}"`);
    }
  }

  return {
    type: raw['type'] as string,
    project_id: raw['project_id'] as string,
    private_key_id: raw['private_key_id'] as string,
    private_key: raw['private_key'] as string,
    client_email: raw['client_email'] as string,
    client_id: raw['client_id'] as string,
    token_uri: (typeof raw['token_uri'] === 'string' && raw['token_uri'])
      ? raw['token_uri']
      : DEFAULT_TOKEN_URI,
    auth_uri: (typeof raw['auth_uri'] === 'string' && raw['auth_uri'])
      ? raw['auth_uri']
      : 'https://accounts.google.com/o/oauth2/auth',
  };
}

function toBase64url(input: string | Buffer): string {
  const b64 = Buffer.isBuffer(input)
    ? input.toString('base64')
    : Buffer.from(input).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export interface SignJwtAssertionParams {
  sa: ServiceAccountKey;
  scopes: string[];
  subject?: string;
}

export function signJwtAssertion({ sa, scopes, subject }: SignJwtAssertionParams): string {
  const now = Math.floor(Date.now() / 1000);

  const header = toBase64url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id })
  );

  const payloadObj: Record<string, string | number> = {
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  if (subject) {
    payloadObj['sub'] = subject;
  }

  const payload = toBase64url(JSON.stringify(payloadObj));
  const signingInput = `${header}.${payload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(sa.private_key);
  const sigB64 = toBase64url(sig);

  return `${signingInput}.${sigB64}`;
}

export interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface ExchangeJwtParams {
  assertion: string;
  tokenUri?: string;
}

export async function exchangeJwtForAccessToken({
  assertion,
  tokenUri = DEFAULT_TOKEN_URI,
}: ExchangeJwtParams): Promise<AccessTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    let errBody = await res.text().catch(() => '<unreadable>');
    // Redact any sensitive fields that might appear in error response bodies
    errBody = errBody.replace(
      /"(private_key|access_token|refresh_token)":\s*"[^"]*"/g,
      '"$1":"[REDACTED]"'
    );
    throw new Error(
      `exchangeJwtForAccessToken: HTTP ${res.status} from ${tokenUri}: ${errBody}`
    );
  }

  return res.json() as Promise<AccessTokenResponse>;
}
