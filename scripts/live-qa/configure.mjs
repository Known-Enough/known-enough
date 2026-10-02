import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, isMailDomain, mailboxProvider } from './config.mjs';

const example = () => JSON.parse(readFileSync(new URL('../../infra/live-qa/config.example.json', import.meta.url), 'utf8'));
const placeholders = example();
const inputNames = ['mailDomain', 'hostedZoneId', 'sourceCommit', 'mailboxProvider'];

/** Offline only: omitted inputs stay placeholders; this never enables paid/cloud operations. */
export function draftConfiguration(inputs = {}) {
  if (Object.keys(inputs).some(key => !inputNames.includes(key))) throw new Error('UNKNOWN_CONFIGURATION_INPUT');
  const draft = example();
  for (const name of inputNames) {
    if (inputs[name] === undefined) continue;
    if (typeof inputs[name] !== 'string' || !inputs[name].trim()) throw new Error('INVALID_CONFIGURATION_INPUT');
    const value = inputs[name].trim();
    draft[name] = name === 'mailDomain' ? value.toLowerCase().replace(/\.$/, '')
      : name === 'hostedZoneId' ? value.replace(/^\/hostedzone\//, '') : value;
  }
  if (mailboxProvider(draft) === 'mailtm') {
    if (inputs.mailDomain !== undefined || inputs.hostedZoneId !== undefined) throw new Error('MAILTM_DNS_INPUT_NOT_ALLOWED');
    draft.mailDomain = null; draft.hostedZoneId = null;
  }
  const status = configurationStatus(draft);
  if (status.status === 'INVALID_CONFIGURATION') throw new Error('INVALID_CONFIGURATION_INPUT');
  return draft;
}

/** Reports field names only; no configuration values, credentials or environment are printed. */
export function configurationStatus(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return { status: 'INVALID_CONFIGURATION', fields: ['configuration'], cloudWrites: false };
  const required = mailboxProvider(draft) === 'mailtm' ? ['sourceCommit'] : ['mailDomain', 'hostedZoneId', 'sourceCommit'];
  const missing = required.filter(key => draft[key] === placeholders[key] || draft[key] === null || draft[key] === undefined || draft[key] === '');
  const invalid = required.filter(key => !missing.includes(key) && (key === 'mailDomain' ? !isMailDomain(draft[key])
    : key === 'hostedZoneId' ? !/^Z[A-Z0-9]{5,32}$/.test(draft[key]) : !/^[a-f0-9]{40}$/.test(draft[key])));
  if (invalid.length) return { status: 'INVALID_CONFIGURATION', fields: invalid, cloudWrites: false };
  // Validate all fixed security/envelope fields even when site inputs are not chosen yet.
  // These syntax-only stand-ins are never written to the draft or sent to AWS.
  try { validateConfig({ ...draft, ...Object.fromEntries(missing.map(key => [key,
    key === 'mailDomain' ? 'qa.example.org' : key === 'hostedZoneId' ? 'Z123456789' : 'a'.repeat(40)])) }); }
  catch { return { status: 'INVALID_CONFIGURATION', fields: ['configuration'], cloudWrites: false }; }
  return { status: missing.length ? 'NEEDS_INPUTS' : 'READY_FOR_READ_ONLY_VALIDATION', missing,
    authorizationEnabled: draft.authorization.approved, primaryRollout: draft.primaryRollout, cloudWrites: false };
}

export function writeDraft(path, inputs = {}) {
  if (!isAbsolute(path)) throw new Error('ABSOLUTE_PRIVATE_OUTPUT_PATH_REQUIRED');
  const draft = draftConfiguration(inputs);
  // Exclusive create also rejects existing files/symlinks, preserving any saved approval/configuration.
  writeFileSync(path, JSON.stringify(draft, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return configurationStatus(draft);
}

export function configure(args) {
  const [mode, path, ...flags] = args;
  if (!['init', 'check'].includes(mode) || !path || !isAbsolute(path)) throw new Error('CONFIGURATION_USAGE_REQUIRED');
  if (mode === 'check') {
    if (flags.length) throw new Error('CONFIGURATION_USAGE_REQUIRED');
    return configurationStatus(JSON.parse(readFileSync(path, 'utf8')));
  }
  const mapping = { '--mail-domain': 'mailDomain', '--hosted-zone-id': 'hostedZoneId', '--source-commit': 'sourceCommit', '--mailbox-provider': 'mailboxProvider' };
  const inputs = {};
  for (let i = 0; i < flags.length; i += 2) {
    const key = mapping[flags[i]];
    if (!key || inputs[key] !== undefined || flags[i + 1] === undefined || flags[i + 1].startsWith('--')) throw new Error('CONFIGURATION_USAGE_REQUIRED');
    inputs[key] = flags[i + 1];
  }
  return writeDraft(path, inputs);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const status = configure(process.argv.slice(2));
    console.log(JSON.stringify(status));
    if (status.status === 'INVALID_CONFIGURATION') process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ status: 'CONFIGURATION_FAILED', cloudWrites: false,
      recovery: 'Use init ABSOLUTE_NEW_FILE with optional --mail-domain/--hosted-zone-id/--source-commit, or check ABSOLUTE_FILE. Existing files are never overwritten.' }));
    process.exitCode = 1;
  }
}
