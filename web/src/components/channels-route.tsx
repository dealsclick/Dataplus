import { lazy, useEffect, useMemo, useState } from "react"
import { AlertCircle, Ban, CheckCircle2, Copy, Database, ExternalLink, ListChecks, Loader2, RefreshCw, RotateCcw, Save, Search, ShieldCheck, ShoppingBag, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { CompanyManualChannels } from "./manual-channels"
import { EbayOperations } from "./ebay-operations"
import { api, dateLabel, numberLabel } from "../lib/client-api"
import { ContextActions, Detail, Field, PageHeader, ToggleField } from "./app-ui"
import {
  ActionTile, ChannelLogsPanel, PriceModeSelect,
} from "./legacy-workspaces"
import type {
  ChannelConnection, ImportJob, ShopifyAuthCheck, ShopifyWarehouseMapping, WarehouseRoutingRule,
} from "../App"

const WalmartChannel = lazy(() => import("./walmart-channel").then((module) => ({ default: module.WalmartChannel })))
const TikTokChannel = lazy(() => import("./tiktok-channel").then((module) => ({ default: module.TikTokChannel })))
function ChannelsPage({
  channels,
  warehouses,
  auth,
  checking,
  onCheckShopify,
  onRefreshShopifyToken,
  onSaveChannel,
  onRunShopifyAction,
  onRefreshData,
}: {
  channels: ChannelConnection[]
  warehouses: Array<Record<string, unknown>>
  auth: ShopifyAuthCheck | null
  checking: boolean
  onCheckShopify: () => void
  onRefreshShopifyToken: () => void
  onSaveChannel: (id: string, patch: Record<string, unknown>) => Promise<void>
  onRunShopifyAction: (options: { path: string; body?: Record<string, unknown>; confirmMessage?: string; successMessage?: string }) => Promise<void>
  onRefreshData: () => void
}) {
  const [selectedId, setSelectedId] = useState("")
  const selectedChannel = channels.find((channel) => channel.id === selectedId) || channels.find(channel => channel.name === new URLSearchParams(window.location.search).get('channel')) || channels.find((channel) => channel.name?.toLowerCase() === "shopify") || channels[0]

  useEffect(() => {
    if (!selectedId && selectedChannel?.id) setSelectedId(selectedChannel.id)
  }, [selectedChannel?.id, selectedId])

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Marketplace"
        title="Channel Settings"
        description="Compact tabs for connection health, defaults, schedules, mappings, and channel logs."
      />
      <CompanyManualChannels />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Channels</CardTitle>
            {!channels.length && <CardDescription>No API channels are connected for this company. Manual channels use file imports under Orders &gt; Tools.</CardDescription>}
            <CardDescription>Select a marketplace to configure.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {channels.map((channel) => (
              <Button
                key={channel.id}
                variant={selectedChannel?.id === channel.id ? "secondary" : "ghost"}
                className="justify-between"
                onClick={() => setSelectedId(channel.id)}
              >
                <span>{channel.name}</span>
                <Badge variant={channel.connected ? "default" : "outline"}>{String(channel.status || (channel.connected ? "active" : "draft")).replaceAll("_", " ")}</Badge>
              </Button>
            ))}
          </CardContent>
        </Card>
        {selectedChannel?.name === 'Walmart' ? <WalmartChannel key={selectedChannel.id} channel={selectedChannel} warehouses={warehouses} onSave={onSaveChannel} onRefresh={onRefreshData} /> : selectedChannel?.name === 'TikTok Shop' ? <TikTokChannel key={selectedChannel.id} channel={selectedChannel} onSave={onSaveChannel} onRefresh={onRefreshData} /> : selectedChannel ? (
          <ChannelDetail
            channel={selectedChannel}
            warehouses={warehouses}
            auth={auth}
            checking={checking}
            onCheckShopify={onCheckShopify}
            onRefreshShopifyToken={onRefreshShopifyToken}
            onSave={onSaveChannel}
            onRunShopifyAction={onRunShopifyAction}
            onRefreshData={onRefreshData}
          />
        ) : (
          <Card><CardContent className="p-6 text-muted-foreground">No API channels connected.</CardContent></Card>
        )}
      </div>
    </div>
  )
}

