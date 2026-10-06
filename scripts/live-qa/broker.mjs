import { safeBudgetEvidence } from './budget-evidence.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminGetUserCommand, AdminDeleteUserCommand, AdminUserGlobalSignOutCommand, CreateGroupCommand, DeleteGroupCommand, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient, PutSecretValueCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createDynamoGroupRepository, createAwsDynamoDBRoomRepository } from '../../packages/adapters/src/index.ts';
import { KnownEnoughApplication } from '../../packages/application/src/index.ts';
import { operateAccount } from '../../apps/api/src/group-operator.ts';
import { ACTORS, requireRunId, authorizationActive, qa05Allowance } from './config.mjs';
import { createMailtmClient } from './mailtm.mjs';
import { reserveTotal, authorizationTransaction } from './cumulative.mjs';
import { beginLease, actorUsername, cleanupPlan } from './fixture-core.mjs';
import { githubRun, reserveExtra } from './extra-runs.mjs';
import { assertStandingRun } from './standing.mjs';
import { githubApprovals, githubAllowance } from './github-allowance.mjs';
const options = { region: 'us-east-1', maxAttempts: 1 };
const db = new DynamoDBClient(options), users = new CognitoIdentityProviderClient(options), secrets = new SecretsManagerClient(options), s3 = new S3Client(options);
const mailtm = createMailtmClient();
const freeMailbox = () => process.env.QA_MAIL_PROVIDER === 'mailtm';
async function loginSecret() {
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.QA_SECRET }));
    try {
        return JSON.parse(result.SecretString);
    }
    catch {
        return null;
    }
}
async function saveLogin(value) {
    await secrets.send(new PutSecretValueCommand({ SecretId: process.env.QA_SECRET, SecretString: JSON.stringify(value), ClientRequestToken: randomBytes(20).toString('hex') }));
}
const key = id => ({ PK: { S: id }, SK: { S: 'STATE' } });
const table = () => process.env.QA_CONTROL_TABLE;
async function read(id) {
    const result = await db.send(new GetItemCommand({ TableName: table(), Key: key(id), ConsistentRead: true }));
    return result.Item ? { value: JSON.parse(result.Item.payload.S), version: Number(result.Item.version.N) } : { value: null, version: 0 };
}
const put = (id, prior, value) => ({
    Put: {
        TableName: table(), Item: { ...key(id), payload: { S: JSON.stringify(value) }, version: { N: String(prior.version + 1) } }, ConditionExpression: prior.version ? '#v=:v' : 'attribute_not_exists(PK)', ...(prior.version ? { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': { N: String(prior.version) } } } : {})
    }
});
async function save(id, prior, value) {
    await db.send(new TransactWriteItemsCommand({ TransactItems: [put(id, prior, value)] }));
    return { value, version: prior.version + 1 };
}
async function auth() {
    const a = await read('AUTH');
    if (!authorizationActive(a.value))
        throw new Error('AUTHORIZATION_BLOCKED');
    return a;
}
async function lease(id, cleaning = false) {
    requireRunId(id);
    const l = await read('LEASE');
    if (l.value?.id !== id || (!cleaning && (l.value.status !== 'ACTIVE' || l.value.expiresAt <= Date.now())))
        throw new Error('LEASE_BLOCKED');
    return l;
}
function attributes(result) {
    return Object.fromEntries((result.UserAttributes ?? result.User?.Attributes ?? []).map(item => [item.Name, item.Value]));
}
const groupRepo = () => createDynamoGroupRepository(process.env.QA_GROUP_TABLE, 'us-east-1');
async function setActorStatus(l, actor, action) {
    let user = l.value.users.find(item => item.actor === actor);
    if (user?.actor === 'signup' && !user.subject) {
        const current = await users.send(new AdminGetUserCommand({ UserPoolId: process.env.QA_POOL_ID, Username: user.username }));
        const fields = attributes(current);
        if (fields.email !== user.email || fields.email_verified !== 'true' || !fields.sub)
            throw new Error('SIGNUP_NOT_VERIFIED');
        user = { ...user, subject: fields.sub };
        await save('LEASE', l, { ...l.value, users: l.value.users.map(item => item.actor === actor ? user : item) });
    }
    if (!user?.subject || !['approve', 'reject', 'disable'].includes(action))
        throw new Error('ACTOR_NOT_PROVISIONED');
    const repository = groupRepo();
    const version = await repository.transaction(state => state.accounts.find(item => item.subject === user.subject)?.version);
    if (!version)
        throw new Error('ACCOUNT_NOT_REGISTERED');
    await operateAccount(repository, action, user.subject, version);
    return { status: 'PASS', actor };
}
async function migrateStanding(runId) {
    assertStandingRun(runId, await githubRun(runId));
    const readItem = async id => (await db.send(new GetItemCommand({ TableName: table(), Key: key(id), ConsistentRead: true }))).Item;
    const a = await readItem('AUTH');
    if (!a) throw new Error('AUTHORIZATION_BLOCKED');
    const standing = qa05Allowance(JSON.parse(a.payload.S));
    if (!standing.approved) throw new Error('AUTHORIZATION_BLOCKED');
    const l = await readItem('LEASE');
    const total = await readItem('TOTAL');
    // CAS every observed cell; TOTAL and historical DAY/EXTRA records are never rewritten.
    if (!total) throw new Error('CUMULATIVE_BUDGET_MIGRATION_REQUIRES_RECONCILIATION');
    await db.send(new TransactWriteItemsCommand(authorizationTransaction(table(), a, l, total, standing)));
    return { status: 'PASS', authorizationMode: 'standing', usagePreserved: true };
}
async function provision(runId) {
    const a = await auth();
    let prior = await read('LEASE');
    const current = beginLease(prior.value, runId, a.value, Date.now());
    if (prior.value?.id !== runId) {
        const day = 'DAY#' + new Date().toISOString().slice(0, 10);
        const period = await read(day);
        const next = { runs: (period.value?.runs ?? 0) + 1, messages: period.value?.messages ?? 0 };
        const total = await read('TOTAL');
        const reservedTotal = reserveTotal(total.value, a.value, { runs: 1 });
        let extraReservation = [];
        if (a.value.mode === 'standing') assertStandingRun(runId, await githubRun(runId));
        if (next.runs > a.value.maxRunsPerDay) {
            const extraKey = 'EXTRA#' + day.slice(4);
            const extra = await read(extraKey);
            const testRun = await githubRun(runId);
            if (extra.value) {
                try {
                    const reservedExtra = reserveExtra(extra.value, a.value, a.version, period.value.runs, runId, testRun, Date.now());
                    extraReservation = [put(extraKey, extra, reservedExtra)];
                } catch (error) {
                    if (!['EXTRA_RUN_ALLOWANCE_BLOCKED', 'EXTRA_RUN_ACTOR_UNVERIFIED'].includes(error.message)) throw error;
                }
            }
            if (!extraReservation.length) {
                const now = Date.now();
                const grant = await githubAllowance(await githubApprovals(now), a.value, a.version, period.value,
                    total.value, runId, testRun, now, read);
                extraReservation = [put(grant.id, grant.prior, grant.next)];
            }
        }
        await db.send(new TransactWriteItemsCommand({
            TransactItems: [
                {
                    ConditionCheck: {
                        TableName: table(), Key: key('AUTH'), ConditionExpression: '#v=:v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': { N: String(a.version) } }
                    }
                }, put('LEASE', prior, current), put(day, period, next), put('TOTAL', total, reservedTotal), ...extraReservation
            ]
        }));
    }
    prior = await lease(runId);
    if (prior.value.initialized)
        return { status: 'PASS', runId, actors: ACTORS.length };
    const login = { schemaVersion: 1, runId, users: [] };
    if (freeMailbox()) {
        let saved = await loginSecret();
        if (saved?.runId !== runId || !saved.mailbox) {
            saved = { ...login, mailbox: await mailtm.intent(runId) };
            await saveLogin(saved);
        }
        const mailbox = saved.mailbox.id ? saved.mailbox : await mailtm.create(saved.mailbox);
        login.mailbox = mailbox;
        await saveLogin({ ...saved, mailbox });
        prior = await save('LEASE', prior, { ...prior.value, mailboxAccountId: mailbox.id, mailboxAddress: mailbox.address });
    }
    for (const actor of ACTORS) {
        const username = actorUsername(runId, actor), email = actor === 'signup' && freeMailbox() ? login.mailbox.address : `${username}@${process.env.QA_MAIL_DOMAIN}`, password = `Qa7!${randomBytes(24).toString('base64url')}`;
        let recorded = prior.value.users.find(item => item.actor === actor);
        if (!recorded) {
            const next = { ...prior.value, users: [...prior.value.users, { actor, username, email, subject: null }] };
            prior = await save('LEASE', prior, next);
            recorded = next.users.at(-1);
        }
        if (actor !== 'signup') {
            let found;
            try {
                found = await users.send(new AdminGetUserCommand({ UserPoolId: process.env.QA_POOL_ID, Username: username }));
            }
            catch (error) {
                if (error.name !== 'UserNotFoundException')
                    throw error;
                await users.send(new AdminCreateUserCommand({
                    UserPoolId: process.env.QA_POOL_ID, Username: username, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }]
                }));
                found = await users.send(new AdminGetUserCommand({ UserPoolId: process.env.QA_POOL_ID, Username: username }));
            }
            const fields = attributes(found);
            if (fields.email !== email || !fields.sub)
                throw new Error('IDENTITY_MISMATCH');
            await users.send(new AdminSetUserPasswordCommand({ UserPoolId: process.env.QA_POOL_ID, Username: username, Password: password, Permanent: true }));
            recorded = { ...recorded, subject: fields.sub };
            prior = await save('LEASE', prior, { ...prior.value, users: prior.value.users.map(item => item.actor === actor ? recorded : item) });
        }
        login.users.push({ ...recorded, password });
    }
    await secrets.send(new PutSecretValueCommand({ SecretId: process.env.QA_SECRET, SecretString: JSON.stringify(login), ClientRequestToken: randomBytes(20).toString('hex') }));
    await save('LEASE', prior, { ...prior.value, initialized: true });
    return { status: 'PASS', runId, actors: ACTORS.length };
}
async function cleanup(runId) {
    let l = await lease(runId, true);
    if (l.value.status === 'CLEAN')
        return { status: 'PASS', runId, cleanup: 'CLEAN' };
    l = await save('LEASE', l, { ...l.value, status: 'CLEANING' });
    try {
        await new Promise(resolve => globalThis.setTimeout(resolve, 32000));
        for (const user of l.value.users.filter(item => !item.subject)) {
            try {
                const found = await users.send(new AdminGetUserCommand({ UserPoolId: process.env.QA_POOL_ID, Username: user.username }));
                const fields = attributes(found);
                if (fields.email !== user.email || !fields.sub)
                    throw new Error('CLEANUP_OWNER_MISMATCH');
                user.subject = fields.sub;
            }
            catch (error) {
                if (error.name !== 'UserNotFoundException')
                    throw error;
            }
        }
        l = await save('LEASE', l, l.value);
        const repository = groupRepo();
        const plan = await repository.transaction(state => cleanupPlan(state, l.value));
        // Exact decision PK only; no Scan, no shared table and no prefix deletion.
        for (const decisionId of plan.decisions) {
            let start;
            do {
                const page = await db.send(new QueryCommand({
                    TableName: process.env.QA_DECISION_TABLE, KeyConditionExpression: 'PK=:p', ExpressionAttributeValues: { ':p': { S: 'ROOM#' + decisionId } }, ...(start ? { ExclusiveStartKey: start } : {})
                }));
                for (const item of page.Items ?? [])
                    await db.send(new DeleteItemCommand({ TableName: process.env.QA_DECISION_TABLE, Key: { PK: item.PK, SK: item.SK } }));
                start = page.LastEvaluatedKey;
            } while (start);
        }
        await repository.transaction(state => {
            cleanupPlan(state, l.value);
            state.groups = state.groups.filter(group => !plan.groups.includes(group.id));
            state.accounts = state.accounts.filter(account => !plan.subjects.includes(account.subject));
        });
        for (const user of l.value.users) {
            if (user.username !== actorUsername(runId, user.actor))
                throw new Error('CLEANUP_OWNER_MISMATCH');
            try {
                const existing = await users.send(new AdminGetUserCommand({ UserPoolId: process.env.QA_POOL_ID, Username: user.username }));
                if (attributes(existing).email !== user.email)
                    throw new Error('CLEANUP_OWNER_MISMATCH');
                await users.send(new AdminUserGlobalSignOutCommand({ UserPoolId: process.env.QA_POOL_ID, Username: user.username }));
                await users.send(new AdminDeleteUserCommand({ UserPoolId: process.env.QA_POOL_ID, Username: user.username }));
            }
            catch (error) {
                if (error.name !== 'UserNotFoundException')
                    throw error;
            }
        }
        for (const name of l.value.displayGroups ?? []) {
            try {
                await users.send(new DeleteGroupCommand({ UserPoolId: process.env.QA_POOL_ID, GroupName: name }));
            }
            catch (error) {
                if (!['ResourceNotFoundException', 'GroupNotFoundException'].includes(error.name))
                    throw error;
            }
        }
        if (freeMailbox()) {
            const saved = await loginSecret();
            if (saved?.runId !== runId || saved.mailbox?.runId !== runId)
                throw new Error('MAILTM_CLEANUP_OWNER_MISMATCH');
            if (!saved.mailbox.deleted)
                await mailtm.remove(saved.mailbox);
            await saveLogin({ schemaVersion: 1, runId, users: [], mailbox: { runId, deleted: true } });
        }
        if (!freeMailbox())
            await saveLogin({ schemaVersion: 1, runId, users: [] });
        for (const object of l.value.mailboxObjects ?? [])
            await s3.send(new DeleteObjectCommand({ Bucket: process.env.QA_MAIL_BUCKET, Key: object }));
        await save('LEASE', l, { ...l.value, status: 'CLEAN' });
        return { status: 'PASS', runId, cleanup: 'CLEAN' };
    }
    catch {
        await save('LEASE', l, { ...l.value, status: 'CLEANUP_FAILED' });
        throw new Error('CLEANUP_FAILED');
    }
}
export function verificationCode(raw, email) {
    const [headers] = raw.split(/\r?\n\r?\n/, 1);
    if (!headers.toLowerCase().includes(email.toLowerCase()))
        return null;
    const parts = raw.split(/\r?\n--[^\r\n]+/);
    for (const part of parts) {
        const split = part.search(/\r?\n\r?\n/);
        if (split < 0)
            continue;
        const h = part.slice(0, split);
        let body = part.slice(split).trim();
        if (/Content-Transfer-Encoding:\s*base64/i.test(h))
            body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
        else if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(h))
            body = body.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const code = body.match(/QA verification code[=: ]+(\d{6})/);
        if (code)
            return code[1];
    }
    return null;
}
async function verification(runId) {
    const l = await lease(runId);
    const user = l.value.users.find(item => item.actor === 'signup');
    if (!user)
        throw new Error('ACTOR_NOT_PROVISIONED');
    if (freeMailbox()) {
        const saved = await loginSecret();
        if (saved?.runId !== runId || saved.mailbox?.id !== l.value.mailboxAccountId || saved.mailbox?.address !== user.email)
            throw new Error('MAILTM_MAIL_OWNER_MISMATCH');
        let mailStatus = 'MAIL_PENDING';
        let code;
        try { code = await mailtm.code(saved.mailbox, status => { mailStatus = status; }); }
        catch (error) {
            if (error.message === 'MAILTM_REQUEST_FAILED') mailStatus = 'MAIL_PROVIDER_UNAVAILABLE';
            else if (error.message === 'MAILTM_INVALID_MESSAGES') mailStatus = 'MAIL_SCHEMA_UNEXPECTED';
            else throw error; // Ownership, identity and paging failures remain blocked.
        }
        return code ? { status: 'PASS', code, mailStatus } : { status: 'WAITING', mailStatus };
    }
    const page = await s3.send(new ListObjectsV2Command({ Bucket: process.env.QA_MAIL_BUCKET, Prefix: 'verification/', MaxKeys: 100 }));
    for (const item of (page.Contents ?? []).sort((a, b) => Number(b.LastModified) - Number(a.LastModified))) {
        if (!item.Key || Number(item.LastModified) < l.value.expiresAt - 45 * 60000)
            continue;
        const object = await s3.send(new GetObjectCommand({ Bucket: process.env.QA_MAIL_BUCKET, Key: item.Key }));
        if ((object.ContentLength ?? 0) > 100000)
            continue;
        const raw = await object.Body.transformToString();
        const match = verificationCode(raw, user.email);
        if (!match)
            continue;
        await save('LEASE', l, { ...l.value, mailboxObjects: [...new Set([...(l.value.mailboxObjects ?? []), item.Key])] });
        return { status: 'PASS', code: match };
    }
    return { status: 'WAITING' };
}
async function messageReservation(event) {
    const a = await auth();
    const l = await read('LEASE');
    const username = actorUsername(l.value?.id, 'signup');
    if (event.userName !== username || event.request?.userAttributes?.email !== l.value?.users.find(user => user.actor === 'signup')?.email || l.value.status !== 'ACTIVE' || l.value.expiresAt <= Date.now())
        throw new Error('QA_MESSAGE_DENIED');
    const day = 'DAY#' + new Date().toISOString().slice(0, 10);
    const period = await read(day);
    const messages = (l.value.signupMessages ?? 0) + 1;
    const daily = (period.value?.messages ?? 0) + 1;
    if (messages > a.value.maxSignupMessagesPerRun || (a.value.mode !== 'standing' && daily > a.value.maxSignupMessagesPerDay))
        throw new Error('QA_MESSAGE_BUDGET');
    const total = await read('TOTAL');
    const reservedTotal = reserveTotal(total.value, a.value, { messages: 1 });
    await db.send(new TransactWriteItemsCommand({
        TransactItems: [
            {
                ConditionCheck: {
                    TableName: table(), Key: key('AUTH'), ConditionExpression: '#v=:v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': { N: String(a.version) } }
                }
            }, put('LEASE', l, { ...l.value, signupMessages: messages }), put(day, period, { ...period.value, messages: daily }), put('TOTAL', total, reservedTotal)
        ]
    }));
}
export async function preSignup(event) {
    const l = await read('LEASE');
    if (!l.value || l.value.status !== 'ACTIVE' || l.value.expiresAt <= Date.now())
        throw new Error('QA_SIGNUP_DENIED');
    const user = l.value.users.find(item => item.username === event.userName);
    if (!user || event.request?.userAttributes?.email !== user.email || (!event.triggerSource?.includes('AdminCreateUser') && user.actor !== 'signup'))
        throw new Error('QA_SIGNUP_DENIED');
    return event;
}
export async function customMessage(event) {
    if (!['CustomMessage_SignUp', 'CustomMessage_ResendCode'].includes(event.triggerSource))
        throw new Error('QA_MESSAGE_DENIED');
    await messageReservation(event);
    if (freeMailbox())
        return event;
    event.response.emailSubject = 'Known Enough QA verification';
    event.response.emailMessage = `QA verification code: ${event.request.codeParameter}`;
    return event;
}
export async function handler(event) {
    try {
        if (!event || Object.keys(event).some(key => !['action', 'runId', 'actor', 'decisionId', 'permissionId', 'audienceActor'].includes(key)))
            throw new Error('INVALID_FIXTURE_COMMAND');
        requireRunId(event.runId);
        if (event.action === 'migrate-standing')
            return await migrateStanding(event.runId);
        if (event.action === 'start')
            return await provision(event.runId);
        if (event.action === 'cleanup')
            return await cleanup(event.runId);
        const l = await lease(event.runId);
        if (event.action === 'mail')
            return await verification(event.runId);
        if (['approve', 'reject', 'disable'].includes(event.action))
            return await setActorStatus(l, event.actor, event.action);
        if (event.action === 'stats') {
            const authorization = await auth();
            const budget = safeBudgetEvidence(Object.fromEntries(['attempts', 'reservedTokens', 'reservedCostMicros', 'maxAttemptsPerRun', 'maxTokensPerRun', 'maxCostMicrosPerRun'].map(key => [key, key.startsWith('max') ? authorization.value[key] : l.value[key]])));
            return { budget,
                status: 'PASS', attempts: l.value.attempts, reservedTokens: l.value.reservedTokens, reservedCostMicros: l.value.reservedCostMicros, signupMessages: l.value.signupMessages ?? 0
            };
        }
        if (event.action === 'kernel-diagnostics' || event.action === 'bind-display' || event.action === 'disclosure' || event.action === 'publish-disclosure' || event.action === 'expire-invitation') {
            const owned = await groupRepo().transaction(state => cleanupPlan(state, l.value));
            if (event.action !== 'expire-invitation' && !owned.decisions.includes(event.decisionId))
                throw new Error('FOREIGN_DECISION');
            if (event.action === 'kernel-diagnostics') {
                const { diagnosePendingCandidate } = await import('./kernel-diagnostics.ts');
                return await createAwsDynamoDBRoomRepository(process.env.QA_DECISION_TABLE, 'us-east-1').transactionDecision(event.decisionId, diagnosePendingCandidate);
            }
            if (event.action === 'expire-invitation') {
                const user = l.value.users.find(item => item.actor === event.actor);
                if (!user)
                    throw new Error('UNKNOWN_ACTOR');
                const { GroupService } = await import('../../apps/api/src/group-service.ts');
                const hash = new GroupService(groupRepo(), { emailKey: process.env.NP_GROUP_EMAIL_KEY, now: Date.now }).emailHash(user.email);
                await groupRepo().transaction(state => {
                    for (const group of state.groups.filter(item => owned.groups.includes(item.id)))
                        for (const invite of group.invitations.filter(item => item.recipientHash === hash && !item.acceptedBy))
                            invite.expiresAt = Date.now() - 1;
                });
                return { status: 'PASS' };
            }
            if (event.action === 'bind-display') {
                const user = l.value.users.find(item => item.actor === 'display');
                const name = `deal-table-display-${event.decisionId}`;
                await save('LEASE', l, { ...l.value, displayGroups: [...new Set([...(l.value.displayGroups ?? []), name])] });
                try {
                    await users.send(new CreateGroupCommand({ UserPoolId: process.env.QA_POOL_ID, GroupName: name }));
                }
                catch (error) {
                    if (error.name !== 'GroupExistsException')
                        throw error;
                }
                await users.send(new AdminAddUserToGroupCommand({ UserPoolId: process.env.QA_POOL_ID, Username: user.username, GroupName: name }));
                return { status: 'PASS' };
            }
            const owner = l.value.users.find(item => item.actor === event.actor);
            if (!owner?.subject)
                throw new Error('UNKNOWN_ACTOR');
            const app = new KnownEnoughApplication({
                repository: createAwsDynamoDBRoomRepository(process.env.QA_DECISION_TABLE, 'us-east-1'), clock: { now: () => new Date().toISOString() }, ids: { next: () => crypto.randomUUID() }
            });
            if (event.action === 'publish-disclosure') {
                if (!event.permissionId?.startsWith(`qa-${event.runId}-`))
                    throw new Error('FOREIGN_PERMISSION');
                const own = await app.getOwnerSnapshot({ kind: 'participant', subject: owner.subject }, event.decisionId);
                const permission = own.disclosurePermissions.find(p => p.permissionId === event.permissionId);
                if (!permission)
                    throw new Error('FOREIGN_PERMISSION');
                await app.publishDisclosure({ kind: 'service', subject: 'qa-fixture-broker', roomIds: [event.decisionId] }, event.decisionId, own.ownerParticipantId, permission.permissionId, permission.permissionVersion);
                return { status: 'PASS' };
            }
            const own = await app.getOwnerSnapshot({ kind: 'participant', subject: owner.subject }, event.decisionId);
            const p = own.publicSnapshot.currentProposal;
            if (!p)
                throw new Error('NO_PROPOSAL');
            const text = 'Fictional QA disclosure, separate from agreement.';
            await app.requestDisclosure({ kind: 'service', subject: 'qa-fixture-broker', roomIds: [event.decisionId] }, {
                kind: 'EXACT_TEXT', permissionId: `qa-${event.runId}-${event.permissionId ?? 'note'}`, permissionVersion: 1, decisionId: event.decisionId, contextToken: own.publicSnapshot.contextToken, semanticVersion: own.publicSnapshot.semanticVersion, ownerParticipantId: own.ownerParticipantId, proposalId: p.proposalId, proposalVersion: p.facts.proposalVersion, audienceParticipantIds: event.audienceActor ? [
                    (await app.getOwnerSnapshot({ kind: 'participant', subject: l.value.users.find(u => u.actor === event.audienceActor)?.subject ?? 'invalid-qa-audience' }, event.decisionId)).ownerParticipantId
                ] : own.publicSnapshot.frame.requiredParticipantIds, status: 'PENDING', expiresAt: new Date(Math.min(Date.now() + 600000, l.value.expiresAt)).toISOString(), text, textHash: createHash('sha256').update(text).digest('hex')
            });
            return { status: 'PASS' };
        }
        throw new Error('UNKNOWN_FIXTURE_ACTION');
    }
    catch {
        return { status: 'BLOCKED', code: 'QA_FIXTURE_OPERATION_FAILED' };
    }
}
