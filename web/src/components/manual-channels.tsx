import { useEffect, useState, useId } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'
import { currentCompany, type CompanyDirectory } from './company-switcher'

type Channel = { id: string; name: string; source_key: string; enabled: boolean; kind?: string }
async function request<T>(url:string,method='GET',body?:unknown):Promise<T> {
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'Unable to load manual channels.');return data
}
export function ManualChannels({base,companyName,owner,picker=false,value='',onChange}:{base:string;companyName:string;owner?:boolean;picker?:boolean;value?:string;onChange?:(id:string)=>void}) {
  const fieldId=useId()
  const endpoint=picker?'order-import-channels':'manual-channels'
  const [rows,setRows]=useState<Channel[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false),[name,setName]=useState('')
  async function load(){const result=await request<{rows:Channel[]}>(`${base}/${endpoint}`);setRows(result.rows)}
  useEffect(()=>{let cancelled=false;setLoading(true);request<{rows:Channel[]}>(`${base}/${endpoint}`).then(data=>{if(!cancelled)setRows(data.rows)}).catch(e=>{if(!cancelled)setError(e.message)}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[base,endpoint])
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work()}catch(e){setError(e instanceof Error?e.message:'Unable to save channel.')}finally{setBusy(false)}}
  const add=<Button type="button" variant="outline" disabled={busy||loading} onClick={()=>{setName('');setError('');setOpen(true)}}>Add manual channel</Button>
  return <section className="min-w-0 space-y-3" aria-label="Manual channels">
    {picker ? <><Label htmlFor={fieldId}>Which channel are these orders from?</Label><div className="flex flex-wrap gap-2"><select id={fieldId} className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3" value={value} disabled={busy||loading} onChange={e=>onChange?.(e.target.value)}><option value="">Select a channel source</option>{rows.filter(c=>c.enabled).map(c=><option key={c.id} value={c.id}>{c.name}{c.kind==='connected'?' (existing channel)':''}</option>)}</select>{owner&&add}</div><p className="text-xs text-muted-foreground">Company: {companyName}. This selection applies to every order in the file.</p></> : <Card><CardHeader><CardTitle>Manual channels</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{companyName} · Channels such as Zoro that use file imports. No API connection, credentials, or automatic sync.</p>{owner&&add}{rows.map(channel=><div key={channel.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="break-words font-medium">{channel.name}</p><Badge variant={channel.enabled?'secondary':'outline'}>{channel.enabled?'Enabled · Manual import':'Disabled'}</Badge></div>{owner&&<Button className="h-auto max-w-full whitespace-normal break-words" variant="outline" disabled={busy} onClick={()=>void run(async()=>{await request(`${base}/manual-channels`,'PATCH',{id:channel.id,enabled:!channel.enabled});await load()})}>{channel.enabled?'Disable':'Enable'} {channel.name}</Button>}</div>)}<Button variant="link" asChild><a href="/orders/tools">Open order import tool</a></Button></CardContent></Card>}
    {loading&&<p role="status" className="text-sm">Loading channels…</p>}
    {!loading&&!rows.some(c=>c.enabled)&&<p className="text-sm text-muted-foreground">No enabled channels. {owner?'Add a channel such as Zoro to import its orders.':'Ask your organization owner to add or enable a channel.'}</p>}
    {error&&!open&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={open} onOpenChange={next=>{if(!busy)setOpen(next)}}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Add manual channel</DialogTitle><DialogDescription>Company: {companyName}. Orders for this channel will be uploaded through Orders → Tools.</DialogDescription></DialogHeader><Label htmlFor="manual-channel-name">Channel name</Label><Input id="manual-channel-name" placeholder="e.g. Zoro" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter className="pb-[env(safe-area-inset-bottom)]"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={busy||!name.trim()} onClick={()=>void run(async()=>{const channel=await request<Channel>(`${base}/manual-channels`,'POST',{name});await load();onChange?.(channel.id);setOpen(false)})}>{busy?'Saving…':'Create manual channel'}</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
export function CompanyManualChannels() {
  const [directory,setDirectory]=useState<CompanyDirectory|null>(null),[error,setError]=useState('')
  useEffect(()=>{let cancelled=false;request<CompanyDirectory>('/api/organization').then(data=>{if(!cancelled)setDirectory(data)}).catch(e=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[])
  const company=directory&&currentCompany(directory)
  if(error)return <p role="alert">{error}</p>
  if(!company)return null
  return <ManualChannels key={`${company.tenant_id}/${company.id}`} base={`/api/organization/tenants/${encodeURIComponent(company.tenant_id)}/companies/${encodeURIComponent(company.id)}`} companyName={company.name} owner={directory?.tenants.find(t=>t.id===company.tenant_id)?.role==='owner'}/>
}
