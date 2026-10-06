import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIdentity, aws, awsSkeleton, preservationInput } from './live-qa/aws.mjs';

const TARGET = Object.freeze({
    account: '092954139775', region: 'us-east-1', pool: 'us-east-1_V9OMjd0zx',
    domain: 'known-enough-092954139775', participant: '3accf7paalvon2m8ue8okfi853',
    display: '481ru24906sv26f30i569gq8g0', frontend: 'https://main.d143q5ravxp5av.amplifyapp.com/'
});
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SIMPLE_PASSWORD_POLICY = Object.freeze({
    MinimumLength: 6, RequireUppercase: false, RequireLowercase: false,
    RequireNumbers: false, RequireSymbols: false
});
function exactArray(values, expected) {
    return Array.isArray(values) && values.length === expected.length
        && expected.every(value => values.includes(value));
}
function clientSummary(client, id, scopes) {
    if (!client || client.ClientId !== id || client.UserPoolId !== TARGET.pool)
        throw new Error('ASSESS11_CLIENT_IDENTITY_MISMATCH');
    return {
        clientId: id,
        secretless: !client.ClientSecret,
        codeFlow: client.AllowedOAuthFlowsUserPoolClient === true && exactArray(client.AllowedOAuthFlows, ['code']),
        scopes: Array.isArray(client.AllowedOAuthScopes) ? [...client.AllowedOAuthScopes].sort() : [],
        requiredScopesPresent: scopes.every(scope => client.AllowedOAuthScopes?.includes(scope)),
        cognitoProvider: client.SupportedIdentityProviders?.includes('COGNITO') === true,
        callbackExact: client.CallbackURLs?.includes(TARGET.frontend) === true,
        logoutExact: client.LogoutURLs?.includes(TARGET.frontend) === true
    };
}
/** Strict public allowlist; the complete provider responses stay in a private 0600 snapshot. */
export function summarizeAuthSnapshot(snapshot) {
    const pool = snapshot?.userPool;
    if (snapshot?.account !== TARGET.account || !pool || pool.Id !== TARGET.pool)
        throw new Error('ASSESS11_POOL_IDENTITY_MISMATCH');
    if (!Array.isArray(pool.SchemaAttributes)) throw new Error('ASSESS11_POOL_SNAPSHOT_INCOMPLETE');
    const policy = pool.Policies?.PasswordPolicy;
    const email = pool.SchemaAttributes?.find(attribute => attribute.Name === 'email');
    return {
        account: TARGET.account, region: TARGET.region, poolId: TARGET.pool,
        domainExact: pool.Domain === TARGET.domain,
        selfSignupEnabled: pool.AdminCreateUserConfig?.AllowAdminCreateUserOnly === false,
        emailAutoVerified: pool.AutoVerifiedAttributes?.includes('email') === true,
        emailRequiredForHostedSignup: email?.Required === true,
        passwordPolicy: policy ? {
            minimumLength: policy.MinimumLength ?? null,
            requireUppercase: policy.RequireUppercase ?? null,
            requireLowercase: policy.RequireLowercase ?? null,
            requireNumbers: policy.RequireNumbers ?? null,
            requireSymbols: policy.RequireSymbols ?? null
        } : null,
        participantClient: clientSummary(snapshot.participantClient, TARGET.participant, ['openid', 'email']),
        displayClient: clientSummary(snapshot.displayClient, TARGET.display, ['openid'])
    };
}
export function passwordMatchesPolicy(password, policy) {
    return typeof password === 'string' && typeof policy?.MinimumLength === 'number'
        && password.length >= policy.MinimumLength && password.length <= 256
        && (!policy.RequireUppercase || /[A-Z]/.test(password))
        && (!policy.RequireLowercase || /[a-z]/.test(password))
        && (!policy.RequireNumbers || /\d/.test(password))
        && (!policy.RequireSymbols || /[^A-Za-z0-9]/.test(password));
}
/** Prepare a full supported UpdateUserPool input from the complete private DescribeUserPool snapshot. No AWS write. */
export function preparePasswordPolicy(snapshot, updateSkeleton) {
    const pool = snapshot?.userPool;
    if (snapshot?.account !== TARGET.account || !pool || pool.Id !== TARGET.pool
        || !pool.Policies?.PasswordPolicy || !updateSkeleton || typeof updateSkeleton !== 'object'
        || !Object.hasOwn(updateSkeleton, 'Policies') || !Object.hasOwn(updateSkeleton, 'UserPoolId'))
        throw new Error('ASSESS11_POOL_SNAPSHOT_INCOMPLETE');
    const rollbackInput = { ...preservationInput(pool, updateSkeleton), UserPoolId: TARGET.pool };
    const updateInput = structuredClone(rollbackInput);
    updateInput.Policies.PasswordPolicy = { ...updateInput.Policies.PasswordPolicy, ...SIMPLE_PASSWORD_POLICY };
    return { updateInput, rollbackInput };
}
export function privateDirectory(path) {
    if (!isAbsolute(path)) throw new Error('ASSESS11_PRIVATE_PATH_REQUIRED');
    const out = resolve(path);
    const repository = realpathSync(WORKSPACE_ROOT);
    if (out === repository || out.startsWith(repository + sep))
        throw new Error('ASSESS11_PRIVATE_PATH_REQUIRED');
    // Inspect every existing ancestor before creating anything; lexical resolve does not follow aliases.
    for (let parent = dirname(out); ; parent = dirname(parent)) {
        const info = lstatSync(parent);
        if (info.isSymbolicLink() || !info.isDirectory())
            throw new Error('ASSESS11_PRIVATE_PATH_REQUIRED');
        const actual = realpathSync(parent);
        if (actual === repository || actual.startsWith(repository + sep))
            throw new Error('ASSESS11_PRIVATE_PATH_REQUIRED');
        if (parent === dirname(parent)) break;
    }
    mkdirSync(out, { mode: 0o700 }); // Exclusive directory creation also rejects existing output aliases.
    const info = lstatSync(out);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
        || info.uid !== process.getuid())
        throw new Error('ASSESS11_PRIVATE_PATH_REQUIRED');
}

