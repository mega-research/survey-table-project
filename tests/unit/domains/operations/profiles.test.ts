import { describe, expect, it } from 'vitest'
import { formatTotalTime, parseQuestionNumberFromTitle, mapStatusPill, normalizeListArgs, hasActiveFilters, buildStepLocationMap } from '@/lib/operations/profiles'
import type { Question, QuestionGroup } from '@/types/survey'

// buildStepLocationMap 테스트용 최소 fixture — buildRenderSteps 가 읽는 필드만 의미 있다.
function q(partial: Partial<Question> & Pick<Question, 'id' | 'order' | 'title'>): Question {
  return { type: 'radio', required: false, ...partial }
}
function g(partial: Partial<QuestionGroup> & Pick<QuestionGroup, 'id' | 'order' | 'name'>): QuestionGroup {
  return { surveyId: 's', ...partial }
}

describe('formatTotalTime', () => {
  it('completed + 300초 → "5분"', () => {
    expect(formatTotalTime(300, 'completed')).toBe('5분')
  })

  it('completed + 0초 → "0분"', () => {
    expect(formatTotalTime(0, 'completed')).toBe('0분')
  })

  it('completed + 13080초 → "218분" (큰 값)', () => {
    expect(formatTotalTime(13080, 'completed')).toBe('218분')
  })

  it('completed + null → "—"', () => {
    expect(formatTotalTime(null, 'completed')).toBe('—')
  })

  it('in_progress + 임의 값 → "진행 중"', () => {
    expect(formatTotalTime(120, 'in_progress')).toBe('진행 중')
  })

  it('drop + null → "—"', () => {
    expect(formatTotalTime(null, 'drop')).toBe('—')
  })

  it('completed + 음수 (시계 역행) → "0분" 클램프', () => {
    expect(formatTotalTime(-5, 'completed')).toBe('0분')
  })
})

describe('parseQuestionNumberFromTitle', () => {
  it('"Q3. 인공지능 부문…" → "Q3"', () => {
    expect(parseQuestionNumberFromTitle('Q3. 인공지능 부문 귀사의 주력 사업 분야는?')).toBe('Q3')
  })

  it('"Q5-1. 귀사가 사용 중이신…" → "Q5-1"', () => {
    expect(parseQuestionNumberFromTitle('Q5-1. 귀사가 사용 중이신 인공지능 오픈소스')).toBe('Q5-1')
  })

  it('"Q33-1. 인공지능 사업운영…" → "Q33-1"', () => {
    expect(parseQuestionNumberFromTitle('Q33-1. 인공지능 사업운영 애로사항 영역')).toBe('Q33-1')
  })

  it('"공지사항" (Q 없음) → null', () => {
    expect(parseQuestionNumberFromTitle('공지사항')).toBeNull()
  })

  it('"기업 소개" (Q 없음) → null', () => {
    expect(parseQuestionNumberFromTitle('기업 소개')).toBeNull()
  })

  it('빈 문자열 → null', () => {
    expect(parseQuestionNumberFromTitle('')).toBeNull()
  })

  it('null → null', () => {
    expect(parseQuestionNumberFromTitle(null as unknown as string)).toBeNull()
  })
})

describe('mapStatusPill', () => {
  it("status='completed' → { label:'완료', tone:'green' }", () => {
    expect(mapStatusPill({ status: 'completed' })).toEqual({ label: '완료', tone: 'green' })
  })

  it("status='drop' → { label:'이탈', tone:'gray' }", () => {
    expect(mapStatusPill({ status: 'drop' })).toEqual({ label: '이탈', tone: 'gray' })
  })

  it("status='screened_out' → { label:'자격 미달', tone:'amber' }", () => {
    expect(mapStatusPill({ status: 'screened_out' })).toEqual({ label: '자격 미달', tone: 'amber' })
  })

  it("status='quotaful_out' → { label:'쿼터마감', tone:'amber' }", () => {
    expect(mapStatusPill({ status: 'quotaful_out' })).toEqual({ label: '쿼터마감', tone: 'amber' })
  })

  it("status='bad' → { label:'불량', tone:'red' }", () => {
    expect(mapStatusPill({ status: 'bad' })).toEqual({ label: '불량', tone: 'red' })
  })

  it("알 수 없는 status → { label:'기타', tone:'gray' } (default fallback)", () => {
    expect(mapStatusPill({ status: 'future_status' })).toEqual({ label: '기타', tone: 'gray' })
  })

  it("in_progress + visible 26/28, 전체 50, qNumber='Q33' → '26/28(50) · Q33'", () => {
    expect(
      mapStatusPill({
        status: 'in_progress',
        visibleStepIndex: 26,
        visibleStepTotal: 28,
        totalQuestions: 50,
        qNumber: 'Q33',
      }),
    ).toEqual({ label: '진행중', tone: 'blue', sub: '26/28(50) · Q33' })
  })

  it('in_progress + visible null (구 데이터) → ?/?(50) · Q33 폴백 (Q번호는 유지)', () => {
    expect(
      mapStatusPill({
        status: 'in_progress',
        visibleStepIndex: null,
        visibleStepTotal: null,
        totalQuestions: 50,
        qNumber: 'Q33',
      }),
    ).toEqual({ label: '진행중', tone: 'blue', sub: '?/?(50) · Q33' })
  })

  it('in_progress + qNumber null → 26/28(50) · ?', () => {
    expect(
      mapStatusPill({
        status: 'in_progress',
        visibleStepIndex: 26,
        visibleStepTotal: 28,
        totalQuestions: 50,
        qNumber: null,
      }),
    ).toEqual({ label: '진행중', tone: 'blue', sub: '26/28(50) · ?' })
  })

  it('in_progress + 전부 누락 → ?/?(?) · ?', () => {
    expect(mapStatusPill({ status: 'in_progress' })).toEqual({
      label: '진행중',
      tone: 'blue',
      sub: '?/?(?) · ?',
    })
  })
})

