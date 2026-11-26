import { createHash } from 'node:crypto';
import 'server-only';

/**
 * 중복 감지 솔트를 섞은 해시 — 응답의 접속 신호(`survey_responses.ip_hash`·`fp_hash`)와
 * 메일 링크 클릭의 IP 해시(`mail_link_clicks.ip_hash`)가 함께 쓴다. 두 값을 나중에 맞춰 볼 수 있으려면
 * 식이 같아야 하므로 한 곳에 둔다(ADR 0042).
 *
 * 솔트가 없으면 처음 import 될 때 바로 던진다 — 조용히 넘어가면 중복 차단이 무력화된다.
 * 한 번 정한 솔트는 바꾸지 말 것 — 바꾸면 그 전의 해시가 전부 쓸모없어진다.
 */
const SALT = process.env['DUPLICATE_DETECTION_SALT'];
if (!SALT) {
  throw new Error(
    'DUPLICATE_DETECTION_SALT not set. Add to .env.local (dev) and deploy env (prod/CI).',
  );
}

/** 입력에 솔트를 붙인 sha256 16진 문자열. */
export function saltedHash(input: string): string {
  return createHash('sha256')
    .update(input + SALT)
    .digest('hex');
}

/** IP 주소의 해시 — 앞뒤 공백만 걷어 낸다. 비어 있으면 null(IP 신호 없음). */
export function hashClientIp(ip: string | null | undefined): string | null {
  const trimmed = ip?.trim();
  return trimmed ? saltedHash(trimmed) : null;
}
