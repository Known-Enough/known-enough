import { expect,it } from 'vitest';
import { draftFailureMessage,readDraftRequest,saveDraftRequest } from './draft-request-state';
it('server unavailability and missing route never become organizer advice; backend categories do not echo content',()=>{
 for(const status of [404,500,502,503,504]) expect(draftFailureMessage(status,{message:'PRIVATE_ERROR_CANARY'})).not.toMatch(/organizer|PRIVATE_ERROR_CANARY/);
 expect(draftFailureMessage(403,{})).toContain('organizer');expect(draftFailureMessage(401,{})).toContain('session expired');
 expect(draftFailureMessage(503,{draftFailure:'AI_UNAVAILABLE'})).toContain('AI drafting is unavailable');
 expect(draftFailureMessage(422,{draftFailure:'INVALID_MODEL_OUTPUT'})).toContain('AI returned');
 expect(draftFailureMessage(503,{draftFailure:'PROVIDER_FAILED'})).toContain('AI provider');
 expect(draftFailureMessage(503,{draftFailure:'REQUEST_UNKNOWN'})).toContain('outcome is not confirmed');
});
it('tab recovery persists opaque references only; read/release do not cache objectives, private text or tokens',()=>{
 const map=new Map<string,string>();const storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value),removeItem:(key:string)=>map.delete(key)} as unknown as Storage;
 saveDraftRequest('own-group','same-nonce',storage);expect(readDraftRequest('own-group',storage)).toBe('same-nonce');
 expect(()=>saveDraftRequest('own-group','private text & token',storage)).toThrow();
 expect(JSON.stringify([...map])).toBe('[["ke-draft-request:own-group","same-nonce"]]');
 saveDraftRequest('own-group',null,storage);expect(readDraftRequest('own-group',storage)).toBeNull();
});
