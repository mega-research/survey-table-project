import { describe, expect, it } from 'vitest';

import { publishConfirmMessage } from './publish-confirm-message';

/**
 * 배포 확인 창의 문구.
 *
 * 종료된 설문을 다시 배포하면 종료가 풀린다(ADR-0030). 배포는 「이 설문을 다시 돌린다」는
 * 뜻이라 따로 막지 않지만, **오탈자 하나 고치려던 배포가 닫아 둔 외부 접근을 조용히 여는 일**은
 * 없어야 한다 — 확인 창이 그 사실을 말한다.
 */
describe('publishConfirmMessage', () => {
  it('종료되지 않은 설문은 종전 문구 그대로다', () => {
    expect(publishConfirmMessage({ migratableCount: 0, isClosed: false })).toBe(
      '설문을 배포하시겠습니까?\n배포하면 현재 설문 상태가 스냅샷으로 저장되고, 응답자는 배포된 버전으로 응답하게 됩니다.',
    );
  });

  it('진행 중 응답이 있으면 새 버전으로 이어진다고 알린다', () => {
    expect(publishConfirmMessage({ migratableCount: 3, isClosed: false })).toContain(
      '진행 중 응답 3건이 새 버전으로 이어집니다.',
    );
  });

  it('종료된 설문이면 종료가 풀리고 외부 링크가 다시 열린다고 알린다', () => {
    const message = publishConfirmMessage({ migratableCount: 0, isClosed: true });
    expect(message).toContain('이 설문은 종료된 상태입니다.');
    expect(message).toContain('종료가 풀려 새 응답을 다시 받고');
    expect(message).toContain('외주 실사 링크와 클라이언트 링크가 다시 열립니다');
  });

  it('종료 경고는 맨 앞에 선다 — 익숙한 문구 뒤에 묻히지 않는다', () => {
    const message = publishConfirmMessage({ migratableCount: 2, isClosed: true });
    expect(message.indexOf('종료된 상태')).toBeLessThan(message.indexOf('설문을 배포하시겠습니까?'));
    expect(message).toContain('진행 중 응답 2건이 새 버전으로 이어집니다.');
  });
});