describe('buildStepLocationMap', () => {
  it('group step → 키 "group:<rootGroupId>", 첫 질문의 order/qNumber', () => {
    const groups = [g({ id: 'g1', order: 0, name: 'A' })]
    const questions = [
      q({ id: 'q1', groupId: 'g1', order: 0, title: 'Q1. 첫번째' }),
      q({ id: 'q2', groupId: 'g1', order: 1, title: 'Q2. 두번째' }),
    ]
    const map = buildStepLocationMap(questions, groups)
    expect(map.get('group:g1')).toEqual({ order: 0, qNumber: 'Q1' })
  })

  it('table step → 키 "table:<questionId>", 해당 질문의 order/qNumber', () => {
    const groups = [g({ id: 'g1', order: 0, name: 'A' })]
    const questions = [
      q({ id: 'q1', groupId: 'g1', order: 0, title: 'Q1. 첫번째' }),
      q({ id: 't1', groupId: 'g1', order: 1, type: 'table', title: 'Q2. 표질문' }),
    ]
    const map = buildStepLocationMap(questions, groups)
    expect(map.get('table:t1')).toEqual({ order: 1, qNumber: 'Q2' })
  })

  it('ungrouped 질문 → 키 "group:root", 첫 질문', () => {
    const questions = [q({ id: 'u1', order: 0, title: 'Q1. 무그룹' })]
    const map = buildStepLocationMap(questions, [])
    expect(map.get('group:root')).toEqual({ order: 0, qNumber: 'Q1' })
  })

  it('Q번호 없는 title → qNumber null (order 는 그대로)', () => {
    const questions = [q({ id: 'u1', order: 0, title: '안내문' })]
    const map = buildStepLocationMap(questions, [])
    expect(map.get('group:root')).toEqual({ order: 0, qNumber: null })
  })

  it('빈 입력 → 빈 맵', () => {
    expect(buildStepLocationMap([], []).size).toBe(0)
  })
})

describe('normalizeListArgs', () => {
  it('기본값 — col 빈 문자열, status all, sort idx, dir desc', () => {
    const r = normalizeListArgs({})
    expect(r.col).toBe('')
    expect(r.q).toBe('')
    expect(r.status).toBe('all')
    expect(r.sort).toBe('idx')
    expect(r.dir).toBe('desc')
    expect(r.view).toBe('active')
  })

  it('col 원시 문자열 보존 (화이트리스트 검증 안 함)', () => {
    expect(normalizeListArgs({ col: 'attrs.전시회명' }).col).toBe('attrs.전시회명')
    expect(normalizeListArgs({ col: 'idx' }).col).toBe('idx')
  })

  it('status=deleted → view deleted', () => {
    expect(normalizeListArgs({ status: 'deleted' }).view).toBe('deleted')
  })

  it('test 미지정 → 기본값 all', () => {
    expect(normalizeListArgs({}).test).toBe('all')
  })

  it('test=only/exclude → 그대로 통과', () => {
    expect(normalizeListArgs({ test: 'only' }).test).toBe('only')
    expect(normalizeListArgs({ test: 'exclude' }).test).toBe('exclude')
  })

  it('test 화이트리스트 밖 값 → all 폴백', () => {
    expect(normalizeListArgs({ test: 'bogus' }).test).toBe('all')
  })
})

describe('hasActiveFilters', () => {
  it('전부 기본값 → false', () => {
    expect(hasActiveFilters({})).toBe(false)
  })

  it('col+q 둘 다 있으면 → true', () => {
    expect(hasActiveFilters({ col: 'browser', q: 'Chrome' })).toBe(true)
  })

  it('col 만 있고 q 없으면 → false (검색 미발생)', () => {
    expect(hasActiveFilters({ col: 'browser', q: '' })).toBe(false)
  })

  it('status != all → true', () => {
    expect(hasActiveFilters({ status: 'completed' })).toBe(true)
  })

  it('test != all → true', () => {
    expect(hasActiveFilters({ test: 'only' })).toBe(true)
    expect(hasActiveFilters({ test: 'exclude' })).toBe(true)
  })

  it('test all(기본) → false', () => {
    expect(hasActiveFilters({ test: 'all' })).toBe(false)
  })
})
