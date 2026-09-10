import { useEffect, useState } from 'react'
import { companyRequest } from './company-switcher'
import type { CompanyDirectory, CompanyChoice } from './company-switcher'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
type Membership = { user_id: string; role: string; company_ids: string[] }

export function UserCompanyAccess({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const [directory, setDirectory] = useState<CompanyDirectory | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let alive = true; companyRequest<CompanyDirectory>('/api/organization').then(d => { if (alive) setDirectory(d) }).catch(e => { if (alive) setError(e.message) }); return () => { alive = false } }, [])
  return <Card><CardHeader><CardTitle className="text-sm">Company access</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Choose which companies this user can open. Their action permissions still apply within those companies. Company access is saved separately from profile edits.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {directory?.initialized === false && <p className="text-sm">Complete <a className="underline" href="/settings?tab=companies">one-time company setup</a> before assigning company access.</p>}
    {directory?.tenants.filter(t => t.role === 'owner').map(t => <AccessEditor key={`${t.id}/${userId}`} tenantId={t.id} tenantName={t.name} userId={userId} companies={directory.companies.filter(c => c.tenant_id === t.id)} canEdit={canEdit}/>)}
    {directory?.initialized && !directory.tenants.some(t => t.role === 'owner') && <p className="text-sm text-muted-foreground">An organization owner must manage company access.</p>}
  </CardContent></Card>
}
function AccessEditor({ tenantId, tenantName, userId, companies, canEdit }: { tenantId: string; tenantName: string; userId: string; companies: CompanyChoice[]; canEdit: boolean }) {
  const [ids, setIds] = useState<string[]>([])
  const [owner, setOwner] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const base = `/api/organization/tenants/${encodeURIComponent(tenantId)}/members`
  useEffect(() => { let alive = true; companyRequest<{ memberships: Membership[] }>(base).then(data => { if (!alive) return; const member = data.memberships.find(m => m.user_id === userId); setIds(member?.company_ids || []); setOwner(member?.role === 'owner'); setReady(true) }).catch(e => { if (alive) setMessage(e.message) }); return () => { alive = false } }, [base, userId])
  return <div className="space-y-3 rounded-md border p-3"><p className="text-sm font-medium">{tenantName}</p>
    {owner ? <p className="text-sm text-muted-foreground">Organization owner — access to all companies is required.</p> : <>
      <div className="grid gap-2 sm:grid-cols-2">{companies.map(c => <label key={c.id} className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!ready || busy || !canEdit} checked={ids.includes(c.id)} onChange={e => setIds(previous => e.target.checked ? [...previous, c.id] : previous.filter(id => id !== c.id))}/><span className="break-words">{c.name}</span></label>)}</div>
      <Button disabled={!ready || busy || !canEdit} onClick={async () => { setBusy(true); setMessage(''); try { await companyRequest(base, 'PUT', { userId, companyIds: ids }); setMessage('Company access saved.'); window.dispatchEvent(new Event('company-directory-changed')) } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to save company access.') } finally { setBusy(false) } }}>Save company access</Button>
    </>}{message && <p role="status" className="text-sm">{message}</p>}
  </div>
}
