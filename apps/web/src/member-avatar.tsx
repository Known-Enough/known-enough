import { useEffect, useRef, useState } from 'react';
import { Groups } from '@deal-table/contracts';
export function MemberAvatar({ api, groupId, memberId, name, revision }: { api: (path: string, init?: RequestInit) => Promise<Response>; groupId: string; memberId: string; name: string; revision: number }) {
  const apiRef = useRef(api); apiRef.current = api;
  const [image, setImage] = useState<string | null>(null), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setImage(null); setLoading(true);
    void apiRef.current(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/profile`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const profile = Groups.GroupMemberProfile.parse((await response.json()).profile);
      if (active) setImage(profile.image ? `data:image/png;base64,${profile.image.bytesBase64}` : null);
    }).catch(() => { if (active) setImage(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [groupId, memberId, revision]);
  return <span className="ke-member-avatar" aria-hidden="true" data-loading={loading || undefined}>{image ? <img alt="" src={image} onError={() => setImage(null)} /> : name.slice(0, 1).toUpperCase()}</span>;
}
