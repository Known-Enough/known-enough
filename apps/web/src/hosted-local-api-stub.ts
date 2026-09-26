type LocalIdentity = 'maya' | 'leo' | 'nina' | 'display';

/** Fail closed if a hosted-only build ever selects the loopback demo path. */
export class LocalApiClient {
  constructor(identity: LocalIdentity) {
    if (identity !== 'display') throw new Error('Only the display identity is supported by this stub');
    throw new Error('Loopback identity mode is unavailable in the hosted preview');
  }
}
