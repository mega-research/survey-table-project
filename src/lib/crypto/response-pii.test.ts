import { describe, expect, it, vi } from 'vitest';

// Sentry 는 실전송 방지용 목 — 호출 여부만 검증
vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

// getKey 가 호출 시점에 env 를 읽으므로 import 전 세팅이면 충분하지만,
// 파일 최상단에서 확정해 순서 이슈를 원천 차단한다.
process.env['CONTACT_PII_AES_KEY'] = Buffer.alloc(32, 7).toString('base64');

import {
  decryptAnswerValue,
  decryptQuestionResponses,
  encryptAnswerValue,
  encryptResponsesForStorage,
  isEncryptedAnswerValue,
} from '@/lib/crypto/response-pii';

describe('encryptAnswerValue / decryptAnswerValue', () => {
  it('문자열을 암호화하면 v1: 접두사 토큰이 되고 복호화하면 원문으로 돌아온다', () => {
    const enc = encryptAnswerValue('김철수');
    expect(typeof enc).toBe('string');
    expect(enc as string).toMatch(/^v\d+:/);
    expect(decryptAnswerValue(enc)).toBe('김철수');
  });

  it('빈 문자열과 non-string 값은 그대로 통과한다', () => {
    expect(encryptAnswerValue('')).toBe('');
    expect(encryptAnswerValue(null)).toBe(null);
    expect(encryptAnswerValue(undefined)).toBe(undefined);
    expect(encryptAnswerValue(42)).toBe(42);
    expect(encryptAnswerValue(['a'])).toEqual(['a']);
    expect(encryptAnswerValue({ k: 'v' })).toEqual({ k: 'v' });
  });

  it('이미 암호문인 값은 이중 암호화하지 않는다', () => {
    const once = encryptAnswerValue('010-1234-5678');
    const twice = encryptAnswerValue(once);
    expect(twice).toBe(once);
  });

  it('위조 v1: 값은 복호화 실패 시 원문을 반환한다 (throw 금지)', () => {
    const forged = 'v1:' + Buffer.alloc(40, 1).toString('base64');
    expect(decryptAnswerValue(forged)).toBe(forged);
  });

  it('접두사 없는 평문은 복호화 시도 없이 그대로 반환한다', () => {
    expect(decryptAnswerValue('그냥 평문')).toBe('그냥 평문');
    expect(isEncryptedAnswerValue('그냥 평문')).toBe(false);
  });
});

describe('encryptResponsesForStorage / decryptQuestionResponses', () => {
  it('PII 문항 id 의 string 값만 암호화하고 나머지는 보존한다', () => {
    const responses = { q1: '김철수', q2: '서울시', q3: ['a', 'b'], q4: 3 };
    const out = encryptResponsesForStorage(responses, new Set(['q1', 'q3', 'q4']));
    expect(out['q1']).toMatch(/^v\d+:/);
    expect(out['q2']).toBe('서울시'); // 비 PII 문항은 평문 유지
    expect(out['q3']).toEqual(['a', 'b']); // 배열은 대상 아님
    expect(out['q4']).toBe(3); // 숫자는 대상 아님
    // 원본 불변
    expect(responses['q1']).toBe('김철수');
  });

  it('혼재 데이터(평문+암호문)를 복호화하면 암호문만 풀린다', () => {
    const enc = encryptResponsesForStorage({ q1: '김철수' }, new Set(['q1']));
    const mixed = { ...enc, q2: '평문 답변', q3: ['a'] };
    const out = decryptQuestionResponses(mixed);
    expect(out).toEqual({ q1: '김철수', q2: '평문 답변', q3: ['a'] });
  });
});
