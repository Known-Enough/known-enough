// Planning-only consistency check. Not an application or security implementation.
import assert from 'node:assert/strict';

const names = ['Maya', 'Leo', 'Nina'];
const starts = [600, 660, 840];
const prior = { Maya: 0, Leo: 3, Nina: 0 };
const costs = { Maya: { lead: 3, followup: 0 }, Leo: { lead: 0, followup: 1 }, Nina: { followup: 0 } };
const context = 'roster-v1/schedule-v1/inputs-v1/balance-policy-v1';
const plans = starts.flatMap(start => ['Maya', 'Leo'].flatMap(lead =>
  names.filter(person => person !== lead).map(followup => ({ start, duration: 30, lead, followup }))));
function grantAllows(plan, grant, currentContext = context) {
  return Boolean(grant && !grant.revoked && grant.expires > 100 && grant.context === currentContext
    && plan.start === 660 && plan.duration === 30 && plan.lead !== 'Nina' && plan.followup !== 'Nina');
}
function feasible(plan, grant, { ninaAvailable = false, impossible = false, currentContext = context } = {}) {
  if (plan.lead === plan.followup || plan.lead === 'Nina') return false;
  if (plan.start < (impossible ? 840 : 660) || plan.start > 660) return false;
  return plan.start !== 660 || ninaAvailable || grantAllows(plan, grant, currentContext);
}
const validGrant = { context, expires: 200, revoked: false };
const inconvenience = plan => costs[plan.lead].lead + costs[plan.followup].followup;
const loads = plan => names.map(name => prior[name] + (plan.lead === name ? 2 : 0) + (plan.followup === name ? 1 : 0));
const maxLoad = plan => Math.max(...loads(plan));
let checks = 0;
function check(label, fn) { fn(); checks++; console.log(`PASS ${label}`); }
check('12 structural plans', () => assert.equal(plans.length, 12));
check('zero feasible without consent', () => assert.equal(plans.filter(p => feasible(p)).length, 0));
const accepted = plans.filter(p => feasible(p, validGrant));
check('two feasible with scoped consent', () => assert.equal(accepted.length, 2));
const A = accepted.find(p => p.lead === 'Maya');
const B = accepted.find(p => p.lead === 'Leo');
check('declared inconvenience A=4, B=0', () => assert.deepEqual([inconvenience(A), inconvenience(B)], [4, 0]));
check('load maximum A=4, B=5', () => assert.deepEqual([maxLoad(A), maxLoad(B)], [4, 5]));
check('inconvenience policy chooses B', () => assert.equal([...accepted].sort((a,b) => inconvenience(a)-inconvenience(b))[0], B));
check('load policy chooses A', () => assert.equal([...accepted].sort((a,b) => maxLoad(a)-maxLoad(b))[0], A));
check('revocation closes exception', () => assert.equal(plans.filter(p => feasible(p, {...validGrant, revoked:true})).length, 0));
check('expiry closes exception', () => assert.equal(plans.filter(p => feasible(p, {...validGrant, expires:99})).length, 0));
check('wrong context closes exception', () => assert.equal(plans.filter(p => feasible(p, validGrant, {currentContext:'new-policy'})).length, 0));
check('60-minute meeting is outside grant', () => assert.equal(feasible({...A, duration:60}, validGrant), false));
check('Nina weekend duty violates grant', () => assert.equal(feasible({...A, followup:'Nina'}, validGrant), false));
check('hard-impossible case remains impossible', () => assert.equal(plans.filter(p => feasible(p, validGrant, {impossible:true})).length, 0));
check('zero-concession-success variation has four plans', () => assert.equal(plans.filter(p => feasible(p, undefined, {ninaAvailable:true})).length, 4));
check('denying optional disclosure does not alter feasibility', () => {
  const permission = { exception: validGrant, disclosure: false };
  assert.equal(plans.filter(p => feasible(p, permission.exception)).length, 2);
});
console.log(`${checks} planning checks passed. Authentication, concurrency, and production privacy are not implemented or tested here.`);
