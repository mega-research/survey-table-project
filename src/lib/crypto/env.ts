const REQUIRED_KEY_BYTES = 32;

function assertKey(envName: string, optional = false): void {
  const raw = process.env[envName];
  if (!raw) {
    if (optional) return;
    throw new Error(`${envName} env required (base64 ${REQUIRED_KEY_BYTES} bytes)`);
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== REQUIRED_KEY_BYTES) {
    throw new Error(
      `${envName} must decode to ${REQUIRED_KEY_BYTES} bytes (got ${decoded.length})`,
    );
  }
}

export function assertCryptoEnv(): void {
  assertKey('CONTACT_PII_AES_KEY');
  assertKey('CONTACT_PII_HMAC_KEY');
  // 키 로테이션 진행 중일 때만 활성화. 평시엔 미설정 OK.
  assertKey('CONTACT_PII_AES_KEY_V2', true);
}
