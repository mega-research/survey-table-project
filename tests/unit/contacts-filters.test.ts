import { describe, it, expect } from 'vitest';

import {
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
  placeholderFor,
  type ColumnCandidate,
} from '@/lib/operations/contacts-filters.server';
import {
  FILTER_NONE_LABEL,
  FILTER_NONE_VALUE,
  FILTER_NOT_NONE_VALUE,
  contactResultFilterOptions,
  HEADER_FILTER_VALUE_SEPARATOR as SEP,
  MAIL_FILTER_OPTIONS,
  WEB_FILTER_OPTIONS,
  webFilterOptionsFor,
} from '@/lib/operations/filter-shared';
import { STATUS_LABEL } from '@/components/operations/mail-campaign/recipient-status-badge';
import { mapStatusPill } from '@/lib/operations/profiles';
import type { ContactResultCode } from '@/db/schema/schema-types';

describe('webFilterOptionsFor — web 필터 선택지 + 레거시 값 노출', () => {
  it('평상시에는 상태 옵션만 — 레거시 항목 미노출', () => {
    expect(webFilterOptionsFor([])).toEqual(
      WEB_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    );
    expect(webFilterOptionsFor(['completed'])).toEqual(
      WEB_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    );
  });

  it("레거시 'false' 는 실제 서버 의미(미완료 전체) 라벨로 노출 — '미응답' 위장 금지", () => {
    // 구 URL·캠페인 스냅샷 재발송으로 'false' 가 걸린 상태에서 '미응답'으로
    // 위장 표시하면, 화면을 믿은 운영자가 진행중·이탈 포함 대상에게 발송하게 된다.
    const options = webFilterOptionsFor(['false']);
    const legacy = options.find((o) => o.value === 'false');
    expect(legacy?.label).toContain('구필터');
    expect(legacy?.label).toContain('진행중·이탈 포함');
    expect(legacy?.label).not.toBe('미응답');
  });

  it("레거시 'true' 는 응답 완료 구필터 라벨로 노출", () => {
    const options = webFilterOptionsFor(['true', 'drop']);
    expect(options.find((o) => o.value === 'true')?.label).toContain('구필터');
    // 새 상태 옵션은 그대로 유지
    expect(options.find((o) => o.value === 'drop')?.label).toBe('이탈');
  });

  it('종결 상태 3종(자격미달·쿼터마감·불량)도 선택지에 있다', () => {
    const values = webFilterOptionsFor([]).map((o) => o.value);
    expect(values).toContain('screened_out');
    expect(values).toContain('quotaful_out');
    expect(values).toContain('bad');
  });

  it('종결 상태 3종 라벨은 응답 내역 표(mapStatusPill)와 같은 문구', () => {
    // 같은 상태를 두 화면이 다르게 부르면 운영자가 서로 다른 축으로 착각한다.
    // completed/in_progress 는 이 필터가 먼저 쓰던 문구('응답 완료'·'진행 중')를
    // 유지하고, none 은 매칭 응답 자체가 없는 값이라 표 라벨 축 밖이다.
    for (const value of ['screened_out', 'quotaful_out', 'bad']) {
      const option = WEB_FILTER_OPTIONS.find((o) => o.value === value);
      expect(option?.label).toBe(mapStatusPill({ status: value }).label);
    }
  });
});

