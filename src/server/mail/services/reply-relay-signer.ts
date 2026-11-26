import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { InternalFailure } from '@/server/internal-failure';

import { RELAY_SIGNATURE_LENGTH, type RelaySigner } from '../domain/reply-relay';

/**
 * 중계 주소의 서명기 — HMAC-SHA256 을 소문자 16진 앞 10자로 자른다. 규칙(재료·주소 모양)은 `domain/reply-relay`.
 * 비교는 상수 시간이다(`timingSafeEqual`) — 서명을 한 글자씩 맞혀 보는 길을 막는다.
 */
export function createRelaySigner(secret: string): RelaySigner {
  const sign = (material: string): string =>
    createHmac('sha256', secret).update(material, 'utf8').digest('hex').slice(0, RELAY_SIGNATURE_LENGTH);
  return {
    sign,
    matches(material, signature) {
      const expected = Buffer.from(sign(material), 'utf8');
      const given = Buffer.from(signature, 'utf8');
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
  };
}

/**
 * 운영 서명기 — 키는 `RESEND_WEBHOOK_SECRET` 을 그대로 쓴다(새 환경 변수 없음. 웹훅 라우트가 이미 필수로 요구한다).
 * 재료에 용도 접두가 있어 웹훅 서명과 섞이지 않는다.
 *
 * **이 값을 바꾸면 이미 나간 전달 메일의 중계 주소가 전부 죽는다** — 그 메일에 담당자가 「답장」을 누르면
 * 서명이 틀린 주소가 되어 응답자에게 가지 않는다(회사 도메인에서 온 메일로 걸러진다).
 * 없으면 던진다 — 서명 없는 주소를 조용히 내보내지 않는다.
 */
export function requireRelaySigner(): RelaySigner {
  const secret = process.env['RESEND_WEBHOOK_SECRET'];
  if (!secret) throw new InternalFailure('RESEND_WEBHOOK_SECRET 환경변수가 설정되지 않았습니다.');
  return createRelaySigner(secret);
}
