import { describe, expect, it } from 'vitest'
import { formatIpMask, formatTotalTime, parseQuestionNumberFromTitle } from '@/lib/operations/profiles'

describe('formatIpMask', () => {
  it('IPv4 → 끝 옥텟 마스킹', () => {
    expect(formatIpMask('123.45.67.89')).toBe('123.45.67.xx')
  })

  it('IPv4 (작은 수) → 마스킹', () => {
    expect(formatIpMask('1.2.3.4')).toBe('1.2.3.xx')
  })

  it('IPv6 → 마지막 64bit (4 그룹) 마스킹', () => {
    expect(formatIpMask('2001:db8:cafe:1234:5678:9abc:def0:1111')).toBe('2001:db8:cafe:1234:xxxx:xxxx:xxxx:xxxx')
  })

  it('IPv6 축약형 (::1) → "—" (불완전 입력)', () => {
    expect(formatIpMask('::1')).toBe('—')
  })

  it('null → "—"', () => {
    expect(formatIpMask(null)).toBe('—')
  })

  it('빈 문자열 → "—"', () => {
    expect(formatIpMask('')).toBe('—')
  })

  it('비정상 문자열 → "—"', () => {
    expect(formatIpMask('not-an-ip')).toBe('—')
  })
})

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
