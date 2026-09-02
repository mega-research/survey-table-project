import 'server-only';

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

/** 표 답변처럼 셀 id 로 키가 잡힌 한 단계 객체 — 배열·null 은 제외. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 암호화 대상 — 질문 단위(값 전체) + 표 input 셀 단위(questionId → cellId 집합).
 * 스냅샷 ∪ 라이브 플래그 합집합으로 만들어진다 (response.service loadPiiTargets).
 */
export interface PiiTargets {
  questionIds: ReadonlySet<string>;
  cellIds: ReadonlyMap<string, ReadonlySet<string>>;
}

export const EMPTY_PII_TARGETS: PiiTargets = { questionIds: new Set(), cellIds: new Map() };

export function hasPiiTargets(targets: PiiTargets): boolean {
  return targets.questionIds.size > 0 || targets.cellIds.size > 0;
}

/** 단건 저장 경로용 — 질문 하나의 플래그 (assertQuestionBelongsToResponse 반환). */
export interface QuestionPiiFlag {
  piiEncrypted: boolean;
  piiCellIds: readonly string[];
}

/** 비어있지 않은 string 만 암호화. 이미 암호문이면 통과(이중 암호화 방지). */
export function encryptAnswerValue(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  if (isEncryptedAnswerValue(value)) return value;
  return encryptPii(value);
}

/**
 * 표 답변 객체에서 지정한 셀의 string 값만 암호화한 새 객체를 반환한다 (원본 불변).
 * 객체가 아닌 값(단답 문자열·체크박스 배열 등)은 그대로 통과한다.
 */
export function encryptTableCellValues(value: unknown, cellIds: ReadonlySet<string>): unknown {
  if (!isPlainObject(value) || cellIds.size === 0) return value;
  const out: Record<string, unknown> = {};
  for (const [cellId, cellValue] of Object.entries(value)) {
    out[cellId] = cellIds.has(cellId) ? encryptAnswerValue(cellValue) : cellValue;
  }
  return out;
}

/** 질문 하나의 플래그에 따라 값 전체(질문 단위) 또는 지정 셀(셀 단위)만 암호화한다. */
export function encryptAnswerForQuestion(value: unknown, flag: QuestionPiiFlag): unknown {
  if (flag.piiEncrypted) return encryptAnswerValue(value);
  if (flag.piiCellIds.length > 0) return encryptTableCellValues(value, new Set(flag.piiCellIds));
  return value;
}

function decryptString(
  value: string,
  ctx?: { responseId?: string; questionId?: string },
): string {
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

/**
 * 접두사가 있으면 복호화 시도, 실패하면 원문 반환.
 * 표 답변 객체(셀 id → 값)는 한 단계 내려가 암호문 셀만 푼다 — 읽기 경계는 질문 메타데이터
 * 없이 접두사만 본다는 ADR-0012 원칙 그대로. 배열·중첩 객체는 손대지 않는다.
 * export/분석이 죽지 않는 것이 우선 — 값 자체는 절대 로깅하지 않는다(좌표만).
 */
export function decryptAnswerValue(
  value: unknown,
  ctx?: { responseId?: string; questionId?: string },
): unknown {
  if (isEncryptedAnswerValue(value)) return decryptString(value, ctx);
  if (isPlainObject(value)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [cellId, cellValue] of Object.entries(value)) {
      if (isEncryptedAnswerValue(cellValue)) {
        out[cellId] = decryptString(cellValue, ctx);
        changed = true;
      } else {
        out[cellId] = cellValue;
      }
    }
    return changed ? out : value;
  }
  return value;
}

/**
 * 암호화 대상(질문 단위 + 표 셀 단위)에 해당하는 값만 암호화한 새 객체를 반환한다 (원본 불변).
 * ReadonlySet 을 넘기면 질문 단위 대상만으로 해석한다 (기존 호출 호환).
 */
export function encryptResponsesForStorage(
  responses: Record<string, unknown>,
  targets: PiiTargets | ReadonlySet<string>,
): Record<string, unknown> {
  const resolved: PiiTargets =
    targets instanceof Set ? { questionIds: targets, cellIds: new Map() } : (targets as PiiTargets);
  if (!hasPiiTargets(resolved)) return { ...responses };
  const out: Record<string, unknown> = {};
  for (const [qid, value] of Object.entries(responses)) {
    if (resolved.questionIds.has(qid)) {
      out[qid] = encryptAnswerValue(value);
      continue;
    }
    const cells = resolved.cellIds.get(qid);
    out[qid] = cells && cells.size > 0 ? encryptTableCellValues(value, cells) : value;
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
