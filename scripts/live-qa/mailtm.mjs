import { randomBytes } from 'node:crypto';
import { isMailDomain, requireRunId } from './config.mjs';

// Synthetic QA only. API attribution and operating limits: https://mail.tm/.
// No caller-controlled URL, redirects, raw provider errors, or automatic retries.
const ORIGIN = 'https://api.mail.tm';
const idValid = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
export function createMailtmClient(fetcher = globalThis.fetch, pause = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms))) {
  async function request(path, { method = 'GET', token, body, missing = false, conflict = false } = {}) {
    if (!/^\/(?:domains|accounts|token|me|messages)(?:\/[a-zA-Z0-9-]{1,80})?(?:\?page=[1-3])?$/.test(path)) throw new Error('MAILTM_INVALID_PATH');
    await pause(2100);
    try {
      const response = await fetcher(ORIGIN + path, { method, redirect: 'error', signal: globalThis.AbortSignal.timeout(8000),
        headers: { Accept: 'application/ld+json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (missing && response.status === 404) return null;
      if (conflict && [409, 422].includes(response.status)) return null;
      if (!response.ok) throw new Error('MAILTM_REQUEST_FAILED');
      if (response.status === 204) return {};
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 100000) throw new Error('MAILTM_RESPONSE_LIMIT'); chunks.push(Buffer.from(part.value)); } }
      finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new Error('MAILTM_REQUEST_FAILED'); }
  }
  async function domain() {
    const result = await request('/domains');
    const candidate = result['hydra:member']?.find(item => item.isActive === true && item.isPrivate === false && isMailDomain(item.domain));
    if (!candidate) throw new Error('MAILTM_NO_PUBLIC_DOMAIN');
    return candidate.domain;
  }
  async function identity(mailbox) {
    const result = await request('/token', { method: 'POST', body: { address: mailbox.address, password: mailbox.password } });
    if (typeof result.token !== 'string' || result.token.length > 4096 || !idValid(result.id)) throw new Error('MAILTM_INVALID_IDENTITY');
    const me = await request('/me', { token: result.token });
    if (me.id !== result.id || me.address !== mailbox.address || me.isDisabled || me.isDeleted
      || (mailbox.id && mailbox.id !== me.id)) throw new Error('MAILTM_OWNER_MISMATCH');
    return { id: me.id, token: result.token };
  }
  return {
    domain,
    async intent(runId) { requireRunId(runId); return { runId, address: `keqa-${randomBytes(16).toString('hex')}@${await domain()}`, password: randomBytes(32).toString('base64url'), createdAt: Date.now() }; },
    async create(mailbox) {
      requireRunId(mailbox.runId);
      const created = await request('/accounts', { method: 'POST', body: { address: mailbox.address, password: mailbox.password }, conflict: true });
      if (created && (created.address !== mailbox.address || !idValid(created.id))) throw new Error('MAILTM_OWNER_MISMATCH');
      const own = await identity(mailbox);
      if (created && created.id !== own.id) throw new Error('MAILTM_OWNER_MISMATCH');
      return { ...mailbox, id: own.id, token: own.token };
    },
    async code(mailbox) {
      const own = await identity(mailbox);
      for (let page = 1; page <= 3; page++) {
        const result = await request('/messages?page=' + page, { token: own.token });
        if (!Array.isArray(result['hydra:member'])) throw new Error('MAILTM_INVALID_MESSAGES');
        for (const item of result['hydra:member']) {
          if (!idValid(item.id) || item.isDeleted || item.size > 100000) continue;
          const message = await request('/messages/' + item.id, { token: own.token });
          const code = mailtmVerificationCode(message, mailbox);
          if (code) return code;
        }
        if (!result['hydra:view']?.['hydra:next']) return null;
      }
      throw new Error('MAILTM_MESSAGE_PAGE_LIMIT');
    },
    async remove(mailbox) {
      if (mailbox.id && mailbox.token) {
        const observed = await request('/accounts/' + mailbox.id, { token: mailbox.token, missing: true });
        if (observed === null) return;
        if (observed.id !== mailbox.id || observed.address !== mailbox.address) throw new Error('MAILTM_OWNER_MISMATCH');
      }
      const own = await identity(mailbox);
      await request('/accounts/' + own.id, { method: 'DELETE', token: own.token, missing: true });
    },
  };
}

export function mailtmVerificationCode(message, mailbox) {
  if (message.accountId !== mailbox.id || message.isDeleted || message.from?.address !== 'no-reply@verificationemail.com'
    || !message.to?.some(item => item.address === mailbox.address) || !Number.isFinite(Date.parse(message.createdAt))
    || Date.parse(message.createdAt) < mailbox.createdAt) return null;
  const text = [message.text ?? '', ...(Array.isArray(message.html) ? message.html : [])].join('\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  const codes = [...text.matchAll(/(?:verification|confirmation) code(?:\s+is)?\s*[:=]?\s*(\d{6})(?!\d)/gi)].map(match => match[1]);
  const distinct = [...new Set(codes)];
  return distinct.length === 1 ? distinct[0] : null;
}
