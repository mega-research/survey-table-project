import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { libraryKeys } from '@/hooks/queries/use-library';
import { orpc } from '@/shared/lib/rpc';

/**
 * 회귀 테스트: useInitializePresets 의 onSuccess 무효화 키 검증.
 *
 * 저장 질문 쿼리(useSavedQuestions / useRecentlyUsedQuestions / useMostUsedQuestions)는
 * oRPC TanStack Query 통합이 만드는 키([['library','savedQuestions',...], {...}])를 쓴다.
 * 과거 useInitializePresets 는 플랫 키 libraryKeys.questions()(['library','questions'])로
 * invalidate 했는데, 이 키는 oRPC 배열-인덱스-0 키를 prefix-match 할 수 없어
 * 프리셋 초기화 후에도 라이브러리 패널이 새로고침되지 않았다.
 */
describe('useInitializePresets 무효화 키', () => {
  function seedSavedQuestionsQuery() {
    const client = new QueryClient();
    // 실제 useSavedQuestions 가 쓰는 것과 동일한 oRPC 쿼리 키로 캐시에 등록.
    const queryKey = orpc.library.savedQuestions.list.queryOptions().queryKey;
    client.getQueryCache().build(client, { queryKey });
    return { client, queryKey };
  }

  it('orpc.library.savedQuestions.key() 는 저장 질문 쿼리를 무효화한다', async () => {
    const { client, queryKey } = seedSavedQuestionsQuery();

    await client.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });

    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it('플랫 키 libraryKeys.questions() 는 저장 질문 쿼리를 무효화하지 못한다 (과거 버그)', async () => {
    const { client, queryKey } = seedSavedQuestionsQuery();

    await client.invalidateQueries({ queryKey: libraryKeys.questions() });

    // prefix-match 실패가 버그의 본질. 이 단언이 깨지면(=true) oRPC 키 형태가 바뀐 것.
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });
});

/**
 * 회귀 테스트: useImportLibrary 의 onSuccess 무효화 키 검증.
 *
 * 라이브러리 import 는 savedQuestions + questionCategories 를 insert 한다.
 * 과거 useImportLibrary 는 libraryKeys.all(['library'])로 invalidate 했는데,
 * 이 플랫 문자열 키는 oRPC 키([['library','savedQuestions',...], {...}])와
 * partialMatchKey 가 string↔array 로 어긋나 어떤 라이브러리 쿼리도 무효화하지 못했다.
 * 그 결과 import 성공 후에도 질문/카테고리 패널이 stale 한 상태로 남았다.
 */
describe('useImportLibrary 무효화 키', () => {
  function seedClient() {
    const client = new QueryClient();
    const savedQuestionsKey = orpc.library.savedQuestions.list.queryOptions().queryKey;
    const categoriesKey = orpc.library.questionCategories.list.queryOptions().queryKey;
    client.getQueryCache().build(client, { queryKey: savedQuestionsKey });
    client.getQueryCache().build(client, { queryKey: categoriesKey });
    return { client, savedQuestionsKey, categoriesKey };
  }

  it('orpc.library.savedQuestions.key() + questionCategories.key() 는 두 쿼리를 무효화한다', async () => {
    const { client, savedQuestionsKey, categoriesKey } = seedClient();

    await client.invalidateQueries({ queryKey: orpc.library.savedQuestions.key() });
    await client.invalidateQueries({ queryKey: orpc.library.questionCategories.key() });

    expect(client.getQueryState(savedQuestionsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(categoriesKey)?.isInvalidated).toBe(true);
  });

  it('플랫 키 libraryKeys.all 은 어떤 라이브러리 쿼리도 무효화하지 못한다 (과거 버그)', async () => {
    const { client, savedQuestionsKey, categoriesKey } = seedClient();

    await client.invalidateQueries({ queryKey: libraryKeys.all });

    // string↔array 미스매치가 버그의 본질. 두 쿼리 모두 stale 로 남는다.
    expect(client.getQueryState(savedQuestionsKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(categoriesKey)?.isInvalidated).toBe(false);
  });
});
