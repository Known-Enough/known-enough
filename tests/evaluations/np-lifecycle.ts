import { randomUUID } from 'node:crypto';
import { KnownEnough as KE } from '@deal-table/contracts';
import type { npApi } from './np-api.ts';
export async function checked(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || body.ok === false) throw new Error(`Synthetic API failure ${response.status}`);
  return body;
}
export async function freshGroup(api: Awaited<ReturnType<typeof npApi>>, key = randomUUID()) {
  const people = ['iris', 'omar', 'tess', 'vin'];
  for (const who of people) { await checked(await api.call(who, '/account/register', { displayName: who })); await api.approve(who); }
  const { group } = await checked(await api.call('iris', '/groups', { name: 'Gallery club', idempotencyKey: key }));
  const groupId = (group as { id: string }).id;
  for (const who of people.slice(1)) {
    const invite = await checked(await api.call('iris', `/groups/${groupId}/invitations`, { email: `${who}@example.invalid`, replace: false }));
    await checked(await api.call(who, '/groups/accept', { token: invite.token }));
  }
  const drafted = await checked(await api.call('iris', `/groups/${groupId}/drafts`, { objective: 'Choose a gallery meetup venue and time.', idempotencyKey: key }));
  const draft = drafted.draft as { id: string; revision: number };
  const creation = await checked(await api.call('iris', `/groups/${groupId}/drafts/${draft.id}/create`, { revision: draft.revision }));
  const snapshot = KE.PublicDecisionSnapshot.parse(creation.snapshot);
  const decisionId = snapshot.frame.decisionId;
  const owner = async (who: string) => KE.OwnerDecisionSnapshot.parse(await (await api.call(who, `/decisions/${decisionId}/me`)).json());
  const publicView = async () => KE.PublicDecisionSnapshot.parse(await (await api.call('iris', `/decisions/${decisionId}/public`)).json());
  const envelope = async (who: string, type: string, payload: unknown) => {
    const own = await owner(who); const id = randomUUID();
    return { schemaVersion: 2, decisionId, requestId: id, idempotencyKey: id, type,
      expected: { contextToken: own.publicSnapshot.contextToken, semanticVersion: own.publicSnapshot.semanticVersion,
        controlVersion: own.controlVersion, ownerVersion: own.ownerVersion }, payload };
  };
  const command = async (who: string, type: string, payload: unknown) => checked(await api.call(who, `/decisions/${decisionId}/commands`, await envelope(who, type, payload)));
  const confirmFrames = async () => { for (const who of people) await command(who, 'CONFIRM_FRAME', { frameVersion: (await publicView()).frame.frameVersion }); };
  const interpret = async (who: string, text: string) => {
    const result = await checked(await api.call(who, `/decisions/${decisionId}/owner-conversation/draft`, { requestId: randomUUID(), messages: [{ role: 'owner', text }] }));
    return KE.AIConstraintDraft.parse(result.draft);
  };
  const ready = async () => {
    await confirmFrames();
    for (const who of people) {
      const draft = await interpret(who, who === 'iris' ? 'first option, flexible if all hard rules hold, NP_PRIVATE_RAW_CANARY' : 'second option required, NP_PRIVATE_RAW_CANARY');
      await command(who, 'CONFIRM_CONSTRAINTS', { draftId: draft.draftId, draftVersion: draft.draftVersion, constraintIds: draft.proposedConstraints.map(item => item.constraintId) });
    }
  };
  const generate = async () => checked(await api.call('iris', `/decisions/${decisionId}/reasoning`, { requestId: randomUUID() }));
  return { people, groupId, decisionId, owner, publicView, envelope, command, confirmFrames, interpret, ready, generate };
}
