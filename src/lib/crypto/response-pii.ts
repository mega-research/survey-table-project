import * as Sentry from '@sentry/nextjs';

import { decryptPii, encryptPii } from './aes';

/**
 * 응답 PII 인라인 암호화 헬퍼 (ADR-0012)
 *
 * PII 문항(단답형·장문형, questions.pii_encrypted)의 응답값을 기존 컬럼 자리에
 * encryptPii 암호문("v1:...")으로 치환 저장한다. 값이 자기서술적이므로 읽기 경계는
 * 질문 메타데이터 없이 접두사만으로 복호화를 판단한다 — 수집 도중 토글이 바뀌어
 * 평문/암호문이 섞여도 값 단위로 안전하다.
 */

// encryptPii 출력의 키 버전 접두사 (v1:, v2: ...)
const CIPHERTEXT_PREFIX = /^v\d+:/;

export function isEncryptedAnswerValue(value: unknown): value is string {
  return typeof value === 'string' && CIPHERTEXT_PREFIX.test(value);
}

/** 비어있지 않은 string 만 암호화. 이미 암호문이면 통과(이중 암호화 방지). */
export function encryptAnswerValue(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  if (isEncryptedAnswerValue(value)) return value;
  return encryptPii(value);
}

/**
 * 접두사가 있으면 복호화 시도, 실패하면 원문 반환.
 * export/분석이 죽지 않는 것이 우선 — 값 자체는 절대 로깅하지 않는다(좌표만).
 */
export function decryptAnswerValue(
  value: unknown,
  ctx?: { responseId?: string; questionId?: string },
): unknown {
  if (!isEncryptedAnswerValue(value)) return value;
  try {
    return decryptPii(value);
  } catch {
    Sentry.captureMessage('response-pii: 복호화 실패 — 원문 유지', {
      level: 'warning',
      extra: { responseId: ctx?.responseId, questionId: ctx?.questionId },
    });
    return value;
  }
}

/** PII 문항 id 집합에 해당하는 값만 암호화한 새 객체를 반환한다 (원본 불변). */
export function encryptResponsesForStorage(
  responses: Record<string, unknown>,
  piiQuestionIds: ReadonlySet<string>,
): Record<string, unknown> {
  if (piiQuestionIds.size === 0) return { ...responses };
  const out: Record<string, unknown> = {};
  for (const [qid, value] of Object.entries(responses)) {
    out[qid] = piiQuestionIds.has(qid) ? encryptAnswerValue(value) : value;
  }
  return out;
}

/** 최상위 string 값의 암호문을 전부 복호화한 새 객체를 반환한다 (접두사 감지). */
export function decryptQuestionResponses(
  responses: Record<string, unknown>,
  ctx?: { responseId?: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [qid, value] of Object.entries(responses)) {
    const decryptCtx: { responseId?: string; questionId?: string } = { questionId: qid };
    if (ctx?.responseId) decryptCtx.responseId = ctx.responseId;
    out[qid] = decryptAnswerValue(value, decryptCtx);
  }
  return out;
}
