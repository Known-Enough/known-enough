import { expect, it } from 'vitest';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { MemoryGroupRepository, createGroupRepositoryTransport, GroupCapacityError, type GroupRepository } from '@deal-table/adapters';
import { npApi } from '../evaluations/np-api.ts';
const smallFrame = (id:string) => KE.PublicDecisionFrame.parse({schemaVersion:2,decisionId:id,frameVersion:1,semanticVersion:1,contextToken:'a'.repeat(64),title:'Fictional pilot',objective:'Choose',description:'',participants:[{id:'iris',displayName:'Iris',requiredForApproval:true}],requiredParticipantIds:['iris'],variables:[{id:'choice',type:'BOOLEAN',visibility:'PUBLIC',label:'Choice',required:true}],rules:[]});
const draft = (id:string,large=false):Groups.GroupDraft => ({id,bodyHash:'b'.repeat(64),revision:1,groupVersion:1,createdDecisionId:null,clarificationQuestions:[],frame:large?{...smallFrame(id),variables:Array.from({length:64},(_,index)=>({id:'value-'+index,type:'ENUM',label:'Public option',visibility:'PUBLIC',required:true,options:Array.from({length:3},(_,at)=>({id:'option-'+at,label:'x'.repeat(100)}))}))}:smallFrame(id)});
const group = (id:string):Groups.Group => ({id,name:'Fictional group',organizer:'iris',version:1,members:['iris'],drafts:[],invitations:[],decisions:[]});
it.each(['memory','transport'])('realistic public drafts hit the same byte ceiling before nominal counts and rejected writes retain all prior state: %s',async kind=>{
  let stored:{version:number;state:Groups.GroupState}|null=null;let writes=0;
  const repo:GroupRepository=kind==='memory'?new MemoryGroupRepository():createGroupRepositoryTransport({read:async()=>structuredClone(stored),write:async(expected,state)=>{if(expected!==(stored?.version??0))return false;stored={version:expected+1,state:structuredClone(state)};writes++;return true;}});
  await repo.transaction(state=>{state.groups.push(group('club'));});let count=0;
  for(;count<64;count++){try{await repo.transaction(state=>{state.groups[0]!.drafts.push(draft('draft-'+count,true));});}catch(error){expect(error).toBeInstanceOf(GroupCapacityError);break;}}
  expect(count).toBeGreaterThan(1);expect(count).toBeLessThan(64);const beforeWrites=writes;
  expect(await repo.transaction(state=>state.groups[0]!.drafts.length)).toBe(count);expect(writes).toBe(beforeWrites);
  expect(Buffer.byteLength(JSON.stringify(await repo.transaction(state=>state)))).toBeLessThanOrEqual(300000);
});
it('concurrent independent group changes survive CAS conflicts without lost groups',async()=>{
  let stored:{version:number;state:Groups.GroupState}|null=null;
  const repo=createGroupRepositoryTransport({read:async()=>structuredClone(stored),write:async(expected,state)=>{if(expected!==(stored?.version??0))return false;stored={version:expected+1,state:structuredClone(state)};return true;}});
  await Promise.all(['first','second'].map(id=>repo.transaction(state=>{state.groups.push(group(id));})));
  expect(await repo.transaction(state=>state.groups.map(value=>value.id).sort())).toEqual(['first','second']);
});
it('HTTP capacity is specific, sanitized, and rejects new groups and drafts without erasing saved work',async()=>{
  const api=await npApi();try{
    await api.call('iris','/account/register',{displayName:'Iris'});await api.approve('iris');
    await api.repository.transaction(state=>{state.groups=Array.from({length:32},(_,index)=>group('group-'+index));state.groups[0]!.drafts=Array.from({length:64},(_,index)=>draft('draft-'+index));});
    for(const [path,body] of [['/groups',{name:'Overflow',idempotencyKey:'overflow'}],['/groups/group-0/drafts',{objective:'Choose more',idempotencyKey:'overflow'}]] as const){
      const response=await api.call('iris',path,body);expect(response.status).toBe(507);const output=await response.json();expect(KE.DecisionCommandResult.parse(output)).toMatchObject({ok:false,error:{code:'CAPACITY_EXCEEDED',httpStatus:507}});
      expect(JSON.stringify(output)).not.toMatch(/iris|group-0|draft-0|emailHash|Fictional/);
    }
    expect(await api.repository.transaction(state=>[state.groups.length,state.groups[0]!.drafts.length])).toEqual([32,64]);
  }finally{await api.close();}
});
