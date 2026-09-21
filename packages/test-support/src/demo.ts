import { solveDecision } from '@deal-table/domain';
import { buildTeamTableFixture, planLabel } from './teamtable-fixture.ts';

function run(policy: 'LOWEST_INCONVENIENCE' | 'BALANCE_RECENT_LOAD'): void {
  const baseline = solveDecision(buildTeamTableFixture({ policy }));
  const granted = solveDecision(buildTeamTableFixture({ policy, withGrant: true }));
  console.log(`${policy}`);
  console.log(`  structural candidates: ${baseline.structuralPlans.length}`);
  console.log(`  baseline: ${baseline.status}`);
  if (granted.status === 'SOLVED') {
    console.log(`  feasible after Nina's scoped exception: ${granted.feasiblePlans.length}`);
    console.log(`  selected: ${planLabel(granted.selectedPlan)}`);
  } else {
    console.log(`  after exception: ${granted.status}`);
  }
}

run('LOWEST_INCONVENIENCE');
run('BALANCE_RECENT_LOAD');
