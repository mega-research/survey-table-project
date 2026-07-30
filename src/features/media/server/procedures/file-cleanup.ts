import { authed } from '@/server/orpc';

import {
  CancelDeletionInput,
  CancelDeletionResult,
  DeletionCandidateList,
  ListHistoryInput,
  ListPendingInput,
} from '../../domain/file-cleanup';
import * as svc from '../services/file-cleanup.service';

/** 삭제 대기 목록 — R2 유예 삭제 큐의 pending 후보 (admin 큐 페이지). */
const listPending = authed
  .input(ListPendingInput.optional())
  .output(DeletionCandidateList)
  .handler(({ input }) => svc.listPending(input));

/** 집행 이력 — status 생략 시 pending 제외 전체(취소됨·보존됨·삭제됨·실패). */
const listHistory = authed
  .input(ListHistoryInput.optional())
  .output(DeletionCandidateList)
  .handler(({ input }) => svc.listHistory(input));

/** 대기 후보 개별 취소 — 7일 유예 안에 실수를 되돌린다. 이미 처리된 후보면 false. */
const cancel = authed
  .input(CancelDeletionInput)
  .output(CancelDeletionResult)
  .handler(({ input }) => svc.cancel(input));

export const fileCleanup = {
  listPending,
  listHistory,
  cancel,
};
