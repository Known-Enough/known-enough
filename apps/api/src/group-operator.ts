import { Groups, Id } from '@deal-table/contracts';
import type { GroupRepository } from '@deal-table/adapters';
/** Never wired to participant HTTP. The CLI operator's IAM credentials grant state-table authority. */
export async function operateAccount(repository: GroupRepository, action: 'list' | 'approve' | 'reject' | 'disable',
  subject?: string, expectedVersion?: number) {
  return repository.transaction(state => {
    if (action === 'list') return state.accounts.filter(account => account.status === 'PENDING')
      .map(account => ({ subject: account.subject, status: account.status, version: account.version }));
    const target = state.accounts.find(account => account.subject === Id.parse(subject));
    if (!target) throw new Error('Account not found');
    const status = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'DISABLED';
    if (target.status === status) return { subject: target.subject, status, version: target.version };
    if (target.version !== expectedVersion) throw new Error('Account changed; inspect version before retrying');
    if (action === 'reject' && target.status !== 'PENDING') throw new Error('Only pending requests can be rejected');
    target.status = Groups.AccountStatus.parse(status); target.version++;
    return { subject: target.subject, status, version: target.version };
  });
}
