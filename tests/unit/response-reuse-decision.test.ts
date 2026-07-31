import { describe, expect, it } from 'vitest';

import { decideResponseReuse } from '@/features/survey-response/domain/lifecycle';

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
