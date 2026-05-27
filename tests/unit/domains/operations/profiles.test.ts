import { describe, expect, it } from 'vitest'
import { formatTotalTime, parseQuestionNumberFromTitle, mapStatusPill } from '@/lib/operations/profiles'

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

  it("in_progress + currentStepOrder=5, totalSteps=50, qNumber='Q3' → 진행중 N/M·Qx", () => {
    expect(
      mapStatusPill({ status: 'in_progress', currentStepOrder: 5, totalSteps: 50, qNumber: 'Q3' }),
    ).toEqual({ label: '진행중', tone: 'blue', sub: '5/50 · Q3' })
  })

  it('in_progress + currentStepOrder null → ?/M · ?', () => {
    expect(
      mapStatusPill({ status: 'in_progress', currentStepOrder: null, totalSteps: 50, qNumber: null }),
    ).toEqual({ label: '진행중', tone: 'blue', sub: '?/50 · ?' })
  })

  it('in_progress + qNumber null → N/M · ?', () => {
    expect(
      mapStatusPill({ status: 'in_progress', currentStepOrder: 5, totalSteps: 50, qNumber: null }),
    ).toEqual({ label: '진행중', tone: 'blue', sub: '5/50 · ?' })
  })
})
