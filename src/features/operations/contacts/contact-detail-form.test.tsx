import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts/ct-1',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContactDetailForm } from '@/features/operations/contacts/contact-detail-form';
import { contactDetailPermissions } from '@/features/operations/contacts/contact-detail-permissions';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';
import { LINK_CAPABILITIES } from '@tests/fixtures/survey-capability-columns';

/**
 * 단건 상세에서 **무엇이 그려지는가** (ADR-0026, 티켓 08).
 *
 * 서버가 각자의 관문으로 막는 것과 별개로, 외주에게는 자기 권한 밖이 **애초에 보이지 않아야**
 * 한다(스토리 33). 여기서 보는 것은 그 노출뿐이고 저장 동작은 realdb 스위트가 진다.
 *
 * 값 자체는 감추지 않는다 — 전화를 걸려면 연락처 평문이 보여야 한다(스토리 29). 그래서
 * 「입력칸이 사라지는가」가 아니라 **「고칠 수 있는가」**를 묻는다.
 */
const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '회사명', source: 'attrs.회사명', label: '회사명', order: 0 },
    { key: '연락처', source: 'pii.연락처', label: '연락처', order: 1, piiType: 'phone' },
  ],
};

function renderForm(capabilities: readonly SurveyCapability[], proxyRespond = true) {
  return render(
    <ContactDetailForm
      surveyId="sv-1"
      basePath="/admin/surveys/sv-1/operations"
      scheme={SCHEME}
      resultCodes={[{ code: '1', label: '조사완료', order: 0, tone: 'green' }]}
      permissions={contactDetailPermissions(new Set(capabilities), { proxyRespond })}
      mailHistory={[]}
      editLogs={[]}
      mailSend={{ templates: [], disabledReason: null }}
      initial={{
        id: 'ct-1',
        resid: 7,
        attrs: { 회사명: '가나다' },
        piiDecrypted: { 연락처: { fieldType: 'phone', plain: '010-1234-5678', failed: false } },
        memo: null,
        contactMethod: null,
        respondedAt: null,
        inviteCode: proxyRespond ? 'abc12345' : null,
        responseId: null,
        responseReeditable: false,
        attempts: [],
      }}
    />,
  );
}

/** 외주에게 하나도 보이면 안 되는 자리 — 티켓 08 의 「그려지지 않는다」 목록. */
const BLOCKED_ACTIONS = [/^삭제$/, /단건 메일|메일 발송/, /응답 수정/, /응답 초기화/, /재응답 허용/];

describe('ContactDetailForm — 판정이 그릴 것을 정한다', () => {
  it('전권 주체는 관리 자리를 전부 본다', () => {
    renderForm(surveyCapabilityValues);
    expect(screen.getByRole('button', { name: '삭제' })).toBeTruthy();
    expect(screen.getByText('저장')).toBeTruthy();
  });

  it('외주 실사 링크에게는 명단·응답·메일 자리가 하나도 없다', () => {
    renderForm(LINK_CAPABILITIES);
    for (const action of BLOCKED_ACTIONS) {
      expect(screen.queryAllByText(action), `${action} 가 외주에게 보인다`).toEqual([]);
    }
  });

  it('연락처는 평문으로 보이되 고칠 수 없다 — 값을 감추는 것이 아니다', () => {
    renderForm(LINK_CAPABILITIES);
    expect(screen.getByDisplayValue('010-1234-5678').hasAttribute('readonly')).toBe(true);
  });

  // 짝 단언 — 없으면 「언제나 readonly」도 위 테스트를 통과한다.
  it('명단을 고칠 수 있는 주체에게는 연락처 칸이 열려 있다', () => {
    renderForm(surveyCapabilityValues);
    expect(screen.getByDisplayValue('010-1234-5678').hasAttribute('readonly')).toBe(false);
  });

  it('저장 버튼이 메모 저장으로 바뀐다 — 화면의 값 전부가 간다고 읽히면 안 된다', () => {
    renderForm(LINK_CAPABILITIES);
    expect(screen.getByText('메모 저장')).toBeTruthy();
    expect(screen.queryAllByText('저장')).toEqual([]);
  });

  it('회차 추가 카드는 남는다 — 외주 업무의 본체다', () => {
    renderForm(LINK_CAPABILITIES);
    // 추가 카드와 이력 카드가 둘 다 선다(제목이 「회차 결과 추가」·「회차 결과 (최근순)」).
    expect(screen.queryAllByText(/회차 결과/).length).toBeGreaterThanOrEqual(2);
  });

  it('대행 진입점이 닫히면 초대 링크 자리가 통째로 없다', () => {
    renderForm(LINK_CAPABILITIES, false);
    expect(screen.queryAllByText(/초대 링크/)).toEqual([]);
  });
});
