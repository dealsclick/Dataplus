import { Activity, CheckCircle2, FileWarning, History, ShoppingBag, Warehouse } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Detail, MetricCard } from "./app-ui"
import { jobOperationLabel, jobStatusTone } from "../App"
import type { ChannelConnection, ImportJob, Vendor } from "../App"

export function OverviewPage({
  jobs,
  activeJobs,
  attentionJobs,
  shopify,
  vendors,
  onOpenJobs,
  onOpenShopify,
}: {
  jobs: ImportJob[]
  activeJobs: ImportJob[]
  attentionJobs: ImportJob[]
  shopify?: ChannelConnection
  vendors: Vendor[]
  onOpenJobs: () => void
  onOpenShopify: () => void
}) {
  const failedJobs = attentionJobs.filter((job) => String(job.status).toLowerCase() === "failed")
  const activeVendors = vendors.filter((vendor) => String(vendor.status || "active").toLowerCase() === "active")
  return (
    <div className="grid gap-5">
      <Alert variant={failedJobs.length ? "destructive" : "default"}>
        {failedJobs.length ? <FileWarning className="size-4" /> : <CheckCircle2 className="size-4" />}
        <AlertTitle>{failedJobs.length ? "Work needs attention" : "System is ready"}</AlertTitle>
        <AlertDescription>
          {failedJobs.length
            ? `${failedJobs.length.toLocaleString()} failed jobs need review. Start with Job History.`
            : "No active failures were found in the current job history."}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total jobs" value={jobs.length} icon={History} />
        <MetricCard label="Running now" value={activeJobs.length} icon={Activity} />
        <MetricCard label="Active vendors" value={activeVendors.length} icon={Warehouse} />
        <MetricCard label="Shopify" value={shopify?.shopifyConfig?.configured ? "Connected" : "Review"} icon={ShoppingBag} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Priority queue</CardTitle>
              <CardDescription>Background work that needs a human decision.</CardDescription>
            </div>
            <Button onClick={onOpenJobs}>Open jobs</Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {attentionJobs.slice(0, 5).map((job) => (
              <div key={job.id} className="grid gap-1 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{jobOperationLabel(job)}</p>
                  <Badge variant={jobStatusTone(job.status)}>{job.status || "done"}</Badge>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{job.message || "Review job details."}</p>
              </div>
            ))}
            {!attentionJobs.length && <p className="text-sm text-muted-foreground">No jobs need attention right now.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shopify connection</CardTitle>
            <CardDescription>Admin API readiness for catalog, inventory, and price pushes.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 text-sm">
              <Detail label="Store" value={shopify?.shopifyConfig?.shop || "Missing"} />
              <Detail label="API version" value={shopify?.shopifyConfig?.apiVersion || "2026-04"} />
              <Detail label="Credentials" value={shopify?.shopifyConfig?.hasClientCredentials ? "Client auth set" : "Needs auth"} />
            </div>
            <Button variant="outline" onClick={onOpenShopify}>
              Open channel settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
