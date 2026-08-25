import { describe, expect, it } from 'vitest';

import { generateSavBuffer } from '@/lib/spss/sav-builder';
import type { Question, SurveySubmission } from '@/types/survey';

// 회귀: sav-writer@1.0.0 WriteStream 의 두 버그(write() this.options 미설정 throw,
// end() 가 fs.WriteStream 을 flush/close 하지 않고 즉시 resolve) 때문에
// 실제 데이터가 있는 .sav 생성이 throw 하거나 truncated/partial 버퍼를 반환했다.
// generateSavBuffer 가 saveToFile 동기 직렬화를 쓰도록 바꿔 두 버그를 회피한다.

function makeTextQuestion(id: string, code: string): Question {
  return {
    id,
    type: 'text',
    title: code,
    required: false,
    order: 1,
    questionCode: code,
  } as unknown as Question;
}

function makeSubmission(id: string, responses: Record<string, unknown>): SurveySubmission {
  return {
    id,
    surveyId: 's1',
    startedAt: new Date(),
    isCompleted: true,
    currentGroupOrder: 0,
    questionResponses: responses,
    updatedAt: new Date(),
  } as unknown as SurveySubmission;
}

// SPSS .sav 매직 넘버 — 파일이 헤더부터 온전히 flush 되었는지 확인하는 가장 빠른 신호.
const SAV_MAGIC = '$FL2';

describe('generateSavBuffer - 실 데이터 happy path', () => {
  it('데이터 행이 있어도 throw 없이 완전히 flush 된 .sav 버퍼를 반환한다', async () => {
    const question = makeTextQuestion('q1', 'Q1');
    const submissions = [
      makeSubmission('r1', { q1: 'hello' }),
      makeSubmission('r2', { q1: 'world' }),
    ];

    const buf = await generateSavBuffer([question], submissions);

    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString('latin1')).toBe(SAV_MAGIC);
  });

  it('데이터가 없어도 유효한 헤더의 .sav 버퍼를 반환한다', async () => {
    const question = makeTextQuestion('q1', 'Q1');

    const buf = await generateSavBuffer([question], []);

    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString('latin1')).toBe(SAV_MAGIC);
  });

  it('대량 행에서도 truncated 없이 일관된 크기의 버퍼를 반환한다', async () => {
    const question = makeTextQuestion('q1', 'Q1');
    const submissions = Array.from({ length: 1500 }, (_, i) =>
      makeSubmission(`r${i}`, { q1: `value_${i}` }),
    );

    const buf = await generateSavBuffer([question], submissions);

    expect(buf.subarray(0, 4).toString('latin1')).toBe(SAV_MAGIC);
    // 행 수에 비례해 본문이 늘어나므로 헤더만 있는 빈 파일보다 충분히 커야 한다.
    expect(buf.length).toBeGreaterThan(1500);
  });
});