describe('contactResultFilterOptions — 컨택결과 선택지', () => {
  it('등록 코드 뒤에 "결과 없음" 을 덧붙인다', () => {
    const options = contactResultFilterOptions([
      { code: '1.조사완료', label: '1.조사완료' },
      { code: '6.거절', label: '6.거절' },
    ]);
    expect(options.map((o) => o.value)).toEqual(['1.조사완료', '6.거절', FILTER_NONE_VALUE]);
    // 빈 값 라벨은 컬럼마다 다른 말을 쓰지 않고 표의 '—' 표시와 같은 공용 문구를 쓴다.
    expect(options.at(-1)?.label).toBe(FILTER_NONE_LABEL);
  });

  it('센티널과 같은 코드는 선택지에서 빼고 빈 값 항목을 유지한다', () => {
    // 센티널은 항상 "빈 값" 을 뜻한다. 같은 문자열의 실제 코드를 함께 내밀면
    // 사용자가 고른 것과 실제로 걸리는 행이 갈라진다 — 값 쪽을 포기한다.
    const options = contactResultFilterOptions([
      { code: '1.조사완료', label: '1.조사완료' },
      { code: FILTER_NONE_VALUE, label: '진짜코드' },
    ]);
    expect(options).toEqual([
      { value: '1.조사완료', label: '1.조사완료' },
      { value: FILTER_NONE_VALUE, label: FILTER_NONE_LABEL },
    ]);
  });
});

describe('MAIL_FILTER_OPTIONS — 메일 필터 어휘', () => {
  it('라벨이 badge(STATUS_LABEL)와 동기화돼 있다 — 복제 어긋남 방지', () => {
    for (const o of MAIL_FILTER_OPTIONS) {
      if (o.value === 'none') continue;
      expect(STATUS_LABEL[o.value as keyof typeof STATUS_LABEL]?.label).toBe(o.label);
    }
  });

  it('모든 수신 상태를 빠짐없이 포함한다 (+ none)', () => {
    const values = MAIL_FILTER_OPTIONS.map((o) => o.value);
    expect(new Set(values)).toEqual(new Set([...Object.keys(STATUS_LABEL), 'none']));
  });
});

describe('placeholderFor', () => {
  it('returns id range hint for system.resid', () => {
    expect(placeholderFor('system.resid')).toBe('예: 1-30, 45');
  });

  it('returns exact-match hint for pii.*', () => {
    expect(placeholderFor('pii.email')).toBe('정확한 값 입력 (부분 검색 불가)');
    expect(placeholderFor('pii.mobile')).toBe('정확한 값 입력 (부분 검색 불가)');
  });

  it('attrs 는 숫자 검색 힌트 포함, 나머지는 검색어 계열', () => {
    expect(placeholderFor('attrs.전시회명')).toBe('검색어 또는 번호 (예: 3, 1-10, 12)');
    expect(placeholderFor('system.contact_result')).toBe('검색어 또는 번호 (예: 3, 1-10, 12)');
    expect(placeholderFor('system.web')).toBe('검색어 또는 번호 (예: 3, 1-10, 12)');
  });

  it('system.all 은 전체 검색 안내', () => {
    expect(placeholderFor('system.all')).toBe('전체 검색 (암호화 컬럼은 전문 일치)');
  });
});

const candidates: ColumnCandidate[] = [
  { source: 'system.resid', label: '번호' },
  { source: 'system.contact_result', label: '결과코드' },
  { source: 'system.web', label: '응답' },
  { source: 'system.email_count', label: '메일' },
  { source: 'attrs.전시회명', label: '전시회명' },
  { source: 'attrs.지역', label: '지역' },
  // 숨긴 컬럼 — 명시 선택으로는 검색 가능하지만 전체(system.all) 전개에선 제외.
  { source: 'attrs.종사자수', label: '종사자수', hidden: true },
  { source: 'pii.email', label: '이메일', piiType: 'email' },
];

const resultCodes: ContactResultCode[] = [
  { code: '1.조사완료', label: '1.조사완료', order: 1 },
  { code: '2.재통화예약', label: '2.재통화예약', order: 2 },
];

describe('parseClausesFromUrl', () => {
  it('returns empty array for missing arrays', () => {
    expect(parseClausesFromUrl(undefined, undefined, undefined, candidates, resultCodes)).toEqual([]);
    expect(parseClausesFromUrl([], [], [], candidates, resultCodes)).toEqual([]);
  });
});

