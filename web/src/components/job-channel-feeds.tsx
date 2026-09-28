import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Feed = { channel: string; feedId: string; status?: string; succeeded?: string; failed?: string; processing?: string; checkedAt?: string }

export function JobChannelFeeds({ jobId }: { jobId: string }) {
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    setFeeds([])
    setError('')
    async function load() {
      if (busy) return
      busy = true
      try {
        const response = await fetch(`/api/import-jobs/${encodeURIComponent(jobId)}/channel-feeds`, { signal: controller.signal })
        if (!response.ok) throw new Error('Unable to load channel feed IDs.')
        const result = await response.json()
        if (!controller.signal.aborted) { setFeeds(result.feeds || []); setError('') }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load channel feed IDs.')
      } finally { busy = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [jobId])
  if (!feeds.length && !error) return null
  return <section className="min-w-0 rounded-md border p-3" aria-label="Channel feed IDs">
    <h3 className="font-medium">Channel feed IDs</h3>
    <p className="mt-1 text-xs text-muted-foreground">Use these IDs to find the submissions in the channel. Feed processing does not confirm a live listing.</p>
    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    <div className="mt-2 grid gap-3">{feeds.map(feed => <div key={`${feed.channel}:${feed.feedId}`} className="min-w-0 rounded-md bg-muted/30 p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><p className="text-xs font-medium">{feed.channel}</p><code className="select-all break-all text-xs">{feed.feedId}</code></div>
        <Button size="sm" variant="outline" className="shrink-0" aria-label={`Copy feed ID ${feed.feedId}`} onClick={() => void navigator.clipboard.writeText(feed.feedId).then(() => toast.success('Feed ID copied.'), () => toast.error('Unable to copy the feed ID.'))}><Copy className="size-3.5" />Copy</Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{feed.status || 'Submitted · processing status not checked'}{feed.succeeded != null ? ` · ${feed.succeeded} succeeded` : ''}{feed.processing != null ? ` · ${feed.processing} processing` : ''}{feed.failed != null ? ` · ${feed.failed} failed` : ''}</p>
      {feed.checkedAt && <p className="text-xs text-muted-foreground">Last checked {new Date(feed.checkedAt).toLocaleString()}</p>}
    </div>)}</div>
  </section>
}
