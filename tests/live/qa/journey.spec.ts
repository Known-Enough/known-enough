import { syntheticConditionMatches } from './semantic-review.ts';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { KnownEnough as KE, Groups } from '@deal-table/contracts';
import { data, fixture, login, register, request, checked, owner, publicView, envelope, command, open, close, renewSessions, trackOperation, confirmFrameReview, exploreProposals, createGroup, type Session } from './helpers.ts';
const sessions:Session[]=[];const people:Session[]=[];let groupId='',decisionId='';let offered:KE.PublicDecisionSnapshot['currentProposal']=null;
const canary='QA_PRIVATE_CANARY_'+(process.env.QA_RUN_ID??'uninstalled');
const host=()=>people[0]!;
const invitePath=()=>`/groups/${groupId}/invitations`;
async function freshDecision(name:string){const result=await checked(host(),`/groups/${groupId}/drafts`,{objective:`Choose a fictional garden activity (Planting or Watering) and slot (Morning or Afternoon). ${name}. Exactly these two finite shared choices, no purchases or real personal facts.`,idempotencyKey:randomUUID()});const draft=Groups.GroupDraft.parse(result.draft);expect(draft.clarificationQuestions).toHaveLength(0);const created=await checked(host(),`/groups/${groupId}/drafts/${draft.id}/create`,{revision:draft.revision});return KE.PublicDecisionSnapshot.parse(created.snapshot).frame.decisionId;}
async function ready(id:string){for(const s of people)await command(s,id,'CONFIRM_FRAME',{frameVersion:(await publicView(host(),id)).frame.frameVersion});const frame=(await publicView(host(),id)).frame;const variable=frame.variables.find(v=>v.type==='ENUM'&&v.options.length===2);if(!variable||variable.type!=='ENUM')throw new Error('LIVE_FINITE_CHOICES_REQUIRED');for(const [index,s] of people.entries()){const first=variable.options[0]!,second=variable.options[1]!;const text=index===0?`My negotiable requirement is ${variable.label} = ${first.label}. You may privately ask permission to change it to ${second.label} if all hard rules hold. No other conditions. Private test marker, not a condition: ${canary}-${s.user.actor}`:`My hard requirement is ${variable.label} = ${second.label}. I cannot change it. No other conditions. Private test marker, not a condition: ${canary}-${s.user.actor}`;const result=await checked(s,`/decisions/${id}/owner-conversation/draft`,{requestId:randomUUID(),messages:[{role:'owner',text}]});const draft=KE.AIConstraintDraft.parse(result.draft);expect(draft.unsupportedConditions).toHaveLength(0);expect(draft.proposedConstraints.some(c=>c.kind===(index===0?'NEGOTIABLE':'HARD'))).toBe(true);await command(s,id,'CONFIRM_CONSTRAINTS',{draftId:draft.draftId,draftVersion:draft.draftVersion,constraintIds:draft.proposedConstraints.map(c=>c.constraintId)});}}
async function explore(id:string){await checked(host(),`/decisions/${id}/reasoning`,{requestId:randomUUID()});}
async function allowProposal(id:string){await explore(id);const question=(await owner(host(),id)).pendingQuestions.find(q=>q.status==='PENDING');if(!question)throw new Error('LIVE_NEGOTIATION_QUESTION_REQUIRED');await command(host(),id,'ANSWER_NEGOTIATION',{questionId:question.questionId,constraintVersion:question.constraintVersion,requestIdentity:question.requestIdentity,answer:'ALLOW'});await explore(id);const proposal=(await publicView(host(),id)).currentProposal;if(!proposal)throw new Error('LIVE_PROPOSAL_REQUIRED');return proposal;}
test.describe.configure({mode:'serial'});
test.afterAll(async()=>close(sessions));
test.beforeEach(async ({browser}) => {
  if (people.length) await renewSessions(sessions, people, prior => login(browser, prior.user.actor, {mobile: prior.user.actor === 'iris', display: prior.user.actor === 'display'}));
});
test('QA01 signup and managed login',async({browser})=>{
  const {target,login:logins}=data();const user=logins.users.find(u=>u.actor==='signup')!;
  const context=await browser.newContext();const page=await context.newPage();sessions.push({context,page,user});
  await test.step('QA01_ENTRY',async()=>{
    await page.goto(target.FrontendUrl);await expect(page.getByRole('button',{name:'Sign in or register',exact:true})).toBeVisible();
    await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Sign in or register',exact:true})).toBeFocused();
  });
  await test.step('QA01_SIGNUP',async()=>{
    await page.getByRole('button',{name:'Register with email',exact:true}).click();
    await page.getByLabel('Username',{exact:true}).fill(user.username);await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Password',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Create account',exact:true}).click();
    await expect(page.getByLabel('Verification code',{exact:true})).toBeVisible();
  });
  let code='';
  await test.step('QA01_EMAIL_READ',async()=>{
    await expect.poll(()=>{
      let mailStatus='MAIL_BROKER_UNAVAILABLE';
      try { const result=fixture('mail');mailStatus=result.mailStatus??'MAIL_PENDING';if(result.status==='PASS')code=result.code; }
      finally { const notes=test.info().annotations;const prior=notes.find(n=>n.type==='qa-mail-status');if(prior)prior.description=mailStatus;else notes.push({type:'qa-mail-status',description:mailStatus}); }
      return !!code;
    },{timeout:120000,intervals:[3000]}).toBe(true);
  });
  await test.step('QA01_EMAIL_CONFIRM',async()=>{
    await page.getByLabel('Verification code',{exact:true}).fill(code);await page.getByRole('button',{name:'Verify email',exact:true}).click();
    await expect(page.getByText('Email verified. Sign in to continue and request access.',{exact:true})).toBeVisible();
  });
  await context.close();sessions.pop();
  await test.step('QA01_LOGIN',async()=>{const signup=await login(browser,'signup');sessions.push(signup);await register(signup);expect((await checked(signup,'/account')).account).toMatchObject({status:'APPROVED'});});
  await test.step('QA01_ACTORS',async()=>{
    for(const actor of ['iris','omar','tess','vin','pending','rejected','disabled','outsider']){const s=await login(browser,actor,{mobile:actor==='iris'});sessions.push(s);if(['iris','omar','tess','vin'].includes(actor))people.push(s);}
  });
});
test('QA02 admission and invitations',async()=>{
  await test.step('QA02_REGISTER',async()=>{for(const s of people)await register(s);});
  await test.step('QA02_DENIAL',async()=>{
  for(const actor of ['pending','rejected','disabled','outsider']){const s=sessions.find(v=>v.user.actor===actor)!;await register(s,actor==='disabled'||actor==='outsider');if(actor==='rejected'){fixture('reject',{actor});await s.page.getByRole('button',{name:'Refresh account and groups'}).click();await expect(s.page.getByText('Your access request was declined.',{exact:false})).toBeVisible();}if(actor==='disabled'){fixture('disable',{actor});await s.page.getByRole('button',{name:'Refresh account and groups'}).click();await expect(s.page.getByText('Your access is disabled.',{exact:false})).toBeVisible();}if(actor!=='outsider')expect((await request(s,'/groups',{name:'Denied',idempotencyKey:randomUUID()})).ok()).toBe(false);}
  });
  await test.step('QA02_GROUP_CREATE',()=>createGroup(host().page,'Live fictional garden'));
  await test.step('QA02_GROUP_READ',async()=>{const group=Groups.GroupSnapshot.parse(((await checked(host(),'/groups')).groups as unknown[])[0]);groupId=group.id;});
  await test.step('QA02_INVITATION_REPLACE',async()=>{
  const old=await checked(host(),invitePath(),{email:people[1]!.user.email,replace:false});const replacement=await checked(host(),invitePath(),{email:people[1]!.user.email,replace:true});expect((await request(people[2]!,'/groups/accept',{token:replacement.token})).ok()).toBe(false);expect((await request(people[1]!,'/groups/accept',{token:old.token})).ok()).toBe(false);await checked(people[1]!,'/groups/accept',{token:replacement.token});const again=await checked(people[1]!,'/groups/accept',{token:replacement.token});expect((again.group as {id:string}).id).toBe(groupId);
  });
  await test.step('QA02_INVITATION_UI',async()=>{
  for(const s of people.slice(2)){await host().page.getByRole('button',{name:'Refresh account and groups'}).click();await host().page.getByLabel('Recipient email').fill(s.user.email);await host().page.getByRole('button',{name:'Create invitation link'}).click();await expect(host().page.getByLabel('Invitation link',{exact:true})).not.toHaveValue('');const link=await host().page.getByLabel('Invitation link',{exact:true}).inputValue();await s.page.goto(link);await s.page.getByRole('button',{name:'Accept group invitation',exact:true}).click();await expect(s.page.getByRole('heading',{name:'Live fictional garden',exact:true})).toBeVisible();await host().page.getByRole('button',{name:'Hide invitation link'}).click();}
  });
  await test.step('QA02_INVITATION_EXPIRED',async()=>{
  const outsider=sessions.find(s=>s.user.actor==='outsider')!;const expiry=await checked(host(),invitePath(),{email:outsider.user.email,replace:false});fixture('expire-invitation',{actor:'outsider'});await outsider.page.goto(data().target.FrontendUrl+'#groupInvite='+expiry.token);await outsider.page.getByRole('button',{name:'Accept group invitation',exact:true}).click();await expect(outsider.page.getByText('This action could not be completed.',{exact:false})).toBeVisible();expect((await checked(outsider,'/groups')).groups).toEqual([]);
  });
});
test('QA03 fresh decision and owner confirmations',async()=>{
  const p=host().page;
  const note=(status:string)=>{const notes=test.info().annotations;const prior=notes.find(n=>n.type==='qa-operation-status');if(prior)prior.description=status;else notes.push({type:'qa-operation-status',description:status});};
  await test.step('QA03_DRAFT',()=>trackOperation(p,data().target.ApiUrl+`/groups/${groupId}/drafts`,async()=>{
  await p.getByRole('button',{name:'Refresh account and groups'}).click();await p.getByLabel('What should this group decide?').fill('Choose our fictional garden workday activity: Planting or Watering, and time: Morning or Afternoon. Only two finite enum choices; no real external data.');await p.getByRole('button',{name:'Draft a new decision',exact:true}).click();await expect(p.getByRole('heading',{name:'Review the public draft'})).toBeFocused();
  },note));
  await test.step('QA03_EDIT',async()=>{
await p.getByRole('checkbox',{name:'I reviewed this public draft and the required approvers'}).check();await p.getByLabel('Decision title',{exact:true}).fill('Fresh live garden');await expect(p.getByRole('checkbox',{name:'I reviewed this public draft and the required approvers'})).not.toBeChecked();await expect(p.getByRole('button',{name:'Create decision for group review'})).toBeDisabled();await p.getByRole('button',{name:'Save draft edits'}).click();await expect(p.getByText('Save these edits before creating the decision.',{exact:true})).toHaveCount(0);await expect(p.getByRole('heading',{name:'Review the public draft'}).locator('xpath=ancestor::section[@aria-busy][1]')).toHaveAttribute('aria-busy','false');await p.getByRole('checkbox',{name:'I reviewed this public draft and the required approvers'}).check();await expect(p.getByRole('button',{name:'Create decision for group review'})).toBeEnabled();
  });
  const draftId=await test.step('QA03_CREATE_DRAFT',async()=>{
    const group=Groups.GroupSnapshot.parse(((await checked(host(),'/groups')).groups as unknown[])[0]);
    const drafts=group.drafts.filter(item=>item.current&&!item.created);
    expect(drafts).toHaveLength(1);
    return drafts[0]!.id;
  });
  await trackOperation(p,data().target.ApiUrl+`/groups/${groupId}/drafts/${draftId}/create`,async()=>{
    await test.step('QA03_CREATE_CLICK',()=>p.getByRole('button',{name:'Create decision for group review'}).click());
    await test.step('QA03_CREATE_ID',async()=>{
      await expect(p.getByLabel('Decision ID from your invitation')).toHaveValue(/^groupdecision-[a-f0-9]{40}$/);
      decisionId=await p.getByLabel('Decision ID from your invitation').inputValue();
    });
  },note);
  const snapshot=await test.step('QA03_CREATE_READ',()=>publicView(host(),decisionId));
  await test.step('QA03_CREATE_FRAME',()=>{
    expect(snapshot.frame.title).toBe('Fresh live garden');
    expect(snapshot.frame.requiredParticipantIds).toHaveLength(4);
  });
  let variable:KE.PublicDecisionVariable|undefined;
  await test.step('QA03_FRAME',async()=>{
    for(const s of people){
      await test.step('QA03_FRAME_LOAD',()=>open(s,decisionId));
      await test.step('QA03_FRAME_REVIEW',()=>s.page.getByLabel('I reviewed this frame version, its options and public rules.').check());
      await test.step('QA03_FRAME_CONFIRM',()=>confirmFrameReview(s.page,data().target.ApiUrl+`/decisions/${decisionId}/commands`,note));
      await test.step('QA03_FRAME_VERIFY',async()=>{
        await expect.poll(async()=>{
          const current=await owner(s,decisionId);
          return current.publicSnapshot.frameConfirmations.some(confirmation=>confirmation.participantId===current.ownerParticipantId && confirmation.frameVersion===current.publicSnapshot.frame.frameVersion);
        }).toBe(true);
      });
    }
    const frame=await test.step('QA03_FRAME_READ',async()=>{
      await expect.poll(async()=>{const current=await publicView(host(),decisionId);const count=current.frameConfirmations.length;const status=count===people.length?'FRAME_COUNT_EXACT':count<people.length?'FRAME_COUNT_MISSING':'FRAME_COUNT_EXCESS';const notes=test.info().annotations;const prior=notes.find(note=>note.type==='qa-frame-status');if(prior)prior.description=status;else notes.push({type:'qa-frame-status',description:status});return count;}).toBe(people.length);
      return (await publicView(host(),decisionId)).frame;
    });
    await test.step('QA03_FRAME_FINITE',()=>{
      variable=frame.variables.find(v=>v.type==='ENUM'&&v.options.length===2);
      if(!variable||variable.type!=='ENUM')throw new Error('FINITE_MODEL_FRAME_REQUIRED');
    });
  });
  if(!variable||variable.type!=='ENUM')throw new Error('FINITE_MODEL_FRAME_REQUIRED');
  const finiteVariable=variable;
  await test.step('QA03_OWNER',async()=>{
  for(const [index,s] of people.entries()){await test.step('QA03_OWNER_LOAD',()=>open(s,decisionId));const first=finiteVariable.options[0]!,second=finiteVariable.options[1]!;const text=index===0?`Negotiable requirement: ${finiteVariable.label} must be ${first.label}; you may ask me privately to switch to ${second.label} if hard rules hold. No other conditions. Private test marker, not a condition: ${canary}-${s.user.actor}`:`Hard requirement: ${finiteVariable.label} must be ${second.label}; this cannot change. No other conditions. Private test marker, not a condition: ${canary}-${s.user.actor}`;await test.step('QA03_OWNER_INPUT',()=>s.page.getByLabel('Explain your limits and preferences privately').fill(text));await test.step('QA03_OWNER_INTERPRET',()=>trackOperation(s.page,data().target.ApiUrl+`/decisions/${decisionId}/owner-conversation/draft`,async()=>{await Promise.all([s.page.waitForResponse(response=>response.request().method()==='POST'&&response.url()===data().target.ApiUrl+`/decisions/${decisionId}/owner-conversation/draft`,{timeout:180000}),s.page.getByRole('button',{name:'Interpret my conditions'}).click()]);},note));await test.step('QA03_OWNER_REVIEW',()=>expect(s.page.getByRole('heading',{name:'Review the interpretation'})).toBeVisible());await test.step('QA03_OWNER_SEMANTICS',async()=>{const current=await owner(s,decisionId);expect(current.draft?.unsupportedConditions).toHaveLength(0);expect(syntheticConditionMatches(current.draft?.proposedConstraints??[],{kind:index===0?'NEGOTIABLE':'HARD',variableId:finiteVariable.id,optionId:index===0?first.id:second.id,otherOptionId:index===0?second.id:first.id})).toBe(true);});const boxes=s.page.locator('label').filter({hasText:/^(hard|negotiable|preference):/}).getByRole('checkbox');await test.step('QA03_OWNER_SELECT',async()=>{expect(await boxes.count()).toBeGreaterThan(0);for(const box of await boxes.all())await box.check();});await test.step('QA03_OWNER_CONFIRM',()=>trackOperation(s.page,data().target.ApiUrl+`/decisions/${decisionId}/commands`,async()=>{await s.page.getByRole('button',{name:'Confirm selected conditions'}).click();await expect(s.page.getByRole('heading',{name:'Review the interpretation'})).toHaveCount(0);},note));await test.step('QA03_OWNER_READ',async()=>{expect((await owner(s,decisionId)).confirmedConstraints.some(c=>c.kind===(index===0?'NEGOTIABLE':'HARD'))).toBe(true);});}
  });
});
test('QA04 private negotiation and exact agreement',async()=>{
  const step = (name:string, action:()=>Promise<unknown>) => test.step(name,action);
  await step('QA04_LOAD',()=>open(host(),decisionId));
  await step('QA04_EXPLORE',()=>exploreProposals(host().page,data().target.ApiUrl+`/decisions/${decisionId}/reasoning`,status=>test.info().annotations.push({type:'qa-operation-status',description:status}),status=>test.info().annotations.push({type:'qa-reasoning-outcome',description:status})));
  await step('QA04_QUESTION',async()=>{
    try { const result=fixture('kernel-diagnostics',{decisionId}); if(result.status==='PASS') { test.info().annotations.push({type:'qa-kernel-observed',description:'PASS'}); for(const kind of result.ruleFailureKinds ?? []) test.info().annotations.push({type:'qa-rule-failure-kind',description:kind}); for(const code of result.codes ?? []) test.info().annotations.push({type:'qa-kernel-code',description:code}); } } catch { /* Diagnostic failure never replaces the original journey assertion. */ }
    await step('QA04_QUESTION_SERVER',async()=>{const current=await owner(host(),decisionId);expect(current.pendingQuestions.filter(question=>question.status==='PENDING')).toHaveLength(1);});
    await expect(host().page.getByRole('heading',{name:'Private negotiation question'})).toBeVisible();
    await expect(host().page.getByText('Permission for this adjustment does not disclose your conditions or approve a final proposal.',{exact:false})).toBeVisible();
  });
  await step('QA04_QUESTION_PRIVACY',async()=>{
    await open(people[1]!,decisionId);
    await expect(people[1]!.page.getByRole('heading',{name:'Private negotiation question'})).toHaveCount(0);
    expect(await people[1]!.page.locator('body').innerText()).not.toContain(canary+'-iris');
    expect(JSON.stringify(await owner(people[1]!,decisionId))).not.toContain(canary+'-iris');
  });
  await step('QA04_ALLOW',()=>host().page.getByRole('button',{name:'Allow this adjustment'}).click());
  await step('QA04_REEXPLORE',()=>exploreProposals(host().page,data().target.ApiUrl+`/decisions/${decisionId}/reasoning`,status=>test.info().annotations.push({type:'qa-operation-status',description:status}),status=>test.info().annotations.push({type:'qa-reasoning-outcome',description:status})));
  await step('QA04_PROPOSAL_READ',async()=>{offered=(await publicView(host(),decisionId)).currentProposal;expect(!!offered).toBe(true);});
  await step('QA04_DISCLOSURE_SETUP',async()=>{fixture('disclosure',{decisionId,actor:'iris',permissionId:'declined'});await open(host(),decisionId);});
  await step('QA04_DISCLOSURE_REVIEW',()=>expect(host().page.getByRole('heading',{name:'Review this exact disclosure'})).toBeVisible());
  await step('QA04_DISCLOSURE_DECLINE',()=>host().page.getByRole('button',{name:'Decline this disclosure'}).click());
  await step('QA04_DISCLOSURE_READ',async()=>{expect((await owner(host(),decisionId)).ownApproval).toBeNull();});
  for(const s of people){
    await step('QA04_APPROVAL_LOAD',()=>open(s,decisionId));
    await step('QA04_APPROVAL_REVIEW',async()=>{await expect(s.page.getByRole('heading',{name:'Current proposal',exact:true})).toBeVisible();await expect(s.page.getByRole('button',{name:'Approve this exact proposal'})).toBeDisabled();await s.page.getByLabel('I reviewed the shared outcome and my private part of this exact proposal.').check();});
    await step('QA04_APPROVAL_CONFIRM',()=>s.page.getByRole('button',{name:'Approve this exact proposal'}).click());
  }
  await step('QA04_AGREEMENT_READ',async()=>{const view=await publicView(host(),decisionId);expect(view.status).toBe('AGREED');expect(view.currentProposal?.publicHash).toBe(offered!.publicHash);expect(view.approvedParticipantIds).toHaveLength(4);expect(JSON.stringify(view)).not.toMatch(new RegExp(canary+'|permissionId|constraintId|requestIdentity|refusedRequests'));});
  await step('QA04_AGREEMENT_RENDER',async()=>{for(const s of people){await open(s,decisionId);await expect(s.page.getByText('Everyone approved this exact outcome.',{exact:false})).toBeVisible();}});
});
test('QA05 denial privacy and recovery',async({browser})=>{
  test.setTimeout(1100000);
  for(const actor of ['pending','rejected','disabled','outsider']){const s=sessions.find(v=>v.user.actor===actor)!;for(const path of ['public','me']){const response=await request(s,`/decisions/${decisionId}/${path}`);expect(response.ok()).toBe(false);expect(await response.text()).not.toContain(canary);}}
  const foreignGroup=await checked(sessions.find(v=>v.user.actor==='outsider')!,'/groups',{name:'Other isolated group',idempotencyKey:randomUUID()});expect((await request(host(),`/groups/${(foreignGroup.group as {id:string}).id}/drafts`,{objective:'Foreign',idempotencyKey:randomUUID()})).ok()).toBe(false);const own=await owner(host(),decisionId);expect((await request(people[1]!,`/decisions/${decisionId}/commands`,{...(await envelope(people[1]!,decisionId,'CONFIRM_FRAME',{frameVersion:1})),ownerParticipantId:own.ownerParticipantId})).ok()).toBe(false);
  fixture('bind-display',{decisionId});const display=await login(browser,'display',{display:true});sessions.push(display);await open(display,decisionId);await expect(display.page.getByRole('heading',{name:'Current proposal',exact:true})).toBeVisible();await expect(display.page.getByRole('button',{name:'Approve this exact proposal'})).toHaveCount(0);expect((await request(display,`/decisions/${decisionId}/me`)).ok()).toBe(false);expect((await request(display,`/decisions/${decisionId}/commands`,{type:'APPROVE_PROPOSAL'})).ok()).toBe(false);expect((await request(display,'/decisions/not-this-decision/public')).ok()).toBe(false);
  // A real fresh hosted login, with no session injection, must reconstruct the stored decision.
  const fresh=await login(browser,'omar');sessions.push(fresh);await open(fresh,decisionId);await expect(fresh.page.getByText('Everyone approved this exact outcome.',{exact:false})).toBeVisible();
  const id=await freshDecision('retry and concurrency');const p=host().page;await open(host(),id);const bodies:string[]=[];await p.route(data().target.ApiUrl+`/decisions/${id}/commands`,async route=>{bodies.push(route.request().postData()!);if(bodies.length===1){const committed=await route.fetch();expect(committed.ok()).toBe(true);await route.abort('failed');}else await route.continue();});await p.getByLabel('I reviewed this frame version, its options and public rules.').check();await p.getByRole('button',{name:'Confirm shared frame'}).click();await p.getByRole('button',{name:'Retry the same action'}).click();await expect.poll(()=>bodies.length).toBe(2);expect(bodies[0]===bodies[1]).toBe(true);expect((await publicView(host(),id)).frameConfirmations).toHaveLength(1);await p.unrouteAll({behavior:'wait'});
  const commands=await Promise.all([envelope(people[1]!,id,'CONFIRM_FRAME',{frameVersion:1}),envelope(people[2]!,id,'CONFIRM_FRAME',{frameVersion:1})]);const results=await Promise.all(commands.map((body,i)=>request(people[i+1]!,`/decisions/${id}/commands`,body)));expect(results.some(r=>r.ok())).toBe(true);for(const [i,response] of results.entries())if(!response.ok())await command(people[i+1]!,id,'CONFIRM_FRAME',{frameVersion:1});expect((await publicView(host(),id)).frameConfirmations).toHaveLength(3);
  // Actual expired access token: wait out the pool's 15-minute validity, then reauthenticate normally.
  const token=await fresh.page.evaluate(()=>JSON.parse(sessionStorage.getItem('known-enough-cognito-session')!).accessToken as string);const claims=JSON.parse(Buffer.from(token.split('.')[1]!,'base64url').toString('utf8')) as {exp:number};const waitMs=Math.max(0,claims.exp*1000-Date.now()+2000);await new Promise(resolve=>setTimeout(resolve,waitMs));const expiredResponse=await fresh.context.request.get(data().target.ApiUrl+`/decisions/${decisionId}/me`,{headers:{authorization:'Bearer '+token}});expect(expiredResponse.status()).toBe(401);await fresh.page.reload();await expect(fresh.page.getByRole('button',{name:'Sign in or register',exact:true})).toBeVisible();
});
test('QA06 refusal revocation revision and disclosure',async()=>{
  // Refresh all expired participants via real login before this test, never by replacing token storage.
  // This test is followed by the independent accessibility screen lane, so missing actions remain blocked.
  const refused=await freshDecision('refusal');await ready(refused);await explore(refused);const question=(await owner(host(),refused)).pendingQuestions.find(q=>q.status==='PENDING')!;await command(host(),refused,'ANSWER_NEGOTIATION',{questionId:question.questionId,constraintVersion:question.constraintVersion,requestIdentity:question.requestIdentity,answer:'DECLINE'});for(let i=0;i<2;i++){const response=await request(host(),`/decisions/${refused}/reasoning`,{requestId:randomUUID()});expect([200,422]).toContain(response.status());}expect((await owner(host(),refused)).pendingQuestions.filter(q=>q.status==='PENDING')).toHaveLength(0);expect((await publicView(host(),refused)).currentProposal).toBeNull();
  const revoke=await freshDecision('revocation');await ready(revoke);const proposal=await allowProposal(revoke);const stale=await envelope(people[1]!,revoke,'APPROVE_PROPOSAL',{proposalId:proposal.proposalId,proposalVersion:proposal.facts.proposalVersion,publicHash:proposal.publicHash});await command(people[2]!,revoke,'APPROVE_PROPOSAL',{proposalId:proposal.proposalId,proposalVersion:proposal.facts.proposalVersion,publicHash:proposal.publicHash});await open(host(),revoke);await host().page.getByRole('button',{name:'Revoke this adjustment'}).click();expect((await request(people[1]!,`/decisions/${revoke}/commands`,stale)).status()).toBe(409);expect((await publicView(host(),revoke)).currentProposal).toBeNull();
  const disclosure=await freshDecision('disclosure');await ready(disclosure);await allowProposal(disclosure);fixture('disclosure',{decisionId:disclosure,actor:'iris',permissionId:'note'});const permission=(await owner(host(),disclosure)).disclosurePermissions.find(p=>p.status==='PENDING')!;expect(()=>fixture('publish-disclosure',{decisionId:disclosure,actor:'iris',permissionId:permission.permissionId})).toThrow();await command(host(),disclosure,'DECIDE_DISCLOSURE',{permissionId:permission.permissionId,permissionVersion:permission.permissionVersion,decision:'ALLOW'});expect((await owner(host(),disclosure)).ownApproval).toBeNull();await command(host(),disclosure,'REVOKE_DISCLOSURE',{permissionId:permission.permissionId,permissionVersion:permission.permissionVersion});expect(()=>fixture('publish-disclosure',{decisionId:disclosure,actor:'iris',permissionId:permission.permissionId})).toThrow();
  fixture('disclosure',{decisionId:disclosure,actor:'iris',permissionId:'published',audienceActor:'omar'});const published=(await owner(host(),disclosure)).disclosurePermissions.find(p=>p.status==='PENDING')!;await command(host(),disclosure,'DECIDE_DISCLOSURE',{permissionId:published.permissionId,permissionVersion:published.permissionVersion,decision:'ALLOW'});fixture('publish-disclosure',{decisionId:disclosure,actor:'iris',permissionId:published.permissionId});expect(JSON.stringify(await publicView(people[1]!,disclosure))).toContain('Fictional QA disclosure, separate from agreement.');expect(JSON.stringify(await publicView(people[2]!,disclosure))).not.toContain('Fictional QA disclosure, separate from agreement.');expect((await owner(host(),disclosure)).ownApproval).toBeNull();
  const group=Groups.GroupSnapshot.parse(((await checked(host(),'/groups')).groups as unknown[])[0]);const removed=group.members.find(m=>m.displayName==='vin')!;await checked(host(),`/groups/${groupId}/remove`,{memberId:removed.id,version:group.version});expect((await request(people[3]!,`/decisions/${decisionId}/me`)).ok()).toBe(false);await host().page.reload();await host().page.getByRole('button',{name:'Review changed roster'}).first().click();await expect(host().page.getByRole('heading',{name:'Review the new roster'})).toBeVisible();await host().page.getByLabel('I reviewed the changed roster and understand the reset').check();await host().page.getByRole('button',{name:'Start a new review with this roster'}).click();const revised=await publicView(host(),decisionId);expect(revised.frame.requiredParticipantIds).toHaveLength(3);expect(revised.frameConfirmations).toHaveLength(0);expect(revised.approvedParticipantIds).toHaveLength(0);expect(revised.currentProposal).toBeNull();
});
test('QA07 rendered clarification and accessibility',async()=>{
  const s=host();await open(s,decisionId);expect(await s.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);for(const person of people.slice(0,3))await command(person,decisionId,'CONFIRM_FRAME',{frameVersion:(await publicView(s,decisionId)).frame.frameVersion});await open(s,decisionId);await s.page.getByLabel('Explain your limits and preferences privately').fill('My condition requires proving another person is happy, with live external weather tomorrow and unlimited alternatives. Do not guess or convert this into supported conditions. '+canary);await s.page.getByRole('button',{name:'Interpret my conditions'}).click();await expect(s.page.getByText('Needs clarification:',{exact:false}).first()).toBeVisible();await expect(s.page.getByRole('button',{name:'Explore proposals'})).toBeDisabled();expect(await people[1]!.page.locator('body').innerText()).not.toContain(canary);
  await s.page.getByRole('button',{name:'Refresh account and groups'}).click();await s.page.getByLabel('What should this group decide?').fill('Predict every future real outcome with unlimited options and determine objective happiness. This has no finite supported domain.');await s.page.getByRole('button',{name:'Draft a new decision',exact:true}).click();await expect(s.page.getByRole('heading',{name:'Review the public draft'})).toBeFocused();await expect(s.page.getByRole('button',{name:'Create decision for group review'})).toBeDisabled();expect(await s.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
