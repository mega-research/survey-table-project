import { describe, expect, it } from 'vitest';

import { toGateBlockReason } from '@/features/survey-response/domain/gate-block-reason';

// 가용성 게이트 위반은 예상 가능한 도메인 상태다. 500 으로 새면 응답자는 "Internal server
// error" 만 보고 왜 막혔는지 알 수 없고, 클라이언트가 차단을 인지하지 못해 클릭할 때마다
// 무의미한 INSERT 를 계속 쏜다.
describe('toGateBlockReason', () => {
  it('중단 모드는 기존 survey_paused 화면으로 보낸다', () => {
    expect(toGateBlockReason('survey_paused')).toBe('survey_paused');
  });

  it('invite 필요는 초대 링크 안내로 보낸다', () => {
    expect(toGateBlockReason('invite_required')).toBe('invalid_token');
  });

  it('미배포·마감·정원·버전 문제는 모두 not_accepting 으로 접는다', () => {
    // 응답자에게 내부 사유를 세분해 노출하지 않는다 — 화면 문구는 하나면 충분하다.
    expect(toGateBlockReason('status_not_published')).toBe('not_accepting');
    expect(toGateBlockReason('end_date_passed')).toBe('not_accepting');
    expect(toGateBlockReason('max_responses_reached')).toBe('not_accepting');
    expect(toGateBlockReason('survey_not_found')).toBe('not_accepting');
    expect(toGateBlockReason('version_mismatch')).toBe('not_accepting');
    expect(toGateBlockReason('version_not_active')).toBe('not_accepting');
  });

  it('변조 가드 사유는 접지 않는다', () => {
    // answer_value_too_large 는 가용성 문제가 아니라 거대 JSONB 주입 차단이다.
    // blocked 로 접으면 "응답을 받지 않습니다" 라는 틀린 안내가 나가고 공격 신호도 묻힌다.
    expect(toGateBlockReason('answer_value_too_large')).toBeNull();
  });

  it('모르는 사유는 접지 않는다', () => {
    // reason 은 string 이라 미지의 값이 올 수 있다. 안전한 쪽(그대로 throw)으로 닫는다.
    expect(toGateBlockReason('무언가_새로운_사유')).toBeNull();
  });
});
