import { describe, expect, it } from 'vitest';

import { decideResponseReuse } from '@/server/survey-response/domain/lifecycle';

// sweep_stale_sessions() pg_cron 이 3시간 유휴 in_progress 를 drop 으로 바꾸면서
// is_completed 는 false 로 남긴다. 컨택 재사용 조회는 is_completed=false 만 보므로
// drop 행을 "활성"으로 집어오고, 쓰기(applyQuestionResponseUpdate)는 status='in_progress'
// 를 요구해 0행 → '응답을 수정할 수 없습니다.' 500 이 났다.
describe('decideResponseReuse', () => {
  it('in_progress 는 그대로 재사용한다', () => {
    expect(decideResponseReuse('in_progress', { hasContact: true })).toEqual({ action: 'reuse' });
  });

  it('drop 은 되살려서 재사용한다', () => {
    expect(decideResponseReuse('drop', { hasContact: true })).toEqual({ action: 'revive' });
  });

  it('quotaful_out 은 정원 마감으로 차단한다', () => {
    expect(decideResponseReuse('quotaful_out', { hasContact: true })).toEqual({
      action: 'blocked',
      reason: 'quota_closed',
    });
  });

  it('컨택 연결 종결 상태는 초대 링크 사용 완료로 차단한다', () => {
    for (const status of ['completed', 'screened_out', 'bad'] as const) {
      expect(decideResponseReuse(status, { hasContact: true })).toEqual({
        action: 'blocked',
        reason: 'token_already_used',
      });
    }
  });

  it('컨택 없는 종결 상태는 기기 기준 중복으로 차단한다', () => {
    expect(decideResponseReuse('completed', { hasContact: false })).toEqual({
      action: 'blocked',
      reason: 'device_already_responded',
    });
  });

  it('알 수 없는 status 는 재사용하지 않고 차단한다', () => {
    expect(decideResponseReuse('weird_status', { hasContact: true })).toEqual({
      action: 'blocked',
      reason: 'token_already_used',
    });
  });
});

// 테스트 링크로 완료한 뒤 같은 링크로 다시 들어오면 처음부터 다시 응답할 수 있어야 한다.
// 완화는 유효 테스트 세션에서만 적용되며, 실응답 판정과 알 수 없는 status 는 그대로 차단이다.
describe('decideResponseReuse - 테스트 세션', () => {
  const real = { hasContact: false, isTestSession: false };
  const test = { hasContact: false, isTestSession: true };

  it('진행 중은 실응답·테스트 모두 재사용', () => {
    expect(decideResponseReuse('in_progress', real).action).toBe('reuse');
    expect(decideResponseReuse('in_progress', test).action).toBe('reuse');
  });

  it('이탈은 실응답·테스트 모두 되살려 재사용', () => {
    expect(decideResponseReuse('drop', real).action).toBe('revive');
    expect(decideResponseReuse('drop', test).action).toBe('revive');
  });

  it('완료는 실응답이면 차단, 테스트면 재시작', () => {
    expect(decideResponseReuse('completed', real)).toEqual({
      action: 'blocked',
      reason: 'device_already_responded',
    });
    expect(decideResponseReuse('completed', test).action).toBe('restart');
  });

  it('screened_out·bad·quotaful_out 도 테스트면 재시작', () => {
    for (const status of ['screened_out', 'bad', 'quotaful_out']) {
      expect(decideResponseReuse(status, test).action).toBe('restart');
    }
  });

  it('알 수 없는 status 는 테스트여도 차단한다', () => {
    // 보수적 기본값 유지 — 모르는 상태를 재시작으로 흘리면 쓰기 가드에서 500 이 된다.
    expect(decideResponseReuse('없는상태', test).action).toBe('blocked');
  });

  it('실응답 판정은 기존 그대로', () => {
    expect(decideResponseReuse('completed', { hasContact: true, isTestSession: false })).toEqual({
      action: 'blocked',
      reason: 'token_already_used',
    });
  });

  it('isTestSession 미지정은 실응답과 동일하게 판정한다', () => {
    expect(decideResponseReuse('completed', { hasContact: false })).toEqual({
      action: 'blocked',
      reason: 'device_already_responded',
    });
  });
});
