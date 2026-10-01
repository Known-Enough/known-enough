import { writeFileSync } from 'node:fs';
import { REQUIRED_TESTS } from './runner-core.mjs';
export default class Reporter {
  tests=[];
  onTestEnd(test,result){if(REQUIRED_TESTS.includes(test.title))this.tests.push({title:test.title,status:result.status});}
  onEnd(){if(process.env.QA_RESULTS_FILE)writeFileSync(process.env.QA_RESULTS_FILE,JSON.stringify({tests:this.tests}),{mode:0o600});}
  printsToStdio(){return false;}
}
