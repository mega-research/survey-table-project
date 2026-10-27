import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLIENT_LINK_TABS,
  clientLinkTabValues,
  normalizeClientLinkTabs,
  normalizeSurveyGuestTabs,
  surveyGuestTabValues,
} from './workspace';

/**
 * 클라이언트 링크의 탭 어휘 — 옛 게스트 계정 어휘에서 갈라졌다.
 *
 * 게스트 넷에 셋(설문 보기·상세 통계·응답 내역)을 더한다. 게스트 어휘·정규화는 그대로여야
 * 한다 — 철거 대상인 게스트 콘솔이 새 칸을 얻으면 안 된다.
 */
describe('normalizeClientLinkTabs', () => {
  it('컬럼이 비어 있으면 기본값 — 응답 현황·설문 보기·상세 통계만 켜짐', () => {
    expect(normalizeClientLinkTabs(null)).toEqual({
      overview: true,
      progressReport: false,
      contactsMasked: false,
      quota: false,
      preview: true,
      overviewDetail: true,
      responses: false,
    });
    expect(normalizeClientLinkTabs(null)).toEqual(DEFAULT_CLIENT_LINK_TABS);
  });

  it('객체인데 키가 없으면 false — 새 칸이 옛 행에 저절로 열리지 않는다', () => {
    expect(normalizeClientLinkTabs({ overview: true })).toEqual({
      overview: true,
      progressReport: false,
      contactsMasked: false,
      quota: false,
      preview: false,
      overviewDetail: false,
      responses: false,
    });
  });

  it('true 가 아닌 값은 false 다', () => {
    expect(normalizeClientLinkTabs({ preview: 'yes', responses: 1 }).preview).toBe(false);
    expect(normalizeClientLinkTabs({ preview: 'yes', responses: 1 }).responses).toBe(false);
  });

  it('기본값을 돌려받은 쪽이 고쳐도 상수가 바뀌지 않는다', () => {
    const tabs = normalizeClientLinkTabs(null);
    tabs.responses = true;
    expect(DEFAULT_CLIENT_LINK_TABS.responses).toBe(false);
  });

  it('어휘는 게스트 넷을 그대로 품는다', () => {
    for (const tab of surveyGuestTabValues) expect(clientLinkTabValues).toContain(tab);
    expect(clientLinkTabValues).toEqual(
      expect.arrayContaining(['preview', 'overviewDetail', 'responses']),
    );
  });

  it('게스트 정규화는 새 칸을 만들지 않는다', () => {
    expect(Object.keys(normalizeSurveyGuestTabs(null)).sort()).toEqual(
      [...surveyGuestTabValues].sort(),
    );
  });
});
