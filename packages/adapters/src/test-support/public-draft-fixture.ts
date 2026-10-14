import { createHash } from 'node:crypto';
import { Groups } from '@deal-table/contracts';
import { preparePartitionMigration } from '../partition-migration.ts';
import { createPartitionGroupSession, type PartitionDraftArchitect } from '../partition-group-session.ts';
import type { PartitionMutation, PartitionTransport } from '../partitioned-group-repository.ts';
export function publicDraftFixture() {
  const state: Groups.GroupState = { accounts: ['iris','omar'].map(subject => ({ subject,displayName:subject.toUpperCase(),emailHash:createHash('sha256').update(subject).digest('hex'),status:'APPROVED' as const,version:1 })),
    groups:[{id:'garden',name:'Garden',organizer:'iris',version:1,members:['iris','omar'],drafts:[],decisions:[],invitations:[]}] };
  const plan=preparePartitionMigration(Buffer.from(JSON.stringify(state)),1,'a'.repeat(40));
  const rows=new Map(plan.batches.flat().map(item=>[item.key.PK+'/'+item.key.SK,structuredClone(item.next!)]));
  const transport: PartitionTransport = {
    read:async key=>structuredClone(rows.get(key.PK+'/'+key.SK)??null),
    readMany:async keys=>keys.map(key=>structuredClone(rows.get(key.PK+'/'+key.SK)??null)),
    commit:async mutations=>{if(mutations.some(mutation=>(rows.get(mutation.key.PK+'/'+mutation.key.SK)?.revision??0)!==mutation.expected))return false;
      for(const mutation of mutations)if(mutation.next)rows.set(mutation.key.PK+'/'+mutation.key.SK,structuredClone(mutation.next));return true;},
  };
  return {rows,transport,session:(draftArchitect:PartitionDraftArchitect)=>createPartitionGroupSession(transport,{draftArchitect}),
    commit:(mutations:PartitionMutation[])=>transport.commit(mutations),
    disable:()=>{const row=rows.get('ACCOUNT#iris/STATE')!;if(row.kind!=='ACCOUNT')throw new Error('bad fixture');row.value.status='DISABLED';row.value.version++;row.revision++;},
  };
}