describe('parseClausesFromUrl - source 분기', () => {
  it('system.resid + 숫자 패턴 → idlist', () => {
    const result = parseClausesFromUrl(
      ['system.resid'],
      ['1-30, 45'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'system.resid',
          mode: 'idlist',
          value: '1-30, 45',
          ranges: [
            { from: 1, to: 30 },
            { from: 45, to: 45 },
          ],
        },
      },
    ]);
  });

  it('system.resid + 비숫자 → text 폴백', () => {
    const result = parseClausesFromUrl(['system.resid'], ['abc'], [''], candidates, resultCodes);
    expect(result).toEqual([
      { op: null, condition: { source: 'system.resid', mode: 'text', value: 'abc' } },
    ]);
  });

  it('system.contact_result + enum 값 → enum', () => {
    const result = parseClausesFromUrl(
      ['system.contact_result'],
      ['1.조사완료'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: { source: 'system.contact_result', mode: 'enum', value: '1.조사완료' },
      },
    ]);
  });

  it('system.contact_result + enum 외 값 → drop', () => {
    expect(
      parseClausesFromUrl(['system.contact_result'], ['unknown'], [''], candidates, resultCodes),
    ).toEqual([]);
  });

  it('system.contact_result + "결과 없음" 센티널 → includeNull, value 는 왕복용 보존', () => {
    const result = parseClausesFromUrl(
      ['system.contact_result'],
      [FILTER_NONE_VALUE],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'system.contact_result',
          mode: 'enum',
          value: FILTER_NONE_VALUE,
          includeNull: true,
        },
      },
    ]);
  });

  it('센티널은 같은 이름의 결과코드가 있어도 항상 빈 값을 뜻한다', () => {
    // UI(contactResultFilterOptions)가 충돌 코드를 아예 내밀지 않으므로 파서도
    // 예외 없이 센티널 = 빈 값으로 해석한다. 세 층의 판정을 한 규칙으로 묶는다.
    const shadowed: ContactResultCode[] = [
      ...resultCodes,
      { code: FILTER_NONE_VALUE, label: '진짜코드', order: 99 },
    ];
    const result = parseClausesFromUrl(
      ['system.contact_result'],
      [FILTER_NONE_VALUE],
      [''],
      candidates,
      shadowed,
    );
    expect(result[0]?.condition.includeNull).toBe(true);
  });

  it('system.web + true/false → boolean', () => {
    const t = parseClausesFromUrl(['system.web'], ['true'], [''], candidates, resultCodes);
    const t0 = t[0];
    if (!t0) throw new Error('expected t[0]');
    expect(t0.condition).toEqual({ source: 'system.web', mode: 'boolean', value: 'true' });
    const f = parseClausesFromUrl(['system.web'], ['false'], [''], candidates, resultCodes);
    const f0 = f[0];
    if (!f0) throw new Error('expected f[0]');
    expect(f0.condition).toEqual({ source: 'system.web', mode: 'boolean', value: 'false' });
  });

  it('system.web + 종결 상태(자격미달·쿼터마감·불량) → boolean 조건으로 수용', () => {
    for (const value of ['screened_out', 'quotaful_out', 'bad']) {
      const parsed = parseClausesFromUrl(['system.web'], [value], [''], candidates, resultCodes);
      expect(parsed[0]?.condition).toEqual({ source: 'system.web', mode: 'boolean', value });
    }
  });

  it('system.web + 상태 값(drop 등) → boolean 조건으로 수용', () => {
    const d = parseClausesFromUrl(['system.web'], ['drop'], [''], candidates, resultCodes);
    expect(d[0]?.condition).toEqual({ source: 'system.web', mode: 'boolean', value: 'drop' });
  });

  it('system.email_count + 상태 값 → boolean 조건, 어휘 외 값은 drop', () => {
    const d = parseClausesFromUrl(['system.email_count'], ['bounced'], [''], candidates, resultCodes);
    expect(d[0]?.condition).toEqual({
      source: 'system.email_count',
      mode: 'boolean',
      value: 'bounced',
    });
    expect(
      parseClausesFromUrl(['system.email_count'], ['yes'], [''], candidates, resultCodes),
    ).toEqual([]);
  });

  it('system.web + 외 값 → drop', () => {
    expect(parseClausesFromUrl(['system.web'], ['yes'], [''], candidates, resultCodes)).toEqual([]);
  });

  it('attrs.* → text', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명'],
      ['핵심'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      { op: null, condition: { source: 'attrs.전시회명', mode: 'text', value: '핵심' } },
    ]);
  });

  it('attrs.* + 범위 문법 → idlist (NO 범위 검색)', () => {
    const result = parseClausesFromUrl(
      ['attrs.지역'],
      ['10-13, 15'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'attrs.지역',
          mode: 'idlist',
          value: '10-13, 15',
          ranges: [
            { from: 10, to: 13 },
            { from: 15, to: 15 },
          ],
        },
      },
    ]);
  });

  it('attrs.* + 단일 숫자 → idlist + textFallback (연번 15 는 15 만, 텍스트 값은 부분검색 유지)', () => {
    const single = parseClausesFromUrl(['attrs.지역'], ['15'], [''], candidates, resultCodes);
    expect(single).toEqual([
      {
        op: null,
        condition: {
          source: 'attrs.지역',
          mode: 'idlist',
          value: '15',
          ranges: [{ from: 15, to: 15 }],
          textFallback: true,
        },
      },
    ]);
  });

  it('attrs.* + 선행 0 숫자는 text 유지 (010 을 10 으로 접으면 원 행이 사라진다)', () => {
    const single = parseClausesFromUrl(['attrs.지역'], ['010'], [''], candidates, resultCodes);
    const z0 = single[0];
    if (!z0) throw new Error('expected single[0]');
    expect(z0.condition.mode).toBe('text');
  });

  it('attrs.* + 숫자가 아닌 하이픈 문자열은 text 유지', () => {
    const textDash = parseClausesFromUrl(
      ['attrs.지역'],
      ['서울-강남'],
      [''],
      candidates,
      resultCodes,
    );
    const t0 = textDash[0];
    if (!t0) throw new Error('expected textDash[0]');
    expect(t0.condition.mode).toBe('text');
  });

  it('pii.email + 유효 이메일 → exact + blindIndex', () => {
    const result = parseClausesFromUrl(
      ['pii.email'],
      ['user@example.com'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
    const clause0 = result[0];
    if (!clause0) throw new Error('expected result[0]');
    expect(clause0.condition.source).toBe('pii.email');
    expect(clause0.condition.mode).toBe('exact');
    expect(clause0.condition.value).toBe('user@example.com');
    expect(
      clause0.condition.mode === 'exact' &&
        /^[0-9a-f]{64}$/.test(clause0.condition.blindIndex ?? ''),
    ).toBe(true);
  });

  it('pii.* + 정규화 실패 → drop', () => {
    expect(parseClausesFromUrl(['pii.email'], ['abc'], [''], candidates, resultCodes)).toEqual([]);
  });

  it('pii.* + candidate 에 piiType 누락 → drop', () => {
    const candidatesNoPiiType: ColumnCandidate[] = [
      { source: 'pii.email', label: '이메일' },
    ];
    expect(
      parseClausesFromUrl(
        ['pii.email'],
        ['user@example.com'],
        [''],
        candidatesNoPiiType,
        resultCodes,
      ),
    ).toEqual([]);
  });

  it('whitelist 위반 → drop', () => {
    expect(parseClausesFromUrl(['attrs.unknown'], ['x'], [''], candidates, resultCodes)).toEqual(
      [],
    );
  });

  it('system.all + 일반 텍스트 → attrs 전체를 text OR 로 전개 (pii 는 정규화 실패로 제외)', () => {
    const result = parseClausesFromUrl(['system.all'], ['핵심'], [''], candidates, resultCodes);
    expect(result).toHaveLength(1);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    expect(c0.condition.mode).toBe('any');
    expect(c0.condition.subConditions).toEqual([
      { source: 'attrs.전시회명', mode: 'text', value: '핵심' },
      { source: 'attrs.지역', mode: 'text', value: '핵심' },
    ]);
  });

  it('system.all + 유효 이메일 → pii exact(blindIndex 포함)도 OR 에 포함', () => {
    const result = parseClausesFromUrl(
      ['system.all'],
      ['user@example.com'],
      [''],
      candidates,
      resultCodes,
    );
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    const piiSub = (c0.condition.subConditions ?? []).find((s) => s.source === 'pii.email');
    if (!piiSub) throw new Error('expected pii.email subcondition');
    expect(piiSub.mode).toBe('exact');
    expect(/^[0-9a-f]{64}$/.test(piiSub.blindIndex ?? '')).toBe(true);
  });

  it('system.all + 범위 문법 → attrs 숫자 범위 매칭(idlist)도 OR 에 포함', () => {
    // 전체가 기본값이라 사용자는 여기에 1-10 같은 범위를 입력한다 —
    // 텍스트 부분검색과 함께 attrs 컬럼별 숫자 범위 매칭을 OR 로 함께 건다.
    const result = parseClausesFromUrl(['system.all'], ['10-13'], [''], candidates, resultCodes);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    const subs = c0.condition.subConditions ?? [];
    const idlists = subs.filter((s) => s.mode === 'idlist');
    expect(idlists.map((s) => s.source)).toEqual(['attrs.전시회명', 'attrs.지역']);
    expect(idlists[0]?.ranges).toEqual([{ from: 10, to: 13 }]);
    // 텍스트 부분검색도 함께 유지 (범위처럼 생긴 리터럴 값 검색 가능성)
    expect(subs.some((s) => s.mode === 'text')).toBe(true);
  });

  it('system.all + 단일 숫자는 부분검색만 (범위 문법 아님)', () => {
    const result = parseClausesFromUrl(['system.all'], ['15'], [''], candidates, resultCodes);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    expect((c0.condition.subConditions ?? []).every((s) => s.mode !== 'idlist')).toBe(true);
  });

  it('system.all — 범위 × 컬럼 총량이 상한을 넘으면 idlist 전개를 생략하고 텍스트만 유지', () => {
    // 안전밸브: postgres 바인드 파라미터 한계(65,535) 보호. 정상 사용에선 미발동.
    const manyColumns: ColumnCandidate[] = Array.from({ length: 51 }, (_, i) => ({
      source: `attrs.컬럼${i}`,
      label: `컬럼${i}`,
    }));
    const hundredTokens = Array.from({ length: 100 }, (_, i) => String(i + 1)).join(',');

    // 51 컬럼 × 100 토큰 = 5,100 > 5,000 → idlist 생략
    const over = parseClausesFromUrl(['system.all'], [hundredTokens], [''], manyColumns, resultCodes);
    const o0 = over[0];
    if (!o0) throw new Error('expected over[0]');
    expect((o0.condition.subConditions ?? []).some((s) => s.mode === 'idlist')).toBe(false);
    expect((o0.condition.subConditions ?? []).some((s) => s.mode === 'text')).toBe(true);

    // 50 컬럼 × 100 토큰 = 5,000 → 전개 유지
    const under = parseClausesFromUrl(
      ['system.all'],
      [hundredTokens],
      [''],
      manyColumns.slice(0, 50),
      resultCodes,
    );
    const u0 = under[0];
    if (!u0) throw new Error('expected under[0]');
    expect((u0.condition.subConditions ?? []).some((s) => s.mode === 'idlist')).toBe(true);
  });

  it('system.all — 숨긴 컬럼은 전개에서 제외 (숨긴 숫자 컬럼이 범위 검색을 오염시키지 않음)', () => {
    const result = parseClausesFromUrl(['system.all'], ['1-10'], [''], candidates, resultCodes);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    const sources = (c0.condition.subConditions ?? []).map((s) => s.source);
    expect(sources).not.toContain('attrs.종사자수');
  });

  it('숨긴 컬럼도 명시적으로 선택하면 검색 가능 (전체 전개 제외와 별개)', () => {
    const result = parseClausesFromUrl(['attrs.종사자수'], ['5'], [''], candidates, resultCodes);
    expect(result).toHaveLength(1);
  });

  it('빈 q → drop', () => {
    expect(parseClausesFromUrl(['attrs.전시회명'], [''], [''], candidates, resultCodes)).toEqual(
      [],
    );
    expect(parseClausesFromUrl(['attrs.전시회명'], ['   '], [''], candidates, resultCodes)).toEqual(
      [],
    );
  });
});