export function privateWrite(path, value) {
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function readCurrent() {
    assertIdentity(aws('sts', 'get-caller-identity'), TARGET);
    return {
        account: TARGET.account,
        userPool: aws('cognito-idp', 'describe-user-pool', { UserPoolId: TARGET.pool }).UserPool,
        participantClient: aws('cognito-idp', 'describe-user-pool-client',
            { UserPoolId: TARGET.pool, ClientId: TARGET.participant }).UserPoolClient,
        displayClient: aws('cognito-idp', 'describe-user-pool-client',
            { UserPoolId: TARGET.pool, ClientId: TARGET.display }).UserPoolClient
    };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const [mode, first, second] = process.argv.slice(2);
        if (mode === 'read' && first && !second) {
            const snapshot = readCurrent();
            const summary = summarizeAuthSnapshot(snapshot);
            privateDirectory(first);
            privateWrite(join(first, 'full-snapshot.json'), snapshot);
            privateWrite(join(first, 'allowlisted-summary.json'), summary);
            console.log(JSON.stringify({ status: 'READ_ONLY_SNAPSHOT_SAVED', summary }));
        } else if (mode === 'prepare' && first && second) {
            const snapshot = JSON.parse(readFileSync(first, 'utf8'));
            const summary = summarizeAuthSnapshot(snapshot);
            const inputs = preparePasswordPolicy(snapshot, awsSkeleton('cognito-idp', 'update-user-pool'));
            privateDirectory(second);
            privateWrite(join(second, 'update-input.json'), inputs.updateInput);
            privateWrite(join(second, 'rollback-input.json'), inputs.rollbackInput);
            privateWrite(join(second, 'prior-summary.json'), summary);
            console.log(JSON.stringify({ status: 'PRIVATE_UPDATE_PREPARED_NO_CLOUD_WRITE',
                poolId: TARGET.pool, priorPolicy: summary.passwordPolicy, requestedPolicy: SIMPLE_PASSWORD_POLICY }));
        } else throw new Error('ASSESS11_USAGE');
    } catch (error) {
        const safe = new Set(['ASSESS11_CLIENT_IDENTITY_MISMATCH', 'ASSESS11_POOL_IDENTITY_MISMATCH',
            'ASSESS11_POOL_SNAPSHOT_INCOMPLETE', 'ASSESS11_PRIVATE_PATH_REQUIRED', 'ASSESS11_USAGE']);
        console.error(safe.has(error?.message) ? error.message : 'ASSESS11_AUTH_CONFIG_FAILED');
        process.exitCode = 1;
    }
}
