import { expect, test, type Page } from '@playwright/test';

import {
  cleanupSeed,
  closeSeedDb,
  fetchContactTarget,
  fetchResponseAnswers,
  fetchResponses,
  seedRespondentSurvey,
} from './_helpers/seed-survey';

/**
 * 응답자 경로 e2e — 렌더가 아니라 "제출이 성공하고 저장값이 맞다"까지 본다.
 *
 * 커버 급소 (이슈 12 grilling 확정 범위):
 *   - radio 기타 텍스트 → __optTexts__ 사이드카 (8/14 3연쇄 소실 사고 경로)
 *   - 테이블 input·radio 셀 → cell.id 키 직렬화
 *   - invite 토큰 → contact_targets 응답 매칭
 * 시드는 publish 와 같은 snapshot-builder 를 통과하므로 스냅샷 어휘 드리프트도 잡는다.
 */

// dev 서버 콜드 컴파일(터보팩 첫 방문 ~30초)이 기본 30초 테스트 타임아웃을 넘길 수 있다.
test.setTimeout(90_000);

test.afterAll(async () => {
  await closeSeedDb();
});

async function fillAndSubmit(page: Page, seed: Awaited<ReturnType<typeof seedRespondentSurvey>>) {
  await expect(page.getByText('전반적으로 얼마나 만족하십니까?')).toBeVisible({ timeout: 30_000 });

  // Q1 radio — 기타 선택 후 사이드카 텍스트 입력 (기본 placeholder '상세 기재')
  const radioQuestion = page.locator(`[data-question-id="${seed.ids.radioQuestion}"]`);
  await radioQuestion.getByLabel('기타').check();
  await radioQuestion.getByPlaceholder('상세 기재').fill('사이드카 e2e 텍스트');

  // Q2 text
  await page
    .locator(`[data-question-id="${seed.ids.textQuestion}"]`)
    .getByRole('textbox')
    .fill('자유 서술 응답');

  // Q3 table — input 셀 숫자, radio 셀 선택
  const tableQuestion = page.locator(`[data-question-id="${seed.ids.tableQuestion}"]`);
  await tableQuestion.getByRole('textbox').first().fill('42');
  await tableQuestion.getByRole('radio', { name: '수행', exact: true }).check();

  // 단일 페이지라 '다음' 한 번이 곧 제출이다 (마지막 페이지 라벨도 '다음').
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByText(seed.thankYouMessage)).toBeVisible({ timeout: 15_000 });
}

test('비공개 토큰 진입 응답이 제출되고 저장값이 일치한다', async ({ page }) => {
  // 익명 제출은 공개 설문의 규칙이다 (비공개 + contact 없음 → invalid_token).
  const seed = await seedRespondentSurvey({ isPublic: true });
  try {
    await page.goto(`/survey/${seed.privateToken}`);
    await fillAndSubmit(page, seed);

    await expect
      .poll(async () => (await fetchResponses(seed.surveyId)).filter((r) => r.isCompleted).length, {
        timeout: 15_000,
      })
      .toBe(1);

    const [row] = (await fetchResponses(seed.surveyId)).filter((r) => r.isCompleted);
    if (!row) throw new Error('완료 응답 행이 없다');
    expect(row.status).toBe('completed');
    expect(row.versionId).toBe(seed.versionId);

    const qr = row.questionResponses as Record<string, unknown>;
    expect(qr[seed.ids.textQuestion]).toBe('자유 서술 응답');
    // 질문 레벨 radio 저장값 = 옵션 value ('기타' 옵션은 'other')
    expect(qr[seed.ids.radioQuestion]).toBe('other');

    const table = qr[seed.ids.tableQuestion] as Record<string, unknown>;
    expect(table[seed.ids.inputCell]).toBe('42');
    // 표 radio 셀 저장값 = 선택한 radioOption 의 value
    expect(table[seed.ids.radioCell]).toBe('1');

    // 정규화 경로(response_answers) — 시드가 questions rows 를 넣는 이유이기도 하다.
    const answers = await fetchResponseAnswers(row.id);
    expect(answers.map((a) => a.questionId).sort()).toEqual(
      [seed.ids.radioQuestion, seed.ids.textQuestion, seed.ids.tableQuestion].sort(),
    );
    expect(answers.find((a) => a.questionId === seed.ids.textQuestion)?.textValue).toBe('자유 서술 응답');

    const sidecar = (qr['__optTexts__'] ?? {}) as Record<string, Record<string, string>>;
    expect(sidecar[seed.ids.radioQuestion]?.[seed.ids.otherOption]).toBe('사이드카 e2e 텍스트');
  } finally {
    await cleanupSeed(seed.surveyId);
  }
});

test('초대 링크 응답이 컨택에 매칭된다', async ({ page }) => {
  const seed = await seedRespondentSurvey();
  try {
    await page.goto(`/survey/${seed.privateToken}?invite=${seed.inviteToken}`);
    await fillAndSubmit(page, seed);

    await expect
      .poll(async () => {
        const contact = await fetchContactTarget(seed.contactTargetId);
        return contact?.responseId != null && contact.respondedAt != null;
      }, { timeout: 15_000 })
      .toBe(true);

    const [row] = (await fetchResponses(seed.surveyId)).filter((r) => r.isCompleted);
    if (!row) throw new Error('완료 응답 행이 없다');
    expect(row.contactTargetId).toBe(seed.contactTargetId);
  } finally {
    await cleanupSeed(seed.surveyId);
  }
});
