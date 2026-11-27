import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLIENT_LINK_TABS,
  DEFAULT_CLIENT_RESPONSE_COLUMN_KEYS,
  NO_CLIENT_LINK_TABS,
  clientLinkTabValues,
  isClientLinkTabOpen,
  normalizeClientLinkTabs,
  normalizeClientResponseColumns,
  normalizeSurveyGuestTabs,
  resolveAccessLinkSurveyBlock,
  surveyGuestTabValues,
} from './workspace';

/**
 * 클라이언트 링크의 탭 어휘 — 옛 게스트 계정 어휘에서 갈라졌다.
 *
 * 게스트 넷에 셋(설문 보기·상세 통계·응답 내역)을 더한다. 게스트 어휘·정규화는 그대로여야
 * 한다 — 철거 대상인 게스트 콘솔이 새 칸을 얻으면 안 된다.
 */
/**
 * 딸린 칩 — 엑셀 다운로드·응답 조회는 응답 내역에, 상세 통계는 응답 현황에 딸린다
 * (`.scratch/client-link-response-extras`). 부모가 꺼지면 값과 무관하게 닫힌다.
 */
describe('isClientLinkTabOpen', () => {
  it('딸린 칩은 자기 값 ∧ 부모 값', () => {
    const on = { ...NO_CLIENT_LINK_TABS, responses: true, responsesExport: true, responseView: true };
    expect(isClientLinkTabOpen(on, 'responsesExport')).toBe(true);
    expect(isClientLinkTabOpen(on, 'responseView')).toBe(true);
    const parentOff = { ...on, responses: false };
    expect(isClientLinkTabOpen(parentOff, 'responsesExport')).toBe(false);
    expect(isClientLinkTabOpen(parentOff, 'responseView')).toBe(false);
    expect(isClientLinkTabOpen({ ...on, responseView: false }, 'responseView')).toBe(false);
  });

  it('부모 없는 칩은 자기 값만 본다', () => {
    expect(isClientLinkTabOpen({ ...NO_CLIENT_LINK_TABS, responses: true }, 'responses')).toBe(true);
    expect(isClientLinkTabOpen({ ...NO_CLIENT_LINK_TABS, overviewDetail: true }, 'overviewDetail')).toBe(false);
  });

  it('새 두 칩은 새 링크·옛 행에서 꺼져 있다', () => {
    expect(DEFAULT_CLIENT_LINK_TABS.responsesExport).toBe(false);
    expect(DEFAULT_CLIENT_LINK_TABS.responseView).toBe(false);
    const old = normalizeClientLinkTabs({ overview: true, responses: true, preview: true });
    expect(old.responsesExport).toBe(false);
    expect(old.responseView).toBe(false);
  });

  it('칩 순서 — 딸린 칩은 응답 내역 바로 뒤', () => {
    const at = clientLinkTabValues.indexOf('responses');
    expect(clientLinkTabValues.slice(at, at + 3)).toEqual(['responses', 'responsesExport', 'responseView']);
  });
});

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
      responsesExport: false,
      responseView: false,
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
      responsesExport: false,
      responseView: false,
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

/** 클라이언트 링크 응답 내역의 열 설정 — 모양만 접는다(허용 판정은 읽는 쪽이 한다). */
describe('normalizeClientResponseColumns', () => {
  it('비어 있으면 기본 열과 version 0 이다', () => {
    expect(normalizeClientResponseColumns(null)).toEqual({
      version: 0,
      keys: [...DEFAULT_CLIENT_RESPONSE_COLUMN_KEYS],
    });
    expect(normalizeClientResponseColumns(['sys.idx'])).toEqual({
      version: 0,
      keys: [...DEFAULT_CLIENT_RESPONSE_COLUMN_KEYS],
    });
  });

  it('저장된 순서를 지키고, 순번은 언제나 맨 앞이며 중복은 앞의 것만 남는다', () => {
    expect(
      normalizeClientResponseColumns({
        version: 3,
        keys: ['entry.euid', 'sys.status', 'sys.idx', 'entry.euid', 7],
      }),
    ).toEqual({ version: 3, keys: ['sys.idx', 'entry.euid', 'sys.status'] });
  });

  it('순번만 남긴 설정은 기본 열로 접히지 않는다', () => {
    expect(normalizeClientResponseColumns({ version: 1, keys: [] })).toEqual({
      version: 1,
      keys: ['sys.idx'],
    });
  });

  it('version 이 정수가 아니면 0 으로 읽는다', () => {
    expect(normalizeClientResponseColumns({ version: '2', keys: ['sys.idx'] }).version).toBe(0);
    expect(normalizeClientResponseColumns({ version: -1, keys: ['sys.idx'] }).version).toBe(0);
  });
});

/**
 * 닫힘 표의 설문 상태 두 줄 (ADR-0029·0030) — 세션 판정과 공유 설정의 표시가 함께 보는 함수다.
 */
describe('resolveAccessLinkSurveyBlock', () => {
  const open = { isPaused: false, surveyClosed: false };

  it('열려 있으면 두 종류 모두 null 이다', () => {
    expect(resolveAccessLinkSurveyBlock('fieldwork', open)).toBeNull();
    expect(resolveAccessLinkSurveyBlock('client', open)).toBeNull();
  });

  it('중단은 외주 링크만 닫는다 — 클라이언트 링크는 열려 있다', () => {
    const paused = { isPaused: true, surveyClosed: false };
    expect(resolveAccessLinkSurveyBlock('fieldwork', paused)).toBe('paused');
    expect(resolveAccessLinkSurveyBlock('client', paused)).toBeNull();
  });

  it('종료는 두 종류를 모두 닫는다', () => {
    const closed = { isPaused: false, surveyClosed: true };
    expect(resolveAccessLinkSurveyBlock('fieldwork', closed)).toBe('closed');
    expect(resolveAccessLinkSurveyBlock('client', closed)).toBe('closed');
  });

  it('중단과 종료가 함께 서 있으면 종료를 말한다 — 재개만으로는 다시 열리지 않는다', () => {
    const both = { isPaused: true, surveyClosed: true };
    expect(resolveAccessLinkSurveyBlock('fieldwork', both)).toBe('closed');
    expect(resolveAccessLinkSurveyBlock('client', both)).toBe('closed');
  });
});
