import { describe, expect, it } from 'vitest';

import { testSendInviteNote } from './test-send-invite-note';

describe('testSendInviteNote — 테스트 발송 완료 문구의 초대 링크 안내', () => {
  it('열리는 테스트 링크면 로그인 없이 응답해 볼 수 있고 테스트 데이터로 쌓인다고 알린다', () => {
    const note = testSendInviteNote('live');
    expect(note).toContain('테스트 링크');
    expect(note).toContain('로그인 없이');
    expect(note).toContain('테스트 데이터');
  });

  it('견본 링크면 열리지 않는다는 것과 테스트 모드를 켜라는 것을 알린다', () => {
    const note = testSendInviteNote('sandbox');
    expect(note).toContain('열리지 않는');
    expect(note).toContain('테스트 모드');
    expect(note).toContain('테스트 조사 대상자 생성');
  });

  it('링크 종류를 모르면(옛 서버 응답) 아무것도 적지 않는다', () => {
    expect(testSendInviteNote(undefined)).toBeNull();
  });
});
