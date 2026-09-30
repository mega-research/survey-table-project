import { describe, expect, it } from 'vitest';

import { contactDetailPermissions } from '@/features/operations/contacts/contact-detail-permissions';
import {
  FULL_PARTICIPANT_CAPABILITIES,
  LINK_CAPABILITIES,
} from '@tests/fixtures/survey-capability-columns';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';

/**
 * 단건 상세가 무엇을 그릴지는 **판정 결과**가 정한다 (ADR-0026, 티켓 08).
 *
 * 각 칸의 요구는 그 동작이 부르는 표면의 관문에서 손으로 옮긴 것이고, 프리셋 상수를 다시
 * 읽어 비교하지 않는다 — 구현이 스스로를 채점하면 요구가 바뀌어도 초록으로 남는다.
 */
function permissionsFor(capabilities: readonly SurveyCapability[], proxyRespond = false) {
  return contactDetailPermissions(new Set(capabilities), { proxyRespond });
}

describe('contactDetailPermissions', () => {
  it('전권 주체는 전부 연다', () => {
    expect(permissionsFor(surveyCapabilityValues, true)).toEqual({
      manageContacts: true,
      writeAttempts: true,
      editResponses: true,
      manageResponses: true,
      viewMail: true,
      sendMail: true,
      proxyRespond: true,
    });
  });

  /**
   * 외주 실사 링크 — 회차·메모에 더해 **응답 수정과 단건 메일**이 열린다 (ADR-0027).
   *
   * 닫힌 채로 남는 것이 요점이다 — 명단 수정(`contacts.manage`)과 응답 초기화·재응답 허용
   * (`responses.manage`). 서버도 각자의 관문으로 막지만, 화면이 그리지 않아야 외주가 자기
   * 권한 밖을 눌러 거부당하지 않는다(스토리 33).
   */
  it('외주 실사 링크는 회차·메모·응답 수정·단건 메일을 열고 명단 수정·응답 관리는 닫는다', () => {
    expect(permissionsFor(LINK_CAPABILITIES, true)).toEqual({
      manageContacts: false,
      writeAttempts: true,
      editResponses: true,
      manageResponses: false,
      viewMail: true,
      sendMail: true,
      proxyRespond: true,
    });
  });

  /**
   * 사내 실사원(전체 권한 참여자) — 단건 상세의 **모든 자리**가 열린다 (티켓 10, 스토리 50).
   *
   * 외주와 갈리는 지점이 이 한 줄이다. 둘이 같은 조사 대상 표를 보지만(티켓 06 이 화면을 한
   * 벌로 만들었다) 사내는 응답 수정·단건 메일·명단 수정까지 닿는다.
   */
  it('사내 실사원은 명단 수정·응답 수정·단건 메일이 전부 열린다', () => {
    expect(permissionsFor(FULL_PARTICIPANT_CAPABILITIES, true)).toEqual({
      manageContacts: true,
      writeAttempts: true,
      editResponses: true,
      manageResponses: true,
      viewMail: true,
      sendMail: true,
      proxyRespond: true,
    });
  });

  it('대행 진입점은 capability 축이 아니다 — 같은 열에서도 갈린다', () => {
    // 상세를 볼 수 있다는 것(contacts.view)과 남의 응답 화면을 대신 열어도 된다는 것이
    // 같지 않다. 판정은 서버 투영이 하고 이 함수는 그 결과를 옮기기만 한다.
    expect(permissionsFor(LINK_CAPABILITIES, false).proxyRespond).toBe(false);
    expect(permissionsFor(LINK_CAPABILITIES, true).proxyRespond).toBe(true);
  });

  it('메일 열람과 발송이 갈린다 — 이력은 보되 못 보내는 주체가 있다', () => {
    const viewer = permissionsFor(['contacts.view', 'mail.view']);
    expect(viewer.viewMail).toBe(true);
    expect(viewer.sendMail).toBe(false);
  });

  it('단건 발송은 메일 탭 쓰기(mail.send)가 아니라 mail.sendSingle 을 따른다', () => {
    // 메일 탭만 쓰는 주체가 생겨도 단건 버튼이 따라 열리지 않고, 단건만 보내는 주체(외주
    // 링크)는 메일 탭 없이도 이력 카드와 버튼을 함께 본다.
    expect(permissionsFor(['contacts.view', 'mail.send']).sendMail).toBe(false);
    const single = permissionsFor(['contacts.view', 'mail.sendSingle']);
    expect(single.sendMail).toBe(true);
    expect(single.viewMail).toBe(true);
  });

  it('응답 수정과 응답 관리가 갈린다 — 고치되 지우지는 못하는 주체가 있다', () => {
    const editor = permissionsFor(['contacts.view', 'responses.view']);
    expect(editor.editResponses).toBe(true);
    expect(editor.manageResponses).toBe(false);
  });
});