describe('parseClausesFromUrl - 다중 조건', () => {
  it('첫 절 op 는 강제 null, 나머지는 AND/OR', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.지역', 'attrs.지역'],
      ['핵심', '서울', '부산'],
      ['', 'AND', 'OR'],
      candidates,
      resultCodes,
    );
    expect(result.map((c) => c.op)).toEqual([null, 'AND', 'OR']);
  });

  it('op[0] 에 AND/OR 가 와도 첫 절은 null 로 강제', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명'],
      ['핵심'],
      ['OR'],
      candidates,
      resultCodes,
    );
    const first0 = result[0];
    if (!first0) throw new Error('expected result[0]');
    expect(first0.op).toBeNull();
  });

  it('op 가 AND/OR 외 값이면 AND 폴백', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.지역'],
      ['핵심', '서울'],
      ['', 'XOR'],
      candidates,
      resultCodes,
    );
    const second = result[1];
    if (!second) throw new Error('expected result[1]');
    expect(second.op).toBe('AND');
  });

  it('길이 불일치 → 짧은 쪽까지만 (silent truncate)', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.지역'],
      ['핵심'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
  });

  it('일부 drop, 나머지 유지 (인덱스 보존 아님 — 통과한 절 순서대로)', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.unknown', 'attrs.지역'],
      ['핵심', 'x', '서울'],
      ['', 'AND', 'OR'],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(2);
    const r0 = result[0];
    const r1 = result[1];
    if (!r0 || !r1) throw new Error('expected result[0] and result[1]');
    expect(r0.condition.source).toBe('attrs.전시회명');
    expect(r1.condition.source).toBe('attrs.지역');
    expect(r1.op).toBe('OR');
  });

  it('URL 첫 절이 drop 되어도 출력 첫 절의 op 는 null', () => {
    // col[0] 는 화이트리스트 위반으로 drop → 통과한 col[1] 이 결과의 첫 절이 됨.
    // URL 인덱스 기준이 아니라 출력 인덱스 기준으로 op=null 이 부여되어야 한다.
    const result = parseClausesFromUrl(
      ['attrs.unknown', 'attrs.지역'],
      ['x', '서울'],
      ['', 'OR'],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
    const dropped0 = result[0];
    if (!dropped0) throw new Error('expected result[0]');
    expect(dropped0.op).toBeNull();
    expect(dropped0.condition.source).toBe('attrs.지역');
  });
});

