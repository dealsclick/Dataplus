import { useEffect,useState } from "react"
import { Download,ExternalLink,History,Loader2,Puzzle,ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs"
import { api } from "../lib/client-api"
import { PageHeader } from "./app-ui"
import { ReleaseHistorySettings } from "./settings-workspaces"

type ExtensionRecord = {
  id: string
  name: string
  version: string
  browser: string
  purpose: string
  features: string[]
  downloadUrl: string
  available: boolean
}

export function ExtensionsRoute() {
  const [tab,setTab] = useState("extensions")
  const [extensions,setExtensions] = useState<ExtensionRecord[]>([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const result = await api<{ extensions?: ExtensionRecord[] }>("/api/system/extensions")
      setExtensions(result.extensions || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load extensions.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function download(extension: ExtensionRecord) {
    if (!extension.available) return toast.error(`${extension.name} is not available in this deployment.`)
    window.location.assign(extension.downloadUrl)
    toast.success(`${extension.name} download started.`)
  }

  return <div className="grid gap-5">
    <PageHeader eyebrow="Account / Extensions" title="Extensions" description="DataPlus browser tools and their production change history." />
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="grid w-full grid-cols-2 sm:w-[360px]"><TabsTrigger value="extensions"><Puzzle className="size-4" /> Extensions</TabsTrigger><TabsTrigger value="changes"><History className="size-4" /> Change log</TabsTrigger></TabsList>
      <TabsContent value="extensions" className="mt-4">
        {error ? <Alert variant="destructive"><ExternalLink className="size-4" /><AlertTitle>Extensions unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {loading ? <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 2 }).map((_value,index) => <Skeleton key={index} className="h-72" />)}</div> : null}
        {!loading && !error ? <div className="grid gap-4 lg:grid-cols-2">{extensions.map((extension) => <Card key={extension.id} className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted"><Puzzle className="size-5" /></div><div className="min-w-0"><CardTitle className="text-base">{extension.name}</CardTitle><CardDescription className="mt-1">{extension.purpose}</CardDescription></div></div><Badge variant={extension.available ? "success" : "secondary"}>{extension.available ? `v${extension.version}` : "Unavailable"}</Badge></div>
          </CardHeader>
          <CardContent className="grid gap-4 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4" /><span>{extension.browser}</span></div>
            <div className="grid gap-2">{extension.features.map((feature) => <div key={feature} className="flex items-start gap-2 text-sm"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" /><span>{feature}</span></div>)}</div>
            <div className="flex justify-end border-t pt-4"><Button disabled={!extension.available} onClick={() => download(extension)}>{extension.available ? <Download className="size-4" /> : <Loader2 className="size-4" />} Download extension</Button></div>
          </CardContent>
        </Card>)}{!extensions.length ? <Card><CardContent className="p-8 text-center text-muted-foreground">No extensions are available.</CardContent></Card> : null}</div> : null}
      </TabsContent>
      <TabsContent value="changes" className="mt-4"><ReleaseHistorySettings active={tab === "changes"} /></TabsContent>
    </Tabs>
  </div>
}
