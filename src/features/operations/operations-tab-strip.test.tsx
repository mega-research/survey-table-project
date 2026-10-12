import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/surveys/sv-1/operations/overview',
}));

import { OperationsTabStrip } from '@/features/operations/operations-tab-strip';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';
import {
  FULL_PARTICIPANT_CAPABILITIES,
  LINK_CAPABILITIES,
  TEAM_MEMBER_CAPABILITIES,
} from '@tests/fixtures/survey-capability-columns';

/**
 * 탭 노출은 **판정 결과**가 정한다 — 주체 종류를 묻는 불리언이 아니다 (ADR-0026 티켓 02).
 *
 * 각 탭의 요구 capability 는 그 탭이 여는 leaf 페이지의 관문과 **같아야** 한다. 갈리면
 * 「메뉴엔 있는데 누르면 404」가 된다 — 실제로 팀원 열(responses·contacts·mail 없음)에서
 * 그랬다. 그래서 여기 적는 기대값은 leaf 관문에서 손으로 옮긴 것이고, 프리셋 상수를 다시
 * 읽어 비교하지 않는다.
 *
 * 라벨 문자열은 탭의 이름이 곧 주소의 의미라 단언하지만, 클래스·아이콘·순서는 보지 않는다.
 */

const ALL: readonly SurveyCapability[] = surveyCapabilityValues;

interface StripOptions {
  hasSurveyDocument?: boolean;
  /** 내부 셸인가 — 외주 링크 콘솔만 false 다. */
  internalShell?: boolean;
  hasQuota?: boolean;
}

function renderStrip(capabilities: readonly SurveyCapability[], options: StripOptions = {}) {
  return render(
    <OperationsTabStrip
      basePath="/surveys/sv-1/operations"
      capabilities={new Set(capabilities)}
      internalShell={options.internalShell ?? true}
      hasSurveyDocument={options.hasSurveyDocument ?? false}
      {...(options.hasQuota !== undefined ? { hasQuota: options.hasQuota } : {})}
    />,
  );
}

/** 열려 있는 최상위 탭의 이름들. 드롭다운 안쪽은 닫혀 있어 여기에 세지 않는다. */
function visibleTabs(): string[] {
  // 탭이 하나도 없는 경우가 기대값인 테스트가 있어 query* 를 쓴다(get* 은 0건에서 던진다).
  return screen
    .queryAllByRole('listitem')
    .map((item) => item.textContent?.trim() ?? '')
    .filter((text) => text.length > 0);
}

describe('OperationsTabStrip — capability 가 탭을 정한다', () => {
  it('전권 주체는 탭을 전부 본다', () => {
    renderStrip(ALL, { hasSurveyDocument: true });
    expect(visibleTabs()).toEqual(['실사 현황', '진척 보고', '조사 대상', '메일', '문항 수요', '쿼터']);
  });

  it('외주 링크는 현황·진척 보고·조사 대상·쿼터 현황을 본다 — 내부 셸 아님', () => {
    renderStrip(LINK_CAPABILITIES, { hasSurveyDocument: true, internalShell: false });
    // 문항 수요는 내부 전용 화면이라 조사표가 붙어 있어도 서지 않는다. 쿼터는 읽기 전용
    // 현황판으로 서고 이름이 「쿼터 현황」이다 — 내부의 「쿼터」(플랜 편집)와 다른 화면이다.
    expect(visibleTabs()).toEqual(['실사 현황', '진척 보고', '조사 대상', '쿼터 현황']);
  });

  it('쿼터가 없는 설문이면 링크 셸에 쿼터 현황이 서지 않는다 — 눌러도 빈 안내뿐인 탭을 두지 않는다', () => {
    renderStrip(LINK_CAPABILITIES, { internalShell: false, hasQuota: false });
    expect(visibleTabs()).toEqual(['실사 현황', '진척 보고', '조사 대상']);
  });

  it('내부 셸의 쿼터는 쿼터가 없어도 선다 — 거기가 쿼터를 만드는 자리다', () => {
    renderStrip(ALL, { hasQuota: false });
    expect(visibleTabs()).toContain('쿼터');
  });

  it('링크 셸의 쿼터 현황은 주입받은 접두 아래로 간다', () => {
    renderStrip(LINK_CAPABILITIES, { internalShell: false });
    expect(screen.getByRole('link', { name: '쿼터 현황' })).toHaveAttribute(
      'href',
      '/surveys/sv-1/operations/quota',
    );
  });

  /**
   * 사내 실사원(전체 권한 참여자) — **전용 콘솔이 없다는 주장의 화면 쪽 근거** (티켓 10).
   *
   * 쿼터·문항 수요는 설문 처분권이 아니라 내부 셸의 화면이라 함께 선다. 여기서 하나라도
   * 빠지면 「연구원과 같은 화면에서 일한다」(스토리 50)가 거짓이 된다.
   */
  it('사내 실사원은 연구원과 같은 탭을 본다 — 전용 콘솔이 필요 없는 이유', () => {
    renderStrip(FULL_PARTICIPANT_CAPABILITIES, { hasSurveyDocument: true });
    expect(visibleTabs()).toEqual(['실사 현황', '진척 보고', '조사 대상', '메일', '문항 수요', '쿼터']);
  });

  it('메일 권한이 없으면 메일 탭이 서지 않는다', () => {
    renderStrip(TEAM_MEMBER_CAPABILITIES);
    expect(visibleTabs()).not.toContain('메일');
  });

  it('팀원은 조사 대상·진척 보고 탭을 보지 않는다 — 누르면 404 이던 자리다', () => {
    renderStrip(TEAM_MEMBER_CAPABILITIES);
    const tabs = visibleTabs();
    expect(tabs).toContain('실사 현황');
    expect(tabs).not.toContain('조사 대상');
    expect(tabs).not.toContain('진척 보고');
  });

  it('조사표가 없으면 문항 수요 탭이 서지 않는다', () => {
    renderStrip(ALL);
    expect(visibleTabs()).not.toContain('문항 수요');
  });

  it('현황을 볼 수 없으면 실사 현황 탭도 서지 않는다', () => {
    renderStrip(['survey.view']);
    expect(visibleTabs()).toEqual([]);
  });
});
