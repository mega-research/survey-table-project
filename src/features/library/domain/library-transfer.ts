import * as z from 'zod';

import type { DbSavedQuestion } from './saved-question';

// export/import 도메인. 런타임 import 0 (zod + 타입 re-export 만).

// exportLibrary 는 JSON.stringify 결과(문자열)를 그대로 반환한다.
// (SavedQuestion 배열이 아니라 { savedQuestions, categories } 직렬화 문자열)
export const ExportLibrarySchema = z.string();

// importLibrary 는 raw JSON 문자열을 입력으로 받는다.
// 컴포넌트가 string 단일 인자로 호출하므로 procedure 에서 { json } 객체로 래핑한다.
// JSON.parse 는 service 내부에서 try/catch 로 처리하므로 여기서는 string 수준만 검증.
export const ImportLibraryInput = z.object({ json: z.string() });
export type ImportLibraryInput = z.infer<typeof ImportLibraryInput>;

// 프리셋 초기화 반환 = saved_questions DB row 배열.
// 기존 action 이 raw db row(description/tags 가 nullable, createdAt 포함)를 그대로 반환했고
// 소비처(use-library-sync)가 그대로 store 에 넣으므로 byte 동작 보존 차원에서 raw row 형태 유지.
// 복잡 JSONB(question) 포함이라 z.custom 으로 타입만 보장.
export const PresetQuestionsSchema = z.custom<DbSavedQuestion[]>();
