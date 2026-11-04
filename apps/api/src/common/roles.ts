import { ForbiddenException } from '@nestjs/common';
import type { org_role } from '@prisma/client';
import type { AuthUser, Tx } from '../db/db.service';

export const BUILDERS: org_role[] = ['owner', 'admin', 'recruiter'];
export const EVALUATORS: org_role[] = ['owner', 'admin', 'reviewer'];

/** Backend check on top of RLS, so a non-member gets a clear refusal instead of an empty list. */
export async function requireRole(tx: Tx, user: AuthUser, orgId: string, roles?: org_role[]) {
  const member = await tx.organization_members.findFirst({
    where: { org_id: orgId, user_id: user.id, ...(roles && { role: { in: roles } }) },
    select: { id: true },
  });
  if (!member) throw new ForbiddenException();
}