function ChannelDetail({
  channel,
  warehouses,
  auth,
  checking,
  onCheckShopify,
  onRefreshShopifyToken,
  onSave,
  onRunShopifyAction,
  onRefreshData,
}: {
  channel: ChannelConnection
  warehouses: Array<Record<string, unknown>>
  auth: ShopifyAuthCheck | null
  checking: boolean
  onCheckShopify: () => void
  onRefreshShopifyToken: () => void
  onSave: (id: string, patch: Record<string, unknown>) => Promise<void>
  onRunShopifyAction: (options: { path: string; body?: Record<string, unknown>; confirmMessage?: string; successMessage?: string }) => Promise<void>
  onRefreshData: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [credentials, setCredentials] = useState<{ shop?: string; apiVersion?: string; hasAccessToken?: boolean; hasClientCredentials?: boolean; clientIdPreview?: string; clientSecretPreview?: string; accessTokenPreview?: string; runtimeManaged?: boolean } | null>(null)
  const [ebayCredentials, setEbayCredentials] = useState<{ environment?: string; ruName?: string; scope?: string; hasAccessToken?: boolean; hasClientCredentials?: boolean; hasSellerAuthorization?: boolean; sellerAuthorizedAt?: string; accessTokenExpiresAt?: string; connectionVerifiedAt?: string; connectionVerificationMessage?: string; webhookEnabled?: boolean; webhookEndpoint?: string; webhookVerificationTokenConfigured?: boolean; webhookLastReceivedAt?: string; webhookLastTopic?: string; webhookLastSignatureVerifiedAt?: string; webhookVerificationAt?: string; webhookVerificationMessage?: string; clientIdPreview?: string; clientSecretPreview?: string; refreshTokenPreview?: string; accessTokenPreview?: string; runtimeManaged?: boolean; configured?: boolean } | null>(null)
  const [ebayWebhookStatus, setEbayWebhookStatus] = useState<{ topics?: Array<Record<string, any>>; destinations?: Array<Record<string, any>>; subscriptions?: Array<Record<string, any>>; notificationConfig?: Record<string, any> | null; notificationConfigRequired?: boolean; notificationConfigError?: string; destinationId?: string; selectedTopicIds?: string[]; syncedAt?: string } | null>(null)
  const [ebayWebhookSelectedTopics, setEbayWebhookSelectedTopics] = useState<string[]>([])
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [ebayCredentialsOpen, setEbayCredentialsOpen] = useState(false)
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [ebayVerifying, setEbayVerifying] = useState(false)
  const [ebayWebhookVerifying, setEbayWebhookVerifying] = useState(false)
  const [ebayWebhookStatusLoading, setEbayWebhookStatusLoading] = useState(false)
  const [ebayWebhookSyncing, setEbayWebhookSyncing] = useState(false)
  const [credentialDraft, setCredentialDraft] = useState({ storeDomain: "", apiVersion: "", clientId: "", clientSecret: "", accessToken: "" })
  const [ebayCredentialDraft, setEbayCredentialDraft] = useState({ environment: "production", ruName: "", scope: "", clientId: "", clientSecret: "", refreshToken: "", accessToken: "" })
  const [ebayOrderImportOpen, setEbayOrderImportOpen] = useState(false)
  const [ebayOrderImportSaving, setEbayOrderImportSaving] = useState(false)
  const [ebayOrderImportDraft, setEbayOrderImportDraft] = useState({ lookbackDays: "30", limit: "all", includeCanceled: false })
  const [ebayReturnImportSaving, setEbayReturnImportSaving] = useState(false)
  const [temuOrderImportOpen, setTemuOrderImportOpen] = useState(false)
  const [temuOrderImportSaving, setTemuOrderImportSaving] = useState(false)
  const [temuOrderImportDraft, setTemuOrderImportDraft] = useState({ lookbackDays: "30", startDate: "", limit: "250", includeCanceled: false })
  const [temuSetupGuideOpen, setTemuSetupGuideOpen] = useState(false)
  const [temuSetupGuideSaving, setTemuSetupGuideSaving] = useState(false)
  const [temuSetupGuideDraft, setTemuSetupGuideDraft] = useState({ downloadOrders: true, lookbackDays: "30", startDate: "", limit: "250", includeCanceled: false, prepareSkuMapping: true, enableSchedule: false, scheduleEveryHours: "12" })
  const [temuConnectionTest, setTemuConnectionTest] = useState<{ ok?: boolean; configured?: boolean; liveApiChecked?: boolean; hasAccessToken?: boolean; endpoint?: string; appKeyPreview?: string; mallId?: string; latestOrderSync?: string; verifiedAt?: string; message?: string } | null>(null)
  const [temuTestingConnection, setTemuTestingConnection] = useState(false)
  const [temuConnecting, setTemuConnecting] = useState(false)
  const [temuWarehouses, setTemuWarehouses] = useState<Array<{ id: string; name: string; isDefault?: boolean; buyShippingEnabled?: boolean }>>([])
  const [temuWarehousesLoading, setTemuWarehousesLoading] = useState(false)
  const [ebayTemplatesOpen, setEbayTemplatesOpen] = useState(false)
  const [ebayTemplatesSaving, setEbayTemplatesSaving] = useState(false)
  const [ebayTemplateDraft, setEbayTemplateDraft] = useState({ listingTemplates: "[]", itemSpecificTemplates: "[]", storeCategories: "[]", buyerRequirements: "{}", shippingMethodMappings: "[]", customPolicies: "[]" })
  const [ebayHealth, setEbayHealth] = useState<{
    channel?: { connected?: boolean; enabled?: boolean; lastSync?: string }
    credentials?: { configured?: boolean; hasSellerAuthorization?: boolean; connectionVerifiedAt?: string }
    account?: { status?: string; lastSyncedAt?: string; merchantLocations?: number; paymentPolicies?: number; returnPolicies?: number; fulfillmentPolicies?: number; failures?: string[] }
    workflows?: { inventoryUpdateEnabled?: boolean; priceUpdateEnabled?: boolean; trackingUploadEnabled?: boolean; settlementImportEnabled?: boolean; autoRelistEnabled?: boolean; webhookEnabled?: boolean; webhookEndpoint?: string }
    defaultsReady?: boolean
  } | null>(null)
  const [ebayHealthLoading, setEbayHealthLoading] = useState(false)
  const [shopifyLocations, setShopifyLocations] = useState<Array<{ id: string; name: string; isActive?: boolean; fulfillsOnlineOrders?: boolean }>>([])
  const [shopifyLocationsLoading, setShopifyLocationsLoading] = useState(false)
  const [warehouseReconcileBusy, setWarehouseReconcileBusy] = useState(false)
  const [ebayTaxonomyStatus, setEbayTaxonomyStatus] = useState<{
    indexed?: boolean
    marketplaceId?: string
    categoryCount?: number
    categoryTreeId?: string
    categoryTreeVersion?: string
    syncedAt?: string
    source?: string
  } | null>(null)
  const [ebayTaxonomyStatusLoading, setEbayTaxonomyStatusLoading] = useState(false)
  const isShopify = channel.name?.toLowerCase() === "shopify"
  const isEbay = channel.name?.toLowerCase() === "ebay"
  const isWalmart = channel.name?.toLowerCase() === "walmart"
  const isTemu = channel.name?.toLowerCase() === "temu"
  const isWhatnot = channel.name?.toLowerCase() === "whatnot"
  const settings = { ...(channel.settings || {}), ...draft }
  const channelEnabled = settings.channelEnabled !== false
  const shippingProfiles = Array.isArray(channel.settings?.shopifyShippingProfiles) ? channel.settings.shopifyShippingProfiles : []
  const ebayMerchantLocations = Array.isArray(settings.ebayMerchantLocations) ? settings.ebayMerchantLocations : []
  const ebayPaymentPolicies = Array.isArray(settings.ebayPaymentPolicies) ? settings.ebayPaymentPolicies : []
  const ebayReturnPolicies = Array.isArray(settings.ebayReturnPolicies) ? settings.ebayReturnPolicies : []
  const ebayFulfillmentPolicies = Array.isArray(settings.ebayFulfillmentPolicies) ? settings.ebayFulfillmentPolicies : []
  const scheduleTimes = String(settings.inventoryScheduleTimes || "03:00,13:00").split(/[,;\s]+/).filter(Boolean)
  const orderImportScheduleTimes = String(settings.shopifyOrderImportScheduleTimes || "04:00,16:00").split(/[,;\s]+/).filter(Boolean)
  const ebayOrderImportScheduleTimes = String(settings.ebayOrderImportScheduleTimes || "05:00,17:00").split(/[,;\s]+/).filter(Boolean)
  const ebayCatalogSyncScheduleTimes = String(settings.ebayCatalogSyncScheduleTimes || "02:00").split(/[,;\s]+/).filter(Boolean)
  const temuOrderImportScheduleTimes = String(settings.temuOrderImportScheduleTimes || "05:00,17:00").split(/[,;\s]+/).filter(Boolean)
  const ebayPriceInventorySyncScheduleTimes = String(settings.ebayPriceInventorySyncScheduleTimes || "04:00,16:00").split(/[,;\s]+/).filter(Boolean)
  const whatnotOrderImportScheduleTimes = String(settings.whatnotOrderImportScheduleTimes || "05:00,17:00").split(/[,;\s]+/).filter(Boolean)
  const whatnotDefaultWebhookEndpoint = `${window.location.origin}/api/webhooks/whatnot`
  const whatnotWebhookEndpoint = String(settings.whatnotWebhookEndpoint || whatnotDefaultWebhookEndpoint)
  const whatnotScopes = Array.isArray(settings.whatnotScopes) ? settings.whatnotScopes : []
  const whatnotWebhookTopics = Array.isArray(settings.whatnotWebhookTopics) ? settings.whatnotWebhookTopics : []
  const whatnotAvailableScopes = ["read:inventory", "write:inventory", "read:orders", "write:orders", "read:customers", "read:shipments", "write:shipments"]
  const whatnotAvailableWebhookTopics = ["product/sold", "bulk_operation/finished", "listing/created", "listing/updated", "order/created", "order/updated", "livestream/created", "livestream/stopped", "livestream/product_added", "livestream/product_removed", "shipment/label_created"]
  const shopifyWarehouseMappings: ShopifyWarehouseMapping[] = Array.isArray(settings.warehouseMappings) && settings.warehouseMappings.length
    ? settings.warehouseMappings as ShopifyWarehouseMapping[]
    : Array.isArray(settings.shopifyWarehouseMappings)
      ? settings.shopifyWarehouseMappings as ShopifyWarehouseMapping[]
    : [{ id: "shopify-datawarehouse-zsi", enabled: true, sourceWarehouseId: "datawarehouse", sourceWarehouseName: "DataWarehouse", destinationLocationId: "gid://shopify/Location/108946260272", destinationLocationName: "zSi Warehouse" }]
  const warehouseRoutingRules: WarehouseRoutingRule[] = Array.isArray(settings.warehouseRoutingRules) ? settings.warehouseRoutingRules as WarehouseRoutingRule[] : []
  const shopifySourceWarehouses = useMemo(() => {
    const rows = warehouses.map((warehouse) => ({
      id: String(warehouse.id || ""),
      name: String(warehouse.name || warehouse.code || warehouse.id || "Warehouse"),
    })).filter((warehouse) => warehouse.id)
    if (!rows.some((warehouse) => warehouse.id.toLowerCase() === "datawarehouse")) {
      rows.unshift({ id: "datawarehouse", name: "DataWarehouse" })
    }
    return rows
  }, [warehouses])
  const ebayOAuthCallbackUrl = `${window.location.origin}/auth/ebay/callback`
  const defaultEbayWebhookEndpoint = `${window.location.origin}/api/webhooks/ebay`
  const ebayWebhookEndpoint = String(settings.ebayWebhookEndpoint || ebayCredentials?.webhookEndpoint || defaultEbayWebhookEndpoint)
  const hasUnsavedChannelChanges = Object.keys(draft).length > 0
  const temuAppKeyConfigured = Boolean(settings.temuAppKey || settings.temuAppKeyConfigured)
  const temuAppSecretConfigured = Boolean(settings.temuAppSecret || settings.temuAppSecretConfigured)
  const temuAccessTokenConfigured = Boolean(settings.temuAccessToken || settings.temuAccessTokenConfigured)
  const temuCredentialsConfigured = temuAppKeyConfigured && temuAppSecretConfigured
  const temuGeneratedTokenLabel = temuAccessTokenConfigured ? "Stored securely" : channel.connected ? "Stored from Temu authorization" : "Generated by channel when available"
  const temuConnectionMessage = temuConnectionTest?.message || String(settings.temuConnectionVerificationMessage || "")
  const temuConnectionVerifiedAt = temuConnectionTest?.verifiedAt || String(settings.temuConnectionVerifiedAt || "")
  const temuLatestOrderSync = temuConnectionTest?.latestOrderSync || String(settings.temuLastOrderSync || (channel as Record<string, unknown>).lastSync || "")
  const temuHasLiveToken = Boolean(temuAccessTokenConfigured || temuConnectionTest?.hasAccessToken)
  const temuCanRunLive = temuHasLiveToken || Boolean(channel.connected)
  const temuSetupGuideCompleted = Boolean(settings.temuInitialSetupGuideCompleted)
  const temuSetupGuideLabel = temuSetupGuideCompleted ? "Relaunch setup guide" : "Launch setup guide"
  const temuAuthActionLabel = temuCanRunLive ? "Reconnect Temu" : "Connect Temu"
  const requestedTab = new URLSearchParams(window.location.search).get("tab")
  const allowedChannelTabs = new Set(["overview", "connection", "operations", "setup", "actions", "rules", "mappings", "attributes", "variants", "skus", "logs"])
  const [activeTab, setActiveTab] = useState(allowedChannelTabs.has(requestedTab || "") ? String(requestedTab) : "overview")

  const mappedShopifyLocations = useMemo(() => {
    const byId = new Map(shopifyLocations.map((location) => [location.id, location]))
    for (const mapping of shopifyWarehouseMappings) {
      if (!mapping.destinationLocationId || byId.has(mapping.destinationLocationId)) continue
      byId.set(mapping.destinationLocationId, {
        id: mapping.destinationLocationId,
        name: mapping.destinationLocationName || mapping.destinationLocationId,
        isActive: true,
      })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [shopifyLocations, shopifyWarehouseMappings])

  useEffect(() => {
    setDraft({})
    setEditing(false)
    setTemuConnectionTest(null)
    setTemuWarehouses([])
  }, [channel.id])

  useEffect(() => {
    if (!isTemu) return
    void loadTemuWarehouses(false)
  }, [isTemu, channel.id])

  useEffect(() => {
    if (!isShopify) return
    api<{ credentials?: { shop?: string; apiVersion?: string; hasAccessToken?: boolean; hasClientCredentials?: boolean; clientIdPreview?: string; clientSecretPreview?: string; accessTokenPreview?: string; runtimeManaged?: boolean } }>("/api/shopify/credentials")
      .then((result) => setCredentials(result.credentials || null))
      .catch(() => setCredentials(null))
  }, [isShopify])

  useEffect(() => {
    if (!isShopify || activeTab !== "rules" || shopifyLocations.length) return
    void loadShopifyLocations()
  }, [isShopify, activeTab, channel.id])

  useEffect(() => {
    if (!isEbay) return
    api<{ credentials?: typeof ebayCredentials }>("/api/ebay/credentials")
      .then((result) => setEbayCredentials(result.credentials || null))
      .catch(() => setEbayCredentials(null))
  }, [isEbay])

  useEffect(() => {
    if (!isEbay) return
    void loadEbayWebhookStatus()
  }, [isEbay, channel.id])

  useEffect(() => {
    if (!isEbay) return
    api<typeof ebayHealth>("/api/ebay/health")
      .then((result) => setEbayHealth(result || null))
      .catch(() => setEbayHealth(null))
  }, [isEbay, channel.id])

  useEffect(() => {
    if (!isEbay) return
    void loadEbayTaxonomyStatus()
  }, [isEbay, channel.id, settings.ebayMarketplaceId])

  useEffect(() => {
    if (!isEbay) return
    function onEbayAuthorization(event: MessageEvent) {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return
      const payload = event.data as { type?: string; message?: string }
      if (payload.type === "dataplus:ebay-authorized") {
        api<{ credentials?: typeof ebayCredentials }>("/api/ebay/credentials")
          .then((result) => {
            setEbayCredentials(result.credentials || null)
            toast.success("eBay seller account connected.")
            onRefreshData()
          })
          .catch(() => toast.error("eBay connected, but DataPlus could not refresh its connection status."))
      }
      if (payload.type === "dataplus:ebay-authorization-error") {
        toast.error(payload.message || "eBay authorization did not complete.")
      }
    }
    window.addEventListener("message", onEbayAuthorization)
    return () => window.removeEventListener("message", onEbayAuthorization)
  }, [isEbay, onRefreshData])

  useEffect(() => {
    if (!isTemu) return
    function onTemuAuthorization(event: MessageEvent) {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return
      const payload = event.data as { type?: string; message?: string }
      if (payload.type === "dataplus:temu-authorized") {
        toast.success(payload.message || "Temu seller account connected.")
        setTemuConnectionTest(null)
        onRefreshData()
        if (!temuSetupGuideCompleted) openTemuSetupGuide()
      }
      if (payload.type === "dataplus:temu-authorization-error") {
        toast.error(payload.message || "Temu seller authorization did not complete.")
      }
    }
    window.addEventListener("message", onTemuAuthorization)
    return () => window.removeEventListener("message", onTemuAuthorization)
  }, [isTemu, onRefreshData])

  function update(field: string, value: unknown) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function loadTemuWarehouses(notify = true) {
    setTemuWarehousesLoading(true)
    try {
      const result = await api<{ warehouses?: Array<{ id: string; name: string; isDefault?: boolean; buyShippingEnabled?: boolean }>; configuredWarehouseId?: string }>("/api/temu/warehouses")
      const rows = result.warehouses || []
      setTemuWarehouses(rows)
      const configured = String(settings.temuDefaultWarehouseId || result.configuredWarehouseId || "")
      const preferred = rows.find((warehouse) => warehouse.id === configured) || rows.find((warehouse) => warehouse.isDefault) || rows[0]
      if (!configured && preferred?.id) setDraft((current) => ({ ...current, temuDefaultWarehouseId: preferred.id }))
      if (notify) toast.success(`Loaded ${rows.length.toLocaleString()} Temu warehouse${rows.length === 1 ? "" : "s"}.`)
    } catch (error) {
      if (notify) toast.error(error instanceof Error ? error.message : "Unable to load Temu warehouses.")
    } finally {
      setTemuWarehousesLoading(false)
    }
  }

  function updateStringList(field: string, currentValues: string[], value: string, checked: boolean) {
    const next = checked ? [...new Set([...currentValues, value])] : currentValues.filter((item) => item !== value)
    update(field, next)
  }

  function updateShopifyWarehouseMapping(id: string, patch: Partial<ShopifyWarehouseMapping>) {
    const mappings = shopifyWarehouseMappings.map((mapping) => mapping.id === id ? { ...mapping, ...patch } : mapping)
    setDraft((current) => ({ ...current, warehouseMappings: mappings, ...(isShopify ? { shopifyWarehouseMappings: mappings } : {}) }))
  }

  function addShopifyWarehouseMapping() {
    const mappings = [
      ...shopifyWarehouseMappings,
      { id: `${String(channel.name || "channel").toLowerCase()}-warehouse-${Date.now()}`, enabled: true, sourceWarehouseId: "", sourceWarehouseName: "", destinationLocationId: "", destinationLocationName: "", inventoryMode: "pooled" as const, allocationPercent: 100, safetyQty: Number(settings.defaultSafetyQty || 0), maxSellableQty: Number(settings.defaultMaxSellableQty || 0), exportInventoryEnabled: true, importInventoryEnabled: false, orderRoutingPriority: shopifyWarehouseMappings.length + 1 },
    ]
    setDraft((current) => ({ ...current, warehouseMappings: mappings, ...(isShopify ? { shopifyWarehouseMappings: mappings } : {}) }))
  }

  function removeShopifyWarehouseMapping(id: string) {
    const mappings = shopifyWarehouseMappings.filter((mapping) => mapping.id !== id)
    setDraft((current) => ({ ...current, warehouseMappings: mappings, ...(isShopify ? { shopifyWarehouseMappings: mappings } : {}) }))
  }

  function updateWarehouseRoutingRule(id: string, patch: Partial<WarehouseRoutingRule>) {
    update("warehouseRoutingRules", warehouseRoutingRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule))
  }

  function addWarehouseRoutingRule() {
    update("warehouseRoutingRules", [...warehouseRoutingRules, {
      id: `route-${Date.now()}`,
      name: `Routing rule ${warehouseRoutingRules.length + 1}`,
      enabled: true,
      priority: (warehouseRoutingRules.length + 1) * 10,
      warehouseId: "",
      requireAvailableStock: true,
    }])
  }

  function removeWarehouseRoutingRule(id: string) {
    update("warehouseRoutingRules", warehouseRoutingRules.filter((rule) => rule.id !== id))
  }

  async function loadShopifyLocations() {
    setShopifyLocationsLoading(true)
    try {
      const result = await api<{ locations?: Array<{ id: string; name: string; isActive?: boolean; fulfillsOnlineOrders?: boolean }> }>("/api/shopify/locations")
      setShopifyLocations(result.locations || [])
      toast.success(`Loaded ${(result.locations || []).length.toLocaleString()} Shopify locations.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load Shopify locations.")
    } finally {
      setShopifyLocationsLoading(false)
    }
  }

  async function reconcileWarehouseMappings() {
    setWarehouseReconcileBusy(true)
    try {
      const result = await api<{ healthy?: boolean; issues?: Array<{ message?: string }>; message?: string }>(`/api/channels/${encodeURIComponent(channel.id)}/warehouse-mappings/reconcile`, { method: "POST" })
      if (result.healthy) toast.success(result.message || "Warehouse mappings are healthy.")
      else toast.error(result.message || `${(result.issues || []).length} warehouse mapping issue(s) require attention.`)
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reconcile warehouse mappings.")
    } finally {
      setWarehouseReconcileBusy(false)
    }
  }

  async function save() {
    await onSave(channel.id, draft)
    setDraft({})
    setEditing(false)
  }

  async function syncShippingProfiles() {
    try {
      const result = await api<{ channel: ChannelConnection; message?: string }>(
        "/api/shopify/shipping-profiles/sync",
        { method: "POST", body: JSON.stringify({}) },
      )
      toast.success(result.message || "Shipping profiles imported.")
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to import Shopify shipping profiles.")
    }
  }


  function openCredentials() {
    setCredentialDraft({ storeDomain: String(credentials?.shop || settings.shopifyStoreDomain || channel.shopifyConfig?.shop || ""), apiVersion: String(credentials?.apiVersion || settings.shopifyAdminApiVersion || channel.shopifyConfig?.apiVersion || "2026-04"), clientId: "", clientSecret: "", accessToken: "" })
    setCredentialsOpen(true)
  }

  async function saveCredentials() {
    setCredentialSaving(true)
    try {
      const result = await api<{ credentials?: typeof credentials; message?: string }>("/api/shopify/credentials", { method: "PUT", body: JSON.stringify(credentialDraft) })
      setCredentials(result.credentials || null)
      setCredentialDraft((current) => ({ ...current, clientId: "", clientSecret: "", accessToken: "" }))
      setCredentialsOpen(false)
      toast.success(result.message || "Shopify credentials updated.")
      onRefreshData()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update Shopify credentials.") } finally { setCredentialSaving(false) }
  }

  function openEbayCredentials() {
    setEbayCredentialDraft({ environment: String(ebayCredentials?.environment || "production"), ruName: String(ebayCredentials?.ruName || ""), scope: String(ebayCredentials?.scope || ""), clientId: "", clientSecret: "", refreshToken: "", accessToken: "" })
    setEbayCredentialsOpen(true)
  }

  async function saveEbayCredentials() {
    setCredentialSaving(true)
    try {
      const result = await api<{ credentials?: typeof ebayCredentials; message?: string }>("/api/ebay/credentials", { method: "PUT", body: JSON.stringify(ebayCredentialDraft) })
      setEbayCredentials(result.credentials || null)
      setEbayCredentialDraft((current) => ({ ...current, clientId: "", clientSecret: "", refreshToken: "", accessToken: "" }))
      setEbayCredentialsOpen(false)
      toast.success(result.message || "eBay credentials updated.")
      onRefreshData()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update eBay credentials.") } finally { setCredentialSaving(false) }
  }

  async function verifyEbayConnection() {
    setEbayVerifying(true)
    try {
      const result = await api<{ credentials?: typeof ebayCredentials; message?: string }>("/api/ebay/connection/verify", { method: "POST", body: JSON.stringify({}) })
      setEbayCredentials(result.credentials || null)
      toast.success(result.message || "eBay seller connection verified.")
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify the eBay seller connection.")
    } finally {
      setEbayVerifying(false)
    }
  }

  async function refreshEbayHealth(showSuccess = true) {
    setEbayHealthLoading(true)
    try {
      const result = await api<typeof ebayHealth>("/api/ebay/health")
      setEbayHealth(result || null)
      if (showSuccess) toast.success("eBay account health refreshed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh eBay account health.")
    } finally {
      setEbayHealthLoading(false)
    }
  }

  async function loadEbayTaxonomyStatus(showSuccess = false) {
    setEbayTaxonomyStatusLoading(true)
    try {
      const marketplaceId = String(settings.ebayMarketplaceId || "EBAY_US")
      const result = await api<{
        indexed?: boolean
        marketplaceId?: string
        categoryCount?: number
        categoryTreeId?: string
        categoryTreeVersion?: string
        syncedAt?: string
        source?: string
      }>(`/api/channel-taxonomies/ebay/status?marketplaceId=${encodeURIComponent(marketplaceId)}`)
      setEbayTaxonomyStatus(result || null)
      if (showSuccess) toast.success(result?.indexed ? "Local eBay category index is ready." : "No local eBay category index has been downloaded yet.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to check the local eBay category index.")
    } finally {
      setEbayTaxonomyStatusLoading(false)
    }
  }

  function generateEbayWebhookToken() {
    const bytes = new Uint8Array(32)
    window.crypto.getRandomValues(bytes)
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
    update("ebayWebhookVerificationToken", token)
    toast.success("A new eBay webhook verification token is ready. Save the channel settings before using it in eBay.")
  }

  async function verifyEbayWebhookSetup() {
    if (hasUnsavedChannelChanges) {
      toast.error("Save the eBay channel changes before verifying webhook setup.")
      return
    }
    setEbayWebhookVerifying(true)
    try {
      const result = await api<{ credentials?: typeof ebayCredentials; message?: string }>("/api/ebay/webhooks/verify", { method: "POST", body: JSON.stringify({}) })
      setEbayCredentials(result.credentials || null)
      toast.success(result.message || "eBay webhook setup verified.")
      void loadEbayWebhookStatus()
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify eBay webhook setup.")
    } finally {
      setEbayWebhookVerifying(false)
    }
  }

  async function loadEbayWebhookStatus(showSuccess = false) {
    setEbayWebhookStatusLoading(true)
    try {
      const result = await api<typeof ebayWebhookStatus>("/api/ebay/webhooks/status")
      setEbayWebhookStatus(result || null)
      const available = (result?.topics || []).map((topic) => String(topic.topicId || "")).filter(Boolean)
      const saved = (result?.selectedTopicIds || []).filter((topicId) => available.includes(topicId))
      const recommended = available.filter((topicId) => /ORDER_CONFIRMATION|ORDER_CANCELLATION|ORDER_UPDATE|FULFILLMENT/i.test(topicId))
      setEbayWebhookSelectedTopics(saved.length ? saved : recommended)
      if (showSuccess) {
        toast.success(result?.notificationConfigRequired
          ? "eBay topics loaded. Add the alert email before syncing subscriptions."
          : "eBay notification topics and subscriptions loaded.")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load eBay notification status.")
    } finally {
      setEbayWebhookStatusLoading(false)
    }
  }

  async function syncEbayWebhookSubscriptions() {
    if (hasUnsavedChannelChanges) {
      toast.error("Save the eBay channel changes before syncing notification subscriptions.")
      return
    }
    if (settings.ebayWebhookEnabled !== true) {
      toast.error("Enable signed eBay webhook processing and save the eBay channel settings before syncing topics.")
      return
    }
    const topicIds = ebayWebhookSelectedTopics
    setEbayWebhookSyncing(true)
    try {
      const result = await api<typeof ebayWebhookStatus>("/api/ebay/webhooks/sync", { method: "POST", body: JSON.stringify({ topicIds }) })
      setEbayWebhookStatus(result || null)
      toast.success("eBay webhook destination and subscriptions synchronized.")
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to synchronize eBay webhook subscriptions.")
    } finally {
      setEbayWebhookSyncing(false)
    }
  }

  async function testEbayWebhookSubscription(subscriptionId: string) {
    try {
      await api(`/api/ebay/webhooks/${encodeURIComponent(subscriptionId)}/test`, { method: "POST", body: JSON.stringify({}) })
      toast.success("eBay test notification requested.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to test eBay webhook subscription.")
    }
  }

  async function runEbayAction(kind: "authorize" | "account" | "catalog" | "compliance" | "reconcile" | "priceInventory" | "taxonomy") {
    try {
      if (kind === "authorize") {
        const returnTo = `${window.location.pathname}${window.location.search}`
        const authPath = `/auth/ebay/start?returnTo=${encodeURIComponent(returnTo)}`
        const popup = window.open(authPath, "dataplus-ebay-auth", "popup,width=760,height=820")
        if (!popup) window.location.assign(authPath)
        else toast.message("Continue with eBay in the sign-in window.")
        return
      }
      const path = kind === "taxonomy"
        ? "/api/channel-taxonomies/ebay/refresh"
        : kind === "account"
        ? "/api/ebay/account-settings/sync"
        : kind === "catalog"
          ? "/api/ebay/catalog-import"
        : kind === "compliance"
          ? "/api/ebay/compliance/audit"
          : kind === "priceInventory"
            ? "/api/ebay/price-inventory/sync"
            : "/api/ebay/fulfillment/reconcile"
      const result = await api<{ message?: string }>(path, { method: "POST", body: JSON.stringify(kind === "taxonomy" ? { marketplaceId: String(settings.ebayMarketplaceId || "EBAY_US") } : {}) })
      const message = kind === "taxonomy"
        ? "eBay category taxonomy refresh queued."
        : kind === "account"
        ? "eBay account sync queued."
        : kind === "catalog"
          ? "eBay offers and live-status sync queued."
          : kind === "compliance"
            ? "eBay compliance audit queued."
            : kind === "priceInventory"
              ? "eBay price and inventory sync queued."
              : "eBay fulfillment reconciliation queued."
      toast.success(result.message || message)
      onRefreshData()
      void refreshEbayHealth(false)
      if (kind === "taxonomy") void loadEbayTaxonomyStatus()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to run eBay action.") }
  }

  function openEbayOrderImport() {
    setEbayOrderImportDraft({
      lookbackDays: String(settings.ebayOrderImportLookbackDays || 30),
      // Full-period reconciliation is the operational default. Counted runs are
      // retained only for a deliberately narrow diagnostic import.
      limit: "all",
      includeCanceled: settings.ebayOrderImportIncludeCanceled === true,
    })
    setEbayOrderImportOpen(true)
  }

  async function queueEbayOrderImport() {
    setEbayOrderImportSaving(true)
    try {
      const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>("/api/ebay/orders/import", {
        method: "POST",
        body: JSON.stringify({
          lookbackDays: Math.max(1, Math.min(365, Number(ebayOrderImportDraft.lookbackDays || 30) || 30)),
          limit: ebayOrderImportDraft.limit === "all"
            ? "all"
            : Math.max(1, Math.min(5000, Number(ebayOrderImportDraft.limit || 250) || 250)),
          fetchAll: ebayOrderImportDraft.limit === "all",
          includeCanceled: ebayOrderImportDraft.includeCanceled,
        }),
      })
      setEbayOrderImportOpen(false)
      toast.success(result.message || (result.duplicate ? "An equivalent eBay order import is already running." : "eBay order import queued."))
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue eBay order import.")
    } finally {
      setEbayOrderImportSaving(false)
    }
  }

  async function queueEbayReturnImport() {
    setEbayReturnImportSaving(true)
    try {
      const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>("/api/ebay/returns/import", {
        method: "POST",
        body: JSON.stringify({
          lookbackDays: Math.max(1, Math.min(548, Number(settings.ebayReturnSyncLookbackDays || 90) || 90)),
          limit: Math.max(1, Math.min(10000, Number(settings.ebayReturnSyncLimit || 1000) || 1000)),
        }),
      })
      toast.success(result.message || (result.duplicate ? "An equivalent eBay return import is already running." : "eBay return import queued."))
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue eBay return import.")
    } finally {
      setEbayReturnImportSaving(false)
    }
  }

  function openTemuOrderImport() {
    setTemuOrderImportDraft({
      lookbackDays: String(settings.temuOrderImportLookbackDays || 30),
      startDate: String(settings.temuOrderImportStartDate || ""),
      limit: String(settings.temuOrderImportLimit || 250),
      includeCanceled: settings.temuOrderImportIncludeCanceled === true,
    })
    setTemuOrderImportOpen(true)
  }

  function openTemuSetupGuide() {
    setActiveTab("actions")
    setTemuSetupGuideDraft({
      downloadOrders: true,
      lookbackDays: String(settings.temuOrderImportLookbackDays || 30),
      startDate: String(settings.temuOrderImportStartDate || ""),
      limit: String(settings.temuOrderImportLimit || 250),
      includeCanceled: settings.temuOrderImportIncludeCanceled === true,
      prepareSkuMapping: settings.temuListingSyncEnabled !== false || settings.temuCatalogSyncEnabled !== false,
      enableSchedule: Boolean(settings.temuOrderImportScheduleEnabled),
      scheduleEveryHours: String(settings.temuOrderImportScheduleEveryHours || 12),
    })
    setTemuSetupGuideOpen(true)
  }

  async function queueTemuOrderImport() {
    setTemuOrderImportSaving(true)
    try {
      const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>("/api/temu/orders/import", {
        method: "POST",
        body: JSON.stringify({
          lookbackDays: Math.max(1, Math.min(365, Number(temuOrderImportDraft.lookbackDays || 30) || 30)),
          limit: Math.max(1, Math.min(5000, Number(temuOrderImportDraft.limit || 250) || 250)),
          startDate: String(temuOrderImportDraft.startDate || ""),
          includeCanceled: temuOrderImportDraft.includeCanceled,
        }),
      })
      setTemuOrderImportOpen(false)
      toast.success(result.message || (result.duplicate ? "An equivalent Temu order import is already running." : "Temu order import queued."))
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue Temu order import.")
    } finally {
      setTemuOrderImportSaving(false)
    }
  }

  async function queueTemuBlindOrderRepair() {
    setTemuOrderImportSaving(true)
    try {
      const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>("/api/temu/orders/import", {
        method: "POST",
        body: JSON.stringify({
          repairBlind: true,
          limit: Math.max(1, Math.min(5000, Number(settings.temuOrderImportLimit || 250) || 250)),
          includeCanceled: true,
        }),
      })
      toast.success(result.message || (result.duplicate ? "An equivalent Temu repair job is already running." : "Blind Temu order repair queued."))
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue blind Temu order repair.")
    } finally {
      setTemuOrderImportSaving(false)
    }
  }

  async function queueTemuStatusRefresh() {
    setTemuOrderImportSaving(true)
    try {
      const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>("/api/temu/orders/refresh-statuses", {
        method: "POST",
        body: JSON.stringify({
          lookbackDays: 3,
          limit: Math.max(1, Math.min(1000, Number(settings.temuOrderImportLimit || 500) || 500))
        })
      })
      toast.success(result.message || (result.duplicate ? "A Temu status refresh is already running." : "Temu order status refresh queued."))
      await onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue Temu status refresh.")
    } finally {
      setTemuOrderImportSaving(false)
    }
  }

  async function queueTemuEnrichment() {
    setTemuOrderImportSaving(true)
    try {
      const result = await api<{ message?: string }>("/api/temu/orders/import", {
        method: "POST", body: JSON.stringify({ mode: "enrichment", lookbackDays: settings.temuOrderEnrichmentLookbackDays || 7, limit: settings.temuOrderEnrichmentLimit || 250 })
      })
      toast.success(result.message || "Temu enrichment queued.")
      await onRefreshData()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue enrichment.") }
    finally { setTemuOrderImportSaving(false) }
  }

  async function runTemuSetupGuide() {
    if (!temuCanRunLive) {
      toast.error("Temu needs a generated access token before live order downloads can run.")
      return
    }
    setTemuSetupGuideSaving(true)
    try {
      const lookbackDays = Math.max(1, Math.min(365, Number(temuSetupGuideDraft.lookbackDays || 30) || 30))
      const limit = Math.max(1, Math.min(5000, Number(temuSetupGuideDraft.limit || 250) || 250))
      const scheduleEveryHours = Math.max(1, Math.min(24, Number(temuSetupGuideDraft.scheduleEveryHours || 12) || 12))
      const settingsPatch: Record<string, unknown> = {
        temuOrderImportLookbackDays: lookbackDays,
        temuOrderImportLimit: limit,
        temuOrderImportStartDate: temuSetupGuideDraft.startDate,
        temuOrderImportIncludeCanceled: temuSetupGuideDraft.includeCanceled,
        temuInitialSetupGuideCompleted: true,
      }
      if (temuSetupGuideDraft.downloadOrders) {
        settingsPatch.orderDownloadEnabled = true
        settingsPatch.temuOrderImportEnabled = true
      }
      if (temuSetupGuideDraft.enableSchedule) {
        settingsPatch.temuOrderImportScheduleEnabled = true
        settingsPatch.temuOrderImportScheduleType = "interval"
        settingsPatch.temuOrderImportScheduleEveryHours = scheduleEveryHours
      }
      if (temuSetupGuideDraft.prepareSkuMapping) {
        settingsPatch.temuListingSyncEnabled = true
        settingsPatch.temuCatalogSyncEnabled = true
      }
      await onSave(channel.id, settingsPatch)
      if (temuSetupGuideDraft.downloadOrders) {
        const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>("/api/temu/orders/import", {
          method: "POST",
          body: JSON.stringify({
            lookbackDays,
            limit,
            startDate: temuSetupGuideDraft.startDate,
            includeCanceled: temuSetupGuideDraft.includeCanceled,
          }),
        })
        toast.success(result.message || (result.duplicate ? "An equivalent Temu order import is already running." : "Temu order import queued."))
      } else {
        toast.success("Temu next-step settings saved.")
      }
      if (temuSetupGuideDraft.prepareSkuMapping) {
        toast.message("Temu SKU mapping prep is enabled. Listing download is waiting on the Temu listing importer worker.")
      }
      setTemuSetupGuideOpen(false)
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to run the Temu setup guide.")
    } finally {
      setTemuSetupGuideSaving(false)
    }
  }

  async function testTemuConnection() {
    if (hasUnsavedChannelChanges) {
      toast.error("Save Temu connection changes before testing.")
      return
    }
    setTemuTestingConnection(true)
    try {
      const result = await api<typeof temuConnectionTest>("/api/temu/connection/test", { method: "POST", body: JSON.stringify({}) })
      setTemuConnectionTest(result || null)
      if (result?.ok) toast.success(result.message || "Temu connection settings verified.")
      else toast.error(result?.message || "Temu connection test failed.")
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to test Temu connection.")
    } finally {
      setTemuTestingConnection(false)
    }
  }

  async function connectTemuSeller() {
    if (hasUnsavedChannelChanges) {
      toast.error("Save Temu connection changes before connecting.")
      return
    }
    setTemuConnecting(true)
    try {
      const result = await api<{ authUrl?: string; redirectUri?: string }>("/api/temu/auth-url")
      if (!result.authUrl) throw new Error("Temu authorization URL was not returned.")
      const popup = window.open(result.authUrl, "dataplus-temu-auth", "popup,width=860,height=820")
      if (!popup) window.location.assign(result.authUrl)
      else toast.message("Continue with Temu in the authorization window.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start Temu authorization.")
    } finally {
      setTemuConnecting(false)
    }
  }

  function openEbayTemplateControls() {
    const pretty = (value: unknown, fallback: string) => {
      try { return JSON.stringify(value ?? JSON.parse(fallback), null, 2) } catch { return fallback }
    }
    setEbayTemplateDraft({
      listingTemplates: pretty(settings.ebayListingTemplates, "[]"),
      itemSpecificTemplates: pretty(settings.ebayItemSpecificTemplates, "[]"),
      storeCategories: pretty(settings.ebayStoreCategories, "[]"),
      buyerRequirements: pretty(settings.ebayBuyerRequirements, "{}"),
      shippingMethodMappings: pretty(settings.ebayShippingMethodMappings, "[]"),
      customPolicies: pretty(settings.ebayCustomPolicies, "[]"),
    })
    setEbayTemplatesOpen(true)
  }

  async function saveEbayTemplateControls() {
    const parse = (raw: string, label: string, expectsArray = true) => {
      let value: unknown
      try { value = JSON.parse(raw || (expectsArray ? "[]" : "{}")) } catch { throw new Error(`${label} must contain valid JSON.`) }
      if (expectsArray && !Array.isArray(value)) throw new Error(`${label} must be a JSON array.`)
      if (!expectsArray && (!value || Array.isArray(value) || typeof value !== "object")) throw new Error(`${label} must be a JSON object.`)
      return value
    }
    setEbayTemplatesSaving(true)
    try {
      await onSave(channel.id, {
        ebayListingTemplates: parse(ebayTemplateDraft.listingTemplates, "Listing templates"),
        ebayItemSpecificTemplates: parse(ebayTemplateDraft.itemSpecificTemplates, "Item specifics templates"),
        ebayStoreCategories: parse(ebayTemplateDraft.storeCategories, "Store categories"),
        ebayBuyerRequirements: parse(ebayTemplateDraft.buyerRequirements, "Buyer requirements", false),
        ebayShippingMethodMappings: parse(ebayTemplateDraft.shippingMethodMappings, "Shipping method mappings"),
        ebayCustomPolicies: parse(ebayTemplateDraft.customPolicies, "Custom policies"),
      })
      setEbayTemplatesOpen(false)
      toast.success("eBay templates and advanced defaults saved.")
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save eBay templates.")
    } finally {
      setEbayTemplatesSaving(false)
    }
  }

  function queueShopifyAction(kind: string, apply = false) {
    const inventoryMapping = shopifyWarehouseMappings.find((mapping) => mapping.enabled && mapping.sourceWarehouseId === "datawarehouse")
      || shopifyWarehouseMappings.find((mapping) => mapping.enabled)
    const inventoryLocationId = String(inventoryMapping?.destinationLocationId || settings.shopifyInventoryLocationId || "")
    const inventoryWarehouseId = String(inventoryMapping?.sourceWarehouseId || settings.shopifyInventoryWarehouseId || "")
    const actionMap: Record<string, { path: string; body: Record<string, unknown>; confirmMessage?: string; successMessage: string }> = {
      status: {
        path: "/api/shopify/status-sync-all",
        body: { limit: Number(settings.shopifyStatusSyncLimit || 100) || 100 },
        successMessage: "Shopify status sync queued.",
      },
      skuMap: {
        path: "/api/shopify/sku-map-sync",
        body: {},
        successMessage: "Shopify SKU pair audit queued.",
      },
      orderImport: {
        path: "/api/shopify/orders/import",
        body: { limit: Number(settings.shopifyOrderImportLimit || 250), sources: String(settings.shopifyOrderImportSources || "Native Shopify sources"), includeCanceled: Boolean(settings.shopifyOrderImportIncludeCanceled) },
        successMessage: "Shopify orders imported or refreshed.",
      },
      registerOrderWebhooks: {
        path: "/api/shopify/webhooks/orders/register",
        body: {},
        successMessage: "Shopify order webhooks registered.",
      },
      inventoryDryRun: {
        path: "/api/shopify/inventory-update",
        body: { apply: false, dryRun: true, mappingId: inventoryMapping?.id || "", warehouseId: inventoryWarehouseId, locationId: inventoryLocationId },
        successMessage: "Shopify inventory dry run queued.",
      },
      inventoryApply: {
        path: "/api/shopify/inventory-update",
        body: { apply: true, dryRun: false, mappingId: inventoryMapping?.id || "", warehouseId: inventoryWarehouseId, locationId: inventoryLocationId },
        confirmMessage: "Push inventory updates to live Shopify now? This should only be used after the dry run looks good.",
        successMessage: "Shopify inventory update queued.",
      },
      priceDryRun: {
        path: "/api/shopify/variant-price-push",
        body: { apply: false, dryRun: true },
        successMessage: "Shopify price dry run queued.",
      },
      priceApply: {
        path: "/api/shopify/variant-price-push",
        body: { apply: true, dryRun: false },
        confirmMessage: "Push DataPlus prices to live Shopify variants now? Run a price dry run first if you have not reviewed it.",
        successMessage: "Shopify price push queued.",
      },
      createDryRun: {
        path: "/api/shopify/product-create",
        body: { apply: false, dryRun: true, limit: 100 },
        successMessage: "Shopify product create dry run queued.",
      },
      createApply: {
        path: "/api/shopify/product-create",
        body: { apply: true, dryRun: false, limit: 100 },
        confirmMessage: "Create new live Shopify products now? This should only be used after reviewing a create dry run.",
        successMessage: "Shopify product creation queued.",
      },
      linkDryRun: {
        path: "/api/shopify/link-existing-variants",
        body: { apply: false, dryRun: true, limit: 50000 },
        successMessage: "Shopify existing-link dry run queued.",
      },
      linkApply: {
        path: "/api/shopify/link-existing-variants",
        body: { apply: true, dryRun: false, limit: 50000 },
        confirmMessage: "Backfill DataPlus links from existing Shopify variants now? This will update DataPlus mappings.",
        successMessage: "Shopify existing-link backfill queued.",
      },
      collectionsDryRun: {
        path: "/api/shopify/product-type-collections-sync",
        body: { apply: false, dryRun: true },
        successMessage: "Shopify product type and collections dry run queued.",
      },
      collectionsApply: {
        path: "/api/shopify/product-type-collections-sync",
        body: { apply: true, dryRun: false },
        confirmMessage: "Push product type and smart collection updates to live Shopify now?",
        successMessage: "Shopify product type and collections sync queued.",
      },
      taxonomyDryRun: {
        path: "/api/shopify/taxonomy-push",
        body: { apply: false, dryRun: true },
        successMessage: "Shopify taxonomy dry run queued.",
      },
      taxonomyApply: {
        path: "/api/shopify/taxonomy-push",
        body: { apply: true, dryRun: false },
        confirmMessage: "Push Shopify taxonomy updates to live products now?",
        successMessage: "Shopify taxonomy push queued.",
      },
      shippingEligibilityDryRun: {
        path: "/api/shopify/shipping-eligibility/sync",
        body: { apply: false, dryRun: true, limit: 1000 },
        successMessage: "Shopify shipping eligibility review queued.",
      },
      shippingEligibilityApply: {
        path: "/api/shopify/shipping-eligibility/sync",
        body: { apply: true, dryRun: false, limit: 1000 },
        confirmMessage: "Apply Shopify shipping eligibility tags and delivery-profile assignments now? Review the dry run first. Products without complete measurements remain paid/review instead of becoming free shipping.",
        successMessage: "Shopify shipping eligibility sync queued.",
      },
    }
    const action = actionMap[kind]
    if (!action) return
    if (apply && kind === "inventoryApply" && !settings.shopifyInventoryPushEnabled) {
      toast.error("Enable DataPlus inventory push before applying inventory updates.")
      return
    }
    onRunShopifyAction(action)
  }

  const [inactiveInventoryBusy, setInactiveInventoryBusy] = useState(false)
  async function runInactiveInventory(apply: boolean) {
    setInactiveInventoryBusy(true)
    try {
      await onRunShopifyAction({
        path: `/api/channels/${encodeURIComponent(channel.id)}/inactive-inventory`, body: { apply },
        confirmMessage: apply ? `Send zero inventory to ${channel.name} for all linked inactive SKUs? Listings and local warehouse stock will be preserved. Active SKUs will not change.` : "",
        successMessage: "Inactive inventory job queued. Open Jobs for results.",
      })
    } finally { setInactiveInventoryBusy(false) }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <ChannelLogo channel={channel} />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Marketplace channel</p>
              <CardTitle>{channel.name}</CardTitle>
              <CardDescription>{channel.connected ? "Connected" : "Not connected"} / {channel.status || "draft"}</CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="outline" onClick={() => { setEditing(false); setDraft({}) }}>Cancel</Button>
                <Button onClick={save}>Save changes</Button>
              </>
            ) : (
              <ContextActions disabled={inactiveInventoryBusy} label={inactiveInventoryBusy ? "Queuing..." : "Actions"} actions={[
                { id: "edit-channel", label: "Edit channel", onSelect: () => setEditing(true) },
                ...(["temu", "whatnot", "tiktok", "tiktok shop"].includes(channel.name.toLowerCase()) ? [
                  { id: "review-inactive", label: "Review inactive inventory", icon: <Search className="size-4" />, onSelect: () => { void runInactiveInventory(false) } },
                  { id: "zero-inactive", label: "Zero inactive inventory", icon: <Ban className="size-4" />, onSelect: () => { void runInactiveInventory(true) } },
                ] : []),
              ]} />
            )}
          </div>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={tab => { if (tab === "companies") window.location.assign("/settings?tab=companies"); else setActiveTab(tab) }}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {isTemu && <TabsTrigger value="connection">Connection</TabsTrigger>}
          {isEbay && <TabsTrigger value="operations">Operations</TabsTrigger>}
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="actions">Run</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="mappings">Mappings</TabsTrigger>
          <TabsTrigger value="attributes">Attributes</TabsTrigger>
          <TabsTrigger value="variants">Variants</TabsTrigger>
          <TabsTrigger value="skus">SKUs</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4">
          {isShopify && (
            <Card className={auth?.ok ? "border-emerald-300" : ""}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {auth?.ok ? <CheckCircle2 className="size-5 text-emerald-600" /> : <ShieldCheck className="size-5" />}
                    Shopify connection health
                  </CardTitle>
                  <CardDescription>{auth?.message || "Run a connection check before major Shopify jobs."}</CardDescription>
                </div>
                <Button onClick={onCheckShopify} disabled={checking}>
                  {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Check connection
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-5">
                <Detail label="Store" value={channel.shopifyConfig?.shop || auth?.shop?.myshopifyDomain || "Missing"} />
                <Detail label="API version" value={channel.shopifyConfig?.apiVersion || "2026-04"} />
                <Detail label="Token source" value={auth?.tokenSource || "Configured"} />
                <Detail label="read_shipping" value={auth?.hasReadShipping ? "Active" : auth ? "Missing" : "Unchecked"} />
                <Detail label="Order import scopes" value={auth ? auth.hasReadOrders && auth.hasReadCustomers ? "Active" : `Missing: ${(auth.missingOrderScopes || []).join(", ")}` : "Unchecked"} />
              </CardContent>
            </Card>
          )}
          {isEbay && (
            <Card className={ebayCredentials?.hasSellerAuthorization ? "border-emerald-300" : "border-amber-300"}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {ebayCredentials?.hasSellerAuthorization ? <CheckCircle2 className="size-5 text-emerald-600" /> : <ShieldCheck className="size-5" />}
                    eBay connection health
                  </CardTitle>
                  <CardDescription>{ebayCredentials?.hasSellerAuthorization ? "Seller authorization is ready for eBay syncs." : "Add credentials, then authorize the eBay seller account."}</CardDescription>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={() => void runEbayAction("authorize")} disabled={!ebayCredentials?.configured}>{ebayCredentials?.hasSellerAuthorization ? "Reconnect eBay account" : "Sign in with eBay"}</Button>
                  <Button variant="outline" onClick={() => void verifyEbayConnection()} disabled={!ebayCredentials?.hasSellerAuthorization || ebayVerifying}>
                    {ebayVerifying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Verify connection
                  </Button>
                  <Button variant="outline" onClick={openEbayCredentials}>Update API credentials</Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-5">
                <Detail label="Environment" value={ebayCredentials?.environment || "Production"} />
                <Detail label="Client credentials" value={ebayCredentials?.hasClientCredentials ? "Configured" : "Missing"} />
                <Detail label="Redirect URI name" value={ebayCredentials?.ruName || "Missing"} />
                <Detail label="Seller authorization" value={ebayCredentials?.hasSellerAuthorization ? "Connected" : "Required"} />
                <Detail label="Connected" value={ebayCredentials?.sellerAuthorizedAt ? new Date(ebayCredentials.sellerAuthorizedAt).toLocaleString() : "Not yet"} />
                <Detail label="Last verified" value={ebayCredentials?.connectionVerifiedAt ? new Date(ebayCredentials.connectionVerifiedAt).toLocaleString() : "Not yet"} />
                <Detail label="Webhooks" value={ebayCredentials?.webhookEnabled ? "Enabled" : "Off"} />
                <Detail label="Webhook API" value={ebayCredentials?.webhookVerificationAt ? "Verified" : "Not verified"} />
                <Detail label="Last eBay event" value={ebayCredentials?.webhookLastReceivedAt ? new Date(ebayCredentials.webhookLastReceivedAt).toLocaleString() : "None"} />
                {!ebayCredentials?.hasSellerAuthorization && <div className="col-span-full"><Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>Finish the eBay RuName setup</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>In eBay Developer Portal → User Tokens → your Production RuName, turn on <strong>OAuth Enabled</strong>. Set both <strong>Auth accepted URL</strong> and <strong>Auth declined URL</strong> to this DataPlus callback.</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="max-w-full break-all rounded bg-muted px-2 py-1 text-xs">{ebayOAuthCallbackUrl}</code>
                      <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(ebayOAuthCallbackUrl).then(() => toast.success("eBay callback URL copied."), () => toast.error("Unable to copy the callback URL."))}><Copy className="size-3.5" />Copy URL</Button>
                    </div>
                  </AlertDescription>
                </Alert></div>}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Channel defaults</CardTitle>
              <CardDescription>These values are used when new SKUs are prepared for this channel.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <Detail label="Shadow status" value={String(settings.defaultShadowStatus || "Draft")} />
              <Detail label="Handling days" value={String(settings.defaultHandlingTimeDays ?? 0)} />
              <Detail label="Safety qty" value={String(settings.defaultSafetyQty ?? 0)} />
              <Detail label="Max sellable qty" value={String(settings.defaultMaxSellableQty ?? 0)} />
              <Detail label="Shipping profile" value={String(settings.defaultShippingProfile || "Standard")} />
              <Detail label="Shipping service" value={String(settings.defaultShippingService || "Marketplace Standard")} />
            </CardContent>
          </Card>
        </TabsContent>

        {isEbay && <TabsContent value="operations" className="grid gap-4">
          <EbayOperations enabled={channelEnabled} marketplaceId={String(settings.ebayMarketplaceId || "EBAY_US")} />
        </TabsContent>}

        {isTemu && <TabsContent value="connection" className="grid gap-4">
          <Card className={temuCredentialsConfigured ? "border-emerald-300" : "border-amber-300"}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  {temuCredentialsConfigured ? <CheckCircle2 className="size-5 text-emerald-600" /> : <ShieldCheck className="size-5" />}
                  Temu connection
                </CardTitle>
                <CardDescription>{temuCanRunLive ? "Temu is connected. Use reconnect only when the seller authorization or generated token needs to be refreshed." : "Save the Temu Seller API request URL, app key, and app secret, then connect the seller account."}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant={temuCanRunLive ? "outline" : "default"} onClick={() => void connectTemuSeller()} disabled={temuConnecting || hasUnsavedChannelChanges || !temuCredentialsConfigured}>
                  {temuConnecting ? <Loader2 className="size-4 animate-spin" /> : temuCanRunLive ? <RotateCcw className="size-4" /> : <ExternalLink className="size-4" />}
                  {temuAuthActionLabel}
                </Button>
                <Button variant="outline" onClick={() => void testTemuConnection()} disabled={temuTestingConnection || hasUnsavedChannelChanges || !temuCredentialsConfigured}>
                  {temuTestingConnection ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  Test connection
                </Button>
                <Button variant="outline" onClick={openTemuSetupGuide} disabled={hasUnsavedChannelChanges || !temuCanRunLive}>
                  <ListChecks className="size-4" />
                  {temuSetupGuideLabel}
                </Button>
                {!editing && <Button onClick={() => setEditing(true)}>Edit connection</Button>}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Detail label="API credentials" value={temuCredentialsConfigured ? "Configured" : "Missing"} />
              <Detail label="App key" value={temuAppKeyConfigured ? "Configured" : "Missing"} />
              <Detail label="Seller connection" value={temuCanRunLive ? "Connected" : "Not connected"} />
              <Detail label="Generated token" value={temuCanRunLive ? temuGeneratedTokenLabel : "Waiting for channel"} />
              <Detail label="Live API check" value={temuConnectionTest?.liveApiChecked || settings.temuConnectionLiveApiChecked ? (temuConnectionTest?.ok ?? settings.temuConnectionOk ? "Passed" : "Needs attention") : "Not checked"} />
              <Detail label="Last verified" value={dateLabel(temuConnectionVerifiedAt)} />
              <Detail label="Latest order sync" value={dateLabel(temuLatestOrderSync)} />
              <Field label="API request URL"><Input disabled={!editing} value={String(settings.temuEndpoint || "https://openapi-b-us.temu.com/openapi/router")} onChange={(event) => update("temuEndpoint", event.target.value)} /></Field>
              <Field label="Seller authorization URL"><Input disabled={!editing} value={String(settings.temuAuthorizationUrl || "https://seller.temu.com/open-platform/client-manage/authorization")} onChange={(event) => update("temuAuthorizationUrl", event.target.value)} /><p className="text-xs text-muted-foreground">Used by the Temu connect and reconnect action to open the seller authorization page.</p></Field>
              <Field label="App key"><Input disabled={!editing} value={String(settings.temuAppKey || "")} placeholder={temuAppKeyConfigured ? "Configured - enter a value only to replace it" : "Required"} onChange={(event) => update("temuAppKey", event.target.value)} /></Field>
              <Field label="App secret"><Input disabled={!editing} type="password" value={String(settings.temuAppSecret || "")} placeholder={temuAppSecretConfigured ? "Configured - enter a value only to replace it" : "Required"} onChange={(event) => update("temuAppSecret", event.target.value)} /></Field>
              <Field label="Access token override"><Input disabled={!editing} type="password" value={String(settings.temuAccessToken || "")} placeholder={temuGeneratedTokenLabel} onChange={(event) => update("temuAccessToken", event.target.value)} /><p className="text-xs text-muted-foreground">Usually auto-populated by Connect Temu. Paste a token here only when Temu provides one manually or a reconnect needs a temporary override.</p></Field>
              <Field label="Mall ID"><Input disabled value={String(temuConnectionTest?.mallId || settings.temuMallId || "")} placeholder="Generated by Temu after connection" readOnly /><p className="text-xs text-muted-foreground">Auto-populated from the connected Temu mall account when Temu returns it.</p></Field>
              <Field label="Order page size"><Input disabled={!editing} type="number" min="1" max="100" value={String(settings.temuOrderPageSize ?? 50)} onChange={(event) => update("temuOrderPageSize", Number(event.target.value || 50))} /></Field>
              <Field label="OAuth callback URL"><Input disabled value={`${window.location.origin}/auth/temu/callback`} readOnly /></Field>
              <div className={`rounded-md border p-3 text-sm md:col-span-2 xl:col-span-3 ${temuConnectionTest?.ok || settings.temuConnectionOk ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "bg-muted/20 text-muted-foreground"}`}>
                {hasUnsavedChannelChanges ? "Save changes to activate these Temu credentials." : temuConnectionMessage || (temuCredentialsConfigured ? "Temu API credentials are saved. Use Test connection to verify whether the generated token can reach Temu order APIs." : "Enter the app key and app secret, then save changes.")}
              </div>
            </CardContent>
          </Card>
        </TabsContent>}

        <TabsContent value="setup" id="shopify-schedules">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connection and enabled features</CardTitle>
              <CardDescription>Credentials, channel availability, and the integrations that are permitted to run. Click Edit above before changing values.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="col-span-full flex flex-wrap items-center justify-between gap-4 rounded-md border bg-muted/30 p-4">
                <div><p className="text-sm font-semibold">Master channel status</p><p className="mt-1 text-xs text-muted-foreground">When disabled, DataPlus blocks every channel job, scheduled run, import, listing action, inventory update, price update, and webhook processing. Your individual settings are retained for when the channel returns live.</p></div>
                <ToggleField label={channelEnabled ? "Channel is live" : "Channel is disabled"} checked={channelEnabled} disabled={!editing} onCheckedChange={(value) => update("channelEnabled", value)} />
              </div>
              {!channelEnabled && <div className="col-span-full"><Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Channel is disabled</AlertTitle><AlertDescription>Enable the channel and save before DataPlus can run any marketplace automation. Existing connection credentials are retained safely for when this channel returns live.</AlertDescription></Alert></div>}
              <fieldset disabled={!editing || !channelEnabled} className="col-span-full grid gap-4 border-0 p-0 md:grid-cols-2 xl:grid-cols-3">
              <div className="col-span-full"><p className="text-sm font-semibold">General channel enablement</p><p className="pt-1 text-xs text-muted-foreground">Turn on only the individual integrations this live channel is permitted to run.</p></div>
              <ToggleField label="Enable price updates" checked={Boolean(settings.priceUpdateEnabled)} disabled={!editing || !channelEnabled} onCheckedChange={(value) => update("priceUpdateEnabled", value)} />
              <ToggleField label="Enable inventory updates" checked={Boolean(settings.inventoryUpdateEnabled)} disabled={!editing || !channelEnabled} onCheckedChange={(value) => update("inventoryUpdateEnabled", value)} />
              <ToggleField label="Enable order downloads" checked={Boolean(settings.orderDownloadEnabled)} disabled={!editing || !channelEnabled} onCheckedChange={(value) => update("orderDownloadEnabled", value)} />
              <ToggleField label="Create SKU from order import" description="Create a draft local product when an imported order SKU is unknown. DataPlus marks it for Catalog Readiness review so it can be completed or linked as an alias later." checked={settings.createMissingOrderSkusFromSource !== false} disabled={!editing || !channelEnabled} onCheckedChange={(value) => update("createMissingOrderSkusFromSource", value)} />
              <ToggleField label="Enable tracking updates" checked={Boolean(settings.trackingUpdateEnabled)} disabled={!editing || !channelEnabled} onCheckedChange={(value) => update("trackingUpdateEnabled", value)} />
              <ToggleField label="Auto-create shadows" checked={Boolean(settings.autoCreateShadow)} disabled={!editing || !channelEnabled} onCheckedChange={(value) => update("autoCreateShadow", value)} />
              {isShopify && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Shopify Admin API</p></div>
                <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
                  <div className="text-sm"><p className="font-medium">Shopify credentials</p><p className="text-muted-foreground">{credentials?.shop || "Store domain not configured"} / API {credentials?.apiVersion || "not configured"}</p><p className="pt-1 text-xs text-muted-foreground">Client credentials: {credentials?.hasClientCredentials ? "configured" : "missing"} / Admin token: {credentials?.hasAccessToken ? "configured" : "missing"}</p></div>
                  <Button size="sm" variant="outline" onClick={openCredentials}>Update API credentials</Button>
                </div>
                <Field label="Status sync limit">
                  <Input disabled={!editing} min="1" max="500" type="number" value={String(settings.shopifyStatusSyncLimit ?? 100)} onChange={(event) => update("shopifyStatusSyncLimit", Number(event.target.value || 100))} />
                </Field>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Enabled Shopify features</p><p className="pt-1 text-xs text-muted-foreground">These switches grant DataPlus permission to run the matching channel operation. Product and fulfillment defaults live under Rules.</p></div>
                <ToggleField label="Enable Shopify status sync" checked={Boolean(settings.shopifySyncStatusEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifySyncStatusEnabled", value)} />
                <ToggleField label="Auto-sync after API actions" checked={Boolean(settings.shopifyAutoSyncStatus)} disabled={!editing} onCheckedChange={(value) => update("shopifyAutoSyncStatus", value)} />
                <ToggleField label="Manage Closeouts collection" checked={Boolean(settings.shopifyCloseoutsEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyCloseoutsEnabled", value)} />
                <ToggleField label="Enable Shopify order imports" checked={Boolean(settings.shopifyOrderImportEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyOrderImportEnabled", value)} />
                <ToggleField label="Import Shopify Payments payouts daily" description="Reconcile paid Shopify Payments payouts, processing fees, bank trace IDs, and order proceeds in Accounting. Other payment gateways require their own settlement source." checked={settings.shopifySettlementImportEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("shopifySettlementImportEnabled", value)} />
                <ToggleField label="Enable Shopify order webhooks" checked={Boolean(settings.shopifyOrderWebhookEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyOrderWebhookEnabled", value)} />
                <ToggleField label="Enable Shopify cancellation API" checked={Boolean(settings.shopifyCancellationNotificationEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyCancellationNotificationEnabled", value)} />
                <ToggleField label="Enable Shopify fulfillment sync" checked={Boolean(settings.shopifyFulfillmentSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyFulfillmentSyncEnabled", value)} />
                <ToggleField label="Enable Shopify refund sync" checked={Boolean(settings.shopifyRefundSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyRefundSyncEnabled", value)} />
                <ToggleField label="Enable Shopify return sync" checked={Boolean(settings.shopifyReturnSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyReturnSyncEnabled", value)} />
                <ToggleField label="Enable Shopify payment capture" checked={Boolean(settings.shopifyPaymentCaptureEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyPaymentCaptureEnabled", value)} />
                <ToggleField label="Enable Shopify order address sync" checked={Boolean(settings.shopifyOrderAddressSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyOrderAddressSyncEnabled", value)} />
                <ToggleField label="Enable Shopify label purchase (API 2026-07+)" checked={Boolean(settings.shopifyLabelPurchaseEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyLabelPurchaseEnabled", value)} />
                <ToggleField label="Enable DataPlus inventory push" checked={Boolean(settings.shopifyInventoryPushEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyInventoryPushEnabled", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Order sync behavior</p></div>
                <Field label="Orders per manual import"><Input disabled={!editing} type="number" min="1" max="1000" value={String(settings.shopifyOrderImportLimit ?? 250)} onChange={(event) => update("shopifyOrderImportLimit", Number(event.target.value || 250))} /></Field>
                <Field label="Order source allowlist"><Input disabled={!editing} value={String(settings.shopifyOrderImportSources || "Native Shopify sources")} placeholder="Native Shopify sources" onChange={(event) => update("shopifyOrderImportSources", event.target.value)} /><p className="text-xs text-muted-foreground">Native Shopify sources includes Online Store, Shop, Point of Sale, completed draft orders, mobile, and API-created orders. Connected third-party channels such as eBay or Temu are excluded. Enter a comma-separated list to restrict imports further.</p></Field>
                <ToggleField label="Include canceled orders" checked={Boolean(settings.shopifyOrderImportIncludeCanceled)} disabled={!editing} onCheckedChange={(value) => update("shopifyOrderImportIncludeCanceled", value)} />
                <Field label="Order reconciliation schedule"><Select disabled={!editing} value={String(settings.shopifyOrderImportScheduleType || "times")} onValueChange={(value) => update("shopifyOrderImportScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></Field>
                <Field label="First reconciliation"><Input disabled={!editing} type="time" value={orderImportScheduleTimes[0] || "04:00"} onChange={(event) => update("shopifyOrderImportScheduleTimes", [event.target.value, orderImportScheduleTimes[1] || "16:00"].join(","))} /></Field>
                <Field label="Second reconciliation"><Input disabled={!editing} type="time" value={orderImportScheduleTimes[1] || "16:00"} onChange={(event) => update("shopifyOrderImportScheduleTimes", [orderImportScheduleTimes[0] || "04:00", event.target.value].join(","))} /></Field>
                <Field label="Reconcile every hours"><Input disabled={!editing} type="number" min="1" max="24" value={String(settings.shopifyOrderImportScheduleEveryHours ?? 12)} onChange={(event) => update("shopifyOrderImportScheduleEveryHours", Number(event.target.value || 12))} /></Field>
                <ToggleField label="Schedule Shopify order reconciliation" checked={Boolean(settings.shopifyOrderImportScheduleEnabled)} disabled={!editing || !Boolean(settings.shopifyOrderImportEnabled)} onCheckedChange={(value) => update("shopifyOrderImportScheduleEnabled", value)} />
              </>}
              {isEbay && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">eBay Sell API</p></div>
                <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
                  <div className="text-sm"><p className="font-medium">eBay credentials</p><p className="text-muted-foreground">{ebayCredentials?.environment || "production"} / Redirect URI: {ebayCredentials?.ruName || "not configured"}</p><p className="pt-1 text-xs text-muted-foreground">Client credentials: {ebayCredentials?.hasClientCredentials ? "configured" : "missing"} / Seller authorization: {ebayCredentials?.hasSellerAuthorization ? "connected" : "required"}</p></div>
                  <Button size="sm" variant="outline" onClick={openEbayCredentials}>Update API credentials</Button>
                </div>
                <Field label="Marketplace"><Select disabled={!editing} value={String(settings.ebayMarketplaceId || "EBAY_US")} onValueChange={(value) => update("ebayMarketplaceId", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EBAY_US">United States</SelectItem><SelectItem value="EBAY_CA">Canada</SelectItem><SelectItem value="EBAY_GB">United Kingdom</SelectItem><SelectItem value="EBAY_AU">Australia</SelectItem></SelectContent></Select></Field>
                <Field label="Merchant location">
                  {ebayMerchantLocations.length ? <Select disabled={!editing} value={String(settings.ebayMerchantLocationKey || "none")} onValueChange={(value) => update("ebayMerchantLocationKey", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Select an imported eBay location" /></SelectTrigger><SelectContent><SelectItem value="none">No merchant location selected</SelectItem>{ebayMerchantLocations.map((location: any) => <SelectItem key={String(location.merchantLocationKey || location.key || location.name)} value={String(location.merchantLocationKey || location.key || location.name)}>{String(location.name || location.merchantLocationKey || location.key)}{location.status ? ` / ${String(location.status)}` : ""}</SelectItem>)}</SelectContent></Select> : <Input disabled={!editing} value={String(settings.ebayMerchantLocationKey || "")} placeholder="Sync policies and locations first" onChange={(event) => update("ebayMerchantLocationKey", event.target.value)} />}
                </Field>
                <Field label="Active-listing sync limit"><Input disabled={!editing} min="1" max="100000" type="number" value={String(settings.ebayCatalogSyncLimit ?? 50000)} onChange={(event) => update("ebayCatalogSyncLimit", Number(event.target.value || 50000))} /><p className="mt-1 text-xs text-muted-foreground">Maximum active offers read from eBay per listing sync.</p></Field>
                <ToggleField label="Enable eBay catalog sync" checked={settings.ebayCatalogSyncEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("ebayCatalogSyncEnabled", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">eBay offers and live-status sync</p><p className="pt-1 text-xs text-muted-foreground">Import offer identities and verify live status with eBay's GetMyeBaySelling active feed. A failed, capped, or incomplete feed never marks missing listings as ended.</p></div>
                <ToggleField label="Automatic schedule" description="Run the same offer and live-status sync automatically." checked={settings.ebayCatalogSyncScheduleEnabled !== false} disabled={!editing || settings.ebayCatalogSyncEnabled === false} onCheckedChange={(value) => update("ebayCatalogSyncScheduleEnabled", value)} />
                <ToggleField label="Require fresh status before launch" description="Automatically run a live-status sync before publishing when the saved eBay snapshot is stale. The launch waits and resumes without another user action." checked={settings.ebayRequireFreshStatusBeforeLaunch !== false} disabled={!editing || settings.ebayCatalogSyncEnabled === false} onCheckedChange={(value) => update("ebayRequireFreshStatusBeforeLaunch", value)} />
                <Field label="Launch status freshness (hours)"><Input disabled={!editing || settings.ebayCatalogSyncEnabled === false || settings.ebayRequireFreshStatusBeforeLaunch === false} type="number" min="1" max="24" value={String(settings.ebayLaunchStatusMaxAgeHours ?? 6)} onChange={(event) => update("ebayLaunchStatusMaxAgeHours", Number(event.target.value || 6))} /><p className="mt-1 text-xs text-muted-foreground">A publish launch automatically queues verification first when the latest complete active-listing feed is older than this.</p></Field>
                <Field label="Verification schedule"><Select disabled={!editing || settings.ebayCatalogSyncEnabled === false} value={String(settings.ebayCatalogSyncScheduleType || "interval")} onValueChange={(value) => update("ebayCatalogSyncScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific time</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></Field>
                {String(settings.ebayCatalogSyncScheduleType || "interval") === "interval"
                  ? <Field label="Verify every hours"><Input disabled={!editing || settings.ebayCatalogSyncEnabled === false} type="number" min="1" max="24" value={String(settings.ebayCatalogSyncScheduleEveryHours ?? 6)} onChange={(event) => update("ebayCatalogSyncScheduleEveryHours", Number(event.target.value || 6))} /></Field>
                  : <Field label="Daily verification time"><Input disabled={!editing || settings.ebayCatalogSyncEnabled === false} type="time" value={ebayCatalogSyncScheduleTimes[0] || "02:00"} onChange={(event) => update("ebayCatalogSyncScheduleTimes", event.target.value)} /></Field>}
                <ToggleField label="Enable eBay order imports" checked={Boolean(settings.ebayOrderImportEnabled)} disabled={!editing} onCheckedChange={(value) => update("ebayOrderImportEnabled", value)} />
                <ToggleField label="Enable eBay return sync" checked={Boolean(settings.ebayReturnSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("ebayReturnSyncEnabled", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">eBay webhooks</p><p className="pt-1 text-xs text-muted-foreground">Use signed eBay notifications for fast order reconciliation. DataPlus validates the public endpoint and records every accepted delivery in Channel logs.</p></div>
                <div className="col-span-full grid gap-4 rounded-md border bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2"><Field label="Public HTTPS endpoint"><Input disabled={!editing} value={ebayWebhookEndpoint} placeholder={defaultEbayWebhookEndpoint} onChange={(event) => update("ebayWebhookEndpoint", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Register this exact URL as the eBay Notification API destination.</p></Field></div>
                    <div className="md:col-span-2"><Field label="Webhook verification token"><div className="flex gap-2"><Input disabled={!editing} type={editing ? "text" : "password"} value={editing ? String(settings.ebayWebhookVerificationToken || "") : settings.ebayWebhookVerificationTokenConfigured || settings.ebayWebhookVerificationToken ? "Configured" : ""} placeholder={settings.ebayWebhookVerificationTokenConfigured ? "Configured - generate only to replace it" : "Generate a 32-80 character token"} onChange={(event) => update("ebayWebhookVerificationToken", event.target.value)} /><Button type="button" variant="outline" disabled={!editing} onClick={generateEbayWebhookToken}>Generate</Button></div><p className="mt-1 text-xs text-muted-foreground">Save after generating. Then paste the token into the eBay destination configuration.</p></Field></div>
                    <div className="md:col-span-2"><Field label="eBay Notification alert email"><Input disabled={!editing} type="email" value={String(settings.ebayNotificationAlertEmail || "")} placeholder="alerts@yourcompany.com" onChange={(event) => update("ebayNotificationAlertEmail", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">eBay requires an app-level alert email before notification subscriptions can be read or created.</p></Field></div>
                    <ToggleField label="Enable signed eBay webhook processing" checked={Boolean(settings.ebayWebhookEnabled)} disabled={!editing} onCheckedChange={(value) => update("ebayWebhookEnabled", value)} />
                    <ToggleField label="Reconcile orders from Order Confirmation" checked={settings.ebayWebhookOrderSyncEnabled !== false} disabled={!editing || !Boolean(settings.ebayWebhookEnabled) || !Boolean(settings.ebayOrderImportEnabled)} onCheckedChange={(value) => update("ebayWebhookOrderSyncEnabled", value)} />
                  </div>
                  <div className="flex min-w-56 flex-col justify-between gap-3 rounded-md border bg-background p-3 text-sm">
                    <div><p className="font-medium">Webhook readiness</p><p className="mt-1 text-xs text-muted-foreground">{ebayCredentials?.webhookVerificationMessage || "Save a valid endpoint and token, then verify Notification API access."}</p></div>
                    <div className="space-y-1 text-xs text-muted-foreground"><p>{ebayCredentials?.webhookLastReceivedAt ? `Last event: ${new Date(ebayCredentials.webhookLastReceivedAt).toLocaleString()}` : "No event received yet."}</p>{ebayCredentials?.webhookLastTopic ? <p className="truncate">Topic: {ebayCredentials.webhookLastTopic}</p> : null}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button type="button" variant="outline" size="sm" disabled={!ebayCredentials?.hasClientCredentials || ebayWebhookVerifying || hasUnsavedChannelChanges} onClick={() => void verifyEbayWebhookSetup()}>{ebayWebhookVerifying ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}Verify access</Button>
                      <Button type="button" size="sm" disabled={!ebayCredentials?.hasClientCredentials || ebayWebhookStatusLoading} onClick={() => void loadEbayWebhookStatus(true)}>{ebayWebhookStatusLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Load topics</Button>
                    </div>
                    {ebayWebhookStatus ? <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-xs sm:col-span-2">
                      {ebayWebhookStatus.notificationConfigRequired ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-medium">eBay notification configuration required</p><p className="mt-1">{ebayWebhookStatus.notificationConfigError || "Save a valid alert email, then sync selected topics."}</p></div> : null}
                      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Notification subscriptions</p><p className="text-muted-foreground">DataPlus destination: {ebayWebhookStatus.destinationId || "Not created"}</p><p className="text-muted-foreground">{ebayWebhookSelectedTopics.length ? `${ebayWebhookSelectedTopics.length} topic${ebayWebhookSelectedTopics.length === 1 ? "" : "s"} selected` : "No topics selected; syncing will disable eBay subscriptions."}</p></div><Button type="button" size="sm" disabled={ebayWebhookSyncing || hasUnsavedChannelChanges || settings.ebayWebhookEnabled !== true} onClick={() => void syncEbayWebhookSubscriptions()}>{ebayWebhookSyncing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{ebayWebhookSelectedTopics.length ? "Sync selected topics" : "Disable all topics"}</Button></div>
                      <div className="grid gap-1 sm:grid-cols-2">{(ebayWebhookStatus.topics || []).map((topic) => { const topicId = String(topic.topicId || ""); const checked = ebayWebhookSelectedTopics.includes(topicId); const subscription = (ebayWebhookStatus.subscriptions || []).find((row) => String(row.topicId || "") === topicId && String(row.destinationId || "") === String(ebayWebhookStatus.destinationId || "")); return <label key={topicId} className="flex items-start gap-2 rounded border bg-background p-2"><Checkbox checked={checked} onCheckedChange={(value) => setEbayWebhookSelectedTopics((current) => value === true ? [...new Set([...current, topicId])] : current.filter((item) => item !== topicId))} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{topicId}</span><span className="text-muted-foreground">{subscription ? `Subscription ${String(subscription.status || "configured").toLowerCase()}` : "Not subscribed"}</span></span>{subscription && String(subscription.subscriptionId || "") ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => void testEbayWebhookSubscription(String(subscription.subscriptionId))}>Test</Button> : null}</label> })}</div>
                    </div> : null}
                    <a className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline" href="https://developer.ebay.com/develop/api/sell/notification_api" target="_blank" rel="noreferrer">Open eBay Notification API <ExternalLink className="size-3" /></a>
                  </div>
                </div>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">eBay order import</p><p className="pt-1 text-xs text-muted-foreground">Import a selected history window on demand, then keep recent eBay orders synchronized on a schedule.</p></div>
                <Field label="Manual import lookback days"><Select disabled={!editing} value={String(settings.ebayOrderImportLookbackDays ?? 30)} onValueChange={(value) => update("ebayOrderImportLookbackDays", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Last 24 hours</SelectItem><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 180 days</SelectItem><SelectItem value="365">Last 365 days</SelectItem></SelectContent></Select></Field>
                <Field label="Orders per import"><Input disabled={!editing} type="number" min="1" max="5000" value={String(settings.ebayOrderImportLimit ?? 250)} onChange={(event) => update("ebayOrderImportLimit", Number(event.target.value || 250))} /></Field>
                <ToggleField label="Include canceled eBay orders" checked={Boolean(settings.ebayOrderImportIncludeCanceled)} disabled={!editing} onCheckedChange={(value) => update("ebayOrderImportIncludeCanceled", value)} />
                <Field label="Order import schedule"><Select disabled={!editing} value={String(settings.ebayOrderImportScheduleType || "times")} onValueChange={(value) => update("ebayOrderImportScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></Field>
                <Field label="First scheduled import"><Input disabled={!editing} type="time" value={ebayOrderImportScheduleTimes[0] || "05:00"} onChange={(event) => update("ebayOrderImportScheduleTimes", [event.target.value, ebayOrderImportScheduleTimes[1] || "17:00"].join(","))} /></Field>
                <Field label="Second scheduled import"><Input disabled={!editing} type="time" value={ebayOrderImportScheduleTimes[1] || "17:00"} onChange={(event) => update("ebayOrderImportScheduleTimes", [ebayOrderImportScheduleTimes[0] || "05:00", event.target.value].join(","))} /></Field>
                <Field label="Import every hours"><Input disabled={!editing} type="number" min="1" max="24" value={String(settings.ebayOrderImportScheduleEveryHours ?? 12)} onChange={(event) => update("ebayOrderImportScheduleEveryHours", Number(event.target.value || 12))} /></Field>
                <ToggleField label="Schedule eBay order imports" checked={Boolean(settings.ebayOrderImportScheduleEnabled)} disabled={!editing || !Boolean(settings.ebayOrderImportEnabled)} onCheckedChange={(value) => update("ebayOrderImportScheduleEnabled", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">eBay returns</p><p className="pt-1 text-xs text-muted-foreground">Import channel returns/refunds from eBay Post-Order and link them to DataPlus orders for reporting and local return receiving.</p></div>
                <Field label="Return sync lookback days"><Select disabled={!editing || !Boolean(settings.ebayReturnSyncEnabled)} value={String(settings.ebayReturnSyncLookbackDays ?? 90)} onValueChange={(value) => update("ebayReturnSyncLookbackDays", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 180 days</SelectItem><SelectItem value="365">Last 365 days</SelectItem><SelectItem value="548">Last 18 months</SelectItem></SelectContent></Select></Field>
                <Field label="Returns per import"><Input disabled={!editing || !Boolean(settings.ebayReturnSyncEnabled)} type="number" min="1" max="10000" value={String(settings.ebayReturnSyncLimit ?? 1000)} onChange={(event) => update("ebayReturnSyncLimit", Number(event.target.value || 1000))} /></Field>
                <ToggleField label="Schedule eBay return reconciliation" checked={settings.ebayReturnSyncScheduleEnabled !== false} disabled={!editing || !Boolean(settings.ebayReturnSyncEnabled)} onCheckedChange={(value) => update("ebayReturnSyncScheduleEnabled", value)} />
                <Field label="Return schedule"><Select disabled={!editing || !Boolean(settings.ebayReturnSyncEnabled)} value={String(settings.ebayReturnSyncScheduleType || "interval")} onValueChange={(value) => update("ebayReturnSyncScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></Field>
                {String(settings.ebayReturnSyncScheduleType || "interval") === "interval"
                  ? <Field label="Reconcile returns every hours"><Input disabled={!editing || !Boolean(settings.ebayReturnSyncEnabled)} type="number" min="1" max="24" value={String(settings.ebayReturnSyncScheduleEveryHours ?? 2)} onChange={(event) => update("ebayReturnSyncScheduleEveryHours", Number(event.target.value || 2))} /></Field>
                  : <Field label="Return reconciliation times"><Input disabled={!editing || !Boolean(settings.ebayReturnSyncEnabled)} value={String(settings.ebayReturnSyncScheduleTimes || "03:00,15:00")} placeholder="03:00,15:00" onChange={(event) => update("ebayReturnSyncScheduleTimes", event.target.value)} /></Field>}
              </>}
              {isTemu && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Temu API credentials</p><p className="pt-1 text-xs text-muted-foreground">Save the Temu Seller API request URL, app key, and app secret here. Use the Connection tab when you need to connect or reconnect the mall account.</p></div>
                <Field label="API request URL"><Input disabled={!editing} value={String(settings.temuEndpoint || "https://openapi-b-us.temu.com/openapi/router")} onChange={(event) => update("temuEndpoint", event.target.value)} /></Field>
                <Field label="Seller authorization URL"><Input disabled={!editing} value={String(settings.temuAuthorizationUrl || "https://seller.temu.com/open-platform/client-manage/authorization")} onChange={(event) => update("temuAuthorizationUrl", event.target.value)} /></Field>
                <Field label="App key"><Input disabled={!editing} value={String(settings.temuAppKey || "")} placeholder={temuAppKeyConfigured ? "Configured - enter a value only to replace it" : "Required"} onChange={(event) => update("temuAppKey", event.target.value)} /></Field>
                <Field label="App secret"><Input disabled={!editing} type="password" value={String(settings.temuAppSecret || "")} placeholder={temuAppSecretConfigured ? "Configured - enter a value only to replace it" : "Required"} onChange={(event) => update("temuAppSecret", event.target.value)} /></Field>
                <Field label="Access token override"><Input disabled={!editing} type="password" value={String(settings.temuAccessToken || "")} placeholder={temuGeneratedTokenLabel} onChange={(event) => update("temuAccessToken", event.target.value)} /><p className="text-xs text-muted-foreground">Usually generated by Connect Temu. Manual values are saved into Temu channel settings.</p></Field>
                <Field label="Mall ID"><Input disabled value={String(settings.temuMallId || "")} placeholder="Generated by Temu after connection" readOnly /><p className="text-xs text-muted-foreground">Auto-populated from Temu when available.</p></Field>
                <Field label="Order page size"><Input disabled={!editing} type="number" min="1" max="100" value={String(settings.temuOrderPageSize ?? 50)} onChange={(event) => update("temuOrderPageSize", Number(event.target.value || 50))} /></Field>
                <Field label="OAuth callback URL"><Input disabled value={`${window.location.origin}/auth/temu/callback`} readOnly /></Field>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Temu API controls</p><p className="pt-1 text-xs text-muted-foreground">Pause each Temu API workflow independently from the master channel switch.</p></div>
                <ToggleField label="Sync product catalog" checked={Boolean(settings.temuProductSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuProductSyncEnabled", value)} />
                <ToggleField label="Sync listings" checked={Boolean(settings.temuListingSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuListingSyncEnabled", value)} />
                <ToggleField label="Launch listings" checked={Boolean(settings.temuListingLaunchEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuListingLaunchEnabled", value)} />
                <ToggleField label="Sync category catalog" checked={Boolean(settings.temuCatalogSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuCatalogSyncEnabled", value)} />
                <ToggleField label="Apply inventory" checked={Boolean(settings.temuInventorySyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuInventorySyncEnabled", value)} />
                <ToggleField label="Apply prices" checked={Boolean(settings.temuPriceSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuPriceSyncEnabled", value)} />
                <ToggleField label="Upload tracking" checked={Boolean(settings.temuTrackingUploadEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuTrackingUploadEnabled", value)} />
                <ToggleField label="Sync fulfillment status" checked={Boolean(settings.temuFulfillmentSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuFulfillmentSyncEnabled", value)} />
                <ToggleField label="Notify cancellations" checked={Boolean(settings.temuCancellationNotificationEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuCancellationNotificationEnabled", value)} />
                <ToggleField label="Sync returns" checked={Boolean(settings.temuReturnSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuReturnSyncEnabled", value)} />
                <ToggleField label="Sync refunds" checked={Boolean(settings.temuRefundSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuRefundSyncEnabled", value)} />
                <ToggleField label="Receive webhooks" checked={Boolean(settings.temuWebhookEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuWebhookEnabled", value)} />
                <Field label="Webhook endpoint"><Input disabled={!editing} value={String(settings.temuWebhookEndpoint || `${window.location.origin}/api/webhooks/temu`)} onChange={(event) => update("temuWebhookEndpoint", event.target.value)} /></Field>
                <ToggleField label="Webhook secret configured" checked={Boolean(settings.temuWebhookSecretConfigured)} disabled={!editing} onCheckedChange={(value) => update("temuWebhookSecretConfigured", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Temu inventory and pricing</p></div>
                <Field label="Inventory mode"><Select disabled={!editing} value={String(settings.temuInventoryMode || "available")} onValueChange={(value) => update("temuInventoryMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="available">Use available inventory</SelectItem><SelectItem value="fixed">Use fixed channel quantity</SelectItem><SelectItem value="disabled">Do not send inventory</SelectItem></SelectContent></Select></Field>
                <Field label="Inventory safety qty"><Input disabled={!editing} type="number" min="0" value={String(settings.temuInventorySafetyQty ?? 0)} onChange={(event) => update("temuInventorySafetyQty", Number(event.target.value || 0))} /></Field>
                <Field label="Default Temu ship-from warehouse"><div className="flex gap-2"><Select disabled={!editing || temuWarehousesLoading || !temuWarehouses.length} value={String(settings.temuDefaultWarehouseId || "none")} onValueChange={(value) => update("temuDefaultWarehouseId", value === "none" ? "" : value)}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder={temuWarehousesLoading ? "Loading Temu warehouses..." : "Select Temu warehouse"} /></SelectTrigger><SelectContent><SelectItem value="none">No default selected</SelectItem>{temuWarehouses.map((warehouse) => <SelectItem key={`connection-temu-${warehouse.id}`} value={warehouse.id}>{warehouse.name}{warehouse.isDefault ? " (Temu default)" : ""} · {warehouse.id}</SelectItem>)}</SelectContent></Select><Button type="button" size="icon" variant="outline" title="Refresh Temu warehouses" disabled={temuWarehousesLoading} onClick={() => void loadTemuWarehouses()}>{temuWarehousesLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button></div><p className="text-xs text-muted-foreground">Loaded from Temu and sent as the ship-from warehouse on labels and tracking confirmations.</p></Field>
                <Field label="Price formula"><Select disabled={!editing} value={String(settings.temuPricingMode || "cost-plus")} onValueChange={(value) => update("temuPricingMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cost-plus">Cost plus markup</SelectItem><SelectItem value="higher-of-product-or-cost">Higher of catalog price or cost formula</SelectItem><SelectItem value="product-price">Use catalog price</SelectItem></SelectContent></Select></Field>
                <Field label="Price markup percent"><Input disabled={!editing} type="number" min="0" max="1000" value={String(settings.temuPriceMarkupPercent ?? 60)} onChange={(event) => update("temuPriceMarkupPercent", Number(event.target.value || 0))} /></Field>
                <Field label="Minimum margin percent"><Input disabled={!editing} type="number" min="0" max="99" value={String(settings.temuMinMarginPercent ?? 0)} onChange={(event) => update("temuMinMarginPercent", Number(event.target.value || 0))} /></Field>
                <Field label="Minimum Temu price"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(settings.temuMinimumPrice ?? 0)} onChange={(event) => update("temuMinimumPrice", Number(event.target.value || 0))} /></Field>
                <Field label="Temu rounding rule"><Select disabled={!editing} value={String(settings.temuRoundingRule || "none")} onValueChange={(value) => update("temuRoundingRule", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No rounding</SelectItem><SelectItem value="nearest .99">Nearest .99</SelectItem><SelectItem value="nearest .95">Nearest .95</SelectItem><SelectItem value="round up">Round up</SelectItem></SelectContent></Select></Field>
                <Field label="Currency"><Input disabled={!editing} value={String(settings.temuDefaultCurrency || "USD")} onChange={(event) => update("temuDefaultCurrency", event.target.value.toUpperCase())} /></Field>
                <ToggleField label="Import orders" checked={Boolean(settings.temuOrderImportEnabled)} disabled={!editing} onCheckedChange={(value) => update("temuOrderImportEnabled", value)} />
                <Field label="Import orders from date"><Input disabled={!editing} type="date" value={String(settings.temuOrderImportStartDate || "")} onChange={(event) => update("temuOrderImportStartDate", event.target.value)} /></Field>
                <ToggleField label="Include canceled Temu orders" checked={Boolean(settings.temuOrderImportIncludeCanceled)} disabled={!editing} onCheckedChange={(value) => update("temuOrderImportIncludeCanceled", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Temu order import</p><p className="pt-1 text-xs text-muted-foreground">Import a selected history window on demand, then keep recent Temu orders synchronized on a schedule.</p></div>
                <Field label="Manual import lookback days"><Select disabled={!editing} value={String(settings.temuOrderImportLookbackDays ?? 30)} onValueChange={(value) => update("temuOrderImportLookbackDays", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Last 24 hours</SelectItem><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 180 days</SelectItem><SelectItem value="365">Last 365 days</SelectItem></SelectContent></Select></Field>
                <Field label="Orders per import"><Input disabled={!editing} type="number" min="1" max="5000" value={String(settings.temuOrderImportLimit ?? 250)} onChange={(event) => update("temuOrderImportLimit", Number(event.target.value || 250))} /></Field>
                <Field label="Order import schedule"><Select disabled={!editing} value={String(settings.temuOrderImportScheduleType || "times")} onValueChange={(value) => update("temuOrderImportScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></Field>
                <Field label="First scheduled import"><Input disabled={!editing} type="time" value={temuOrderImportScheduleTimes[0] || "05:00"} onChange={(event) => update("temuOrderImportScheduleTimes", [event.target.value, temuOrderImportScheduleTimes[1] || "17:00"].join(","))} /></Field>
                <Field label="Second scheduled import"><Input disabled={!editing} type="time" value={temuOrderImportScheduleTimes[1] || "17:00"} onChange={(event) => update("temuOrderImportScheduleTimes", [temuOrderImportScheduleTimes[0] || "05:00", event.target.value].join(","))} /></Field>
                <Field label="Import every hours"><Input disabled={!editing} type="number" min="1" max="24" value={String(settings.temuOrderImportScheduleEveryHours ?? 12)} onChange={(event) => update("temuOrderImportScheduleEveryHours", Number(event.target.value || 12))} /></Field>
                <ToggleField label="Schedule Temu order imports" checked={Boolean(settings.temuOrderImportScheduleEnabled)} disabled={!editing || !Boolean(settings.temuOrderImportEnabled)} onCheckedChange={(value) => update("temuOrderImportScheduleEnabled", value)} />
                {([['temuOrderStatus', 'Status reconciliation'], ['temuOrderEnrichment', 'Order enrichment']] as const).map(([prefix, label]) => <section key={prefix} className="col-span-full grid gap-3 border-t pt-4 sm:grid-cols-2">
                  <h4 className="col-span-full text-sm font-semibold">{label}</h4>
                  <ToggleField label={`Schedule ${label.toLowerCase()}`} checked={Boolean(settings[`${prefix}ScheduleEnabled`])} disabled={!editing || !settings.temuOrderImportEnabled} onCheckedChange={value => update(`${prefix}ScheduleEnabled`, value)} />
                  <Field label="Every hours"><Input disabled={!editing} type="number" min="1" max="24" value={String(settings[`${prefix}ScheduleEveryHours`] ?? 12)} onChange={event => update(`${prefix}ScheduleEveryHours`, Number(event.target.value))} /></Field>
                  <Field label="Lookback days"><Input disabled={!editing} type="number" min="1" max="365" value={String(settings[`${prefix}LookbackDays`] ?? 7)} onChange={event => update(`${prefix}LookbackDays`, Number(event.target.value))} /></Field>
                  <Field label="Orders per job"><Input disabled={!editing} type="number" min="1" max="5000" value={String(settings[`${prefix}Limit`] ?? 250)} onChange={event => update(`${prefix}Limit`, Number(event.target.value))} /></Field>
                </section>)}
                <section className="col-span-full grid gap-3 border-t pt-4 sm:grid-cols-2">
                  <div className="col-span-full"><h4 className="text-sm font-semibold">Temu returns</h4><p className="pt-1 text-xs text-muted-foreground">Re-import a rolling window so new cases and later status changes remain linked to their channel orders.</p></div>
                  <ToggleField label="Schedule Temu return reconciliation" checked={settings.temuReturnSyncScheduleEnabled !== false} disabled={!editing || !Boolean(settings.temuReturnSyncEnabled)} onCheckedChange={(value) => update("temuReturnSyncScheduleEnabled", value)} />
                  <Field label="Lookback days"><Input disabled={!editing || !Boolean(settings.temuReturnSyncEnabled)} type="number" min="1" max="365" value={String(settings.temuReturnSyncLookbackDays ?? 30)} onChange={(event) => update("temuReturnSyncLookbackDays", Number(event.target.value || 30))} /></Field>
                  <Field label="Return schedule"><Select disabled={!editing || !Boolean(settings.temuReturnSyncEnabled)} value={String(settings.temuReturnSyncScheduleType || "interval")} onValueChange={(value) => update("temuReturnSyncScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></Field>
                  {String(settings.temuReturnSyncScheduleType || "interval") === "interval"
                    ? <Field label="Reconcile returns every hours"><Input disabled={!editing || !Boolean(settings.temuReturnSyncEnabled)} type="number" min="1" max="24" value={String(settings.temuReturnSyncScheduleEveryHours ?? 2)} onChange={(event) => update("temuReturnSyncScheduleEveryHours", Number(event.target.value || 2))} /></Field>
                    : <Field label="Return reconciliation times"><Input disabled={!editing || !Boolean(settings.temuReturnSyncEnabled)} value={String(settings.temuReturnSyncScheduleTimes || "03:00,15:00")} placeholder="03:00,15:00" onChange={(event) => update("temuReturnSyncScheduleTimes", event.target.value)} /></Field>}
                </section>
              </>}
              {isWhatnot && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Whatnot Seller API</p><p className="pt-1 text-xs text-muted-foreground">Whatnot is GraphQL-based and currently gated by Seller API access. Store secrets in runtime credentials before enabling live jobs.</p></div>
                <Field label="Environment"><Select disabled={!editing} value={String(settings.whatnotApiEnvironment || "staging")} onValueChange={(value) => { update("whatnotApiEnvironment", value); update("whatnotGraphqlEndpoint", value === "production" ? "https://api.whatnot.com/seller-api/graphql" : "https://api.stage.whatnot.com/seller-api/graphql") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="staging">Staging</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent></Select></Field>
                <Field label="GraphQL endpoint"><Input disabled={!editing} value={String(settings.whatnotGraphqlEndpoint || "https://api.stage.whatnot.com/seller-api/graphql")} onChange={(event) => update("whatnotGraphqlEndpoint", event.target.value)} /></Field>
                <Field label="Auth mode"><Select disabled={!editing} value={String(settings.whatnotAuthMode || "seller-api-key")} onValueChange={(value) => update("whatnotAuthMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="seller-api-key">Seller API key</SelectItem><SelectItem value="oauth">OAuth partner app</SelectItem></SelectContent></Select></Field>
                <Field label="OAuth client ID"><Input disabled={!editing || settings.whatnotAuthMode !== "oauth"} value={String(settings.whatnotOAuthClientId || "")} placeholder="Provided by Whatnot" onChange={(event) => update("whatnotOAuthClientId", event.target.value)} /></Field>
                <Field label="OAuth redirect URI"><Input disabled={!editing || settings.whatnotAuthMode !== "oauth"} value={String(settings.whatnotOAuthRedirectUri || `${window.location.origin}/auth/whatnot/callback`)} onChange={(event) => update("whatnotOAuthRedirectUri", event.target.value)} /></Field>
                <div className="col-span-full grid gap-2 rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium">Requested API scopes</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{whatnotAvailableScopes.map((scope) => <label key={scope} className="flex items-center gap-2 rounded border bg-background p-2 text-sm"><Checkbox disabled={!editing} checked={whatnotScopes.includes(scope)} onCheckedChange={(checked) => updateStringList("whatnotScopes", whatnotScopes, scope, checked === true)} /><span className="font-mono text-xs">{scope}</span></label>)}</div>
                </div>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Enabled Whatnot features</p></div>
                <ToggleField label="Sync products" checked={Boolean(settings.whatnotProductSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotProductSyncEnabled", value)} />
                <ToggleField label="Sync listings" checked={Boolean(settings.whatnotListingSyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotListingSyncEnabled", value)} />
                <ToggleField label="Sync inventory quantity" checked={Boolean(settings.whatnotInventorySyncEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotInventorySyncEnabled", value)} />
                <ToggleField label="Import orders" checked={Boolean(settings.whatnotOrderImportEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotOrderImportEnabled", value)} />
                <ToggleField label="Upload tracking" checked={Boolean(settings.whatnotTrackingUploadEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotTrackingUploadEnabled", value)} />
                <ToggleField label="Generate labels" checked={Boolean(settings.whatnotShipmentLabelEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotShipmentLabelEnabled", value)} />
                <ToggleField label="Use bulk operations" checked={settings.whatnotBulkOperationsEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("whatnotBulkOperationsEnabled", value)} />
                <ToggleField label="Sync taxonomy" checked={settings.whatnotTaxonomySyncEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("whatnotTaxonomySyncEnabled", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Whatnot webhooks</p><p className="pt-1 text-xs text-muted-foreground">Whatnot signs events with X-Whatnot-Webhook-Signature. During Developer Preview, subscriptions must be requested from Whatnot with the endpoint and topic list.</p></div>
                <Field label="Webhook endpoint"><Input disabled={!editing} value={whatnotWebhookEndpoint} placeholder={whatnotDefaultWebhookEndpoint} onChange={(event) => update("whatnotWebhookEndpoint", event.target.value)} /></Field>
                <ToggleField label="Enable signed webhook processing" checked={Boolean(settings.whatnotWebhookEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotWebhookEnabled", value)} />
                <ToggleField label="Webhook secret configured" checked={Boolean(settings.whatnotWebhookSecretConfigured)} disabled={!editing} onCheckedChange={(value) => update("whatnotWebhookSecretConfigured", value)} />
                <div className="col-span-full grid gap-2 rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium">Subscribed topics</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{whatnotAvailableWebhookTopics.map((topic) => <label key={topic} className="flex items-center gap-2 rounded border bg-background p-2 text-sm"><Checkbox disabled={!editing} checked={whatnotWebhookTopics.includes(topic)} onCheckedChange={(checked) => updateStringList("whatnotWebhookTopics", whatnotWebhookTopics, topic, checked === true)} /><span className="font-mono text-xs">{topic}</span></label>)}</div>
                </div>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Order import</p></div>
                <Field label="Manual import lookback days"><Input disabled={!editing} type="number" min="1" max="365" value={String(settings.whatnotOrderImportLookbackDays ?? 30)} onChange={(event) => update("whatnotOrderImportLookbackDays", Number(event.target.value || 30))} /></Field>
                <Field label="Orders per import"><Input disabled={!editing} type="number" min="1" max="5000" value={String(settings.whatnotOrderImportLimit ?? 250)} onChange={(event) => update("whatnotOrderImportLimit", Number(event.target.value || 250))} /></Field>
                <Field label="Import schedule"><Select disabled={!editing} value={String(settings.whatnotOrderImportScheduleType || "times")} onValueChange={(value) => update("whatnotOrderImportScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></Field>
                <Field label="First scheduled import"><Input disabled={!editing} type="time" value={whatnotOrderImportScheduleTimes[0] || "05:00"} onChange={(event) => update("whatnotOrderImportScheduleTimes", [event.target.value, whatnotOrderImportScheduleTimes[1] || "17:00"].join(","))} /></Field>
                <Field label="Second scheduled import"><Input disabled={!editing} type="time" value={whatnotOrderImportScheduleTimes[1] || "17:00"} onChange={(event) => update("whatnotOrderImportScheduleTimes", [whatnotOrderImportScheduleTimes[0] || "05:00", event.target.value].join(","))} /></Field>
                <Field label="Import every hours"><Input disabled={!editing} type="number" min="1" max="24" value={String(settings.whatnotOrderImportScheduleEveryHours ?? 12)} onChange={(event) => update("whatnotOrderImportScheduleEveryHours", Number(event.target.value || 12))} /></Field>
                <ToggleField label="Schedule Whatnot order imports" checked={Boolean(settings.whatnotOrderImportScheduleEnabled)} disabled={!editing || !Boolean(settings.whatnotOrderImportEnabled)} onCheckedChange={(value) => update("whatnotOrderImportScheduleEnabled", value)} />
                <Field label="Bulk poll seconds"><Input disabled={!editing || settings.whatnotBulkOperationsEnabled === false} type="number" min="5" max="300" value={String(settings.whatnotBulkOperationPollSeconds ?? 30)} onChange={(event) => update("whatnotBulkOperationPollSeconds", Number(event.target.value || 30))} /></Field>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Product and live selling defaults</p></div>
                <Field label="Default listing type"><Select disabled={!editing} value={String(settings.whatnotDefaultListingType || "buy_it_now")} onValueChange={(value) => update("whatnotDefaultListingType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="buy_it_now">Buy it now</SelectItem><SelectItem value="auction">Auction</SelectItem><SelectItem value="giveaway">Giveaway</SelectItem></SelectContent></Select></Field>
                <Field label="Default condition"><Input disabled={!editing} value={String(settings.whatnotDefaultCondition || "NEW")} onChange={(event) => update("whatnotDefaultCondition", event.target.value)} /></Field>
                <Field label="Default shipping profile ID"><Input disabled={!editing} value={String(settings.whatnotDefaultShippingProfileId || "")} placeholder="Whatnot ShippingProfile ID" onChange={(event) => update("whatnotDefaultShippingProfileId", event.target.value)} /></Field>
                <Field label="Default livestream ID"><Input disabled={!editing} value={String(settings.whatnotDefaultLivestreamId || "")} placeholder="Optional Whatnot Livestream ID" onChange={(event) => update("whatnotDefaultLivestreamId", event.target.value)} /></Field>
                <ToggleField label="Auto-create shipping profiles" checked={settings.whatnotAutoCreateShippingProfile !== false} disabled={!editing} onCheckedChange={(value) => update("whatnotAutoCreateShippingProfile", value)} />
                <ToggleField label="Require shipping profile before publish" checked={settings.whatnotRequireShippingProfile !== false} disabled={!editing} onCheckedChange={(value) => update("whatnotRequireShippingProfile", value)} />
                <ToggleField label="Auto-publish listings" checked={Boolean(settings.whatnotAutoPublishListings)} disabled={!editing} onCheckedChange={(value) => update("whatnotAutoPublishListings", value)} />
                <ToggleField label="Assign listings to livestream" checked={Boolean(settings.whatnotAssignListingsToLivestream)} disabled={!editing} onCheckedChange={(value) => update("whatnotAssignListingsToLivestream", value)} />
                <ToggleField label="Auction sudden death" checked={Boolean(settings.whatnotAuctionSuddenDeathEnabled)} disabled={!editing} onCheckedChange={(value) => update("whatnotAuctionSuddenDeathEnabled", value)} />
              </>}
              </fieldset>
            </CardContent>
          </Card>
          <Dialog open={credentialsOpen} onOpenChange={setCredentialsOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>Update Shopify API credentials</DialogTitle><DialogDescription>Current connection settings are loaded below. Credential previews show only a few characters; leave a credential field blank to keep its current value.</DialogDescription></DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Store domain"><Input value={credentialDraft.storeDomain} placeholder="store.myshopify.com" onChange={(event) => setCredentialDraft({ ...credentialDraft, storeDomain: event.target.value })} /></Field>
                <Field label="Admin API version"><Input value={credentialDraft.apiVersion} placeholder="2026-04" onChange={(event) => setCredentialDraft({ ...credentialDraft, apiVersion: event.target.value })} /></Field>
                <Field label="Client ID"><Input value={credentialDraft.clientId} placeholder={credentials?.clientIdPreview || "Shopify app client ID"} onChange={(event) => setCredentialDraft({ ...credentialDraft, clientId: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">{credentials?.clientIdPreview ? `Current: ${credentials.clientIdPreview}. Enter a value only to replace it.` : "Not configured."}</p></Field>
                <Field label="Client secret"><Input type="password" autoComplete="new-password" value={credentialDraft.clientSecret} placeholder={credentials?.clientSecretPreview || "Shopify app client secret"} onChange={(event) => setCredentialDraft({ ...credentialDraft, clientSecret: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">{credentials?.clientSecretPreview ? `Current: ${credentials.clientSecretPreview}. Enter a value only to replace it.` : "Not configured."}</p></Field>
                <div className="sm:col-span-2"><Field label="Admin access token"><Input type="password" autoComplete="new-password" value={credentialDraft.accessToken} placeholder={credentials?.accessTokenPreview || "shpat_..."} onChange={(event) => setCredentialDraft({ ...credentialDraft, accessToken: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">{credentials?.accessTokenPreview ? `Current: ${credentials.accessTokenPreview}. Enter a value only to replace it.` : "Not configured. Client credentials are used when available."}</p></Field></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setCredentialsOpen(false)}>Cancel</Button><Button disabled={credentialSaving} onClick={() => void saveCredentials()}>{credentialSaving ? "Updating..." : "Update credentials"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={ebayCredentialsOpen} onOpenChange={setEbayCredentialsOpen}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader><DialogTitle>Update eBay API credentials</DialogTitle><DialogDescription>Credentials remain server-side and are masked after saving. Leave a secret blank to keep its current value. The Redirect URI name must be registered in eBay’s developer portal for this application.</DialogDescription></DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Environment"><Select value={ebayCredentialDraft.environment} onValueChange={(value) => setEbayCredentialDraft({ ...ebayCredentialDraft, environment: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="production">Production</SelectItem><SelectItem value="sandbox">Sandbox</SelectItem></SelectContent></Select></Field>
                <Field label="Redirect URI name (RuName)"><Input value={ebayCredentialDraft.ruName} placeholder="Your eBay RuName" onChange={(event) => setEbayCredentialDraft({ ...ebayCredentialDraft, ruName: event.target.value })} /></Field>
                <div className="sm:col-span-2"><Field label="OAuth scopes"><Input value={ebayCredentialDraft.scope} placeholder="https://api.ebay.com/oauth/api_scope ..." onChange={(event) => setEbayCredentialDraft({ ...ebayCredentialDraft, scope: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Current scopes are preloaded. Change these only when updating eBay app permissions.</p></Field></div>
                <Field label="Client ID"><Input value={ebayCredentialDraft.clientId} placeholder={ebayCredentials?.clientIdPreview || "eBay client ID"} onChange={(event) => setEbayCredentialDraft({ ...ebayCredentialDraft, clientId: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">{ebayCredentials?.clientIdPreview ? `Current: ${ebayCredentials.clientIdPreview}` : "Not configured."}</p></Field>
                <Field label="Client secret"><Input type="password" autoComplete="new-password" value={ebayCredentialDraft.clientSecret} placeholder={ebayCredentials?.clientSecretPreview || "eBay client secret"} onChange={(event) => setEbayCredentialDraft({ ...ebayCredentialDraft, clientSecret: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">{ebayCredentials?.clientSecretPreview ? `Current: ${ebayCredentials.clientSecretPreview}` : "Not configured."}</p></Field>
                <Field label="Refresh token (optional)"><Input type="password" autoComplete="new-password" value={ebayCredentialDraft.refreshToken} placeholder={ebayCredentials?.refreshTokenPreview || "Paste only to replace"} onChange={(event) => setEbayCredentialDraft({ ...ebayCredentialDraft, refreshToken: event.target.value })} /></Field>
                <Field label="Access token (optional)"><Input type="password" autoComplete="new-password" value={ebayCredentialDraft.accessToken} placeholder={ebayCredentials?.accessTokenPreview || "Paste only to replace"} onChange={(event) => setEbayCredentialDraft({ ...ebayCredentialDraft, accessToken: event.target.value })} /></Field>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setEbayCredentialsOpen(false)}>Cancel</Button><Button disabled={credentialSaving} onClick={() => void saveEbayCredentials()}>{credentialSaving ? "Updating..." : "Update credentials"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={ebayTemplatesOpen} onOpenChange={setEbayTemplatesOpen}>
            <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>eBay templates and advanced defaults</DialogTitle>
                <DialogDescription>These are reusable DataPlus templates. Apply them from a product's eBay workspace or use their IDs as channel defaults. Imported business policies remain the source of truth for payment, returns, and fulfillment.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Listing templates (JSON array)"><Textarea className="min-h-44 font-mono text-xs" value={ebayTemplateDraft.listingTemplates} onChange={(event) => setEbayTemplateDraft((current) => ({ ...current, listingTemplates: event.target.value }))} placeholder={'[{"id":"standard","name":"Standard","settings":{"ebayDefaultCondition":"NEW"}}]'} /><p className="mt-1 text-xs text-muted-foreground">Each template can contain an <code>id</code>, <code>name</code>, and <code>settings</code> object.</p></Field>
                <Field label="Item specifics templates (JSON array)"><Textarea className="min-h-44 font-mono text-xs" value={ebayTemplateDraft.itemSpecificTemplates} onChange={(event) => setEbayTemplateDraft((current) => ({ ...current, itemSpecificTemplates: event.target.value }))} placeholder={'[{"id":"tools","name":"Tools","aspects":{"Brand":["Example"]}}]'} /><p className="mt-1 text-xs text-muted-foreground">Use <code>aspects</code> to prefill eBay item specifics for a category family.</p></Field>
                <Field label="Store categories (JSON array)"><Textarea className="min-h-36 font-mono text-xs" value={ebayTemplateDraft.storeCategories} onChange={(event) => setEbayTemplateDraft((current) => ({ ...current, storeCategories: event.target.value }))} placeholder={'[{"id":"123","name":"Power Tools"}]'} /></Field>
                <Field label="Shipping method mappings (JSON array)"><Textarea className="min-h-36 font-mono text-xs" value={ebayTemplateDraft.shippingMethodMappings} onChange={(event) => setEbayTemplateDraft((current) => ({ ...current, shippingMethodMappings: event.target.value }))} placeholder={'[{"source":"Ground","policyId":"..."}]'} /></Field>
                <Field label="Buyer requirements (JSON object)"><Textarea className="min-h-36 font-mono text-xs" value={ebayTemplateDraft.buyerRequirements} onChange={(event) => setEbayTemplateDraft((current) => ({ ...current, buyerRequirements: event.target.value }))} placeholder={'{"blockBuyersWithUnpaidItems":false}'} /></Field>
                <Field label="Custom policies (JSON array)"><Textarea className="min-h-36 font-mono text-xs" value={ebayTemplateDraft.customPolicies} onChange={(event) => setEbayTemplateDraft((current) => ({ ...current, customPolicies: event.target.value }))} placeholder={'[{"id":"policy-1","name":"Marketplace note"}]'} /></Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEbayTemplatesOpen(false)} disabled={ebayTemplatesSaving}>Cancel</Button>
                <Button onClick={() => void saveEbayTemplateControls()} disabled={ebayTemplatesSaving}>{ebayTemplatesSaving && <Loader2 className="size-4 animate-spin" />} Save advanced defaults</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="actions">
          {!channelEnabled && <Alert variant="destructive" className="mb-4"><AlertCircle className="size-4" /><AlertTitle>Actions are paused</AlertTitle><AlertDescription>Enable this channel in Setup and save before running any connection, catalog, price, inventory, listing, or order action.</AlertDescription></Alert>}
          <div className={cn(!channelEnabled && "pointer-events-none opacity-50")}>
          {isShopify ? (
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Connection tools</CardTitle>
                  <CardDescription>Verify credentials, refresh access, and load Shopify configuration data without changing products.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button onClick={onCheckShopify}>Check connection</Button>
                  <Button variant="outline" onClick={onRefreshShopifyToken}>Request new token</Button>
                  <Button variant="outline" onClick={syncShippingProfiles}>Import shipping profiles</Button>
                  <Button variant="outline" onClick={() => queueShopifyAction("skuMap")}>Audit SKU pairs</Button>
                  <Button variant="outline" onClick={() => queueShopifyAction("status")}>Sync Shopify status</Button>
                  <Button variant="outline" disabled={!Boolean(settings.shopifyOrderImportEnabled)} onClick={() => queueShopifyAction("orderImport")}>Import Shopify orders</Button>
                  <Button variant="outline" disabled={!Boolean(settings.shopifyOrderImportEnabled) || !Boolean(settings.shopifyOrderWebhookEnabled)} onClick={() => queueShopifyAction("registerOrderWebhooks")}>Register order webhooks</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Catalog operations</CardTitle>
                  <CardDescription>Run dry runs first. Live actions ask for confirmation before queueing.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <ActionTile
                    title="Create products"
                    description="Create missing ready products in Shopify."
                    dryRunLabel="Create dry run"
                    applyLabel="Create live"
                    onDryRun={() => queueShopifyAction("createDryRun")}
                    onApply={() => queueShopifyAction("createApply", true)}
                  />
                  <ActionTile
                    title="Link existing"
                    description="Match live Shopify variants back to DataPlus SKUs."
                    dryRunLabel="Link dry run"
                    applyLabel="Link live"
                    onDryRun={() => queueShopifyAction("linkDryRun")}
                    onApply={() => queueShopifyAction("linkApply", true)}
                  />
                  <ActionTile
                    title="Product types"
                    description="Update product type and collection assignments."
                    dryRunLabel="Types dry run"
                    applyLabel="Push types"
                    onDryRun={() => queueShopifyAction("collectionsDryRun")}
                    onApply={() => queueShopifyAction("collectionsApply", true)}
                  />
                  <ActionTile
                    title="Taxonomy"
                    description="Push mapped Shopify/Google taxonomy values."
                    dryRunLabel="Taxonomy dry run"
                    applyLabel="Push taxonomy"
                    onDryRun={() => queueShopifyAction("taxonomyDryRun")}
                    onApply={() => queueShopifyAction("taxonomyApply", true)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pricing and inventory</CardTitle>
                  <CardDescription>Live pricing and inventory affect checkout. Review dry runs before applying.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <ActionTile
                    title="Variant prices"
                    description="Push DataPlus-calculated prices to linked Shopify variants."
                    dryRunLabel="Price dry run"
                    applyLabel="Push prices"
                    onDryRun={() => queueShopifyAction("priceDryRun")}
                    onApply={() => queueShopifyAction("priceApply", true)}
                  />
                  <ActionTile
                    title="Inventory"
                    description="Push DataPlus warehouse availability to Shopify inventory levels."
                    dryRunLabel="Inventory dry run"
                    applyLabel="Update inventory"
                    onDryRun={() => queueShopifyAction("inventoryDryRun")}
                    onApply={() => queueShopifyAction("inventoryApply", true)}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Checkout shipping eligibility</CardTitle>
                  <CardDescription>Classifies linked Shopify products as free shipping, paid parcel, or freight. The dry run exports every decision; applying updates tags and the delivery profiles selected in Rules.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <ActionTile
                    title="Shipping eligibility"
                    description={`Freight products use the configured $${Number(settings.shopifyFreightShippingRate || 240).toFixed(2)} checkout rate. Missing measurements never qualify for free shipping.`}
                    dryRunLabel="Review eligibility"
                    applyLabel="Apply profiles"
                    onDryRun={() => queueShopifyAction("shippingEligibilityDryRun")}
                    onApply={() => queueShopifyAction("shippingEligibilityApply", true)}
                  />
                </CardContent>
              </Card>
            </div>
          ) : isEbay ? (
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">eBay connection and sync</CardTitle>
                  <CardDescription>Authorize the seller account, then sync business policies, merchant locations, active listings, and orders into DataPlus.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button onClick={() => void runEbayAction("authorize")} disabled={!ebayCredentials?.configured}>{ebayCredentials?.hasSellerAuthorization ? "Reconnect eBay account" : "Sign in with eBay"}</Button>
                  <Button variant="outline" onClick={openEbayCredentials}>Update API credentials</Button>
                  <Button variant="outline" onClick={() => void runEbayAction("account")} disabled={!ebayCredentials?.hasSellerAuthorization}>Sync policies and locations</Button>
                  <Button variant="outline" onClick={() => void runEbayAction("catalog")} disabled={!ebayCredentials?.hasSellerAuthorization || settings.ebayCatalogSyncEnabled === false}>Run offer/status sync now</Button>
                  <Button variant="outline" onClick={() => void runEbayAction("priceInventory")} disabled={!ebayCredentials?.hasSellerAuthorization || (settings.ebayInventoryUpdateEnabled === false && settings.ebayPriceUpdateEnabled === false)}><RefreshCw className="size-4" />Sync listing price & inventory</Button>
                  <Button variant="outline" onClick={() => void runEbayAction("compliance")} disabled={!ebayCredentials?.hasSellerAuthorization}>Run listing compliance audit</Button>
                  <Button variant="outline" onClick={() => void runEbayAction("reconcile")} disabled={!ebayCredentials?.hasSellerAuthorization || settings.ebayTrackingUploadEnabled === false}>Reconcile fulfillment</Button>
                  <Button variant="outline" onClick={() => void refreshEbayHealth()} disabled={ebayHealthLoading}><RefreshCw className={cn("size-4", ebayHealthLoading && "animate-spin")} />Refresh health</Button>
                  <Button variant="outline" onClick={() => {
                    if (!settings.ebayOrderImportEnabled) {
                      toast.error("Enable eBay order imports in Setup before starting an import.")
                      return
                    }
                    openEbayOrderImport()
                  }} disabled={!ebayCredentials?.hasSellerAuthorization}>Import eBay orders</Button>
                  <Button variant="outline" onClick={() => {
                    if (!settings.ebayReturnSyncEnabled) {
                      toast.error("Enable eBay return sync in Setup before importing returns.")
                      return
                    }
                    void queueEbayReturnImport()
                  }} disabled={!ebayCredentials?.hasSellerAuthorization || ebayReturnImportSaving}>
                    {ebayReturnImportSaving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    Import eBay returns
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">eBay account health</CardTitle>
                  <CardDescription>Verify the connection, policy bundle, and automation switches before releasing or revising listings.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Detail label="Account" value={ebayHealth?.credentials?.hasSellerAuthorization ? "Seller authorized" : "Needs seller sign-in"} />
                  <Detail label="Defaults" value={ebayHealth?.defaultsReady ? "Location + policies ready" : "Complete policy defaults"} />
                  <Detail label="Health" value={String(ebayHealth?.account?.status || "not checked").replace(/_/g, " ")} />
                  <Detail label="Last policy sync" value={ebayHealth?.account?.lastSyncedAt ? new Date(String(ebayHealth.account.lastSyncedAt)).toLocaleString() : "Not synced"} />
                  <Detail label="Inventory updates" value={ebayHealth?.workflows?.inventoryUpdateEnabled ? "Enabled" : "Disabled"} />
                  <Detail label="Price updates" value={ebayHealth?.workflows?.priceUpdateEnabled ? "Enabled" : "Disabled"} />
                  <Detail label="Tracking upload" value={ebayHealth?.workflows?.trackingUploadEnabled ? "Enabled" : "Disabled"} />
                  <Detail label="Return sync" value={settings.ebayReturnSyncEnabled ? "Enabled" : "Disabled in Setup"} />
                  <Detail label="Webhook delivery" value={ebayHealth?.workflows?.webhookEnabled ? "Enabled" : "Disabled"} />
                  {ebayHealth?.account?.failures?.length ? <div className="col-span-full rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-medium">Account sync needs attention</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{ebayHealth.account.failures.slice(0, 4).map((failure) => <li key={failure}>{failure}</li>)}</ul></div> : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Local eBay category index</CardTitle>
                  <CardDescription>Mapping searches use the stored eBay marketplace tree first, so category lookups stay fast and do not call eBay on every search.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Detail label="Index status" value={ebayTaxonomyStatus?.indexed ? "Ready locally" : "Not downloaded"} />
                    <Detail label="Categories" value={numberLabel(Number(ebayTaxonomyStatus?.categoryCount || 0))} />
                    <Detail label="Tree version" value={String(ebayTaxonomyStatus?.categoryTreeVersion || ebayTaxonomyStatus?.categoryTreeId || "Not available")} />
                    <Detail label="Last refreshed" value={ebayTaxonomyStatus?.syncedAt ? new Date(String(ebayTaxonomyStatus.syncedAt)).toLocaleString() : "Not yet"} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => void runEbayAction("taxonomy")} disabled={!ebayCredentials?.configured || ebayTaxonomyStatusLoading}>
                      {ebayTaxonomyStatusLoading ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                      Refresh local categories
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void loadEbayTaxonomyStatus(true)} disabled={ebayTaxonomyStatusLoading}>
                      <RefreshCw className="size-4" />
                      Check index status
                    </Button>
                    <span className="text-xs text-muted-foreground">The refresh runs as a background job and saves a JSON index plus CSV category list.</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">eBay configuration at a glance</CardTitle>
                  <CardDescription>Account sync imports payment, return, and fulfillment policies. Active-listing sync pulls offers and inventory so DataPlus can identify live eBay SKUs before creating anything new.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-4">
                  <Detail label="Seller authorization" value={ebayCredentials?.hasSellerAuthorization ? "Connected" : "Authorize first"} />
                  <Detail label="Marketplace" value={String(settings.ebayMarketplaceId || "EBAY_US")} />
                  <Detail label="Catalog sync" value={settings.ebayCatalogSyncEnabled === false ? "Disabled in Setup" : "Enabled"} />
                  <Detail label="Order import" value={settings.ebayOrderImportEnabled ? "Enabled" : "Disabled in Setup"} />
                  <Detail label="Return sync" value={settings.ebayReturnSyncEnabled ? `Last ${settings.ebayReturnSyncLookbackDays || 90} days` : "Disabled in Setup"} />
                  <Detail label="Merchant locations" value={numberLabel(ebayMerchantLocations.length)} />
                  <Detail label="Payment policies" value={numberLabel(ebayPaymentPolicies.length)} />
                  <Detail label="Return policies" value={numberLabel(ebayReturnPolicies.length)} />
                  <Detail label="Shipping policies" value={numberLabel(ebayFulfillmentPolicies.length)} />
                </CardContent>
              </Card>
              <Dialog open={ebayOrderImportOpen} onOpenChange={setEbayOrderImportOpen}>
                <DialogContent className="sm:max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Import eBay orders</DialogTitle>
                    <DialogDescription>Choose the order history window for this run. The import is queued as a job and creates a downloadable result file.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Look back">
                      <Select value={ebayOrderImportDraft.lookbackDays} onValueChange={(value) => setEbayOrderImportDraft((current) => ({ ...current, lookbackDays: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Last 24 hours</SelectItem>
                          <SelectItem value="7">Last 7 days</SelectItem>
                          <SelectItem value="30">Last 30 days</SelectItem>
                          <SelectItem value="90">Last 90 days</SelectItem>
                          <SelectItem value="180">Last 180 days</SelectItem>
                          <SelectItem value="365">Last 365 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Import scope">
                      <Select value={ebayOrderImportDraft.limit} onValueChange={(value) => setEbayOrderImportDraft((current) => ({ ...current, limit: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All orders in selected period</SelectItem>
                          <SelectItem value="250">250 orders</SelectItem>
                          <SelectItem value="500">500 orders</SelectItem>
                          <SelectItem value="1000">1,000 orders</SelectItem>
                          <SelectItem value="2500">2,500 orders</SelectItem>
                          <SelectItem value="5000">5,000 orders</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="col-span-full flex items-center justify-between gap-4 rounded-md border bg-muted/35 p-3">
                      <div>
                        <p className="text-sm font-medium">Include canceled orders</p>
                        <p className="text-xs text-muted-foreground">Leave this off for the working order queue. Imported cancellations can still be reviewed when needed.</p>
                      </div>
                      <Switch checked={ebayOrderImportDraft.includeCanceled} onCheckedChange={(checked) => setEbayOrderImportDraft((current) => ({ ...current, includeCanceled: checked }))} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEbayOrderImportOpen(false)} disabled={ebayOrderImportSaving}>Cancel</Button>
                    <Button onClick={() => void queueEbayOrderImport()} disabled={ebayOrderImportSaving}>
                      {ebayOrderImportSaving && <Loader2 className="size-4 animate-spin" />} Import orders
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : isTemu ? (
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Temu order import</CardTitle>
                  <CardDescription>Import Temu orders into DataPlus as a background job. Seller SKUs and Temu product identifiers are preserved for catalog matching review.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Detail label="Connection" value={channel.connected ? "Connected" : "Not connected"} />
                  <Detail label="Order downloads" value={settings.orderDownloadEnabled === false ? "Disabled globally" : "Allowed"} />
                  <Detail label="Temu order import" value={settings.temuOrderImportEnabled ? "Enabled" : "Disabled in Setup"} />
                  <Detail label="Inventory sync" value={settings.temuInventorySyncEnabled ? "Enabled" : "Disabled"} />
                  <Detail label="Price sync" value={settings.temuPriceSyncEnabled ? "Enabled" : "Disabled"} />
                  <Detail label="Tracking upload" value={settings.temuTrackingUploadEnabled ? "Enabled" : "Disabled"} />
                  <Detail label="Listing sync" value={settings.temuListingSyncEnabled ? "Enabled" : "Disabled"} />
                  <Detail label="Latest order sync" value={dateLabel(temuLatestOrderSync)} />
                  <Detail label="Last blind-order repair" value={dateLabel(String(settings.temuLastBlindOrderRepairAt || ""))} />
                  <Detail label="Import mode" value={settings.temuOrderImportScheduleEnabled ? `Scheduled ${String(settings.temuOrderImportScheduleType || "times") === "interval" ? `every ${settings.temuOrderImportScheduleEveryHours || 12} hours` : `at ${temuOrderImportScheduleTimes.join(" and ") || "05:00 and 17:00"}`}` : "Manual only"} />
                  <Detail label="Generated token" value={temuCanRunLive ? "Available" : "Needed for live import"} />
                  <Detail label="Last connection test" value={dateLabel(temuConnectionVerifiedAt)} />
                </CardContent>
                <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
                  <p className="max-w-3xl text-xs text-muted-foreground">
                    {settings.temuOrderImportScheduleEnabled ? "The scheduler will queue Temu order imports at the configured times when the channel is enabled." : "Order import is manual until the Temu order import schedule is enabled in Setup."} {temuCanRunLive ? "The generated token is available for live Temu API calls." : "A generated Temu access token is still needed before live order downloads can complete."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={openTemuSetupGuide} disabled={!temuCanRunLive}>{temuSetupGuideLabel}</Button>
                    <Button variant="outline" onClick={() => {
                      if (settings.orderDownloadEnabled === false || !settings.temuOrderImportEnabled) {
                        toast.error("Enable order downloads and Temu order imports in Setup before repairing orders.")
                        return
                      }
                      if (!temuHasLiveToken) {
                        toast.error("Temu needs a generated access token before order repair can run.")
                        return
                      }
                      void queueTemuBlindOrderRepair()
                    }} disabled={temuOrderImportSaving}>Repair blind orders</Button>
                    <Button variant="outline" onClick={() => {
                      if (settings.orderDownloadEnabled === false || !settings.temuOrderImportEnabled) {
                        toast.error("Enable order downloads and Temu order imports in Setup before refreshing statuses.")
                        return
                      }
                      if (!temuHasLiveToken) {
                        toast.error("Temu needs a generated access token before status refresh can run.")
                        return
                      }
                      void queueTemuStatusRefresh()
                    }} disabled={temuOrderImportSaving}>Refresh statuses</Button>
                    <Button variant="outline" disabled={temuOrderImportSaving || !temuHasLiveToken || settings.orderDownloadEnabled === false || !settings.temuOrderImportEnabled} onClick={() => void queueTemuEnrichment()}>Enrich existing orders</Button>
                    <Button variant="outline" onClick={() => {
                      if (settings.orderDownloadEnabled === false) {
                        toast.error("Enable order downloads in Setup before starting a Temu import.")
                        return
                      }
                      if (!settings.temuOrderImportEnabled) {
                        toast.error("Enable Temu order imports in Setup before starting an import.")
                        return
                      }
                      if (!temuHasLiveToken) {
                        toast.error("Temu needs a generated access token before order imports can run.")
                        return
                      }
                      openTemuOrderImport()
                    }}>Import new Temu orders</Button>
                  </div>
                </CardFooter>
              </Card>
              <Dialog open={temuOrderImportOpen} onOpenChange={setTemuOrderImportOpen}>
                <DialogContent className="sm:max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Import Temu orders</DialogTitle>
                    <DialogDescription>Choose the order history window for this run. The import is queued as a job and creates a downloadable result file.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Look back">
                      <Select value={temuOrderImportDraft.lookbackDays} onValueChange={(value) => setTemuOrderImportDraft((current) => ({ ...current, lookbackDays: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Last 24 hours</SelectItem>
                          <SelectItem value="7">Last 7 days</SelectItem>
                          <SelectItem value="30">Last 30 days</SelectItem>
                          <SelectItem value="90">Last 90 days</SelectItem>
                          <SelectItem value="180">Last 180 days</SelectItem>
                          <SelectItem value="365">Last 365 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Import from date">
                      <Input type="date" value={temuOrderImportDraft.startDate} onChange={(event) => setTemuOrderImportDraft((current) => ({ ...current, startDate: event.target.value }))} />
                      <p className="text-xs text-muted-foreground">Optional hard start date. Leave blank to use the look-back window.</p>
                    </Field>
                    <Field label="Maximum orders">
                      <Select value={temuOrderImportDraft.limit} onValueChange={(value) => setTemuOrderImportDraft((current) => ({ ...current, limit: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="250">250 orders</SelectItem>
                          <SelectItem value="500">500 orders</SelectItem>
                          <SelectItem value="1000">1,000 orders</SelectItem>
                          <SelectItem value="2500">2,500 orders</SelectItem>
                          <SelectItem value="5000">5,000 orders</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 p-3 sm:col-span-2">
                      <div><p className="text-sm font-medium">Include canceled orders</p><p className="text-xs text-muted-foreground">Leave this off for the working order queue. Imported cancellations can still be reviewed when needed.</p></div>
                      <Switch checked={temuOrderImportDraft.includeCanceled} onCheckedChange={(checked) => setTemuOrderImportDraft((current) => ({ ...current, includeCanceled: checked }))} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTemuOrderImportOpen(false)} disabled={temuOrderImportSaving}>Cancel</Button>
                    <Button onClick={() => void queueTemuOrderImport()} disabled={temuOrderImportSaving}>
                      {temuOrderImportSaving && <Loader2 className="size-4 animate-spin" />} Import orders
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={temuSetupGuideOpen} onOpenChange={setTemuSetupGuideOpen}>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{temuSetupGuideCompleted ? "Relaunch Temu setup guide" : "Temu is connected. Choose what happens next."}</DialogTitle>
                    <DialogDescription>Connection only saves credentials. Select the first jobs and settings DataPlus should apply now.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4">
                    <div className="rounded-md border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold">Download Temu orders now</p>
                          <p className="text-xs text-muted-foreground">Queues a background order import job and saves these import defaults.</p>
                        </div>
                        <Switch checked={temuSetupGuideDraft.downloadOrders} onCheckedChange={(checked) => setTemuSetupGuideDraft((current) => ({ ...current, downloadOrders: checked }))} />
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Field label="Look back">
                          <Select value={temuSetupGuideDraft.lookbackDays} onValueChange={(value) => setTemuSetupGuideDraft((current) => ({ ...current, lookbackDays: value }))} disabled={!temuSetupGuideDraft.downloadOrders}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Last 24 hours</SelectItem>
                              <SelectItem value="7">Last 7 days</SelectItem>
                              <SelectItem value="30">Last 30 days</SelectItem>
                              <SelectItem value="90">Last 90 days</SelectItem>
                              <SelectItem value="180">Last 180 days</SelectItem>
                              <SelectItem value="365">Last 365 days</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Import from date">
                          <Input type="date" disabled={!temuSetupGuideDraft.downloadOrders} value={temuSetupGuideDraft.startDate} onChange={(event) => setTemuSetupGuideDraft((current) => ({ ...current, startDate: event.target.value }))} />
                          <p className="text-xs text-muted-foreground">Optional hard start date. Leave blank to use the look-back window.</p>
                        </Field>
                        <Field label="Maximum orders">
                          <Select value={temuSetupGuideDraft.limit} onValueChange={(value) => setTemuSetupGuideDraft((current) => ({ ...current, limit: value }))} disabled={!temuSetupGuideDraft.downloadOrders}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="250">250 orders</SelectItem>
                              <SelectItem value="500">500 orders</SelectItem>
                              <SelectItem value="1000">1,000 orders</SelectItem>
                              <SelectItem value="2500">2,500 orders</SelectItem>
                              <SelectItem value="5000">5,000 orders</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
                          <div>
                            <p className="text-sm font-medium">Include canceled orders</p>
                            <p className="text-xs text-muted-foreground">Usually off for the active order queue.</p>
                          </div>
                          <Switch disabled={!temuSetupGuideDraft.downloadOrders} checked={temuSetupGuideDraft.includeCanceled} onCheckedChange={(checked) => setTemuSetupGuideDraft((current) => ({ ...current, includeCanceled: checked }))} />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold">Keep downloading orders on a schedule</p>
                          <p className="text-xs text-muted-foreground">Saves a recurring Temu order import schedule after the first manual run.</p>
                        </div>
                        <Switch checked={temuSetupGuideDraft.enableSchedule} onCheckedChange={(checked) => setTemuSetupGuideDraft((current) => ({ ...current, enableSchedule: checked }))} />
                      </div>
                      <div className="mt-4 max-w-xs">
                        <Field label="Run every">
                          <Select value={temuSetupGuideDraft.scheduleEveryHours} onValueChange={(value) => setTemuSetupGuideDraft((current) => ({ ...current, scheduleEveryHours: value }))} disabled={!temuSetupGuideDraft.enableSchedule}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Every hour</SelectItem>
                              <SelectItem value="3">Every 3 hours</SelectItem>
                              <SelectItem value="6">Every 6 hours</SelectItem>
                              <SelectItem value="12">Every 12 hours</SelectItem>
                              <SelectItem value="24">Every 24 hours</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-4 rounded-md border p-4">
                      <div>
                        <p className="text-sm font-semibold">Prepare Temu SKU mapping</p>
                        <p className="text-xs text-muted-foreground">Enables Temu listing and category sync settings for mapping review. Product publish actions stay separate.</p>
                      </div>
                      <Switch checked={temuSetupGuideDraft.prepareSkuMapping} onCheckedChange={(checked) => setTemuSetupGuideDraft((current) => ({ ...current, prepareSkuMapping: checked }))} />
                    </div>
                    {!temuCanRunLive && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Generated token needed</AlertTitle><AlertDescription>Connect Temu first so DataPlus has a generated access token for live imports.</AlertDescription></Alert>}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTemuSetupGuideOpen(false)} disabled={temuSetupGuideSaving}>Not now</Button>
                    <Button onClick={() => void runTemuSetupGuide()} disabled={temuSetupGuideSaving || !temuCanRunLive}>
                      {temuSetupGuideSaving && <Loader2 className="size-4 animate-spin" />} Run selected steps
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Run channel operation</CardTitle>
                <CardDescription>Review completed and active channel operations from the Jobs workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline"><a href="/jobs">View channel jobs</a></Button>
              </CardContent>
            </Card>
          )}
          </div>
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Channel defaults and operating rules</CardTitle>
              <CardDescription>Reusable defaults applied when DataPlus prepares products, inventory, and fulfillment for this channel.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="col-span-full pt-1"><p className="text-sm font-semibold">Product and fulfillment defaults</p></div>
              <Field label="Default shadow status">
                <Select disabled={!editing} value={String(settings.defaultShadowStatus || "Draft")} onValueChange={(value) => update("defaultShadowStatus", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Draft">Draft</SelectItem><SelectItem value="Active">Active</SelectItem><SelectItem value="Archived">Archived</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Default handling days"><Input disabled={!editing} type="number" value={String(settings.defaultHandlingTimeDays ?? 0)} onChange={(event) => update("defaultHandlingTimeDays", Number(event.target.value || 0))} /></Field>
              <Field label="Default safety qty"><Input disabled={!editing} type="number" value={String(settings.defaultSafetyQty ?? 0)} onChange={(event) => update("defaultSafetyQty", Number(event.target.value || 0))} /></Field>
              <Field label="Default replenishable qty"><Input disabled={!editing} type="number" min="1" value={String(settings.defaultReplenishableQty ?? 1)} onChange={(event) => update("defaultReplenishableQty", Math.max(1, Number(event.target.value || 1)))} /><p className="text-xs text-muted-foreground">Published when a replenishable SKU has no SKU or vendor quantity.</p></Field>
              <Field label="Default max sellable qty"><Input disabled={!editing} type="number" value={String(settings.defaultMaxSellableQty ?? 0)} onChange={(event) => update("defaultMaxSellableQty", Number(event.target.value || 0))} /></Field>
              <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Replenishable inventory protection</p><p className="pt-1 text-xs text-muted-foreground">A replenishable target is a channel promise, not warehouse stock. These checks can temporarily send zero without changing physical inventory or disabling the SKU.</p></div>
              <ToggleField label="Enable safeguards" description="Suspend replenishable quantity when a reliable vendor or SKU risk is detected." checked={settings.replenishableSafeguardsEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("replenishableSafeguardsEnabled", value)} />
              <ToggleField label="Require a recent vendor feed" description="Use the most recent saved inventory timestamp when one is available." checked={settings.replenishableRequireFreshVendorFeed !== false} disabled={!editing || settings.replenishableSafeguardsEnabled === false} onCheckedChange={(value) => update("replenishableRequireFreshVendorFeed", value)} />
              <ToggleField label="Block vendor-unavailable SKUs" description="Send zero when the vendor explicitly marks the item unavailable." checked={settings.replenishableBlockVendorUnavailable !== false} disabled={!editing || settings.replenishableSafeguardsEnabled === false} onCheckedChange={(value) => update("replenishableBlockVendorUnavailable", value)} />
              <Field label="Maximum feed age (hours)"><Input disabled={!editing || settings.replenishableSafeguardsEnabled === false || settings.replenishableRequireFreshVendorFeed === false} type="number" min="0" value={String(settings.replenishableFeedMaxAgeHours ?? 36)} onChange={(event) => update("replenishableFeedMaxAgeHours", Math.max(0, Number(event.target.value || 0)))} /><p className="text-xs text-muted-foreground">Set 0 to disable the age check. Missing timestamps are shown for review but do not block.</p></Field>
              <Field label="Maximum 30-day daily velocity"><Input disabled={!editing || settings.replenishableSafeguardsEnabled === false} type="number" min="0" step="0.1" value={String(settings.replenishableMaxDailyVelocity ?? 0)} onChange={(event) => update("replenishableMaxDailyVelocity", Math.max(0, Number(event.target.value || 0)))} /><p className="text-xs text-muted-foreground">Set 0 to disable. Higher velocity suspends unlimited inventory until reviewed.</p></Field>
              {isShopify && <Field label="Shopify replenishable location"><Select disabled={!editing} value={String(settings.shopifyReplenishableLocationId || "default")} onValueChange={(value) => { const mapping = shopifyWarehouseMappings.find((row) => row.destinationLocationId === value); update("shopifyReplenishableLocationId", value === "default" ? "" : value); update("shopifyReplenishableLocationName", value === "default" ? "" : String(mapping?.destinationLocationName || "")) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Use normal inventory location</SelectItem>{shopifyWarehouseMappings.filter((row) => row.enabled !== false && row.destinationLocationId).map((row) => <SelectItem key={`replenishable-${row.id || row.destinationLocationId}`} value={String(row.destinationLocationId)}>{row.destinationLocationName || row.destinationLocationId}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Shopify replenishable quantities are assigned to this one location and are not added to physical warehouse stock. Existing quantity at another location is flagged for review instead of being zeroed automatically.</p></Field>}
              {!isTemu && <Field label="Default shipping profile">
                {shippingProfiles.length ? <Select disabled={!editing} value={String(settings.defaultShippingProfile || "")} onValueChange={(value) => update("defaultShippingProfile", value)}><SelectTrigger><SelectValue placeholder="Select profile" /></SelectTrigger><SelectContent>{shippingProfiles.map((profile) => <SelectItem key={profile.id || profile.name} value={profile.name || profile.id || ""}>{profile.name || profile.id}</SelectItem>)}</SelectContent></Select> : <Input disabled={!editing} value={String(settings.defaultShippingProfile || "")} onChange={(event) => update("defaultShippingProfile", event.target.value)} />}
              </Field>}
              {!isTemu && <Field label="Default shipping service"><Input disabled={!editing} value={String(settings.defaultShippingService || "")} onChange={(event) => update("defaultShippingService", event.target.value)} /></Field>}
              {!isTemu && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Shipping inventory protection</p><p className="pt-1 text-xs text-muted-foreground">Uses the catalog shipping class already calculated from package dimensions and weight. Restricted live SKUs publish zero inventory; restricted unpublished SKUs are blocked from launch.</p></div>
                <ToggleField label="Enable shipping restriction gate" description="Turns the class-based inventory and launch protections on for this channel." checked={settings.shippingRestrictionGateEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("shippingRestrictionGateEnabled", value)} />
                <ToggleField label="Zero inventory for freight/LTL" description="Live listings in the LTL class will sync inventory as 0." checked={settings.shippingRestrictLtlInventory !== false} disabled={!editing || settings.shippingRestrictionGateEnabled === false} onCheckedChange={(value) => update("shippingRestrictLtlInventory", value)} />
                <ToggleField label="Zero inventory when measurements are missing" description="Optional. Leave off unless this channel should never sell SKUs without package data." checked={Boolean(settings.shippingRestrictMissingMeasurementsInventory)} disabled={!editing || settings.shippingRestrictionGateEnabled === false} onCheckedChange={(value) => update("shippingRestrictMissingMeasurementsInventory", value)} />
                <ToggleField label="Block launch for freight/LTL" description="Unpublished LTL SKUs will fail readiness instead of creating a listing." checked={settings.shippingRestrictLtlLaunch !== false} disabled={!editing || settings.shippingRestrictionGateEnabled === false} onCheckedChange={(value) => update("shippingRestrictLtlLaunch", value)} />
              </>}
              {isShopify && <>
                <Field label="Default product status"><Select disabled={!editing} value={String(settings.shopifyDefaultStatus || "draft")} onValueChange={(value) => update("shopifyDefaultStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></Field>
                <Field label="Inventory policy"><Select disabled={!editing} value={String(settings.shopifyInventoryPolicy || "deny")} onValueChange={(value) => update("shopifyInventoryPolicy", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deny">Deny oversell</SelectItem><SelectItem value="continue">Continue selling</SelectItem></SelectContent></Select></Field>
                <Field label="Fulfillment service"><Input disabled={!editing} value={String(settings.shopifyFulfillmentService || "manual")} onChange={(event) => update("shopifyFulfillmentService", event.target.value)} /></Field>
                <Field label="Publish scope"><Select disabled={!editing} value={String(settings.shopifyPublishScope || "global")} onValueChange={(value) => update("shopifyPublishScope", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="global">Global</SelectItem><SelectItem value="web">Web</SelectItem></SelectContent></Select></Field>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Checkout shipping eligibility</p><p className="pt-1 text-xs text-muted-foreground">DataPlus tags products for visibility, then assigns Shopify variants to the selected delivery profiles. Create the profiles and their rates in Shopify first, import them here, then run a dry review.</p></div>
                <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50/60 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
                  <div><p className="font-medium">Free / paid / freight policy</p><p className="text-xs text-muted-foreground">Parcel products with complete measurements qualify for free shipping. Oversize and missing measurements stay paid. LTL/freight uses the configured freight profile.</p></div>
                  <ToggleField label="Enable policy" checked={Boolean(settings.shopifyShippingEligibilityEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyShippingEligibilityEnabled", value)} />
                </div>
                <Field label="Free-shipping profile">
                  <Select disabled={!editing || !shippingProfiles.length} value={String(settings.shopifyFreeShippingProfileId || "none")} onValueChange={(value) => update("shopifyFreeShippingProfileId", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Import profiles first" /></SelectTrigger><SelectContent><SelectItem value="none">No profile selected</SelectItem>{shippingProfiles.map((profile) => <SelectItem key={`free-${profile.id || profile.name}`} value={profile.id || profile.name || ""}>{profile.name || profile.id}</SelectItem>)}</SelectContent></Select>
                </Field>
                <Field label="Paid parcel profile">
                  <Select disabled={!editing || !shippingProfiles.length} value={String(settings.shopifyPaidShippingProfileId || "none")} onValueChange={(value) => update("shopifyPaidShippingProfileId", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Import profiles first" /></SelectTrigger><SelectContent><SelectItem value="none">No profile selected</SelectItem>{shippingProfiles.map((profile) => <SelectItem key={`paid-${profile.id || profile.name}`} value={profile.id || profile.name || ""}>{profile.name || profile.id}</SelectItem>)}</SelectContent></Select>
                </Field>
                <Field label="Freight profile">
                  <Select disabled={!editing || !shippingProfiles.length} value={String(settings.shopifyFreightShippingProfileId || "none")} onValueChange={(value) => update("shopifyFreightShippingProfileId", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Import profiles first" /></SelectTrigger><SelectContent><SelectItem value="none">No profile selected</SelectItem>{shippingProfiles.map((profile) => <SelectItem key={`freight-${profile.id || profile.name}`} value={profile.id || profile.name || ""}>{profile.name || profile.id}</SelectItem>)}</SelectContent></Select>
                </Field>
                <Field label="LTL allowance included in product price"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(settings.shopifyLtlFreightAllowance ?? 250)} onChange={(event) => update("shopifyLtlFreightAllowance", Number(event.target.value))} /></Field>
                <Field label="Freight checkout rate"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(settings.shopifyFreightShippingRate ?? 240)} onChange={(event) => update("shopifyFreightShippingRate", Number(event.target.value || 240))} /></Field>
                <Field label="Free shipping tag"><Input disabled={!editing} value={String(settings.shopifyFreeShippingTag || "shipping-free")} onChange={(event) => update("shopifyFreeShippingTag", event.target.value)} /></Field>
                <Field label="Paid shipping tag"><Input disabled={!editing} value={String(settings.shopifyPaidShippingTag || "shipping-paid")} onChange={(event) => update("shopifyPaidShippingTag", event.target.value)} /></Field>
                <Field label="Freight shipping tag"><Input disabled={!editing} value={String(settings.shopifyFreightShippingTag || "shipping-freight")} onChange={(event) => update("shopifyFreightShippingTag", event.target.value)} /></Field>
                <div className="col-span-full flex flex-wrap items-center gap-2 rounded-md border p-3"><Button type="button" size="sm" variant="outline" onClick={syncShippingProfiles}><RefreshCw className="size-4" />Import Shopify delivery profiles</Button><span className="text-xs text-muted-foreground">{settings.shopifyShippingProfilesSyncedAt ? `Imported ${new Date(String(settings.shopifyShippingProfilesSyncedAt)).toLocaleString()}` : "No profiles imported yet."}</span></div>
              </>}
              {isEbay && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">eBay listing defaults</p><p className="pt-1 text-xs text-muted-foreground">Policies are imported from the eBay seller account. These defaults are prefilled for every eBay listing review and can be changed for a specific bulk launch.</p></div>
                <div className="col-span-full rounded-md border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30"><p className="text-sm font-medium">eBay price formula</p><p className="mt-1 text-xs text-muted-foreground">The final eBay price is always the higher of this calculation or the SKU's imported MAP, LAP, and minimum allowed price. It does not change your Shopify or catalog price.</p></div>
                <Field label="Formula"><Select disabled={!editing} value={String(settings.ebayPricingMode || "cost-plus")} onValueChange={(value) => update("ebayPricingMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cost-plus">Cost plus markup</SelectItem><SelectItem value="higher-of-product-or-cost">Higher of catalog price or cost formula</SelectItem><SelectItem value="product-price">Use catalog price</SelectItem></SelectContent></Select></Field>
                <Field label="Cost markup percent"><Input disabled={!editing} min="0" max="1000" type="number" value={String(settings.ebayPriceMarkupPercent ?? 60)} onChange={(event) => update("ebayPriceMarkupPercent", Number(event.target.value || 0))} /><p className="mt-1 text-xs text-muted-foreground">Applied to the eBay sell-unit cost.</p></Field>
                <Field label="Minimum margin percent"><Input disabled={!editing} min="0" max="99" type="number" value={String(settings.ebayMinMarginPercent ?? 0)} onChange={(event) => update("ebayMinMarginPercent", Number(event.target.value || 0))} /></Field>
                <Field label="Minimum eBay price"><Input disabled={!editing} min="0" step="0.01" type="number" value={String(settings.ebayMinimumPrice ?? 0)} onChange={(event) => update("ebayMinimumPrice", Number(event.target.value || 0))} /></Field>
                <Field label="eBay rounding rule"><Select disabled={!editing} value={String(settings.ebayRoundingRule || "none")} onValueChange={(value) => update("ebayRoundingRule", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No rounding</SelectItem><SelectItem value="nearest .99">Nearest .99</SelectItem><SelectItem value="nearest .95">Nearest .95</SelectItem><SelectItem value="round up">Round up</SelectItem></SelectContent></Select></Field>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Promoted Listings</p><p className="pt-1 text-xs text-muted-foreground">A cost-per-sale advertising estimate is included in eBay price and margin calculations. When enabled, newly published listings are added to the configured campaign without blocking the launch if advertising enrollment fails.</p></div>
                <ToggleField label="Enable eBay ads" description="Add newly published listings to a fixed-rate Promoted Listings campaign." checked={settings.ebayPromotedListingsEnabled === true} disabled={!editing} onCheckedChange={(value) => update("ebayPromotedListingsEnabled", value)} />
                <Field label="Ad rate percent"><Input disabled={!editing || settings.ebayPromotedListingsEnabled !== true} min="2" max="100" step="0.1" type="number" value={String(settings.ebayPromotedListingsRatePercent ?? 2)} onChange={(event) => update("ebayPromotedListingsRatePercent", Math.max(2, Math.min(100, Number(event.target.value || 2))))} /><p className="mt-1 text-xs text-muted-foreground">Default 2%. The estimate is deducted before DataPlus evaluates markup and margin.</p></Field>
                <Field label="Campaign name"><Input disabled={!editing || settings.ebayPromotedListingsEnabled !== true} maxLength={80} value={String(settings.ebayPromotedListingsCampaignName || "DataPlus Promoted Listings")} onChange={(event) => update("ebayPromotedListingsCampaignName", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Reconnect eBay once to grant the Sell Marketing permission before enabling ads.</p></Field>
                <Field label="Marketplace"><Select disabled={!editing} value={String(settings.ebayMarketplaceId || "EBAY_US")} onValueChange={(value) => update("ebayMarketplaceId", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EBAY_US">United States</SelectItem><SelectItem value="EBAY_CA">Canada</SelectItem><SelectItem value="EBAY_GB">United Kingdom</SelectItem><SelectItem value="EBAY_AU">Australia</SelectItem></SelectContent></Select></Field>
                <Field label="Merchant location">
                  {ebayMerchantLocations.length ? <Select disabled={!editing} value={String(settings.ebayMerchantLocationKey || "none")} onValueChange={(value) => update("ebayMerchantLocationKey", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Select imported location" /></SelectTrigger><SelectContent><SelectItem value="none">No merchant location selected</SelectItem>{ebayMerchantLocations.map((location: any) => <SelectItem key={`rule-${String(location.merchantLocationKey || location.key || location.name)}`} value={String(location.merchantLocationKey || location.key || location.name)}>{String(location.name || location.merchantLocationKey || location.key)}{location.status ? ` / ${String(location.status)}` : ""}</SelectItem>)}</SelectContent></Select> : <Input disabled={!editing} value={String(settings.ebayMerchantLocationKey || "")} placeholder="Sync policies and locations first" onChange={(event) => update("ebayMerchantLocationKey", event.target.value)} />}
                </Field>
                <Field label="Default eBay payment policy"><Select disabled={!editing || !ebayPaymentPolicies.length} value={String(settings.ebayPaymentPolicyId || "none")} onValueChange={(value) => update("ebayPaymentPolicyId", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Sync eBay policies first" /></SelectTrigger><SelectContent><SelectItem value="none">No payment policy selected</SelectItem>{ebayPaymentPolicies.map((policy: any) => <SelectItem key={String(policy.paymentPolicyId || policy.id)} value={String(policy.paymentPolicyId || policy.id)}>{String(policy.name || policy.paymentPolicyId || policy.id)}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Default eBay returns policy"><Select disabled={!editing || !ebayReturnPolicies.length} value={String(settings.ebayReturnPolicyId || "none")} onValueChange={(value) => update("ebayReturnPolicyId", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Sync eBay policies first" /></SelectTrigger><SelectContent><SelectItem value="none">No return policy selected</SelectItem>{ebayReturnPolicies.map((policy: any) => <SelectItem key={String(policy.returnPolicyId || policy.id)} value={String(policy.returnPolicyId || policy.id)}>{String(policy.name || policy.returnPolicyId || policy.id)}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Default eBay shipping policy"><Select disabled={!editing || !ebayFulfillmentPolicies.length} value={String(settings.ebayFulfillmentPolicyId || "none")} onValueChange={(value) => update("ebayFulfillmentPolicyId", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Sync eBay policies first" /></SelectTrigger><SelectContent><SelectItem value="none">No fulfillment policy selected</SelectItem>{ebayFulfillmentPolicies.map((policy: any) => <SelectItem key={String(policy.fulfillmentPolicyId || policy.id)} value={String(policy.fulfillmentPolicyId || policy.id)}>{String(policy.name || policy.fulfillmentPolicyId || policy.id)}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Default eBay category ID"><Input disabled={!editing} value={String(settings.ebayDefaultCategoryId || "")} placeholder="Set a mapped eBay category ID" onChange={(event) => update("ebayDefaultCategoryId", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">A SKU-level eBay category mapping takes precedence over this fallback.</p></Field>
                <Field label="Default store category ID"><Input disabled={!editing} value={String(settings.ebayDefaultStoreCategoryId || "")} placeholder="Optional store-category fallback" onChange={(event) => update("ebayDefaultStoreCategoryId", event.target.value)} /></Field>
                <Field label="Default store category name"><Input disabled={!editing} value={String(settings.ebayDefaultStoreCategoryName || "")} placeholder="For operators and exports" onChange={(event) => update("ebayDefaultStoreCategoryName", event.target.value)} /></Field>
                <Field label="Default listing template ID"><Input disabled={!editing} value={String(settings.ebayListingTemplateId || "")} placeholder="Optional DataPlus template" onChange={(event) => update("ebayListingTemplateId", event.target.value)} /></Field>
                <Field label="Default item specifics template ID"><Input disabled={!editing} value={String(settings.ebayItemSpecificTemplateId || "")} placeholder="Optional DataPlus template" onChange={(event) => update("ebayItemSpecificTemplateId", event.target.value)} /></Field>
                <Field label="Condition"><Select disabled={!editing} value={String(settings.ebayDefaultCondition || "NEW")} onValueChange={(value) => update("ebayDefaultCondition", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NEW">New</SelectItem><SelectItem value="USED_EXCELLENT">Used - Excellent</SelectItem><SelectItem value="USED_VERY_GOOD">Used - Very good</SelectItem><SelectItem value="USED_GOOD">Used - Good</SelectItem><SelectItem value="USED_ACCEPTABLE">Used - Acceptable</SelectItem></SelectContent></Select></Field>
                <Field label="Listing type"><Select disabled={!editing} value={String(settings.ebayListingFormat || "FIXED_PRICE")} onValueChange={(value) => update("ebayListingFormat", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FIXED_PRICE">Fixed price</SelectItem></SelectContent></Select></Field>
                <Field label="Description source"><Select disabled={!editing} value={String(settings.ebayDescriptionSource || "longDescription")} onValueChange={(value) => update("ebayDescriptionSource", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="longDescription">Long description</SelectItem><SelectItem value="shortDescription">Short description</SelectItem><SelectItem value="title">Product title</SelectItem></SelectContent></Select></Field>
                <Field label="Default dispatch time"><Input disabled={!editing} type="number" min="0" max="30" value={String(settings.ebayDefaultDispatchTimeDays ?? 2)} onChange={(event) => update("ebayDefaultDispatchTimeDays", Number(event.target.value || 0))} /><p className="mt-1 text-xs text-muted-foreground">Days from purchase to carrier handoff.</p></Field>
                <Field label="Default safety qty"><Input disabled={!editing} type="number" min="0" value={String(settings.ebayDefaultSafetyQty ?? 0)} onChange={(event) => update("ebayDefaultSafetyQty", Number(event.target.value || 0))} /></Field>
                <Field label="Default maximum sellable qty"><Input disabled={!editing} type="number" min="0" value={String(settings.ebayDefaultMaxSellableQty ?? 0)} onChange={(event) => update("ebayDefaultMaxSellableQty", Number(event.target.value || 0))} /></Field>
                <Field label="Minimum stock to auto-list"><Input disabled={!editing} type="number" min="0" value={String(settings.ebayMinInventoryForAutoListing ?? 1)} onChange={(event) => update("ebayMinInventoryForAutoListing", Number(event.target.value || 0))} /></Field>
                <Field label="Maximum listing images"><Input disabled={!editing} type="number" min="1" max="12" value={String(settings.ebayMaxImages ?? 12)} onChange={(event) => update("ebayMaxImages", Number(event.target.value || 12))} /></Field>
                <Field label="Listing launch cap"><Input disabled={!editing} type="number" min="1" max="5000" value={String(settings.ebayListingLaunchLimit ?? 500)} onChange={(event) => update("ebayListingLaunchLimit", Number(event.target.value || 500))} /><p className="mt-1 text-xs text-muted-foreground">A single eBay launch job is capped for predictable review and retries.</p></Field>
                <Field label="Price and inventory sync cap"><Input disabled={!editing} type="number" min="1" max="25000" value={String(settings.ebayPriceInventorySyncLimit ?? 1000)} onChange={(event) => update("ebayPriceInventorySyncLimit", Number(event.target.value || 1000))} /><p className="mt-1 text-xs text-muted-foreground">Only existing eBay offers are considered. Large catalogs are processed in API-safe batches.</p></Field>
                <Field label="Price and inventory schedule"><Select disabled={!editing} value={String(settings.ebayPriceInventorySyncScheduleType || "times")} onValueChange={(value) => update("ebayPriceInventorySyncScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every few hours</SelectItem></SelectContent></Select></Field>
                {String(settings.ebayPriceInventorySyncScheduleType || "times") === "interval" ? <Field label="Sync every hours"><Input disabled={!editing} type="number" min="1" max="24" value={String(settings.ebayPriceInventorySyncScheduleEveryHours ?? 12)} onChange={(event) => update("ebayPriceInventorySyncScheduleEveryHours", Number(event.target.value || 12))} /></Field> : <>
                  <Field label="First scheduled sync"><Input disabled={!editing} type="time" value={ebayPriceInventorySyncScheduleTimes[0] || "04:00"} onChange={(event) => update("ebayPriceInventorySyncScheduleTimes", [event.target.value, ebayPriceInventorySyncScheduleTimes[1] || ""].filter(Boolean).join(","))} /></Field>
                  <Field label="Second scheduled sync"><Input disabled={!editing} type="time" value={ebayPriceInventorySyncScheduleTimes[1] || ""} onChange={(event) => update("ebayPriceInventorySyncScheduleTimes", [ebayPriceInventorySyncScheduleTimes[0] || "04:00", event.target.value].filter(Boolean).join(","))} /></Field>
                </>}
                <ToggleField label="Default to publishing after review" checked={Boolean(settings.ebayAutoPublish)} disabled={!editing} onCheckedChange={(value) => update("ebayAutoPublish", value)} />
                <ToggleField label="Require product image" checked={Boolean(settings.ebayRequireImage)} disabled={!editing} onCheckedChange={(value) => update("ebayRequireImage", value)} />
                <ToggleField label="Enable Best Offer by default" checked={Boolean(settings.ebayBestOfferEnabled)} disabled={!editing} onCheckedChange={(value) => update("ebayBestOfferEnabled", value)} />
                <ToggleField label="Auto relist ended listings" checked={Boolean(settings.ebayAutoRelistEnabled)} disabled={!editing} onCheckedChange={(value) => update("ebayAutoRelistEnabled", value)} />
                <ToggleField label="Require product identifier" checked={Boolean(settings.ebayRequireProductIdentifier)} disabled={!editing} onCheckedChange={(value) => update("ebayRequireProductIdentifier", value)} />
                <ToggleField label="Push inventory updates" checked={settings.ebayInventoryUpdateEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("ebayInventoryUpdateEnabled", value)} />
                <ToggleField label="Push price updates" checked={settings.ebayPriceUpdateEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("ebayPriceUpdateEnabled", value)} />
                <ToggleField label="Schedule eBay price and inventory sync" checked={Boolean(settings.ebayPriceInventorySyncScheduleEnabled)} disabled={!editing || (settings.ebayInventoryUpdateEnabled === false && settings.ebayPriceUpdateEnabled === false)} onCheckedChange={(value) => update("ebayPriceInventorySyncScheduleEnabled", value)} />
                <ToggleField label="Upload tracking to eBay" checked={settings.ebayTrackingUploadEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("ebayTrackingUploadEnabled", value)} />
                <ToggleField label="Import completed payouts daily" checked={settings.ebaySettlementImportEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("ebaySettlementImportEnabled", value)} />
                <ToggleField label="Import paid orders only" checked={settings.ebayPaidOrdersOnly !== false} disabled={!editing} onCheckedChange={(value) => update("ebayPaidOrdersOnly", value)} />
                <ToggleField label="Prevent duplicate parent listings" checked={settings.ebayPreventDuplicateParentListings !== false} disabled={!editing} onCheckedChange={(value) => update("ebayPreventDuplicateParentListings", value)} />
                <ToggleField label="Divide inventory across listings" checked={Boolean(settings.ebayDivideInventoryPerListing)} disabled={!editing} onCheckedChange={(value) => update("ebayDivideInventoryPerListing", value)} />
                <ToggleField label="Use eBay out-of-stock control" checked={settings.ebayOutOfStockControlEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("ebayOutOfStockControlEnabled", value)} />
                <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                  <div><p className="text-sm font-medium">Templates and advanced account controls</p><p className="mt-1 text-xs text-muted-foreground">Maintain reusable listing presets, item-specific presets, store categories, buyer requirements, and shipping method mappings without duplicating per-SKU fields.</p></div>
                  <Button type="button" size="sm" variant="outline" onClick={openEbayTemplateControls}>Manage templates</Button>
                </div>
                <div className="col-span-full flex flex-wrap items-center gap-2 rounded-md border p-3"><Button type="button" size="sm" variant="outline" onClick={() => void runEbayAction("account")}><RefreshCw className="size-4" />Sync eBay policies and locations</Button><span className="text-xs text-muted-foreground">{settings.ebayAccountSettingsSyncedAt ? `Last synced ${new Date(String(settings.ebayAccountSettingsSyncedAt)).toLocaleString()}` : "No eBay policies or locations imported yet."}</span></div>
                <div className="col-span-full flex flex-wrap items-center gap-2 rounded-md border p-3"><Button type="button" size="sm" variant="outline" onClick={() => void runEbayAction("priceInventory")} disabled={!ebayCredentials?.hasSellerAuthorization || (settings.ebayInventoryUpdateEnabled === false && settings.ebayPriceUpdateEnabled === false)}><RefreshCw className="size-4" />Sync existing eBay listings</Button><span className="text-xs text-muted-foreground">Updates paired eBay offers only. It does not create or publish listings. {settings.ebayPriceInventorySyncScheduleEnabled ? `Scheduled ${String(settings.ebayPriceInventorySyncScheduleType || "times") === "interval" ? `every ${settings.ebayPriceInventorySyncScheduleEveryHours || 12} hours` : `at ${ebayPriceInventorySyncScheduleTimes.join(" and ") || "04:00"}`}.` : "Manual only."}</span></div>
              </>}
              <div className="col-span-full grid gap-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20"><Field label="Minimum-price protection"><PriceModeSelect value="protected" disabled onChange={() => undefined} /></Field><p className="text-xs text-muted-foreground">Required for every selling channel. Launches and price updates use the higher of the channel calculation or the quantity-adjusted MAP, LAP, and source minimum. Saving settings does not immediately reprice live listings.</p>{isShopify && <p className="text-sm">Shopify calculation includes the configured LTL allowance before the protected-price comparison.</p>}</div>
              {isWalmart && <ToggleField label="Import reconciliation reports daily" checked={settings.walmartSettlementImportEnabled !== false} disabled={!editing} onCheckedChange={(value) => update("walmartSettlementImportEnabled", value)} />}
              {!isEbay && !isTemu && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">{channel.name} pricing rules</p><p className="pt-1 text-xs text-muted-foreground">These values belong only to {channel.name} and control its next reviewed launch or price sync.</p></div>
                <Field label="Formula"><Select disabled={!editing} value={String(settings.pricingMode || "cost-plus")} onValueChange={(value) => update("pricingMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cost-plus">Cost plus markup</SelectItem><SelectItem value="higher-of-product-or-cost">Higher of catalog price or cost formula</SelectItem><SelectItem value="product-price">Use catalog price</SelectItem></SelectContent></Select></Field>
                <Field label="Price markup percent">
                  <Input disabled={!editing} type="number" value={String(settings.priceMarkupPercent ?? 0)} onChange={(event) => update("priceMarkupPercent", Number(event.target.value || 0))} />
                </Field>
                <Field label="Minimum margin percent">
                  <Input disabled={!editing} type="number" value={String(settings.minMarginPercent ?? 0)} onChange={(event) => update("minMarginPercent", Number(event.target.value || 0))} />
                </Field>
                <Field label="Rounding rule">
                  <Select disabled={!editing} value={String(settings.roundingRule || "none")} onValueChange={(value) => update("roundingRule", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">No rounding</SelectItem><SelectItem value="nearest .99">Nearest .99</SelectItem><SelectItem value="nearest .95">Nearest .95</SelectItem><SelectItem value="round up">Round up</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label={`Minimum ${channel.name} price`}><Input disabled={!editing} type="number" min="0" step="0.01" value={String(settings.minimumPrice ?? 0)} onChange={(event) => update("minimumPrice", Number(event.target.value || 0))} /></Field>
              </>}
              {isTemu && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Temu inventory, pricing, and order rules</p><p className="pt-1 text-xs text-muted-foreground">These controls are Temu-specific and do not use Shopify locations or Shopify delivery profiles.</p></div>
                <Field label="Temu inventory mode">
                  <Select disabled={!editing} value={String(settings.temuInventoryMode || "available")} onValueChange={(value) => update("temuInventoryMode", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="available">Publish available inventory</SelectItem><SelectItem value="fixed">Use fixed/safety quantity</SelectItem><SelectItem value="disabled">Do not publish inventory</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Temu safety quantity"><Input disabled={!editing} type="number" min="0" value={String(settings.temuInventorySafetyQty ?? 0)} onChange={(event) => update("temuInventorySafetyQty", Number(event.target.value || 0))} /></Field>
                <Field label="Temu ship-from warehouse"><div className="flex gap-2"><Select disabled={!editing || temuWarehousesLoading || !temuWarehouses.length} value={String(settings.temuDefaultWarehouseId || "none")} onValueChange={(value) => update("temuDefaultWarehouseId", value === "none" ? "" : value)}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder={temuWarehousesLoading ? "Loading Temu warehouses..." : "Select Temu warehouse"} /></SelectTrigger><SelectContent><SelectItem value="none">No default selected</SelectItem>{temuWarehouses.map((warehouse) => <SelectItem key={`rules-temu-${warehouse.id}`} value={warehouse.id}>{warehouse.name}{warehouse.isDefault ? " (Temu default)" : ""} · {warehouse.id}</SelectItem>)}</SelectContent></Select><Button type="button" size="icon" variant="outline" title="Refresh Temu warehouses" disabled={temuWarehousesLoading} onClick={() => void loadTemuWarehouses()}>{temuWarehousesLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button></div><p className="text-xs text-muted-foreground">This is a Temu warehouse ID, not a DataPlus inventory-location ID.</p></Field>
                <Field label="Temu price formula"><Select disabled={!editing} value={String(settings.temuPricingMode || "cost-plus")} onValueChange={(value) => update("temuPricingMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cost-plus">Cost plus markup</SelectItem><SelectItem value="higher-of-product-or-cost">Higher of catalog price or cost formula</SelectItem><SelectItem value="product-price">Use catalog price</SelectItem></SelectContent></Select></Field>
                <Field label="Temu price markup percent"><Input disabled={!editing} type="number" min="0" max="1000" value={String(settings.temuPriceMarkupPercent ?? 60)} onChange={(event) => update("temuPriceMarkupPercent", Number(event.target.value || 0))} /></Field>
                <Field label="Temu minimum margin percent"><Input disabled={!editing} type="number" min="0" max="99" value={String(settings.temuMinMarginPercent ?? 0)} onChange={(event) => update("temuMinMarginPercent", Number(event.target.value || 0))} /></Field>
                <Field label="Minimum Temu price"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(settings.temuMinimumPrice ?? 0)} onChange={(event) => update("temuMinimumPrice", Number(event.target.value || 0))} /></Field>
                <Field label="Temu rounding rule"><Select disabled={!editing} value={String(settings.temuRoundingRule || "none")} onValueChange={(value) => update("temuRoundingRule", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No rounding</SelectItem><SelectItem value="nearest .99">Nearest .99</SelectItem><SelectItem value="nearest .95">Nearest .95</SelectItem><SelectItem value="round up">Round up</SelectItem></SelectContent></Select></Field>
                <Field label="Temu currency"><Input disabled={!editing} value={String(settings.temuDefaultCurrency || "USD")} onChange={(event) => update("temuDefaultCurrency", event.target.value.toUpperCase())} /></Field>
                <Field label="Import from date"><Input disabled={!editing} type="date" value={String(settings.temuOrderImportStartDate || "")} onChange={(event) => update("temuOrderImportStartDate", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Limits the first/manual Temu order download so old orders are not pulled in by accident.</p></Field>
                <Field label="Orders per import"><Input disabled={!editing} type="number" min="1" max="5000" value={String(settings.temuOrderImportLimit ?? 250)} onChange={(event) => update("temuOrderImportLimit", Number(event.target.value || 250))} /></Field>
                <Field label="Order page size"><Input disabled={!editing} type="number" min="1" max="100" value={String(settings.temuOrderPageSize ?? 50)} onChange={(event) => update("temuOrderPageSize", Number(event.target.value || 50))} /></Field>
                <div className="col-span-full rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">DataPlus routing still decides which physical stock fulfills the order. The Temu warehouse selected above is sent separately as Temu's ship-from address.</div>
              </>}
              {isShopify && <>
                <div className="col-span-full pt-2">
                  <Separator />
                  <div className="flex flex-wrap items-start justify-between gap-3 pt-3">
                    <div><p className="text-sm font-semibold">Warehouse and channel inventory</p><p className="mt-1 text-xs text-muted-foreground">Control which DataPlus locations this channel can use, where inventory is published, and how sellable quantity is calculated.</p></div>
                    <div className="flex gap-2">
                      {isShopify && <Button type="button" size="sm" variant="outline" onClick={() => void loadShopifyLocations()} disabled={shopifyLocationsLoading}>{shopifyLocationsLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Refresh locations</Button>}
                      <Button type="button" size="sm" variant="outline" onClick={() => void reconcileWarehouseMappings()} disabled={warehouseReconcileBusy}>{warehouseReconcileBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Reconcile</Button>
                      {editing && <Button type="button" size="sm" variant="outline" onClick={addShopifyWarehouseMapping}>Add mapping</Button>}
                    </div>
                  </div>
                </div>
                <ToggleField label="Restrict channel to mapped warehouses" checked={Boolean(settings.restrictInventoryUsage)} disabled={!editing} onCheckedChange={(value) => update("restrictInventoryUsage", value)} />
                <Field label="Default ship-from warehouse">
                  <Select disabled={!editing} value={String(settings.defaultShipFromWarehouseId || "none")} onValueChange={(value) => update("defaultShipFromWarehouseId", value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="Use routing priority" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">Use routing priority</SelectItem>{shopifySourceWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <div className="col-span-full grid gap-2">
                  {shopifyWarehouseMappings.map((mapping) => (
                    <div key={mapping.id} className="grid gap-3 rounded-md border bg-muted/30 p-3">
                      <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_auto_minmax(220px,1fr)_auto_auto] md:items-center">
                      <Select disabled={!editing} value={mapping.sourceWarehouseId || "none"} onValueChange={(value) => {
                        const warehouse = shopifySourceWarehouses.find((row) => row.id === value)
                        updateShopifyWarehouseMapping(mapping.id, { sourceWarehouseId: value === "none" ? "" : value, sourceWarehouseName: value === "none" ? "" : String(warehouse?.name || value) })
                      }}>
                        <SelectTrigger><SelectValue placeholder="DataPlus warehouse" /></SelectTrigger>
                        <SelectContent><SelectItem value="none">Select DataPlus warehouse</SelectItem>{shopifySourceWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="hidden text-xs font-medium text-muted-foreground md:block">maps to</span>
                      {isShopify ? <Select disabled={!editing} value={mapping.destinationLocationId || "none"} onValueChange={(value) => {
                        const location = mappedShopifyLocations.find((row) => row.id === value)
                        updateShopifyWarehouseMapping(mapping.id, { destinationLocationId: value === "none" ? "" : value, destinationLocationName: value === "none" ? "" : String(location?.name || value) })
                      }}>
                        <SelectTrigger><SelectValue placeholder="Shopify location" /></SelectTrigger>
                        <SelectContent><SelectItem value="none">Select Shopify location</SelectItem>{mappedShopifyLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}{location.isActive === false ? " (inactive)" : ""}</SelectItem>)}</SelectContent>
                      </Select> : <Input disabled={!editing} value={mapping.externalWarehouseCode || mapping.destinationLocationId || ""} placeholder={`${channel.name || "Channel"} warehouse code`} onChange={(event) => updateShopifyWarehouseMapping(mapping.id, { externalWarehouseCode: event.target.value, destinationLocationId: event.target.value })} />}
                      <div className="flex items-center gap-2"><Switch disabled={!editing} checked={mapping.enabled} onCheckedChange={(enabled) => updateShopifyWarehouseMapping(mapping.id, { enabled })} /><span className="text-xs">{mapping.enabled ? "Enabled" : "Disabled"}</span></div>
                      {editing && <Button type="button" size="icon" variant="ghost" title="Remove mapping" onClick={() => removeShopifyWarehouseMapping(mapping.id)}><Trash2 className="size-4" /></Button>}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <Field label="Quantity mode"><Select disabled={!editing} value={mapping.inventoryMode || "pooled"} onValueChange={(value) => updateShopifyWarehouseMapping(mapping.id, { inventoryMode: value as ShopifyWarehouseMapping["inventoryMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pooled">Available inventory</SelectItem><SelectItem value="exclusive">Exclusive warehouse</SelectItem><SelectItem value="fixed">Fixed channel quantity</SelectItem><SelectItem value="disabled">Do not publish</SelectItem></SelectContent></Select></Field>
                        <Field label="Allocation percent"><Input disabled={!editing || mapping.inventoryMode === "fixed"} type="number" min="0" max="100" value={String(mapping.allocationPercent ?? 100)} onChange={(event) => updateShopifyWarehouseMapping(mapping.id, { allocationPercent: Number(event.target.value || 0) })} /></Field>
                        <Field label="Safety quantity"><Input disabled={!editing || mapping.inventoryMode === "fixed"} type="number" min="0" value={String(mapping.safetyQty ?? settings.defaultSafetyQty ?? 0)} onChange={(event) => updateShopifyWarehouseMapping(mapping.id, { safetyQty: Number(event.target.value || 0) })} /></Field>
                        <Field label="Maximum sellable"><Input disabled={!editing || mapping.inventoryMode === "fixed"} type="number" min="0" value={String(mapping.maxSellableQty ?? settings.defaultMaxSellableQty ?? 0)} onChange={(event) => updateShopifyWarehouseMapping(mapping.id, { maxSellableQty: Number(event.target.value || 0) })} /></Field>
                        <Field label={mapping.inventoryMode === "fixed" ? "Fixed quantity" : "Routing priority"}><Input disabled={!editing} type="number" min="0" value={String(mapping.inventoryMode === "fixed" ? mapping.fixedQty ?? 0 : mapping.orderRoutingPriority ?? 100)} onChange={(event) => updateShopifyWarehouseMapping(mapping.id, mapping.inventoryMode === "fixed" ? { fixedQty: Number(event.target.value || 0) } : { orderRoutingPriority: Number(event.target.value || 0) })} /></Field>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>{mapping.lastSyncedAt ? `Last sync ${dateLabel(mapping.lastSyncedAt)}` : "Not synchronized yet"}</span>{mapping.lastSentQty !== undefined && <span>Last quantity: {numberLabel(mapping.lastSentQty)}</span>}{mapping.lastError && <span className="text-destructive">{mapping.lastError}</span>}</div>
                    </div>
                  ))}
                  {!shopifyWarehouseMappings.length && <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No warehouse mappings configured.</div>}
                  <p className="text-xs text-muted-foreground">Mappings are reused by inventory publication and order routing. Supplier-feed locations remain virtual and route as drop shipments instead of physical picks.</p>
                </div>
                <div className="col-span-full pt-2">
                  <Separator />
                  <div className="flex flex-wrap items-start justify-between gap-3 pt-3"><div><p className="text-sm font-semibold">Conditional order routing</p><p className="mt-1 text-xs text-muted-foreground">Higher-priority matching rules choose the first eligible warehouse with sellable stock. Leave conditions empty to create a general preference.</p></div>{editing && <Button type="button" size="sm" variant="outline" onClick={addWarehouseRoutingRule}>Add routing rule</Button>}</div>
                </div>
                <div className="col-span-full grid gap-2">
                  {warehouseRoutingRules.map((rule) => <div key={rule.id} className="grid gap-3 rounded-md border bg-muted/30 p-3">
                    <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_110px_minmax(200px,1fr)_auto_auto] md:items-end">
                      <Field label="Rule name"><Input disabled={!editing} value={rule.name} onChange={(event) => updateWarehouseRoutingRule(rule.id, { name: event.target.value })} /></Field>
                      <Field label="Priority"><Input disabled={!editing} type="number" min="0" value={String(rule.priority ?? 100)} onChange={(event) => updateWarehouseRoutingRule(rule.id, { priority: Number(event.target.value || 0) })} /></Field>
                      <Field label="Route to"><Select disabled={!editing} value={rule.warehouseId || "none"} onValueChange={(value) => updateWarehouseRoutingRule(rule.id, { warehouseId: value === "none" ? "" : value })}><SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger><SelectContent><SelectItem value="none">Select warehouse</SelectItem>{shopifySourceWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select></Field>
                      <div className="flex h-10 items-center gap-2"><Switch disabled={!editing} checked={rule.enabled !== false} onCheckedChange={(enabled) => updateWarehouseRoutingRule(rule.id, { enabled })} /><span className="text-xs">{rule.enabled !== false ? "Enabled" : "Disabled"}</span></div>
                      {editing && <Button type="button" size="icon" variant="ghost" title="Remove routing rule" onClick={() => removeWarehouseRoutingRule(rule.id)}><Trash2 className="size-4" /></Button>}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Countries"><Input disabled={!editing} value={(rule.countryCodes || []).join(", ")} placeholder="US, CA" onChange={(event) => updateWarehouseRoutingRule(rule.id, { countryCodes: event.target.value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) })} /></Field>
                      <Field label="States"><Input disabled={!editing} value={(rule.stateCodes || []).join(", ")} placeholder="NY, NJ" onChange={(event) => updateWarehouseRoutingRule(rule.id, { stateCodes: event.target.value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) })} /></Field>
                      <Field label="Postal prefixes"><Input disabled={!editing} value={(rule.postalPrefixes || []).join(", ")} placeholder="10, 11, 12" onChange={(event) => updateWarehouseRoutingRule(rule.id, { postalPrefixes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></Field>
                      <Field label="Shipping classes"><Input disabled={!editing} value={(rule.shippingClasses || []).join(", ")} placeholder="parcel, freight" onChange={(event) => updateWarehouseRoutingRule(rule.id, { shippingClasses: event.target.value.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) })} /></Field>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3"><div><p className="text-sm font-medium">Require available stock</p><p className="text-xs text-muted-foreground">If disabled, this warehouse can be selected before inventory is available.</p></div><Switch disabled={!editing} checked={rule.requireAvailableStock !== false} onCheckedChange={(requireAvailableStock) => updateWarehouseRoutingRule(rule.id, { requireAvailableStock })} /></div>
                  </div>)}
                  {!warehouseRoutingRules.length && <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No conditional routing rules. Orders use the default ship-from warehouse and mapping priority.</div>}
                </div>
              </>}
              {isShopify && <>
                <Field label="Schedule type">
                  <Select disabled={!editing} value={String(settings.inventoryScheduleType || "times")} onValueChange={(value) => update("inventoryScheduleType", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Run mode">
                  <Select disabled={!editing} value={String(settings.inventoryScheduleMode || "dry-run")} onValueChange={(value) => update("inventoryScheduleMode", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="dry-run">Dry run only</SelectItem><SelectItem value="apply">Apply to Shopify</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="First run">
                  <Input disabled={!editing} type="time" value={scheduleTimes[0] || "03:00"} onChange={(event) => update("inventoryScheduleTimes", [event.target.value, scheduleTimes[1] || "13:00"].join(","))} />
                </Field>
                <Field label="Second run">
                  <Input disabled={!editing} type="time" value={scheduleTimes[1] || "13:00"} onChange={(event) => update("inventoryScheduleTimes", [scheduleTimes[0] || "03:00", event.target.value].join(","))} />
                </Field>
                <Field label="Every hours">
                  <Input disabled={!editing} type="number" min="1" max="24" value={String(settings.inventoryScheduleEveryHours ?? 12)} onChange={(event) => update("inventoryScheduleEveryHours", Number(event.target.value || 12))} />
                </Field>
                <ToggleField label="Scheduled inventory updates" checked={Boolean(settings.inventoryScheduleEnabled)} disabled={!editing} onCheckedChange={(value) => update("inventoryScheduleEnabled", value)} />
                <ToggleField label="Require successful product dump" checked={Boolean(settings.inventoryScheduleRequireSuccessfulDump)} disabled={!editing} onCheckedChange={(value) => update("inventoryScheduleRequireSuccessfulDump", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Shopify SKU pair audit</p><p className="pt-1 text-xs text-muted-foreground">Checks each Shopify SKU mapping and records both the parent Shopify product ID and the matching variant ID.</p></div>
                <Field label="Daily audit time">
                  <Input disabled={!editing} type="time" value={String(settings.shopifySkuMapScheduleTime || "02:00")} onChange={(event) => update("shopifySkuMapScheduleTime", event.target.value)} />
                </Field>
                <ToggleField label="Run daily SKU pair audit" checked={Boolean(settings.shopifySkuMapScheduleEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifySkuMapScheduleEnabled", value)} />
              </>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mappings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mappings</CardTitle>
              <CardDescription>Open the current category review and vendor mapping workspaces.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href="/category-review">Category review</a></Button>
              <Button asChild variant="outline"><a href="/vendor-category-mappings">Vendor category mappings</a></Button>
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="attributes">
            <ChannelRequirements channelName={channel.name || ""} />
          </TabsContent>

          <TabsContent value="variants">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Variant rules</CardTitle>
              <CardDescription>Channel-level rules are paired with vendor rules before product pushes.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <Detail label="Inventory policy" value={String(settings.shopifyInventoryPolicy || "deny")} />
              <Detail label="Fulfillment service" value={String(settings.shopifyFulfillmentService || "manual")} />
              <Detail label="Publish scope" value={String(settings.shopifyPublishScope || "global")} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skus">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SKU tools</CardTitle>
              <CardDescription>Use the current catalog and channel workspaces for per-SKU review.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href="/products">Open product catalog</a></Button>
              <Button asChild variant="outline"><a href="/channels">Open channel tools</a></Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <ChannelLogsPanel channel={channel.name || ""} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ChannelRequirements({ channelName }: { channelName: string }) {
  const normalizedChannel = channelName.toLowerCase()
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!["shopify", "ebay"].includes(normalizedChannel)) { setRows([]); setLoading(false); return }
    setLoading(true)
    api<{ rows?: Array<Record<string, unknown>> }>(`/api/categories/attributes?channel=${encodeURIComponent(normalizedChannel)}`)
      .then((result) => setRows(result.rows || []))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Unable to load channel requirements."))
      .finally(() => setLoading(false))
  }, [normalizedChannel])
  if (!["shopify", "ebay"].includes(normalizedChannel)) return <Card><CardContent className="p-5 text-sm text-muted-foreground">Category requirements are not configured for this channel yet.</CardContent></Card>
  return <Card><CardHeader className="border-b"><CardTitle className="text-base capitalize">{normalizedChannel} requirements</CardTitle><CardDescription>{normalizedChannel === "shopify" ? "Shopify category attributes. Google taxonomy is displayed with the Shopify category mapping and is not a second requirement set." : "eBay item specifics for mapped eBay categories only."}</CardDescription></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Master category</TableHead><TableHead>Attribute</TableHead><TableHead>Source field</TableHead><TableHead>Fallback</TableHead><TableHead>Required</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((row, index) => { const category = String(row["Main Category"] || row.Category || row.category || ""); return <TableRow key={`${category}-${row.Attribute}-${index}`}><TableCell>{category}</TableCell><TableCell>{String(row.Attribute || "-")}</TableCell><TableCell>{String(row["Mapped Source Field"] || "-")}</TableCell><TableCell>{String(row["Fallback Value"] || "-")}</TableCell><TableCell><Badge variant={String(row.Required) === "true" ? "default" : "secondary"}>{String(row.Required) === "true" ? "Required" : "Optional"}</Badge></TableCell><TableCell><Button size="sm" variant="outline" asChild><a href={`/categories/${encodeURIComponent(String(row["Category ID"] || row.CategoryId || row.categoryId || category))}`}>Open category</a></Button></TableCell></TableRow>})}{!rows.length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No {normalizedChannel} requirements are mapped yet.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card>
}

function ChannelLogo({ channel }: { channel: ChannelConnection }) {
  const src = channel.logoDataUrl || channel.logoUrl
  return (
    <div className="grid size-16 place-items-center overflow-hidden rounded-lg border bg-muted">
      {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain p-2" /> : <ShoppingBag className="size-7 text-muted-foreground" />}
    </div>
  )
}


export { ChannelsPage }
