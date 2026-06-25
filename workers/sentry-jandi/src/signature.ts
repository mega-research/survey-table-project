const encoder = new TextEncoder();

export async function signSentryWebhookBody(rawBody: string, clientSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(clientSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));

  return bytesToHex(new Uint8Array(signature));
}

export async function verifySentryWebhookSignature(
  rawBody: string,
  signature: string | null,
  clientSecret: string,
): Promise<boolean> {
  if (!signature || clientSecret.trim().length === 0) {
    return false;
  }

  const expectedSignature = await signSentryWebhookBody(rawBody, clientSecret);
  return constantTimeEquals(expectedSignature, signature.trim().toLowerCase());
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return diff === 0;
}