describe('parseHeaderFiltersFromUrl', () => {
  it('빈 입력 → 빈 배열', () => {
    expect(parseHeaderFiltersFromUrl(undefined, undefined, undefined, candidates, resultCodes)).toEqual([]);
  });

  it('attrs in — 구분자 조인 값 목록을 in 절로 파싱, 전부 AND 결합', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역', 'attrs.전시회명'],
      ['in', 'in'],
      [`서울${SEP}부산`, '핵심'],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: { source: 'attrs.지역', mode: 'in', value: '', values: ['서울', '부산'] },
      },
      {
        op: 'AND',
        condition: { source: 'attrs.전시회명', mode: 'in', value: '', values: ['핵심'] },
      },
    ]);
  });

  it('attrs text — 고카디널리티 폴백 부분검색', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.전시회명'],
      ['text'],
      ['핵심'],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      { op: null, condition: { source: 'attrs.전시회명', mode: 'text', value: '핵심' } },
    ]);
  });

  it('attrs text — 범위 문법 입력은 idlist 로 승격 (헤더 필터에서도 NO 범위 검색)', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역'],
      ['text'],
      ['10-13, 15'],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'attrs.지역',
          mode: 'idlist',
          value: '10-13, 15',
          ranges: [
            { from: 10, to: 13 },
            { from: 15, to: 15 },
          ],
        },
      },
    ]);
  });

  it('pii exact — blindIndex 계산 포함', () => {
    const result = parseHeaderFiltersFromUrl(
      ['pii.email'],
      ['exact'],
      ['user@example.com'],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    expect(c0.condition.mode).toBe('exact');
    expect(/^[0-9a-f]{64}$/.test(c0.condition.blindIndex ?? '')).toBe(true);
  });

  it('system.contact_result in — 유효 코드만 통과, 전부 무효면 drop', () => {
    const result = parseHeaderFiltersFromUrl(
      ['system.contact_result'],
      ['in'],
      [`1.조사완료${SEP}없는코드`],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'system.contact_result',
          mode: 'in',
          value: '',
          values: ['1.조사완료'],
        },
      },
    ]);
    expect(
      parseHeaderFiltersFromUrl(['system.contact_result'], ['in'], ['없는코드'], candidates, resultCodes),
    ).toEqual([]);
  });

  it('attrs.* in — "(값 없음)" 센티널은 includeNull 로 승격된다', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역'],
      ['in'],
      [`서울${SEP}${FILTER_NONE_VALUE}`],
      candidates,
      resultCodes,
    );
    expect(result[0]?.condition.values).toEqual(['서울']);
    expect(result[0]?.condition.includeNull).toBe(true);
  });

  it('attrs.* in — "(값 없음)" 단독도 절이 성립한다', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역'],
      ['in'],
      [FILTER_NONE_VALUE],
      candidates,
      resultCodes,
    );
    expect(result[0]?.condition.values).toEqual([]);
    expect(result[0]?.condition.includeNull).toBe(true);
  });

  it('attrs.* in — "— 제외" 센티널 단독은 excludeNull 로 승격된다', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역'],
      ['in'],
      [FILTER_NOT_NONE_VALUE],
      candidates,
      resultCodes,
    );
    expect(result[0]?.condition).toEqual({
      source: 'attrs.지역',
      mode: 'in',
      value: '',
      values: [],
      excludeNull: true,
    });
  });

  it('attrs.* in — "— 제외" 센티널이 값과 섞이면 그냥 값으로 본다 (토글은 단독 생성)', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역'],
      ['in'],
      [`서울${SEP}${FILTER_NOT_NONE_VALUE}`],
      candidates,
      resultCodes,
    );
    expect(result[0]?.condition.values).toEqual(['서울', FILTER_NOT_NONE_VALUE]);
    expect(result[0]?.condition.excludeNull).toBeUndefined();
  });

  it('pii.* in — "— 제외" 센티널 단독은 excludeNull 로 승격된다', () => {
    const result = parseHeaderFiltersFromUrl(
      ['pii.email'],
      ['in'],
      [FILTER_NOT_NONE_VALUE],
      candidates,
      resultCodes,
    );
    expect(result[0]?.condition).toEqual({
      source: 'pii.email',
      mode: 'in',
      value: '',
      values: [],
      excludeNull: true,
    });
  });

  it('pii.* in — "값 없음" 센티널 단독만 수용한다 (blindIndex 미계산)', () => {
    const ok = parseHeaderFiltersFromUrl(
      ['pii.email'],
      ['in'],
      [FILTER_NONE_VALUE],
      candidates,
      resultCodes,
    );
    expect(ok[0]?.condition).toEqual({
      source: 'pii.email',
      mode: 'in',
      value: '',
      values: [],
      includeNull: true,
    });

    // 값 열거는 blind index 라 불가능 — 센티널 외 값이 섞이면 절 자체를 버린다.
    expect(
      parseHeaderFiltersFromUrl(
        ['pii.email'],
        ['in'],
        [`a@b.com${SEP}${FILTER_NONE_VALUE}`],
        candidates,
        resultCodes,
      ),
    ).toEqual([]);
  });

  it('system.contact_result in — "결과 없음" 단독 선택도 절이 성립한다', () => {
    const result = parseHeaderFiltersFromUrl(
      ['system.contact_result'],
      ['in'],
      [FILTER_NONE_VALUE],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'system.contact_result',
          mode: 'in',
          value: '',
          values: [],
          includeNull: true,
        },
      },
    ]);
  });

  it('system.contact_result in — 코드 + "결과 없음" 혼합', () => {
    const result = parseHeaderFiltersFromUrl(
      ['system.contact_result'],
      ['in'],
      [`1.조사완료${SEP}${FILTER_NONE_VALUE}`],
      candidates,
      resultCodes,
    );
    expect(result[0]?.condition.values).toEqual(['1.조사완료']);
    expect(result[0]?.condition.includeNull).toBe(true);
  });

  it('system.web in — 어휘 외 값 필터링, 상태 값과 레거시 true/false 는 수용', () => {
    const result = parseHeaderFiltersFromUrl(
      ['system.web'],
      ['in'],
      [`true${SEP}drop${SEP}maybe`],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: { source: 'system.web', mode: 'in', value: '', values: ['true', 'drop'] },
      },
    ]);
  });

  it('system.web in — 종결 상태 3종도 어휘로 수용', () => {
    const result = parseHeaderFiltersFromUrl(
      ['system.web'],
      ['in'],
      [`screened_out${SEP}quotaful_out${SEP}bad`],
      candidates,
      resultCodes,
    );
    expect(result[0]?.condition.values).toEqual(['screened_out', 'quotaful_out', 'bad']);
  });

  it('in 값의 선행·후행 공백은 원형 보존 — distinct 가 보여준 값과 정확 일치해야 함', () => {
    // 엑셀 적재는 셀 값을 trim 하지 않으므로 DB 에 "서울 " 이 실존할 수 있다.
    // 드롭다운이 보여준 원형을 서버가 trim 해버리면 IN 비교가 0건이 되는 왕복 불일치.
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역'],
      ['in'],
      [`서울 ${SEP}부산`],
      candidates,
      resultCodes,
    );
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    expect(c0.condition.values).toEqual(['서울 ', '부산']);
  });

  it('source-mode 불일치 조합은 drop — attrs+exact, pii+in, pii+text', () => {
    expect(
      parseHeaderFiltersFromUrl(['attrs.지역'], ['exact'], ['서울'], candidates, resultCodes),
    ).toEqual([]);
    expect(
      parseHeaderFiltersFromUrl(['pii.email'], ['in'], ['user@example.com'], candidates, resultCodes),
    ).toEqual([]);
    expect(
      parseHeaderFiltersFromUrl(['pii.email'], ['text'], ['user'], candidates, resultCodes),
    ).toEqual([]);
  });

  it('화이트리스트 위반·빈 값·중복 컬럼 처리', () => {
    // 화이트리스트 위반 drop
    expect(
      parseHeaderFiltersFromUrl(['attrs.unknown'], ['in'], ['x'], candidates, resultCodes),
    ).toEqual([]);
    // 빈 값 토큰만 있으면 drop
    expect(
      parseHeaderFiltersFromUrl(['attrs.지역'], ['in'], [`${SEP}`], candidates, resultCodes),
    ).toEqual([]);
    // 같은 컬럼 중복 등장 시 뒤 항목이 이김 (드롭다운 재적용 시나리오)
    const dup = parseHeaderFiltersFromUrl(
      ['attrs.지역', 'attrs.지역'],
      ['in', 'in'],
      ['서울', '부산'],
      candidates,
      resultCodes,
    );
    expect(dup).toHaveLength(1);
    const d0 = dup[0];
    if (!d0) throw new Error('expected dup[0]');
    expect(d0.condition.values).toEqual(['부산']);
  });
});
