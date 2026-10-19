import { useEffect, useRef, useState } from 'react';
import { Groups } from '@deal-table/contracts';

// Keep a member list from flooding the authenticated profile endpoint on first render.
let activeReads = 0;
const pendingReads: (() => void)[] = [];
function drainReads() { while (activeReads < 2 && pendingReads.length) pendingReads.shift()?.(); }
export function avatarRead<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingReads.push(() => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      activeReads++;
      void read().then(resolve, reject).finally(() => { activeReads--; drainReads(); });
    });
    drainReads();
  });
}
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const aborted = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
export function MemberAvatar({ api, groupId, memberId, name, revision }: { api: (path: string, init?: RequestInit) => Promise<Response>; groupId: string; memberId: string; name: string; revision: number }) {
  const apiRef = useRef(api); apiRef.current = api;
  const [image, setImage] = useState<string | null>(null), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setImage(null); setLoading(true);
    let status: number | null = null, reason = 'CONNECTION';
    void avatarRead(controller.signal, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          status = null; reason = 'CONNECTION';
          const response = await apiRef.current(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/profile`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), cache: 'no-store',
          });
          status = response.status;
          if (!response.ok) {
            reason = 'HTTP';
            if ((response.status === 429 || response.status >= 500) && attempt < 2) { await pause(500 * (attempt + 1), controller.signal); continue; }
            throw new Error('Profile unavailable');
          }
          reason = 'RESPONSE_FORMAT';
          const profile = Groups.GroupMemberProfile.parse((await response.json()).profile);
          if (active) setImage(profile.image ? `data:${profile.image.mimeType};base64,${profile.image.bytesBase64}` : null);
          return;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (status === null && attempt < 2) { await pause(500 * (attempt + 1), controller.signal); continue; }
          throw error;
        }
      }
    }).catch(() => {
      if (active) { setImage(null); console.info('Known Enough avatar loading diagnostic', { httpStatus: status, reason }); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [groupId, memberId, revision]);
  return <span className="ke-member-avatar" aria-hidden="true" data-loading={loading || undefined}>{image ? <img alt="" width={40} height={40} loading="eager" decoding="async" src={image} onError={() => { setImage(null); console.info('Known Enough avatar loading diagnostic', { reason: 'IMAGE_DECODE' }); }} /> : name.slice(0, 1).toUpperCase()}</span>;
}
