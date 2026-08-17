import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  UpdateContactColumnsInput,
  UpdateContactGroupLevelsInput,
} from '../../domain/contact-column';
import * as svc from '../services/contact-columns.service';

const update = authed
  .input(UpdateContactColumnsInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.updateContactColumns(input);
    return { ok: true as const };
  });

/** 분류 기준 레벨만 패치 — 스킴 전체 덮어쓰기 없이 groupLevel 필드만 갱신. */
const updateGroupLevels = authed
  .input(UpdateContactGroupLevelsInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.updateContactGroupLevels(input);
    return { ok: true as const };
  });

export const columns = {
  update,
  updateGroupLevels,
};
