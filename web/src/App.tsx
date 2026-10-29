import {
Accessibility,
Activity,
AlertCircle,
AlertTriangle,
Archive,
ArrowLeft,
BarChart3,
Boxes,
CalendarDays,
CheckCircle2,
ChevronDown,
FileDown,
FileText,
FileUp,
FileWarning,
History,
Home,
Loader2,
LockKeyhole,
MessageSquare,
Moon,
MoreHorizontal,
PackageSearch,
Pencil,
Play,
RefreshCw,
RotateCcw,
Save,
Search,
Settings,
ShieldCheck,
ShoppingBag,
Square,
Store,
Sun,
Truck,
UnlockKeyhole,
Users,
Warehouse,
X
} from "lucide-react"
import { useTheme } from "next-themes"
import { lazy,Suspense,useEffect,useMemo,useRef,useState,type FormEvent } from "react"
import { toast,Toaster } from "sonner"
import { Field } from "./components/app-ui"
import { CatalogImagePreviewLayer } from "./components/catalog-image-preview-layer"
import { CompanyMenuItems,CompanySwitcher } from "./components/company-switcher"
import type { ImportProgress } from "./components/import-dashboard"
import { MentionCenter } from "./components/mention-center"
import { NotificationCapture,NotificationCenter } from "./components/notification-center"
import { orderSidebarItems as operationsSidebarItems } from "./components/order-navigation"
import { QuickFindBarcodeScanner } from "./components/quick-find-barcode-scanner"
import { SystemBrandMark } from "./components/system-brand-mark"
import { cachedAppVersion,clearAppStateCache,loadAppBootstrap,loadAppReferences,loadAppSummary,updateAppReference,type AppProjection,type AppReferenceName } from "./lib/app-state"
import { api,dateLabel,numberLabel } from "./lib/client-api"
export { channelFilterLabel,marketplaceChannelKey } from "./lib/catalog-channel-utils"
export type { MarketplaceChannelKey } from "./lib/catalog-channel-utils"
export { api,dateLabel,moneyLabel,numberLabel } from "./lib/client-api"

const AccountingPage = lazy(() => import("./components/accounting-page").then((module) => ({ default: module.AccountingPage })))
const CompaniesSettings = lazy(() => import("./components/companies-settings").then((module) => ({ default: module.CompaniesSettings })))
const OrderImportsWorkspace = lazy(() => import("./components/order-imports-workspace").then((module) => ({ default: module.OrderImportsWorkspace })))
const ShippingDisputes = lazy(() => import("./components/shipping-disputes").then((module) => ({ default: module.ShippingDisputes })))
const OrderDataReview = lazy(() => import("./components/order-data-review").then((module) => ({ default: module.OrderDataReview })))
const loadPurchasingRoute = () => import("./components/purchasing-route")
const PurchasingRouter = lazy(() => loadPurchasingRoute().then((module) => ({ default: module.PurchasingRouter })))
const CatalogPage = lazy(() => import("./components/catalog-route").then((module) => ({ default: module.CatalogPage })))
const OrderDetailWorkspace = lazy(() => import("./components/order-detail-route").then((module) => ({ default: module.OrderDetailWorkspace })))
const RmaDetailPage = lazy(() => import("./components/order-detail-route").then((module) => ({ default: module.RmaDetailPage })))
const ChannelsPage = lazy(() => import("./components/channels-route").then((module) => ({ default: module.ChannelsPage })))
const MessagesRoute = lazy(() => import("./components/messages-route").then((module) => ({ default: module.MessagesRoute })))
const SettingsPage = lazy(() => import("./components/settings-route").then((module) => ({ default: module.SettingsPage })))
const WarehouseWorkspace = lazy(() => import("./components/warehouse-route").then((module) => ({ default: module.WarehouseWorkspace })))
const WarehouseMobileRoute = lazy(() => import("./components/warehouse-route").then((module) => ({ default: module.WarehouseMobileRoute })))
const loadFulfillmentRoute = () => import("./components/fulfillment-route")
const FulfillmentPage = lazy(() => loadFulfillmentRoute().then((module) => ({ default: module.FulfillmentPage })))
const ShippingBatchesPage = lazy(() => loadFulfillmentRoute().then((module) => ({ default: module.ShippingBatchesPage })))
const JobsPage = lazy(() => import("./components/jobs-route").then((module) => ({ default: module.JobsPage })))
const JobDetailPage = lazy(() => import("./components/jobs-route").then((module) => ({ default: module.JobDetailPage })))
const OverviewPage = lazy(() => import("./components/overview-route").then((module) => ({ default: module.OverviewPage })))
const CustomersPage = lazy(() => import("./components/customers-route").then((module) => ({ default: module.CustomersPage })))
const CustomerDetailPage = lazy(() => import("./components/customers-route").then((module) => ({ default: module.CustomerDetailPage })))
const OperationsPage = lazy(() => import("./components/orders-route").then((module) => ({ default: module.OperationsPage })))
const loadLegacyWorkspaces = () => import("./components/legacy-workspaces")
const PurchaseOrderDetailPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.PurchaseOrderDetailPage })))
const DraftQuoteFieldDetailPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.DraftQuoteFieldDetailPage })))
const StandaloneProductPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.StandaloneProductPage })))
const InventorySkuDetailPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.InventorySkuDetailPage })))
const InventoryReportsPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.InventoryReportsPage })))
const InventoryWorkspace = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.InventoryWorkspace })))
const StandaloneCategoryPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.StandaloneCategoryPage })))
const DavidChatPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.DavidChatPage })))
const DavidChatDrawer = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.DavidChatDrawer })))
const WikiWorkspace = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.WikiWorkspace })))
const VendorsPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.VendorsPage })))
const BrandsPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.BrandsPage })))
const BrandDetailPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.BrandDetailPage })))
const SalesReportsPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.SalesReportsPage })))
const ShippingReportsPage = lazy(() => loadLegacyWorkspaces().then((module) => ({ default: module.ShippingReportsPage })))

import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle } from "@/components/ui/card"
import { Command,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList } from "@/components/ui/command"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import { Drawer,DrawerContent,DrawerDescription,DrawerHeader,DrawerTitle } from "@/components/ui/drawer"
import {
DropdownMenu,
DropdownMenuCheckboxItem,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuLabel,
DropdownMenuSeparator,
DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
Sidebar,
SidebarContent,
SidebarFooter,
SidebarGroup,
SidebarGroupContent,
SidebarGroupLabel,
SidebarHeader,
SidebarInset,
SidebarMenu,
SidebarMenuButton,
SidebarMenuItem,
SidebarMenuSub,
SidebarMenuSubButton,
SidebarMenuSubItem,
SidebarProvider,
SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type AppView = "order-imports" | "order-review" | "accounting" | "shipping-disputes" | "sales-reports" | "shipping-reports" | "overview" | "jobs" | "job-detail" | "channels" | "catalog" | "inventory-reports" | "operations" | "customers" | "customer-detail" | "messages" | "warehouse" | "fulfillment" | "purchasing" | "po-detail" | "order-detail" | "return-detail" | "draft-detail" | "product-detail" | "inventory-detail" | "category-detail" | "vendors" | "brands" | "brand-detail" | "ai-chat" | "wiki" | "settings"

type FulfillmentRateRefreshItem = {
  orderId: string
  orderNumber: string
  channel: string
  rateLane: "temu" | "shopify" | "veeqo"
  routeIds: string[]
  skus: string[]
  status: "queued" | "checking" | "rated" | "recorded" | "failed" | "blocked"
  selectedRate?: Record<string, any> | null
  error?: string
}

export type ImportJob = {
  importProgress?: ImportProgress
  id: string
  jobNumber?: number
  section?: string
  category?: string
  operation?: string
  direction?: string
  type?: string
  status?: string
  fileName?: string
  originalFileName?: string
  errorFileName?: string
  manifestFileName?: string
  message?: string
  details?: string
  errors?: string[]
  totalRows?: number
  processedRows?: number
  progressPercent?: number
  phase?: string
  changed?: number
  missingCount?: number
  created?: number
  startedAt?: string
  createdAt?: string
  finishedAt?: string
  updatedAt?: string
  workerId?: string
  workerTask?: string
  workerLane?: string
  jobTrigger?: "manual" | "automated" | string
  jobChannel?: string
  currentFile?: string
  processRssMb?: number
  elapsedSeconds?: number
  rowsPerSecond?: number
  retryOfJobId?: string
  operatorNotes?: string
  notesUpdatedAt?: string
  notesUpdatedBy?: string
  workerPayload?: Record<string, unknown>
  workerOutput?: Array<{ timestamp?: string; stream?: string; line?: string }>
  artifacts?: Array<{ kind?: string; fileName?: string; filePath?: string; contentType?: string; rowCount?: number; byteSize?: number }>
  rateRefreshTargets?: FulfillmentRateRefreshItem[]
  rateRefreshResults?: Array<FulfillmentRateRefreshItem & { review?: Record<string, any> }>
  labelPurchaseBatchId?: string
  labelPurchaseBatchNumber?: string
  labelPurchaseCounts?: Record<string, number>
  printJobId?: string
  printRequestId?: string
}

export type ChannelLogEntry = {
  id: string
  createdAt?: string
  channel?: string
  kind?: string
  actionGroup?: string
  operation?: string
  status?: string
  ok?: boolean
  transport?: string
  method?: string
  path?: string
  statusCode?: number
  durationMs?: number
  requestId?: string
  jobId?: string
  message?: string
  trigger?: string
  actor?: string
  entityType?: string
  entityId?: string
  phase?: string
}

export type WorkerStatus = {
  online?: boolean
  workers?: Array<{ name?: string; lane?: string; workerId?: string; online?: boolean; currentTask?: string }>
  workerId?: string
  currentTask?: string
  status?: string
  lastSeenAt?: string
  ageSeconds?: number
}

type UniversalSearchResult = {
  type: "product" | "order" | "purchase-order" | "draft" | "vendor" | "return"
  id: string
  title: string
  subtitle?: string
  matchLabel?: string
  href: string
}

export type QuickProductResult = {
  id: string
  sku: string
  title: string
  brand?: string
  manufacturer?: string
  supplier?: string
  vendorSku?: string
  mfrPartNumber?: string
  barcode?: string
  cost?: number
  qty?: number
  image?: string
  matchLabel?: string
}

type QuickOperationResult = {
  type: "order" | "purchase-order"
  id: string
  title: string
  marketplaceNumber?: string
  channelOrderId?: string
  channelPoNumber?: string
  subtitle?: string
  matchLabel?: string
  href: string
}

export type ShopifyWarehouseMapping = {
  id: string
  enabled: boolean
  sourceWarehouseId: string
  sourceWarehouseName?: string
  destinationLocationId: string
  destinationLocationName?: string
  externalWarehouseCode?: string
  inventoryMode?: "pooled" | "exclusive" | "fixed" | "disabled"
  allocationPercent?: number
  safetyQty?: number
  maxSellableQty?: number
  fixedQty?: number
  exportInventoryEnabled?: boolean
  importInventoryEnabled?: boolean
  orderRoutingPriority?: number
  lastSyncedAt?: string
  lastSentQty?: number
  lastError?: string
}

export type WarehouseRoutingRule = {
  id: string
  name: string
  enabled: boolean
  priority: number
  warehouseId: string
  fallbackWarehouseIds?: string[]
  countryCodes?: string[]
  stateCodes?: string[]
  postalPrefixes?: string[]
  shippingClasses?: string[]
  orderTypes?: string[]
  supplierIds?: string[]
  requireAvailableStock?: boolean
}

type ChannelSettings = {
  channelEnabled?: boolean
  defaultShadowStatus?: string
  defaultHandlingTimeDays?: number
  defaultSafetyQty?: number
  defaultReplenishableQty?: number
  replenishableSafeguardsEnabled?: boolean
  replenishableRequireFreshVendorFeed?: boolean
  replenishableFeedMaxAgeHours?: number
  replenishableBlockVendorUnavailable?: boolean
  replenishableMaxDailyVelocity?: number
  shopifyReplenishableLocationId?: string
  shopifyReplenishableLocationName?: string
  defaultMaxSellableQty?: number
  defaultShippingProfile?: string
  defaultShippingService?: string
  shippingRestrictionGateEnabled?: boolean
  shippingRestrictLtlInventory?: boolean
  shippingRestrictOversizeInventory?: boolean
  shippingRestrictMissingMeasurementsInventory?: boolean
  shippingRestrictLtlLaunch?: boolean
  shippingRestrictOversizeLaunch?: boolean
  shippingRestrictMissingMeasurementsLaunch?: boolean
  priceUpdateEnabled?: boolean
  inventoryUpdateEnabled?: boolean
  orderDownloadEnabled?: boolean
  createMissingOrderSkusFromSource?: boolean
  trackingUpdateEnabled?: boolean
  autoCreateShadow?: boolean
  priceMarkupPercent?: number
  minMarginPercent?: number
  pricingMode?: string
  minimumPrice?: number
  shopifyDefaultStatus?: string
  shopifyInventoryPolicy?: string
  shopifyFulfillmentService?: string
  shopifySyncStatusEnabled?: boolean
  shopifyAutoSyncStatus?: boolean
  shopifyStatusSyncLimit?: number
  shopifyPublishScope?: string
  shopifyCloseoutsEnabled?: boolean
  shopifyOrderImportEnabled?: boolean
  shopifyOrderImportLimit?: number
  shopifyOrderImportSources?: string
  shopifyOrderImportIncludeCanceled?: boolean
  shopifyOrderImportScheduleEnabled?: boolean
  shopifyOrderImportScheduleType?: string
  shopifyOrderImportScheduleTimes?: string
  shopifyOrderImportScheduleEveryHours?: number
  shopifyCancellationNotificationEnabled?: boolean
  shopifyFulfillmentSyncEnabled?: boolean
  shopifyInventoryPushEnabled?: boolean
  shopifyInventoryWarehouseId?: string
  shopifyInventoryLocationId?: string
  shopifyWarehouseMappings?: ShopifyWarehouseMapping[]
  warehouseMappings?: ShopifyWarehouseMapping[]
  warehouseRoutingRules?: WarehouseRoutingRule[]
  restrictInventoryUsage?: boolean
  defaultShipFromWarehouseId?: string
  fallbackWarehouseIds?: string[]
  inventoryScheduleEnabled?: boolean
  inventoryScheduleMode?: string
  inventoryScheduleType?: string
  inventoryScheduleTimes?: string
  inventoryScheduleEveryHours?: number
  inventoryScheduleRequireSuccessfulDump?: boolean
  shopifySkuMapScheduleEnabled?: boolean
  shopifySkuMapScheduleTime?: string
  shopifyShippingProfiles?: Array<{ id?: string; name?: string; default?: boolean }>
  shopifyShippingProfilesSyncedAt?: string
  shopifyShippingEligibilityEnabled?: boolean
  shopifyFreeShippingTag?: string
  shopifyPaidShippingTag?: string
  shopifyFreightShippingTag?: string
  shopifyFreeShippingProfileId?: string
  shopifyPaidShippingProfileId?: string
  shopifyFreightShippingProfileId?: string
  shopifyFreightShippingRate?: number
  mapPricingMode?: string
  shopifyLtlFreightAllowance?: number
  ebayMarketplaceId?: string
  ebayMerchantLocationKey?: string
  ebayPaymentPolicyId?: string
  ebayReturnPolicyId?: string
  ebayFulfillmentPolicyId?: string
  ebayDefaultCategoryId?: string
  ebayDefaultStoreCategoryId?: string
  ebayDefaultStoreCategoryName?: string
  ebayListingTemplateId?: string
  ebayItemSpecificTemplateId?: string
  ebayDefaultDispatchTimeDays?: number
  ebayDefaultCondition?: string
  ebayCurrency?: string
  ebayListingFormat?: string
  ebayQuantityMode?: string
  ebayDescriptionSource?: string
  ebayMaxImages?: number
  ebayAutoPublish?: boolean
  ebayRequireImage?: boolean
  ebayBestOfferEnabled?: boolean
  ebayCatalogSyncEnabled?: boolean
  ebayCatalogSyncLimit?: number
  ebayCatalogSyncScheduleEnabled?: boolean
  ebayCatalogSyncScheduleType?: string
  ebayCatalogSyncScheduleTimes?: string
  ebayCatalogSyncScheduleEveryHours?: number
  ebayAccountSettingsSyncedAt?: string
  ebayMerchantLocations?: Array<{ merchantLocationKey?: string; name?: string; status?: string; type?: string; address?: Record<string, unknown> }>
  ebayPaymentPolicies?: Array<{ id?: string; name?: string; description?: string; immediatePay?: boolean; paymentInstructions?: string }>
  ebayReturnPolicies?: Array<{ id?: string; name?: string; description?: string; returnsAccepted?: boolean; returnPeriod?: Record<string, unknown>; refundMethod?: string; returnShippingCostPayer?: string; restockingFeePercentage?: number | null }>
  ebayFulfillmentPolicies?: Array<{ id?: string; name?: string; description?: string; handlingTime?: Record<string, unknown>; shippingOptions?: Array<Record<string, unknown>>; globalShipping?: boolean }>
  ebayStoreCategories?: Array<{ id?: string; categoryId?: string; name?: string; categoryName?: string }>
  ebayListingTemplates?: Array<{ id?: string; name?: string; settings?: Record<string, unknown>; defaults?: Record<string, unknown> }>
  ebayItemSpecificTemplates?: Array<{ id?: string; name?: string; aspects?: Record<string, unknown>; itemSpecifics?: Record<string, unknown> }>
  ebayOrderImportEnabled?: boolean
  ebayOrderImportLookbackDays?: number
  ebayOrderImportLimit?: number
  ebayOrderImportIncludeCanceled?: boolean
  ebayOrderImportScheduleEnabled?: boolean
  ebayOrderImportScheduleType?: string
  ebayOrderImportScheduleTimes?: string
  ebayOrderImportScheduleEveryHours?: number
  ebayReturnSyncEnabled?: boolean
  ebayReturnSyncLookbackDays?: number
  ebayReturnSyncLimit?: number
  ebayReturnSyncScheduleEnabled?: boolean
  ebayReturnSyncScheduleType?: string
  ebayReturnSyncScheduleTimes?: string
  ebayReturnSyncScheduleEveryHours?: number
  temuEndpoint?: string
  temuAuthorizationUrl?: string
  temuAppKey?: string
  temuAppKeyConfigured?: boolean
  temuAppSecret?: string
  temuAppSecretConfigured?: boolean
  temuAccessToken?: string
  temuAccessTokenConfigured?: boolean
  temuMallId?: string
  temuOrderPageSize?: number
  temuConnectionOk?: boolean
  temuConnectionLiveApiChecked?: boolean
  temuConnectionVerifiedAt?: string
  temuConnectionVerificationMessage?: string
  temuLastOrderSync?: string
  temuLastBlindOrderRepairAt?: string
  temuProductSyncEnabled?: boolean
  temuListingSyncEnabled?: boolean
  temuListingLaunchEnabled?: boolean
  temuCatalogSyncEnabled?: boolean
  temuInventorySyncEnabled?: boolean
  temuPriceSyncEnabled?: boolean
  temuTrackingUploadEnabled?: boolean
  temuFulfillmentSyncEnabled?: boolean
  temuCancellationNotificationEnabled?: boolean
  temuReturnSyncEnabled?: boolean
  temuReturnSyncLookbackDays?: number
  temuReturnSyncScheduleEnabled?: boolean
  temuReturnSyncScheduleType?: string
  temuReturnSyncScheduleTimes?: string
  temuReturnSyncScheduleEveryHours?: number
  temuRefundSyncEnabled?: boolean
  temuWebhookEnabled?: boolean
  temuWebhookEndpoint?: string
  temuWebhookSecretConfigured?: boolean
  temuDefaultWarehouseId?: string
  temuInventoryMode?: string
  temuInventorySafetyQty?: number
  temuPriceMarkupPercent?: number
  temuMinMarginPercent?: number
  temuPricingMode?: string
  temuMinimumPrice?: number
  temuRoundingRule?: string
  temuDefaultCurrency?: string
  temuOrderImportEnabled?: boolean
  temuOrderImportStartDate?: string
  temuOrderImportLookbackDays?: number
  temuOrderImportLimit?: number
  temuOrderImportIncludeCanceled?: boolean
  temuOrderImportScheduleEnabled?: boolean
  temuOrderImportScheduleType?: string
  temuOrderImportScheduleTimes?: string
  temuOrderImportScheduleEveryHours?: number
  ebayPriceInventorySyncScheduleEnabled?: boolean
  ebayPriceInventorySyncScheduleType?: string
  ebayPriceInventorySyncScheduleTimes?: string
  ebayPriceInventorySyncScheduleEveryHours?: number
  ebayPriceInventorySyncLimit?: number
  ebayListingLaunchLimit?: number
  ebayPricingMode?: string
  ebayPriceMarkupPercent?: number
  ebayMinMarginPercent?: number
  ebayMinimumPrice?: number
  ebayRoundingRule?: string
  ebayPromotedListingsEnabled?: boolean
  ebayPromotedListingsRatePercent?: number
  ebayPromotedListingsCampaignName?: string
  ebayWebhookEnabled?: boolean
  ebayWebhookOrderSyncEnabled?: boolean
  ebayWebhookEndpoint?: string
  ebayWebhookVerificationToken?: string
  ebayWebhookVerificationTokenConfigured?: boolean
  ebayNotificationAlertEmail?: string
  whatnotApiEnvironment?: string
  whatnotGraphqlEndpoint?: string
  whatnotAuthMode?: string
  whatnotOAuthClientId?: string
  whatnotOAuthRedirectUri?: string
  whatnotScopes?: string[]
  whatnotProductSyncEnabled?: boolean
  whatnotListingSyncEnabled?: boolean
  whatnotInventorySyncEnabled?: boolean
  whatnotOrderImportEnabled?: boolean
  whatnotTrackingUploadEnabled?: boolean
  whatnotShipmentLabelEnabled?: boolean
  whatnotWebhookEnabled?: boolean
  whatnotWebhookEndpoint?: string
  whatnotWebhookTopics?: string[]
  whatnotWebhookSecretConfigured?: boolean
  whatnotOrderImportLookbackDays?: number
  whatnotOrderImportLimit?: number
  whatnotOrderImportScheduleEnabled?: boolean
  whatnotOrderImportScheduleType?: string
  whatnotOrderImportScheduleTimes?: string
  whatnotOrderImportScheduleEveryHours?: number
  whatnotBulkOperationsEnabled?: boolean
  whatnotBulkOperationPollSeconds?: number
  whatnotTaxonomySyncEnabled?: boolean
  whatnotDefaultListingType?: string
  whatnotDefaultCondition?: string
  whatnotAutoPublishListings?: boolean
  whatnotRequireShippingProfile?: boolean
  whatnotAutoCreateShippingProfile?: boolean
  whatnotDefaultShippingProfileId?: string
  whatnotDefaultLivestreamId?: string
  whatnotAssignListingsToLivestream?: boolean
  whatnotAuctionSuddenDeathEnabled?: boolean
  roundingRule?: string
  [key: string]: unknown
}

export type ChannelConnection = {
  id: string
  name: string
  connected?: boolean
  status?: string
  notes?: string
  logoUrl?: string
  logoDataUrl?: string
  externalAccount?: string
  settings?: ChannelSettings
  shopifyConfig?: {
    shop?: string
    apiVersion?: string
    hasAccessToken?: boolean
    hasClientCredentials?: boolean
    configured?: boolean
  }
}

export type Vendor = {
  id: string
  name: string
  code?: string
  status?: string
  retirement?: { retiredAt: string; reason: string; actor: string; jobId: string } | null
  type?: string
  contactName?: string
  email?: string
  phone?: string
  website?: string
  paymentTerms?: string
  leadTimeDays?: number
  moq?: number
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
  notes?: string
  rating?: number
  openPOs?: number
  totalPOs?: number
  totalSpend?: number
  catalogStats?: Record<string, number>
  pricingRules?: Record<string, unknown>
  variationRules?: Record<string, unknown>
  inventoryRules?: Record<string, unknown>
  supplierLocations?: VendorSupplierLocation[]
  purchaseOrderRules?: Record<string, unknown>
  submissionSettings?: Record<string, unknown>
  sourcePriority?: Record<string, unknown>
  catalogSettings?: {
    enabled?: boolean
    sourceCodes?: string[]
    note?: string
  }
  channelRules?: Record<string, unknown>
  receivingDocumentTemplate?: {
    enabled?: boolean
    name?: string
    templateKey?: string
    engine?: string
    language?: string
    pageSegmentationMode?: number
    minimumConfidence?: number
    aiFallbackEnabled?: boolean
    documentMarkers?: string[]
    columns?: Record<string, { label?: string; startPercent?: number; endPercent?: number }>
  }
}

export type VendorSupplierLocation = {
  id: string
  code: string
  name: string
  status: "active" | "inactive"
  address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }
  timezone: string
  dropshipEnabled: boolean
  inventoryEnabled: boolean
  priority: number
  leadTimeDays: number
  cutoffTime: string
  safetyQtyEnabled: boolean
  safetyQty: number | null
  freshnessHours: number
  sourceLocationIds: string[]
  lastInventoryAt?: string
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export type Brand = {
  id: string
  name: string
  status?: string
  vendorIds?: string[]
  preferredVendorId?: string
  logoUrl?: string
  logoDataUrl?: string
  category?: string
  website?: string
  mapPricingMode?: string
  mapPolicy?: string
  warranty?: string
  leadTimeNotes?: string
  notes?: string
  virtual?: boolean
  createdAt?: string
  updatedAt?: string
}

export type BrandSummary = Brand & {
  brandKey: string
  brandName: string
  sourceProductCount: number
  sourceInStockCount: number
  sourceStockQty: number
  productCount: number
  activeProductCount: number
  managedInStockCount: number
  managedStockQty: number
  shopifyLive: number
  ebayListed: number
  orderCount: number
  lastOrderAt?: string
  orderValue: number
  suppliers?: string[]
}

export type VendorMarketplaceSummary = {
  supplierKey: string
  supplier: string
  sourceCodes?: string[]
  productCount: number
  activeProductCount: number
  shopifyLive: number
  ebayLive: number
  marketplaceLive: number
}

export type VendorMarketplaceCoverage = Omit<VendorMarketplaceSummary, "supplierKey" | "supplier"> & {
  matchedSuppliers: string[]
}

export type SystemSettings = {
  backgroundJobsMode?: string
  autoDataQualityScanAfterImports?: boolean
  dataQualityWorkerEnabled?: boolean
  backupIncludeSourceCatalog?: boolean
  backupRetentionDays?: number
  jobsRetentionDays?: number
  jobsRetentionAutoCleanupEnabled?: boolean
  channelLogRetentionDays?: number
  jobArtifactRetentionDays?: number
  sourceCatalogImportBatchLimit?: number
  shopifyProductLaunchBatchLimit?: number
  trueValueSourceCategoryAsMainCategory?: boolean
  requireAdminConfirmationForDeletes?: boolean
  shopifyDailyInventoryUpdateEnabled?: boolean
  shopifyDailyInventoryUpdateTime?: string
  shopifyDailyInventoryUpdateMode?: string
  [key: string]: unknown
}

export type ReleaseChange = {
  id: string
  shortId: string
  committedAt: string
  author: string
  title: string
  notes?: string
  type: string
  tags?: string[]
  files?: string[]
  fileCount?: number
  areas?: string[]
  commitUrl?: string
}

type ReleaseGroup = {
  id: string
  version: string
  name: string
  date: string
  publishedAt?: string
  firstCommitAt?: string
  revision?: string
  shortRevision?: string
  primaryType: string
  changeCount: number
  fileCount: number
  areas?: string[]
  types?: Record<string, number>
  tags?: string[]
  current?: boolean
  changes: ReleaseChange[]
}

type DeploymentStatus = {
  environment?: string
  serviceUrl?: string
  status?: string
  revision?: string
  shortRevision?: string
  startedAt?: string
  deployedAt?: string
  failedAt?: string
  updatedAt?: string
  durationSeconds?: number | null
  revisionMatchesHistory?: boolean
}

export type ReleaseHistoryResponse = {
  generatedAt?: string
  source?: string
  repositoryUrl?: string
  current?: ReleaseChange | null
  currentGroup?: ReleaseGroup | null
  deployment?: DeploymentStatus | null
  total: number
  filteredTotal: number
  releaseGroupTotal?: number
  limit: number
  offset: number
  releaseGroups: ReleaseGroup[]
  releases: ReleaseChange[]
}

export type VendorFeedSchedule = {
  id: string
  name: string
  vendorId?: string
  vendorName?: string
  supplierLocationId?: string
  enabled?: boolean
  transport?: string
  ftpHost?: string
  ftpPort?: number
  ftpUsername?: string
  ftpPassword?: string
  ftpPasswordConfigured?: boolean
  ftpRemotePath?: string
  fileFormat?: string
  importTarget?: string
  mappingProfile?: string
  syncMode?: string
  notes?: string
  postImportInventoryMode?: string
  postImportPriceMode?: string
  refreshEnabled?: boolean
  refreshScheduleType?: string
  refreshScheduleTimes?: string
  refreshScheduleEveryHours?: number
  fullImportEnabled?: boolean
  fullImportScheduleType?: string
  fullImportScheduleTimes?: string
  fullImportScheduleEveryHours?: number
  scheduleType?: string
  scheduleTimes?: string
  scheduleEveryHours?: number
  lastQueuedAt?: string
  lastJobId?: string
}

export type LiteState = {
  connections?: ChannelConnection[]
  vendors?: Vendor[]
  brands?: Brand[]
  warehouses?: Array<Record<string, unknown>>
  systemSettings?: SystemSettings
  catalogImportReviews?: CatalogImportReview[]
}

export type AuthPermission = { view?: boolean; read?: boolean; write?: boolean; admin?: boolean; [key: string]: boolean | undefined }
export type AuthPermissionMatrix = Record<string, AuthPermission>
export type AuthPermissionArea = { id: string; label: string; path: string; actions?: string[]; sections?: AuthPermissionArea[]; parentId?: string }
export type AuthPermissionTemplate = { id: string; name: string; description?: string; builtIn?: boolean; version?: number; permissions: AuthPermissionMatrix }
type AuthPermissionAuditDiff = { area?: string; areaLabel?: string; action?: string; before?: boolean; after?: boolean }
export type AuthPermissionAuditEvent = { id: string; type?: string; targetType?: string; targetId?: string; targetName?: string; actorName?: string; message?: string; beforeCount?: number; afterCount?: number; templateId?: string; templateVersion?: number; diffs?: AuthPermissionAuditDiff[]; createdAt?: string }
export type AuthUser = {
  id: string
  name?: string
  fullName?: string
  firstName?: string
  lastName?: string
  displayName?: string
  username?: string
  email?: string
  phone?: string
  mobilePhone?: string
  jobTitle?: string
  department?: string
  team?: string
  location?: string
  manager?: string
  employeeId?: string
  timezone?: string
  avatarUrl?: string
  startDate?: string
  notes?: string
  role?: string
  status?: string
  isMasterAdmin?: boolean
  isSuperuser?: boolean
  featureAccess?: string[]
  mustChangePassword?: boolean
  passwordChangeDueAt?: string
  passwordChangeRequired?: boolean
  permissionTemplateId?: string
  permissionTemplateVersion?: number
  permissions?: AuthPermissionMatrix
  createdAt?: string
  updatedAt?: string
  lastLoginAt?: string
  archivedAt?: string
  passwordConfigured?: boolean
}

type AuthSession = {
  authenticated?: boolean
  user?: AuthUser
  permissionAreas?: AuthPermissionArea[]
}

export type CatalogImportReview = {
  id: string
  sku?: string
  productId?: string
  field?: string
  label?: string
  currentValue?: unknown
  incomingValue?: unknown
  source?: string
  details?: string
  externalUrl?: string
  status?: "pending" | "accepted" | "rejected" | string
  updatedAt?: string
  decidedAt?: string
}

export type CatalogChange = {
  sku?: string
  title?: string
  supplier?: string
  productId?: string
  activeCatalog?: boolean
  field?: string
  before?: unknown
  after?: unknown
  delta?: unknown
  deltaPercent?: number
  direction?: string
  importedAt?: string
}

type ImportJobsResponse = {
  importJobs?: ImportJob[]
  activeJobs?: ImportJob[]
  workerStatus?: WorkerStatus
  total?: number
  page?: number
  limit?: number
}

export type CatalogItem = {
  id?: string
  sku?: string
  title?: string
  brand?: string
  manufacturer?: string
  vendorSku?: string
  supplier?: string
  supplierCode?: string
  sourceSku?: string
  mainCategory?: string
  sourceCategory?: string
  categoryVerified?: boolean
  stockQty?: number
  stockStatus?: string
  cost?: number
  websitePrice?: number
  price?: number
  active?: boolean
  status?: string
  inProducts?: boolean
  productCatalogId?: string
  productCatalogSku?: string
  productCatalogStatus?: string
  productCatalogActive?: boolean
  productCatalogDiffs?: string[]
  toBeDiscontinued?: boolean
  hazardous?: boolean
  alternateVendorCount?: number
  defaultImage?: string
}

export type ProductItem = CatalogItem & {
  sourceOnly?: boolean
  marketplaceTitle?: string
  category?: string
  vendorCategory?: string
  vendor?: string
  barcode?: string
  manufacturer?: string
  mfrPartNumber?: string
  vendorSku?: string
  uom?: string
  uomName?: string
  uomQty?: string | number
  uomDisplay?: string
  isMultiUnit?: boolean
  qty?: number
  reserved?: number
  available?: number
  sourceCost?: number
  sellUnitCost?: number
  listPrice?: number
  msrp?: number
  itemLength?: number
  itemWidth?: number
  itemHeight?: number
  itemWeight?: number
  packageLength?: number
  packageWidth?: number
  packageHeight?: number
  packageWeight?: number
  packageDimensionsLocked?: boolean
  packageDimensionsSource?: string
  packageDimensionsSavedAt?: string
  packageDimensionsSavedBy?: string
  shippingPackageOverride?: boolean
  shipAlone?: boolean
  shippingPreferencesSavedAt?: string
  shippingPreferencesSavedBy?: string
  dimensionalWeight?: number
  shippingClass?: string
  shippingClassOverride?: string
  shippingOverrideReason?: string
  shippingMethod?: string
  shippingClassReason?: string
  externalId?: string
  supplierCode?: string
  stockStatus?: string
  stockUpdatedAt?: string
  lastPricesUpdateAt?: string
  lastPricesUpdateBy?: string
  shopifyId?: string
  shopifyProductId?: string
  shopifyVariantId?: string
  shopifyHandle?: string
  shopifyStatus?: string
  shopifyPublished?: boolean
  shopifyPublishedAt?: string
  shopifyUpdatedAt?: string
  shopifySyncedAt?: string
  shopifyLivePrice?: number
  shopifyLiveInventoryQuantity?: number
  shopifyOnlineStoreUrl?: string
  shopifyVariantSku?: string
  replenishable?: boolean
  replenishableEffective?: boolean
  replenishableUseVendorRules?: boolean
  replenishableQtyUseVendorDefault?: boolean
  replenishableQty?: number
  replenishableChannels?: string[]
  channelInventoryPreview?: Array<{ channel: string; channelName: string; connected?: boolean; enabled: boolean; source: string; physicalAvailable: number; safetyQty: number; targetQty: number; maxQty: number; finalQty: number; suspended: boolean; reason?: string; locationId?: string; locationName?: string; lastSentQty?: number | null; lastSentAt?: string }>
  bypassSafetyQty?: boolean
  effectiveReplenishableQty?: number
  tags?: string[]
  imageCount?: number
  createdAt?: string
  createdBy?: string
  createdMethod?: string
  createdSource?: string
  createdSourceDetail?: string
  systemCreatedFromOrderImport?: boolean
  catalogAttentionRequired?: boolean
  catalogAttentionStatus?: string
  catalogAttentionReason?: string
  updatedAt?: string
  shadowSkuCount?: number
  shopifyVariantCount?: number
  ebayId?: string
  temuId?: string
  temuProductId?: string
  temuListingId?: string
  temuOfferId?: string
  temuSku?: string
  channelStatuses?: Record<string, unknown>
  channelSellingStatus?: Record<string, { status?: string; inactive?: boolean; updatedAt?: string; updatedBy?: string; reason?: string }>
  sources?: Record<string, unknown>
  ebayListing?: {
    variants?: Array<{ sku: string; uomQty: number; status?: string; listingId?: string }>
    status?: string
    offerId?: string
    listingId?: string
    listingUrl?: string
    ebayStatus?: string
    liveState?: string
    liveVerifiedAt?: string
    liveVerificationSource?: string
    lastActiveAt?: string
    marketplaceId?: string
    merchantLocationKey?: string
    categoryId?: string
    categoryPath?: string
    categoryName?: string
    localCategoryId?: string
    localCategoryPath?: string
    liveCategoryId?: string
    liveCategoryPath?: string
    liveCategoryName?: string
    liveCategorySyncedAt?: string
    sourceOfTruth?: string
    importedFromEbayAt?: string
    taxonomyVersion?: string
    condition?: string
    quantity?: number
    price?: number
    currency?: string
    paymentPolicyId?: string
    returnPolicyId?: string
    fulfillmentPolicyId?: string
    publishBlocked?: boolean
    publishError?: string
    publishErrorAt?: string
    publishBlockCode?: string
    publishBlockField?: string
    publishSuggestedFix?: string
    publishRetryable?: boolean
    bestOfferEnabled?: boolean
    bestOfferAutoAcceptPrice?: number
    bestOfferAutoDeclinePrice?: number
    enabled?: boolean
    restricted?: boolean
    restrictionReason?: string
    inventoryConnected?: boolean
    inventorySource?: string
    safetyQty?: number
    maxSellableQty?: number
    minInventoryForAutoListing?: number
    merchantSku?: string
    storeCategoryId?: string
    storeCategoryName?: string
    listingTemplateId?: string
    itemSpecificTemplateId?: string
    identifierType?: string
    identifierValue?: string
    identifierUnavailable?: boolean
    identifierUnavailableText?: string
    ePid?: string
    mpn?: string
    subtitle?: string
    dispatchTimeDays?: number
    packageType?: string
    shippingIrregular?: boolean
    productCompliancePolicyIds?: string[]
    categoryAttributes?: Array<{ id?: string; name?: string; required?: boolean; mode?: string; [key: string]: unknown }>
    history?: Array<{ id?: string; at?: string; action?: string; message?: string; actor?: string; offerId?: string; listingId?: string }>
    settings?: Record<string, string | number | boolean | string[]>
    itemSpecifics?: Record<string, string | string[]>
    updatedAt?: string
    attributesSyncedAt?: string
    promotionStatus?: string
    promotionRatePercent?: number
    promotionCampaignId?: string
    promotionError?: string
    promotedAt?: string
  }
  ebayCategoryComparison?: {
    status?: string
    live?: { id?: string; path?: string; name?: string; syncedAt?: string }
    local?: { id?: string; path?: string; name?: string }
    checkedAt?: string
  }
  shortDescription?: string
  longDescription?: string
  condition?: string
  countryOfOrigin?: string
  hazardous?: boolean
  sdsUrl?: string
  originalSdsUrl?: string
  bulletPoints?: string[]
  seoKeywords?: string
  wildcardSearch?: string
  reorderPoint?: number
  minQuantity?: string | number
  quantityIncrements?: string | number
  leadTime?: string | number
  leadtime?: string | number
  fobPrice?: number
  brandLocked?: boolean
  shopifySystemPrice?: number
  shopifyPriceDelta?: number | null
  shopifyPriceMismatch?: boolean
  shopifyLiveCompareAtPrice?: number | null
  shopifyLiveVariantSku?: string
  shopifySyncSource?: string
  unspsc?: string
  identifiers?: Array<Record<string, unknown>>
  pricingCalculation?: { costBasis?: string; sellUnit?: string; sourceCost?: number; sellUnitCost?: number; primarySellUnitCost?: number; freightAllowance?: number; markupPercent?: number; markedUpPrice?: number; vendorWebsitePrice?: number; minimumAllowedPrice?: number; minimumAllowedPriceEnforced?: boolean; priceSource?: string; finalPrice?: number; ruleNote?: string }
  systemVariants?: Array<{ sku?: string; optionName?: string; optionValue?: string; uomDisplay?: string; uomQty?: number; inventoryMultiplier?: number; quantity?: number; unitCost?: number; price?: number; status?: string; note?: string; generated?: boolean; source?: string }>
  sellingUnits?: { mode: string; sourceQty?: number; individual: boolean; cases: boolean; explicit: boolean }
  shopifyPurchaseVariants?: Array<{ sku?: string; optionName?: string; optionValue?: string; uomDisplay?: string; uomQty?: number; quantity?: number; unitCost?: number; price?: number; compareAtPrice?: number | string; shopifyVariantSku?: string; shopifyVariantId?: string; shopifyLivePrice?: number | null; shopifyLiveInventoryQuantity?: number | null; shopifyPublished?: boolean; shopifyStatus?: string; note?: string }>
  shadowSkus?: Array<{ marketplace?: string; company?: string; shadowSku?: string; marketplaceSku?: string; unitsPerPack?: number; inventoryMultiplier?: number; price?: number; status?: string; inventoryPolicy?: string }>
  vendorOffers?: Array<{ supplier?: string; vendor?: string; sku?: string; vendorSku?: string; cost?: number; qty?: number; stockQty?: number; category?: string; mainCategory?: string; primary?: boolean; updatedAt?: string }>
  productManagerFields?: Record<string, unknown>
  original?: Record<string, unknown> | null
  attributes?: Record<string, unknown>
  sourceCatalogMatches?: Array<Record<string, unknown>>
  images?: Array<string | { url?: string; src?: string }>
  aliases?: Array<{ sku?: string; aliasSku?: string; active?: boolean; source?: string; type?: string; label?: string; uomQty?: number; inventoryMultiplier?: number; createdFromOrderNumber?: string }>
  warehouseCount?: number
  warehouseStock?: Array<{ warehouseId?: string; warehouseCode?: string; warehouseName?: string; warehouse?: string; inventorySourceType?: string; isPhysical?: boolean; aggregate?: boolean; locationBin?: string; qty?: number; reserved?: number; available?: number; reorderPoint?: number; updatedAt?: string }>
  recentChanges?: Array<{ field?: string; previousValue?: string; nextValue?: string; updatedAt?: string; createdAt?: string }>
}

type EbayListingBlockerSample = {
  sku?: string
  title?: string
  supplier?: string
  offerId?: string
  status?: string
  code?: string
  field?: string
  suggestedFix?: string
  retryable?: boolean
  error?: string
  errorAt?: string
  packageWeight?: number
  dimensionalWeight?: number
  packageType?: string
}

type EbayListingBlockerGroup = {
  code: string
  field?: string
  suggestedFix?: string
  retryable?: boolean
  count: number
  samples?: EbayListingBlockerSample[]
}

export type EbayListingBlockerReport = {
  total?: number
  scanned?: number
  limited?: boolean
  retryableTotal?: number
  generatedAt?: string
  groups?: EbayListingBlockerGroup[]
  rows?: EbayListingBlockerSample[]
}

type EbaySyncWarningRow = {
  sku?: string
  title?: string
  supplier?: string
  merchantSku?: string
  listingId?: string
  offerId?: string
  listingUrl?: string
  status?: string
  code?: string
  reason?: string
  suggestedFix?: string
  error?: string
  lastSyncAt?: string
  inventoryApiSkuMissing?: boolean
  source?: string
  jobId?: string
  jobNumber?: number
  price?: number
  quantity?: number
}

type EbaySyncWarningGroup = {
  code?: string
  reason?: string
  suggestedFix?: string
  count?: number
  samples?: EbaySyncWarningRow[]
}

type EbaySyncWarningJob = {
  id?: string
  jobNumber?: number
  status?: string
  message?: string
  errorCount?: number
  finishedAt?: string
}

export type EbaySyncWarningReport = {
  total?: number
  needsRelinkTotal?: number
  scanned?: number
  limited?: boolean
  generatedAt?: string
  groups?: EbaySyncWarningGroup[]
  rows?: EbaySyncWarningRow[]
  latestJobs?: EbaySyncWarningJob[]
}

export type SupplierCoverageEntry = {
  supplier?: string
  supplierCode?: string
  sku?: string
  sourceSku?: string
  vendorSku?: string
  title?: string
  brand?: string
  manufacturer?: string
  mfrPartNumber?: string
  barcode?: string
  category?: string
  sourceCategory?: string
  cost?: number
  qty?: number
  stockQty?: number
  stockStatus?: string
  uom?: string
  uomQty?: string | number
  discontinued?: boolean
  defaultImage?: string
  lastSeenAt?: string
  updatedAt?: string
  matchType?: "primary" | "upc" | "manufacturer-part-number" | "approved-mfr-part-number" | "vendor-sku" | "linked-vendor-sku" | "approved-vendor-sku" | "source-sku" | "exact-sku" | "none"
  matchStatus?: "confirmed" | "pending" | "approved" | "rejected" | string
  reviewId?: string
  confidence?: number | null
  requiresReview?: boolean
}

export type SupplierCoverageResponse = {
  matchType?: SupplierCoverageEntry["matchType"]
  supplierCount?: number
  pendingReviewCount?: number
  matches?: SupplierCoverageEntry[]
}

type CatalogStatusFilter = "" | "source-only" | "managed"

export function normalizeUnifiedCatalogFilters(input: Record<string, string> = {}) {
  const next = { ...input }
  const catalogStatuses = String(next.catalogStatus || "").split("|").filter(Boolean) as CatalogStatusFilter[]
  if (catalogStatuses.length !== 1) delete next.catalogStatus
  if (next.catalogStatus === "source-only") {
    ;["channelStatus", "shippingClass", "creationSource", "verifiedBrand", "createdFrom", "createdTo"].forEach((key) => delete next[key])
  }
  return next
}

export function unifiedCatalogUsesManagedRecords(filters: Record<string, string> = {}) {
  return filters.catalogStatus !== "source-only"
}

export function unifiedCatalogSourceFilters(filters: Record<string, string> = {}) {
  const next = { ...filters }
  const sourceOnly = next.catalogStatus === "source-only"
  delete next.catalogStatus
  ;["channelStatus", "shippingClass", "creationSource", "verifiedBrand", "createdFrom", "createdTo", "vendorScope"].forEach((key) => delete next[key])
  if (sourceOnly) next.productMembership = "not-in-products"
  else delete next.productMembership
  return next
}

export type CatalogResponse = {
  items?: CatalogItem[]
  page?: number
  limit?: number
  totalMatches?: number
  nextCursor?: string
  hasMore?: boolean
  scanned?: number
  partial?: boolean
  indexed?: boolean
  database?: string
  manifest?: { productCount?: number; source?: string; updatedAt?: string; importedAt?: string }
}

export type SourceCatalogFilters = {
  suppliers: string[]
  productMembership: string
  stockStatus: string
  hasStock: string
  stockQtyOperator: string
  stockQty: string
  hazardous: string
  toBeDiscontinued: string
  active: string
  brand: string
  category: string
  manufacturer: string
}

export type SourceCatalogFacets = {
  suppliers?: string[]
  stockStatuses?: string[]
  brands?: string[]
  categories?: string[]
}

export type ShopifyAuthCheck = {
  ok?: boolean
  tokenSource?: string
  hasToken?: boolean
  scope?: string
  scopes?: string[]
  expiresAt?: string
  hasReadShipping?: boolean
  hasReadOrders?: boolean
  hasReadCustomers?: boolean
  missingOrderScopes?: string[]
  shop?: {
    name?: string
    myshopifyDomain?: string
  }
  message?: string
  error?: string
}

type NavigationItem = { id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }

const navGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Operations",
    items: [
      { id: "operations", label: "Orders", icon: ShoppingBag },
      { id: "fulfillment", label: "Fulfillment", icon: Truck },
      { id: "purchasing", label: "Purchasing", icon: Archive },
      { id: "warehouse", label: "Warehouse", icon: Warehouse },
      { id: "accounting", label: "Accounting", icon: FileText },
      { id: "shipping-disputes", label: "Shipping Disputes", icon: FileWarning },
    ],
  },
  {
    label: "Customers",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "messages", label: "Messages", icon: MessageSquare },
    ],
  },
  {
    label: "Reporting",
    items: [
      { id: "sales-reports", label: "Sales Reports", icon: BarChart3 },
      { id: "shipping-reports", label: "Shipping Report", icon: Truck },
    ],
  },
  {
    label: "Catalog",
    items: [
      { id: "catalog", label: "Catalog", icon: PackageSearch },
      { id: "brands", label: "Brands", icon: Store },
      { id: "vendors", label: "Vendors", icon: Warehouse },
    ],
  },
  {
    label: "Channels & Automation",
    items: [
      { id: "channels", label: "Channels", icon: Store },
      { id: "jobs", label: "Jobs", icon: History },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "overview", label: "Overview", icon: Home },
      { id: "ai-chat", label: "David", icon: MessageSquare },
      { id: "wiki", label: "Wiki", icon: FileText },
    ],
  },
]

const catalogSidebarItems: Array<{ label: string; path: string; icon: React.ComponentType<{ className?: string }> }> = [
  { label: "Catalog", path: "/products", icon: Boxes },
  { label: "Import Review", path: "/import-review", icon: FileWarning },
  { label: "SKU Changes", path: "/sku-changes", icon: Activity },
  { label: "Categories", path: "/categories", icon: PackageSearch },
  { label: "Brands", path: "/brands", icon: Store },
  { label: "Vendor Mappings", path: "/vendor-category-mappings", icon: Warehouse },
  { label: "eBay Blockers", path: "/ebay-blockers", icon: AlertTriangle },
  { label: "eBay Sync Warnings", path: "/ebay-sync-warnings", icon: AlertCircle },
  { label: "Attributes", path: "/attributes", icon: CheckCircle2 },
  { label: "Attribute Groups", path: "/groups", icon: Boxes },
  { label: "Inventory", path: "/inventory", icon: Warehouse },
  { label: "Inventory Reports", path: "/inventory/reports", icon: BarChart3 },
  { label: "Templates", path: "/templates", icon: Square },
  { label: "Readiness", path: "/readiness", icon: ShieldCheck },
]

const warehouseSidebarItems: Array<{ label: string; path: string; icon: React.ComponentType<{ className?: string }> }> = [
  { label: "Mobile warehouse", path: "/warehouse/mobile", icon: Warehouse },
  { label: "Warehouses", path: "/warehouse/warehouses", icon: Warehouse },
  { label: "Receiving", path: "/warehouse/receiving", icon: Archive },
  { label: "Warehouse Audits", path: "/warehouse/audits", icon: CheckCircle2 },
  { label: "Bins", path: "/warehouse/bins", icon: Boxes },
  { label: "Fulfillment", path: "/fulfillment", icon: Truck },
]

const purchasingSidebarItems: Array<{ label: string; path: string; icon: React.ComponentType<{ className?: string }> }> = [
  { label: "Purchase orders", path: "/purchasing", icon: Archive },
  { label: "Supplier returns", path: "/purchasing/supplier-returns", icon: RotateCcw },
  { label: "PO reconciliation", path: "/purchasing/reconciliation", icon: FileUp },
]


const viewPaths: Record<AppView, string> = {
  "order-imports": "/orders/tools",
  "order-review": "/orders/data-review",
  accounting: "/accounting",
  "shipping-disputes": "/accounting/shipping-disputes",
  "sales-reports": "/reports/sales",
  "shipping-reports": "/reports/shipping",
  overview: "/",
  jobs: "/jobs",
  "job-detail": "/jobs",
  channels: "/channels",
  catalog: "/products",
  operations: "/orders",
  customers: "/customers",
  "customer-detail": "/customers",
  messages: "/messages",
  warehouse: "/warehouse/warehouses",
  fulfillment: "/fulfillment",
  purchasing: "/purchasing",
  "po-detail": "/purchasing",
  "order-detail": "/orders",
  "return-detail": "/returns",
  "draft-detail": "/drafts",
  "product-detail": "/products",
  "inventory-detail": "/inventory",
  "inventory-reports": "/inventory/reports",
  "category-detail": "/categories",
  vendors: "/vendors",
  brands: "/brands",
  "brand-detail": "/brands",
  "ai-chat": "/ai",
  wiki: "/workspace/wiki",
  settings: "/settings",
}

function viewFromPath(pathname = "/"): AppView {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path === "/orders/tools" || path === "/orders/imports") return "order-imports"
  if (path === "/accounting") return "accounting"
  if (path === "/accounting/shipping-disputes") return "shipping-disputes"
  if (path === "/reports/sales") return "sales-reports"
  if (path === "/reports/shipping") return "shipping-reports"
  if (/^\/customers\/[^/]+$/.test(path)) return "customer-detail"
  if (path.startsWith("/customers")) return "customers"
  if (path.startsWith("/messages")) return "messages"
  if (path === "/orders/data-review") return "order-review"
  if (path === "/orders" || path === "/orders/open" || path === "/orders/all") return "operations"
  if (/^\/jobs\/[^/]+$/.test(path)) return "job-detail"
  if (path.startsWith("/jobs")) return "jobs"
  if (path.startsWith("/channels")) return "channels"
  if (path.startsWith("/orders/")) return "order-detail"
  if (/^\/returns\/[^/]+$/.test(path)) return "return-detail"
  if (path.startsWith("/drafts/")) return "draft-detail"
  if (["/orders", "/drafts", "/returns"].some((prefix) => path.startsWith(prefix))) return "operations"
  if (path.startsWith("/warehouse")) return "warehouse"
  if (path.startsWith("/fulfillment")) return "fulfillment"
  if (path.startsWith("/purchasing")) return "purchasing"
  if (path.startsWith("/purchase-orders/")) return "po-detail"
  if (path === "/inventory/reports") return "inventory-reports"
  if (path.startsWith("/inventory/")) return "inventory-detail"
  if (path.startsWith("/products/")) return "product-detail"
  if (path.startsWith("/categories/")) return "category-detail"
  if (/^\/brands\/[^/]+$/.test(path)) return "brand-detail"
  if (path.startsWith("/brands")) return "brands"
  if (path.startsWith("/products") || path.startsWith("/catalog")) return "catalog"
  if (["/categories", "/source-catalog", "/import-review", "/sku-changes", "/category-review", "/vendor-category-mappings", "/ebay-blockers", "/ebay-sync-warnings", "/attributes", "/groups", "/inventory", "/templates", "/readiness"].some((prefix) => path.startsWith(prefix))) return "catalog"
  if (path.startsWith("/vendors")) return "vendors"
  if (path.startsWith("/ai")) return "ai-chat"
  if (path === "/workspace/wiki") return "wiki"
  if (path.startsWith("/settings")) return "settings"
  return "overview"
}

function appReferencesForView(view: AppView, warehouseMobile = false): AppReferenceName[] {
  const references = new Set<AppReferenceName>()
  if (["overview", "jobs", "brands", "brand-detail"].includes(view)) references.add("vendors")
  if (view === "vendors") references.add("vendorDetails")
  if (["channels", "catalog", "product-detail", "jobs"].includes(view)) references.add("connections")
  if (view === "channels" || warehouseMobile) references.add("warehouses")
  if (view === "settings") references.add("systemSettings")
  return [...references]
}

function vendorReferenceSummary(vendor: Vendor): Vendor {
  return {
    id: vendor.id,
    name: vendor.name,
    code: vendor.code || "",
    status: vendor.status || "active",
    type: vendor.type || "",
    retirement: vendor.retirement || null,
  }
}

function currentAppLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function pushAppLocation(path: string) {
  window.history.pushState({ ...(window.history.state || {}), dataplusFrom: currentAppLocation() }, "", path)
}

export function returnToPreviousLocation(fallback: string) {
  const state = window.history.state as { dataplusFrom?: string } | null
  let hasSameOriginReferrer = false
  try {
    hasSameOriginReferrer = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin
  } catch {
    hasSameOriginReferrer = false
  }
  if (window.history.length > 1 && (Boolean(state?.dataplusFrom) || hasSameOriginReferrer)) {
    window.history.back()
    return
  }
  window.location.assign(fallback)
}

export function HistoryBackButton({ fallback, label, size = "sm", className }: { fallback: string; label: string; size?: "default" | "sm" | "lg" | "icon"; className?: string }) {
  return <Button type="button" size={size} variant="outline" className={className} onClick={() => returnToPreviousLocation(fallback)}><ArrowLeft className="size-4" /> {label}</Button>
}

function jobIdFromPath(pathname = window.location.pathname) {
  const match = pathname.replace(/\/+$/, "").match(/^\/jobs\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : ""
}

export function orderUrlKey(order: Record<string, unknown> = {}) {
  return String(order.id || order.orderId || order.internalOrderNumber || order.orderNumber || order.displayOrderNumber || "").trim()
}

export function orderHref(order: Record<string, unknown> = {}) {
  const key = orderUrlKey(order)
  return `/orders/${encodeURIComponent(key)}`
}

const viewPermissionArea: Record<AppView, string> = {
  "order-imports": "orders",
  "order-review": "orders",
  accounting: "orders.accounting",
  "shipping-disputes": "orders.accounting",
  "sales-reports": "orders.accounting",
  "shipping-reports": "orders.accounting",
  overview: "overview",
  jobs: "jobs.queue",
  "job-detail": "jobs.artifacts",
  channels: "channels.settings",
  catalog: "catalog.products",
  operations: "orders",
  customers: "orders",
  "customer-detail": "orders",
  messages: "orders",
  warehouse: "warehouse.locations",
  fulfillment: "fulfillment.work",
  purchasing: "purchasing.queue",
  "po-detail": "purchasing.po",
  "order-detail": "orders",
  "return-detail": "orders.returns",
  "draft-detail": "orders",
  "product-detail": "catalog.products",
  "inventory-detail": "warehouse.inventory",
  "inventory-reports": "warehouse.inventory",
  "category-detail": "catalog.categories",
  vendors: "vendors.profiles",
  brands: "brands.profiles",
  "brand-detail": "brands.profiles",
  "ai-chat": "ai",
  wiki: "settings.integrations",
  settings: "settings",
}

export function userCan(user: AuthUser | undefined, area: string, action: keyof AuthPermission = "read") {
  if (!user) return false
  if (user.isMasterAdmin) return true
  const permission = user.permissions?.[area] || {}
  const parentArea = area.includes(".") ? area.split(".")[0] : ""
  const parentPermission = parentArea ? (user.permissions?.[parentArea] || {}) : {}
  const childPermissions = !parentArea ? Object.entries(user.permissions || {}).filter(([key]) => key.startsWith(`${area}.`)).map(([, value]) => value || {}) : []
  const allows = (row: AuthPermission) => {
    if (action === "admin") return row.admin === true
    if (action === "write") return row.write === true || row.admin === true
    if (action === "read") return row.read === true || row.view === true || row.write === true || row.admin === true
    if (action === "view") return row.view === true || row.read === true || row.write === true || row.admin === true
    return row[action] === true || row.write === true || row.admin === true
  }
  if (parentArea) return allows(permission) || (!user.permissions?.[area] && allows(parentPermission))
  return allows(permission) || childPermissions.some(allows)
}

function userCanView(user: AuthUser | undefined, view: AppView) {
  return userCan(user, viewPermissionArea[view], "view")
}

export const orderDateRangeOptions = [
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "lastQuarter", label: "Last quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "lastYear", label: "Last year" },
  { value: "allTime", label: "All time" },
  { value: "exact", label: "Exact date" },
  { value: "custom", label: "Custom range" },
] as const

export function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function orderDateRangeBounds(range: string, exactDate = "", customDateTo = "") {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3
  const startOfQuarter = new Date(today.getFullYear(), quarterStartMonth, 1)
  const startOfLastQuarter = new Date(today.getFullYear(), quarterStartMonth - 3, 1)
  const endOfLastQuarter = new Date(startOfQuarter)
  endOfLastQuarter.setDate(0)
  const previousYearStart = new Date(today.getFullYear() - 1, 0, 1)
  const previousYearEnd = new Date(today.getFullYear() - 1, 11, 31)
  const daysAgo = (days: number) => {
    const date = new Date(today)
    date.setDate(date.getDate() - (days - 1))
    return date
  }
  if (range === "exact" && exactDate) return { from: exactDate, to: exactDate, label: new Date(`${exactDate}T12:00:00`).toLocaleDateString() }
  if (range === "custom" && exactDate) {
    const label = customDateTo && customDateTo !== exactDate
      ? `${new Date(`${exactDate}T12:00:00`).toLocaleDateString()} - ${new Date(`${customDateTo}T12:00:00`).toLocaleDateString()}`
      : new Date(`${exactDate}T12:00:00`).toLocaleDateString()
    return { from: exactDate, to: customDateTo || exactDate, label }
  }
  if (range === "last30") return { from: localDateKey(daysAgo(30)), to: "", label: "last 30 days" }
  if (range === "thisQuarter") return { from: localDateKey(startOfQuarter), to: "", label: "this quarter" }
  if (range === "lastQuarter") return { from: localDateKey(startOfLastQuarter), to: localDateKey(endOfLastQuarter), label: "last quarter" }
  if (range === "ytd") return { from: localDateKey(startOfYear), to: "", label: "year to date" }
  if (range === "lastYear") return { from: localDateKey(previousYearStart), to: localDateKey(previousYearEnd), label: "last year" }
  if (range === "allTime") return { from: "", to: "", label: "all time" }
  return { from: localDateKey(daysAgo(7)), to: "", label: "last 7 days" }
}

export function salesDateRangeBounds(range: string, customFrom = "", customTo = "") {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = (date: Date) => localDateKey(date)
  const startOf = (date: Date) => localDateKey(date)
  const daysBack = (days: number) => {
    const date = new Date(today)
    date.setDate(date.getDate() - (days - 1))
    return date
  }
  if (range === "custom") return { from: customFrom, to: customTo || customFrom, label: customFrom && customTo ? `${customFrom} to ${customTo}` : "Custom range" }
  if (range === "today") return { from: startOf(today), to: endOfDay(today), label: "Today" }
  if (range === "yesterday") { const day = new Date(today); day.setDate(day.getDate() - 1); return { from: startOf(day), to: endOfDay(day), label: "Yesterday" } }
  if (range === "last7") return { from: startOf(daysBack(7)), to: endOfDay(today), label: "Last 7 days" }
  if (range === "last30") return { from: startOf(daysBack(30)), to: endOfDay(today), label: "Last 30 days" }
  if (range === "lastMonth") { const start = new Date(today.getFullYear(), today.getMonth() - 1, 1); const end = new Date(today.getFullYear(), today.getMonth(), 0); return { from: startOf(start), to: endOfDay(end), label: "Last month" } }
  if (range === "lastQuarter") { const currentQuarterStart = Math.floor(today.getMonth() / 3) * 3; const start = new Date(today.getFullYear(), currentQuarterStart - 3, 1); const end = new Date(today.getFullYear(), currentQuarterStart, 0); return { from: startOf(start), to: endOfDay(end), label: "Last quarter" } }
  if (range === "lastYear") return { from: `${today.getFullYear() - 1}-01-01`, to: `${today.getFullYear() - 1}-12-31`, label: "Last year" }
  return { from: `${today.getFullYear()}-01-01`, to: endOfDay(today), label: "Year to date" }
}

const permissionActionLabels: Record<string, string> = {
  view: "View",
  edit: "Edit",
  create: "Create",
  delete: "Delete",
  cancel: "Cancel",
  fulfill: "Fulfill",
  refund: "Refund",
  return: "Returns",
  map_sku: "Map SKU",
  notes: "Notes",
  export: "Export",
  pick: "Pick",
  pack: "Pack",
  ship: "Ship",
  labels: "Labels",
  submit: "Submit",
  approve: "Approve",
  receive: "Receive",
  resource: "Re-source",
  adjust: "Adjust",
  transfer: "Transfer",
  audit: "Audit",
  import: "Import",
  map: "Map",
  launch: "Launch",
  sync: "Sync",
  files: "Files",
  feeds: "Feeds",
  credentials: "Credentials",
  webhooks: "Webhooks",
  run: "Run",
  retry: "Retry",
  stop: "Stop",
  cleanup: "Cleanup",
  chat: "Chat",
  configure: "Configure",
  backup: "Backup",
  maintenance: "Maintenance",
  permissions: "Permissions",
  passwords: "Passwords",
  deactivate: "Deactivate",
}

export function permissionActionLabel(action: string) {
  return permissionActionLabels[action] || action.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function scheduleDescription(type: unknown, times: unknown, everyHours: unknown, fallback: string) {
  if (String(type || "times").toLowerCase() === "interval") return `Every ${Math.max(1, Number(everyHours || 12))} hours`
  const values = String(times || fallback).split(/[,;\s]+/).filter(Boolean)
  return values.length ? `At ${values.join(", ")}` : "Not configured"
}

function highlightSearchMatch(value: string, query: string) {
  const text = String(value || "")
  const needle = query.trim()
  if (!needle) return text
  const index = text.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) return text
  return <>{text.slice(0, index)}<mark className="rounded bg-primary/15 px-0.5 text-inherit">{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>
}

export function jobStatusTone(status?: string) {
  const value = String(status || "").toLowerCase()
  if (value === "failed") return "destructive"
  if (value === "warning") return "warning"
  if (value === "queued" || value === "running") return "info"
  if (value === "stopped") return "outline"
  if (["success", "done", "ok", "completed"].includes(value)) return "success"
  return "secondary"
}

export function jobStatusLabel(status?: string) {
  const value = String(status || "").toLowerCase()
  if (["success", "done", "ok", "completed"].includes(value)) return "Completed"
  if (value === "queued") return "Waiting"
  if (value === "running") return "Running"
  if (value === "warning") return "Needs review"
  if (value === "failed") return "Failed"
  if (value === "stopped") return "Stopped"
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown"
}

export function jobProgress(job: ImportJob) {
  const status = String(job.status || "").toLowerCase()
  const active = ["queued", "running"].includes(status)
  const display = (value: number) => active
    ? Math.max(0, Math.min(99, Math.floor(value)))
    : Math.max(0, Math.min(100, Math.round(value)))
  if (job.importProgress?.percent != null) return display(Number(job.importProgress.percent))
  if (["success", "done", "ok", "warning"].includes(status)) return 100
  if (Number(job.progressPercent || 0) > 0) return display(Number(job.progressPercent))
  if (Number(job.totalRows || 0) > 0) {
    return display((Number(job.processedRows || 0) / Number(job.totalRows || 1)) * 100)
  }
  return 0
}

export function isActiveJob(job: ImportJob) {
  return ["queued", "running"].includes(String(job.status || "").toLowerCase())
}

export function isAttentionJob(job: ImportJob) {
  return ["failed", "warning", "stopped"].includes(String(job.status || "").toLowerCase())
}

export function jobCategory(job: ImportJob) {
  return job.category || job.section || "Operations"
}

export function jobRunType(job: ImportJob): "manual" | "automated" {
  const explicit = String(job.jobTrigger || "").toLowerCase()
  if (explicit === "manual") return "manual"
  if (["automated", "scheduled", "system"].includes(explicit)) return "automated"
  const payload = job.workerPayload || {}
  const trigger = String(payload.trigger || "").toLowerCase()
  const actor = String(payload.actor || "").toLowerCase()
  if (
    payload.scheduled === true
    || Boolean(payload.scheduleKey)
    || Boolean(payload.sourceJobId)
    || /^scheduled\b/i.test(String(job.operation || ""))
    || ["automatic", "automation", "scheduled", "schedule", "system", "webhook"].includes(trigger)
    || actor.startsWith("system:")
  ) return "automated"
  return "manual"
}

export function jobChannelLabel(job: ImportJob) {
  if (job.jobChannel) return job.jobChannel
  const payload = job.workerPayload || {}
  const identity = [job.workerTask, job.operation, job.fileName, payload.channelId, payload.channel, payload.marketplace, payload.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  if (identity.includes("walmart")) return "Walmart"
  if (identity.includes("shopify")) return "Shopify"
  if (identity.includes("ebay")) return "eBay"
  if (identity.includes("temu")) return "Temu"
  if (identity.includes("tiktok")) return "TikTok Shop"
  if (identity.includes("whatnot")) return "Whatnot"
  if (identity.includes("amazon")) return "Amazon"
  return "Internal"
}

export function JobContextBadges({ job }: { job: ImportJob }) {
  const automated = jobRunType(job) === "automated"
  return <div className="flex flex-wrap items-center gap-1">
    <Badge variant={automated ? "secondary" : "outline"} className="gap-1 text-[10px]">
      {automated ? <CalendarDays className="size-3" /> : <Play className="size-3" />}
      {automated ? "Automated" : "Manual"}
    </Badge>
    <Badge variant="outline" className="gap-1 text-[10px]"><Store className="size-3" />{jobChannelLabel(job)}</Badge>
  </div>
}

export function isWalmartFeedStatusCheck(job: ImportJob) {
  return job.workerTask === "walmart-feed"
}

export function isEbayLaunchPreflight(job: ImportJob) {
  const identity = `${job.operation || ""} ${job.fileName || ""}`.toLowerCase()
  return job.workerTask === "ebay-listing-launch" && /preflight|listing review|listing-review/.test(identity)
}

export function jobOperationLabel(job: ImportJob) {
  if (isWalmartFeedStatusCheck(job)) return "Walmart feed status check"
  if (isEbayLaunchPreflight(job)) return "eBay launch preflight"
  return job.operation || "Job"
}

export function jobReference(job: ImportJob) {
  return job.jobNumber ? `JOB-${job.jobNumber}` : `Job ${job.id.slice(0, 8)}`
}

export function jobImportMode(job: ImportJob) {
  const mode = String(job.workerPayload?.syncMode || "").toLowerCase()
  if (mode === "reconciliation" || mode === "refresh") return "Refresh"
  if (mode === "full") return "Full import"
  if (mode === "catalog" || mode === "new-only") return "New SKUs"
  if (mode === "split" || mode === "new-and-update") return "New + changed"
  return ""
}

export function jobImportModeDescription(job: ImportJob) {
  const mode = String(job.workerPayload?.syncMode || "").toLowerCase()
  if (mode === "reconciliation" || mode === "refresh") return "Existing catalog records are refreshed for changed inventory, pricing, and lifecycle fields."
  if (mode === "full") return "The source is scanned for new records and approved changes across the catalog."
  if (mode === "catalog" || mode === "new-only") return "Only new catalog records are eligible for import. Existing records are left unchanged."
  if (mode === "split" || mode === "new-and-update") return "New records are added and existing records are updated only when their tracked data changed."
  return ""
}

function jobSettingsHref(job: ImportJob) {
  const payload = job.workerPayload || {}
  const vendorId = String(payload.vendorId || payload.vendor_id || "").trim()
  const text = `${job.operation || ""} ${job.workerTask || ""} ${job.fileName || ""} ${job.category || ""} ${job.section || ""}`.toLowerCase()

  if (vendorId && /feed|ftp|import/.test(text) && !/datawarehouse|datadump/.test(text)) {
    return `/vendors/${encodeURIComponent(vendorId)}`
  }
  if (/datadump|datawarehouse|product dump|source catalog|bson|vendor feed|ftp/.test(text)) {
    return "/settings?tab=data-sources"
  }
  if (/sku.*pair|pair.*audit|sku.*map/.test(text)) {
    return "/channels?tab=setup#shopify-schedules"
  }
  if (/shopify/.test(text) && /inventory/.test(text)) {
    return "/channels?tab=setup#shopify-schedules"
  }
  if (/shopify/.test(text) && /order/.test(text)) {
    return "/channels?tab=setup#shopify-order-import"
  }
  if (/shopify/.test(text) && /price|product|status|taxonomy|publish/.test(text)) {
    return "/channels?tab=actions"
  }
  return "/settings"
}

export function openJobSettings(job: ImportJob) {
  window.history.pushState({}, "", jobSettingsHref(job))
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export function FloatingActions({
  view,
  shopify,
  onNavigate,
  onRefresh,
  onCheckShopify,
  onRefreshShopifyToken,
  onRunShopifyAction,
  onCleanupJobs,
}: {
  view: AppView
  shopify?: ChannelConnection
  onNavigate: (view: AppView) => void
  onRefresh: () => void
  onCheckShopify: () => void
  onRefreshShopifyToken: () => void
  onRunShopifyAction: (options: { path: string; body?: Record<string, unknown>; confirmMessage?: string; successMessage?: string }) => void
  onCleanupJobs: () => void
}) {
  const shopifyStatusLimit = Number(shopify?.settings?.shopifyStatusSyncLimit || 100) || 100
  const pathname = window.location.pathname

  // Order detail provides the same universal dock with order-aware actions.
  // Avoid mounting the generic fallback beside it.
  if (view === "order-detail" || view === "return-detail") return null

  const items = (() => {
    if (view === "operations") return <>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:operations-action", { detail: { action: "import-shopify" } }))}><Store className="size-4" /> Import Shopify orders</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:operations-action", { detail: { action: "refresh" } }))}><RefreshCw className="size-4" /> Refresh orders</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onNavigate("channels")}><Store className="size-4" /> Open Shopify settings</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("jobs")}><Activity className="size-4" /> View order jobs</DropdownMenuItem>
    </>
    if (view === "jobs") return <>
      <DropdownMenuItem onClick={onRefresh}><RefreshCw className="size-4" /> Refresh jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={onCleanupJobs}><RotateCcw className="size-4" /> Clean stale jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("channels")}><Store className="size-4" /> Open channel logs</DropdownMenuItem>
    </>
    if (view === "channels") return <>
      <DropdownMenuItem onClick={onCheckShopify}><ShieldCheck className="size-4" /> Check Shopify connection</DropdownMenuItem>
      <DropdownMenuItem onClick={onRefreshShopifyToken}><RefreshCw className="size-4" /> Request new Shopify token</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/sku-map-sync", successMessage: "Shopify SKU pair audit queued." })}><RotateCcw className="size-4" /> Audit Shopify SKU pairs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/status-sync-all", body: { limit: shopifyStatusLimit }, successMessage: "Shopify status sync queued." })}><RotateCcw className="size-4" /> Sync Shopify status</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onNavigate("jobs")}><Activity className="size-4" /> View jobs</DropdownMenuItem>
    </>
    if (view === "product-detail") return <>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "edit" } }))}><Pencil className="size-4" /> Edit product</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "review-product" } }))}><ShoppingBag className="size-4" /> Review Shopify product</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "review-price" } }))}><ShoppingBag className="size-4" /> Review Shopify price</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "create-product" } }))}><ShoppingBag className="size-4" /> Create Shopify product</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "push-price" } }))}><ShoppingBag className="size-4" /> Push Shopify price</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onNavigate("jobs")}><History className="size-4" /> View channel jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Back to products</DropdownMenuItem>
    </>
    if (view === "category-detail") return <>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:category-action", { detail: { action: "save" } }))}><Save className="size-4" /> Save category</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:category-action", { detail: { action: "sync-attributes" } }))}><RefreshCw className="size-4" /> Sync requirements</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Back to categories</DropdownMenuItem>
    </>
    if (view === "catalog") return <>
      {pathname.startsWith("/source-catalog") ? <>
        <DropdownMenuItem onClick={() => window.location.reload()}><RefreshCw className="size-4" /> Refresh source catalog</DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.location.assign("/import-review")}><FileWarning className="size-4" /> Open import review</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Open products</DropdownMenuItem>
      </> : pathname.startsWith("/categories") ? <>
        <DropdownMenuItem onClick={() => window.location.reload()}><RefreshCw className="size-4" /> Refresh categories</DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.location.assign("/vendor-category-mappings")}><Boxes className="size-4" /> Vendor category mappings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Open products</DropdownMenuItem>
      </> : <>
      <DropdownMenuItem onClick={() => window.open("/api/catalog/changes.csv", "_blank", "noreferrer")}><FileDown className="size-4" /> Export SKU changes</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.open("/api/catalog/closeouts.csv", "_blank", "noreferrer")}><FileDown className="size-4" /> Export closeouts</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/status-sync-all", body: { limit: shopifyStatusLimit }, successMessage: "Shopify status sync queued." })}><RotateCcw className="size-4" /> Sync Shopify status</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/product-create", body: { apply: false, dryRun: true, limit: 100 }, successMessage: "Shopify create dry run queued for eligible products." })}><ShoppingBag className="size-4" /> Review Shopify product launch</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/product-create", body: { apply: true, dryRun: false, limit: 100 }, confirmMessage: "Create up to 100 Shopify-ready products in live Shopify? Review a create dry run first.", successMessage: "Shopify product creation queued." })}><ShoppingBag className="size-4" /> Create Shopify products</DropdownMenuItem>
      </>}
    </>
    if (view === "vendors") return <>
      <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Open catalog</DropdownMenuItem>
    </>
    if (view === "settings") return <>
      <DropdownMenuItem onClick={onRefresh}><RefreshCw className="size-4" /> Refresh settings</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("channels")}><Store className="size-4" /> Open channels</DropdownMenuItem>
    </>
    return <>
      <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Open catalog</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("jobs")}><Activity className="size-4" /> Open jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("channels")}><Store className="size-4" /> Open channels</DropdownMenuItem>
      <DropdownMenuItem onClick={onRefresh}><RefreshCw className="size-4" /> Refresh workspace</DropdownMenuItem>
    </>
  })()

  return (
    <div className="fixed right-5 bottom-5 z-40">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" className="size-12 rounded-full shadow-lg" aria-label="Open page actions" title="Actions">
            <MoreHorizontal className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-64">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function LoginPage({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [username, setUsername] = useState("luis")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    try {
      const session = await api<AuthSession>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      })
      toast.success(`Signed in as ${session.user?.name || session.user?.username || "DataPlus user"}.`)
      onLogin(session)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign in.")
    } finally {
      setLoading(false)
    }
  }

  return <TooltipProvider>
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground"><LockKeyhole className="size-5" /></div>
          <CardTitle>Sign in to DataPlus</CardTitle>
          <CardDescription>Use your assigned login to access permitted workspaces.</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="grid gap-4">
            <Field label="Username"><Input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          </CardContent>
          <CardFooter><Button className="w-full" disabled={loading || !username || !password}>{loading && <Loader2 className="size-4 animate-spin" />} Sign in</Button></CardFooter>
        </form>
      </Card>
      <Toaster richColors />
    </div>
  </TooltipProvider>
}

function App({ companySettings = false, orderTools = false }: { companySettings?: boolean; orderTools?: boolean }) {
  const warehouseMobile = window.location.pathname === "/warehouse/mobile" || window.location.pathname.startsWith("/warehouse/mobile/")
  const companyOnly = companySettings || orderTools || warehouseMobile
  const { resolvedTheme, setTheme } = useTheme()
  const [colorblindMode, setColorblindMode] = useState(() => window.localStorage.getItem("dataplus:color-vision") === "colorblind")
  const [view, setView] = useState<AppView>(() => viewFromPath(window.location.pathname))
  const [state, setState] = useState<LiteState>({})
  const [auth, setAuth] = useState<AuthSession>({})
  const [authLoading, setAuthLoading] = useState(true)
  useEffect(() => {
    const preload = async () => {
      // Purchasing is smaller and used earlier in the buyer workflow. Load it
      // before Fulfillment so the large Fulfillment bundle cannot block it.
      try { await loadPurchasingRoute() } catch { /* A visible route load can retry. */ }
      try { await loadFulfillmentRoute() } catch { /* A visible route load can retry. */ }
    }
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => { void preload() }, { timeout: 4000 })
      return () => window.cancelIdleCallback(idleId)
    }
    const timer = globalThis.setTimeout(() => { void preload() }, 1500)
    return () => globalThis.clearTimeout(timer)
  }, [])
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [activeJobs, setActiveJobs] = useState<ImportJob[]>([])
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({})
  const [jobPageMeta, setJobPageMeta] = useState(() => {
    const jobsTab = new URLSearchParams(window.location.search).get("tab")
    return { page: 1, limit: 10, total: 0, status: "all", query: "", runType: jobsTab === "manual" || jobsTab === "automated" ? jobsTab : "all", channel: "all" }
  })
  const jobPageMetaRef = useRef(jobPageMeta)
  const jobRequestRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const workspaceLoadedRef = useRef(false)
  const workspaceRefreshPendingRef = useRef(false)
  const loadedReferencesRef = useRef(new Set<AppReferenceName>())
  const [checkingShopify, setCheckingShopify] = useState(false)
  const [shopifyAuth, setShopifyAuth] = useState<ShopifyAuthCheck | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string>("")
  const [davidOpen, setDavidOpen] = useState(false)
  const [davidLoaded, setDavidLoaded] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (!auth.authenticated || !auth.user?.id) return
    const path = `${window.location.pathname}${window.location.search}`
    const storageKey = "dataplus:activity-session"
    let sessionId = window.sessionStorage.getItem(storageKey) || ""
    if (!sessionId) {
      sessionId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      window.sessionStorage.setItem(storageKey, sessionId)
    }
    void fetch("/api/activity", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, view, sessionId })
    }).catch(() => undefined)
  }, [auth.authenticated, auth.user?.id, view])
  const [commandOpen, setCommandOpen] = useState(false)
  const [universalQuery, setUniversalQuery] = useState("")
  const [universalResults, setUniversalResults] = useState<UniversalSearchResult[]>([])
  const [universalSearching, setUniversalSearching] = useState(false)
  const [quickFindOpen, setQuickFindOpen] = useState(false)
  const [quickFindQuery, setQuickFindQuery] = useState("")
  const [quickFindProducts, setQuickFindProducts] = useState<QuickProductResult[]>([])
  const [quickOperationsResults, setQuickOperationsResults] = useState<QuickOperationResult[]>([])
  const [quickFindSearching, setQuickFindSearching] = useState(false)
  const quickFindScanRequestRef = useRef(0)
  const quickFindResolvedScanRef = useRef("")
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: "", password: "", confirm: "" })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const authUser = auth.user

  const updateColorblindMode = (enabled: boolean) => {
    setColorblindMode(enabled)
    window.localStorage.setItem("dataplus:color-vision", enabled ? "colorblind" : "standard")
  }

  useEffect(() => {
    if (colorblindMode) document.documentElement.dataset.colorVision = "colorblind"
    else delete document.documentElement.dataset.colorVision
  }, [colorblindMode])

  const signOut = async () => {
    setMobileMenuOpen(false)
    try {
      await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) })
    } catch {
      // Clear client state even if the server session has already expired.
    } finally {
      workspaceLoadedRef.current = false
      loadedReferencesRef.current.clear()
      clearAppStateCache()
      setAuth({ authenticated: false })
      setState({})
      setJobs([])
      setActiveJobs([])
      setSelectedJobId("")
    }
  }

  useEffect(() => {
    let cancelled = false
    api<AuthSession>("/api/auth/session")
      .then((session) => { if (!cancelled) setAuth(session) })
      .catch(() => { if (!cancelled) setAuth({ authenticated: false }) })
      .finally(() => { if (!cancelled) setAuthLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    const onBackLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a")
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.textContent?.trim().toLowerCase().startsWith("back")) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      event.preventDefault()
      returnToPreviousLocation(`${destination.pathname}${destination.search}${destination.hash}`)
    }
    document.addEventListener("click", onBackLinkClick, true)
    return () => document.removeEventListener("click", onBackLinkClick, true)
  }, [])

  useEffect(() => {
    const query = universalQuery.trim()
    if (!commandOpen || query.length < 2) {
      setUniversalResults([])
      setUniversalSearching(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setUniversalSearching(true)
      api<{ results?: UniversalSearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=6`)
        .then((result) => { if (!cancelled) setUniversalResults(result.results || []) })
        .catch(() => { if (!cancelled) setUniversalResults([]) })
        .finally(() => { if (!cancelled) setUniversalSearching(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [commandOpen, universalQuery])

  useEffect(() => {
    const query = quickFindQuery.trim()
    if (!quickFindOpen || query.length < 2) { setQuickFindProducts([]); setQuickOperationsResults([]); setQuickFindSearching(false); return }
    if (quickFindResolvedScanRef.current === query) {
      quickFindResolvedScanRef.current = ""
      setQuickFindSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setQuickFindSearching(true)
      Promise.all([
        api<{ products?: QuickProductResult[] }>(`/api/quick-search/products?q=${encodeURIComponent(query)}&limit=6`, { signal: controller.signal }),
        api<{ results?: QuickOperationResult[] }>(`/api/quick-search/operations?q=${encodeURIComponent(query)}&limit=6`, { signal: controller.signal }),
      ]).then(([products, operations]) => {
        if (controller.signal.aborted) return
        setQuickFindProducts(products.products || [])
        setQuickOperationsResults(operations.results || [])
      }).catch(() => {
        if (!controller.signal.aborted) { setQuickFindProducts([]); setQuickOperationsResults([]) }
      }).finally(() => { if (!controller.signal.aborted) setQuickFindSearching(false) })
    }, 100)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [quickFindOpen, quickFindQuery])

  async function loadJobs(next: Partial<typeof jobPageMeta> = {}, quiet = false) {
    const request = { ...jobPageMetaRef.current, ...next }
    jobPageMetaRef.current = request
    const requestId = ++jobRequestRef.current
    const params = new URLSearchParams({ page: String(request.page), limit: String(request.limit) })
    if (request.status !== "all") params.set("status", request.status)
    if (request.query.trim()) params.set("q", request.query.trim())
    if (request.runType !== "all") params.set("runType", request.runType)
    if (request.channel !== "all") params.set("channel", request.channel)
    try {
      const jobResponse = await api<ImportJobsResponse>(`/api/import-jobs?${params}`)
      if (requestId !== jobRequestRef.current) return
      setJobs(jobResponse.importJobs || [])
      setActiveJobs(jobResponse.activeJobs || (jobResponse.importJobs || []).filter(isActiveJob))
      setWorkerStatus(jobResponse.workerStatus || {})
      const nextMeta = {
        ...request,
        page: Number(jobResponse.page || request.page),
        limit: Number(jobResponse.limit || request.limit),
        total: Number(jobResponse.total || 0),
      }
      jobPageMetaRef.current = nextMeta
      setJobPageMeta(nextMeta)
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Unable to load job history.")
    }
  }

  async function loadJobDetail(job: ImportJob) {
    try {
      const result = await api<{ job: ImportJob }>(`/api/import-jobs/${encodeURIComponent(job.id)}`)
      setJobs((current) => current.some((row) => row.id === result.job.id) ? current.map((row) => row.id === result.job.id ? result.job : row) : [result.job, ...current])
      if (isActiveJob(result.job)) setActiveJobs((current) => [result.job, ...current.filter((row) => row.id !== result.job.id)])
      setSelectedJobId(result.job.id)
    } catch (error) {
      setSelectedJobId(job.id)
      toast.error(error instanceof Error ? error.message : "Unable to load job detail.")
    }
  }

  async function openJobDetail(job: ImportJob) {
    await loadJobDetail(job)
    pushAppLocation(`/jobs/${encodeURIComponent(job.id)}`)
    setView("job-detail")
  }

  async function loadWorkspaceReferences(nextView = view, force = false) {
    const references = appReferencesForView(nextView, warehouseMobile)
    if (!references.length) return
    references.forEach((name) => loadedReferencesRef.current.add(name))
    const result = await loadAppReferences(references, force)
    setState((current) => ({
      ...current,
      ...(references.includes("connections") ? { connections: (result.connections || []) as ChannelConnection[] } : {}),
      ...(references.includes("systemSettings") ? { systemSettings: (result.systemSettings || {}) as SystemSettings } : {}),
      ...(references.includes("vendorDetails") ? { vendors: (result.vendorDetails || []) as Vendor[] } : references.includes("vendors") ? { vendors: (result.vendors || []) as Vendor[] } : {}),
      ...(references.includes("brands") ? { brands: (result.brands || []) as Brand[] } : {}),
      ...(references.includes("warehouses") ? { warehouses: (result.warehouses || []) as Array<Record<string, unknown>> } : {}),
    }))
  }

  async function refreshData({ quiet = false } = {}) {
    if (companySettings || orderTools) { setLoading(false); return }
    if (quiet && (document.hidden || workspaceRefreshPendingRef.current)) return
    // Order details own their data lifecycle. Loading the global shell state here
    // competes with the order query and repeats every minute without feeding this page.
    if (/^\/orders\/[^/]+\/?$/.test(window.location.pathname)) { setLoading(false); return }
    const initialLoad = !workspaceLoadedRef.current
    if (!quiet && initialLoad) setLoading(true)
    if (!quiet && !initialLoad) setRefreshing(true)
    workspaceRefreshPendingRef.current = true
    try {
      const references = appReferencesForView(view, warehouseMobile)
      const [bootstrap, referenceState] = await Promise.all([
        loadAppBootstrap(!quiet),
        references.length ? loadAppReferences(references, !quiet) : Promise.resolve({} as AppProjection),
      ])
      references.forEach((name) => loadedReferencesRef.current.add(name))
      setState((current) => ({
        ...current,
        connections: (references.includes("connections") ? referenceState.connections : bootstrap.connections || current.connections || []) as ChannelConnection[],
        systemSettings: (references.includes("systemSettings") ? referenceState.systemSettings : bootstrap.systemSettings || current.systemSettings || {}) as SystemSettings,
        ...(references.includes("vendorDetails") ? { vendors: (referenceState.vendorDetails || []) as Vendor[] } : references.includes("vendors") ? { vendors: (referenceState.vendors || []) as Vendor[] } : {}),
        ...(references.includes("brands") ? { brands: (referenceState.brands || []) as Brand[] } : {}),
        ...(references.includes("warehouses") ? { warehouses: (referenceState.warehouses || []) as Array<Record<string, unknown>> } : {}),
      }))
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Unable to load DataPlus.")
    } finally {
      workspaceRefreshPendingRef.current = false
      workspaceLoadedRef.current = true
      setLoading(false)
      setRefreshing(false)
    }
    const jobsWorkspaceActive = /^\/(jobs|operations)(\/|$)/.test(window.location.pathname)
    if (jobsWorkspaceActive) void loadJobs({}, quiet)
  }

  async function refreshAppSummary() {
    if (document.hidden || workspaceRefreshPendingRef.current) return
    try {
      const result = await loadAppSummary()
      if (result.workerStatus) setWorkerStatus(result.workerStatus as WorkerStatus)
      const versions = result.versions || {}
      const activeReferences = appReferencesForView(view, warehouseMobile)
      const staleReferences = activeReferences.filter((name) => loadedReferencesRef.current.has(name) && versions[name] && versions[name] !== cachedAppVersion(name))
      if (["connections", "systemSettings", "connectorState"].some((name) => versions[name] && versions[name] !== cachedAppVersion(name))) {
        const bootstrap = await loadAppBootstrap(true)
        setState((current) => ({
          ...current,
          connections: (activeReferences.includes("connections") ? current.connections : bootstrap.connections || current.connections || []) as ChannelConnection[],
          systemSettings: (activeReferences.includes("systemSettings") ? current.systemSettings : bootstrap.systemSettings || current.systemSettings || {}) as SystemSettings,
        }))
      }
      if (staleReferences.length) await loadWorkspaceReferences(view, true)
    } catch {
      // Page-specific data remains usable when the lightweight status poll is unavailable.
    }
  }

  function navigateTo(nextView: AppView) {
    if (companyOnly) { window.location.assign(viewPaths[nextView]); return }
    if (nextView === 'order-imports') { window.location.assign('/orders/tools'); return }
    if (nextView === "purchasing" || nextView === "po-detail") void loadPurchasingRoute()
    if (nextView === "fulfillment") void loadFulfillmentRoute()
    setView(nextView)
    const nextPath = viewPaths[nextView]
    if (window.location.pathname !== nextPath) {
      pushAppLocation(nextPath)
    }
  }

  async function checkShopifyConnection() {
    setCheckingShopify(true)
    try {
      const result = await api<ShopifyAuthCheck>("/api/shopify/auth-check", {
        method: "POST",
        body: JSON.stringify({}),
      })
      setShopifyAuth(result)
      if (result.ok) toast.success(result.message || "Shopify connection is working.")
      else toast.error(result.message || "Shopify is connected, but required import scopes are missing.")
    } catch (error) {
      const result = { ok: false, message: error instanceof Error ? error.message : "Shopify connection failed." }
      setShopifyAuth(result)
      toast.error(result.message)
    } finally {
      setCheckingShopify(false)
    }
  }

  async function refreshShopifyToken() {
    try {
      const result = await api<ShopifyAuthCheck>("/api/shopify/token-refresh", {
        method: "POST",
        body: JSON.stringify({}),
      })
      setShopifyAuth(result)
      toast.success(result.message || "Shopify token refreshed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh Shopify token.")
    }
  }

  async function runShopifyAction({
    path,
    body = {},
    confirmMessage = "",
    successMessage = "Shopify job queued.",
  }: {
    path: string
    body?: Record<string, unknown>
    confirmMessage?: string
    successMessage?: string
  }) {
    if (confirmMessage && !window.confirm(confirmMessage)) return
    try {
      const result = await api<{ job?: ImportJob; importJobs?: ImportJob[]; message?: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      })
      if (result.importJobs) setJobs(result.importJobs)
      else if (result.job) setJobs((current) => [result.job as ImportJob, ...current.filter((job) => job.id !== result.job?.id)])
      toast.success(result.message || successMessage)
      refreshData({ quiet: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue Shopify job.")
    }
  }

  async function mutateJob(path: string, success: string) {
    try {
      const result = await api<ImportJobsResponse>(path, { method: "POST", body: JSON.stringify({}) })
      setJobs(result.importJobs || jobs)
      setActiveJobs(result.activeJobs || (result.importJobs || jobs).filter(isActiveJob))
      toast.success(success)
      void loadJobs({}, true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Job action failed.")
    }
  }

  async function saveChannel(channelId: string, patch: Record<string, unknown>) {
    try {
      const result = await api<{ channel: ChannelConnection }>(`/api/channels/${encodeURIComponent(channelId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setState((current) => {
        const connections = (current.connections || []).map((channel) => channel.id === channelId ? result.channel : channel)
        return { ...current, connections }
      })
      toast.success("Channel settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save channel settings.")
      throw error
    }
  }

  async function saveVendor(vendorId: string, patch: Record<string, unknown>) {
    try {
      const result = await api<{ vendor: Vendor; catalogRefreshJob?: ImportJob | null }>(`/api/vendors/${encodeURIComponent(vendorId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setState((current) => {
        const vendors = (current.vendors || []).map((vendor) => vendor.id === vendorId ? result.vendor : vendor)
        updateAppReference("vendorDetails", vendors)
        updateAppReference("vendors", vendors.map(vendorReferenceSummary))
        return { ...current, vendors }
      })
      toast.success(result.catalogRefreshJob
        ? `Vendor settings saved. Catalog refresh queued as ${jobReference(result.catalogRefreshJob)}.`
        : "Vendor settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save vendor settings.")
      throw error
    }
  }

  async function createBrand(patch: Record<string, unknown>) {
    try {
      const result = await api<{ brand: Brand }>("/api/brands", {
        method: "POST",
        body: JSON.stringify(patch),
      })
      setState((current) => {
        const brands = [result.brand, ...(current.brands || []).filter((brand) => brand.id !== result.brand.id)]
        updateAppReference("brands", brands)
        return { ...current, brands }
      })
      toast.success("Brand created.")
      return result.brand
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create brand.")
      throw error
    }
  }

  async function saveBrand(brandId: string, patch: Record<string, unknown>) {
    try {
      const result = await api<{ brand: Brand }>(`/api/brands/${encodeURIComponent(brandId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setState((current) => {
        const brands = (current.brands || []).map((brand) => brand.id === brandId ? result.brand : brand)
        updateAppReference("brands", brands)
        return { ...current, brands }
      })
      toast.success("Brand profile saved.")
      return result.brand
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save brand.")
      throw error
    }
  }

  async function runBrandAction(brandId: string, action: "enable" | "disable" | "void") {
    try {
      const result = await api<{ brand: Brand }>(`/api/brands/${encodeURIComponent(brandId)}/action`, {
        method: "POST",
        body: JSON.stringify({ action }),
      })
      setState((current) => {
        const brands = (current.brands || []).map((brand) => brand.id === brandId ? result.brand : brand)
        updateAppReference("brands", brands)
        return { ...current, brands }
      })
      toast.success(`Brand ${action === "void" ? "voided" : action === "enable" ? "enabled" : "disabled"}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update brand status.")
      throw error
    }
  }

  async function saveSystemSettings(patch: Record<string, unknown>) {
    try {
      const result = await api<{ systemSettings?: SystemSettings }>("/api/system-settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setState((current) => ({
        ...current,
        systemSettings: result.systemSettings || { ...current.systemSettings, ...patch },
      }))
      toast.success("System settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save system settings.")
      throw error
    }
  }

  useEffect(() => {
    if (!auth.authenticated) return
    if (companySettings || orderTools) { setLoading(false); return }
    refreshData()
    // Poll only the compact version/health summary. Changed references reload
    // independently, while operational pages continue to own their data.
    const timer = window.setInterval(() => { void refreshAppSummary() }, 30_000)
    return () => window.clearInterval(timer)
  }, [auth.authenticated, companySettings, orderTools])

  useEffect(() => {
    if (!auth.authenticated || companySettings || orderTools || !workspaceLoadedRef.current) return
    void loadWorkspaceReferences(view).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Unable to load workspace references.")
    })
  }, [auth.authenticated, companySettings, orderTools, view])

  useEffect(() => {
    if (!auth.authenticated || companyOnly || !["jobs", "operations", "job-detail"].includes(view)) return
    void loadJobs({}, true)
  }, [auth.authenticated, companyOnly, view])

  useEffect(() => {
    if (!authUser || warehouseMobile || userCanView(authUser, view)) return
    const fallback = (["overview", "operations", "catalog", "warehouse", "purchasing", "fulfillment", "channels", "jobs", "settings"] as AppView[]).find((candidate) => userCanView(authUser, candidate)) || "overview"
    navigateTo(fallback)
  }, [authUser, view])

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  useEffect(() => {
    if (view !== "job-detail") return
    const jobId = jobIdFromPath()
    if (!jobId) return
    void loadJobDetail({ id: jobId })
  }, [view])

  const shopify = useMemo(
    () => (state.connections || []).find((connection) => connection.name?.toLowerCase() === "shopify"),
    [state.connections],
  )
  const attentionJobs = jobs.filter(isAttentionJob)
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || (selectedJobId ? undefined : attentionJobs[0] || jobs[0])

  async function changeOwnPassword() {
    if (!authUser) return
    if (passwordDraft.password.length < 8) return toast.error("Password must be at least 8 characters.")
    if (passwordDraft.password !== passwordDraft.confirm) return toast.error("New passwords do not match.")
    setPasswordSaving(true)
    try {
      const result = await api<{ user?: AuthUser }>(`/api/users/${encodeURIComponent(authUser.id)}/password`, {
        method: "POST",
        body: JSON.stringify({ currentPassword: passwordDraft.currentPassword, password: passwordDraft.password, mustChangePassword: false }),
      })
      setAuth((current) => ({ ...current, user: result.user || { ...authUser, mustChangePassword: false, passwordChangeRequired: false, passwordChangeDueAt: "" } }))
      setPasswordDraft({ currentPassword: "", password: "", confirm: "" })
      setPasswordOpen(false)
      toast.success("Password changed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change password.")
    } finally {
      setPasswordSaving(false)
    }
  }

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-muted/30 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading DataPlus session...</div>
  }

  if (!auth.authenticated || !authUser) {
    return <LoginPage onLogin={(session) => { setAuth(session); void refreshData() }} />
  }

  if (warehouseMobile && !authUser.passwordChangeRequired && !passwordOpen) return <TooltipProvider>
    <Suspense fallback={<div className="p-4"><LoadingState /></div>}>
    {userCan(authUser, "warehouse", "view") ? <WarehouseMobileRoute canPurchase={userCan(authUser, "purchasing.po", "view") && userCan(authUser, "purchasing.queue", "view")}
      returns={userCan(authUser, "orders", "view") ? <OperationsPage mobileReturns /> : <p>Returns access is required.</p>}
      fulfillment={userCan(authUser, "fulfillment", "view") ? <FulfillmentPage /> : <p>Fulfillment access is required.</p>}
      inventory={userCan(authUser, "warehouse.inventory", "view") ? <InventoryWorkspace /> : <p>Inventory access is required.</p>}
      brand={<><SystemBrandMark settings={state.systemSettings} className="size-8" /><span className="truncate font-semibold">Warehouse</span></>}
      account={<DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="max-w-44"><Users className="size-4" /><span className="truncate">{authUser.name || authUser.username || "Account"}</span><ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)]"><DropdownMenuLabel><span className="block truncate text-sm text-foreground">{authUser.name || authUser.username}</span><span className="block truncate font-normal">{authUser.role || "Warehouse user"}</span></DropdownMenuLabel><DropdownMenuSeparator /><CompanyMenuItems /><DropdownMenuSeparator /><DropdownMenuItem asChild><a href="/warehouse/warehouses"><Warehouse className="size-4" /> Full app</a></DropdownMenuItem><DropdownMenuItem onClick={() => setPasswordOpen(true)}><LockKeyhole className="size-4" /> Change password</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => void signOut()}><UnlockKeyhole className="size-4" /> Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
      canReceive={userCan(authUser, "warehouse.receiving", "view")}
      canManageBins={userCan(authUser, "warehouse.locations", "view")}
      canAudit={userCan(authUser, "warehouse.audits", "view")}
      warehouses={state.warehouses || []}
      operatorName={authUser.name || authUser.username || "Warehouse"}
      purchaseOrder={(id) => <PurchaseOrderDetailPage key={id} mobileId={id} operatorName={authUser.name || authUser.username || "Warehouse"} />} /> : <div className="p-6">Warehouse access is required. <a href="/" className="underline">Back to app</a></div>}
    </Suspense>
    <NotificationCapture />
    <Toaster richColors closeButton />
  </TooltipProvider>

  const visibleNavGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => userCanView(authUser, item.id)) }))
    .filter((group) => group.items.length)
  const visibleOperationsSidebarItems = userCan(authUser, "orders", "view") ? operationsSidebarItems : []
  const visibleCatalogSidebarItems = catalogSidebarItems.filter((item) => {
    if (item.path === "/brands") return userCan(authUser, "brands", "view")
    if (item.path === "/inventory") return userCan(authUser, "warehouse", "view")
    return userCan(authUser, "catalog", "view")
  })
  const visibleWarehouseSidebarItems = warehouseSidebarItems.filter((item) => item.path === "/fulfillment" ? userCan(authUser, "fulfillment", "view") : userCan(authUser, "warehouse", "view"))
  const visiblePurchasingSidebarItems = userCan(authUser, "purchasing.queue", "view") ? purchasingSidebarItems : []
  const commandNavItems = [
    { label: "Orders", view: "operations" as AppView, path: "/orders" },
    { label: "Customers", view: "customers" as AppView, path: "/customers" },
    { label: "Messages", view: "messages" as AppView, path: "/messages" },
    { label: "Accounting", view: "accounting" as AppView, path: "/accounting" },
    { label: "Shipping disputes", view: "shipping-disputes" as AppView, path: "/accounting/shipping-disputes" },
    { label: "Sales reports", view: "sales-reports" as AppView, path: "/reports/sales" },
    { label: "Shipping report", view: "shipping-reports" as AppView, path: "/reports/shipping" },
    { label: "Fulfillment", view: "fulfillment" as AppView, path: "/fulfillment" },
    { label: "Purchasing", view: "purchasing" as AppView, path: "/purchasing" },
    { label: "Supplier PO reconciliation", view: "purchasing" as AppView, path: "/purchasing/reconciliation" },
    { label: "Products", view: "catalog" as AppView, path: "/products" },
    { label: "Inventory reports", view: "inventory-reports" as AppView, path: "/inventory/reports" },
    { label: "Warehouse", view: "warehouse" as AppView, path: "/warehouse" },
    { label: "Jobs", view: "jobs" as AppView, path: "/jobs" },
    { label: "Channels", view: "channels" as AppView, path: "/channels" },
    { label: "Wiki", view: "wiki" as AppView, path: "/workspace/wiki" },
    { label: "Settings", view: "settings" as AppView, path: "/settings" },
  ].filter((item) => userCanView(authUser, item.view))
  const mobilePrimaryCandidates: NavigationItem[] = [
    { id: "overview", label: "Home", icon: Home },
    { id: "operations", label: "Orders", icon: ShoppingBag },
    { id: "catalog", label: "Catalog", icon: PackageSearch },
    { id: "jobs", label: "Jobs", icon: History },
  ]
  const mobilePrimaryItems = mobilePrimaryCandidates.filter((item) => userCanView(authUser, item.id))
  const mobilePrimaryIds = new Set(mobilePrimaryItems.map((item) => item.id))
  const mobileMoreGroups = visibleNavGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !mobilePrimaryIds.has(item.id)) }))
    .filter((group) => group.items.length)
  const mobileParentView = view === "order-detail" || view === "return-detail" || view === "draft-detail" || view === "order-review" || view === "order-imports"
    ? "operations"
    : view === "product-detail" || view === "inventory-detail" || view === "inventory-reports" || view === "category-detail"
      ? "catalog"
      : view === "job-detail"
        ? "jobs"
        : view
  const openMobileView = (next: AppView) => {
    setMobileMenuOpen(false)
    navigateTo(next)
  }
  const openFirstQuickFindResult = () => {
    const query = quickFindQuery.trim()
    const operationsFirst = /^\d|^(?:po|ret|rma|vr|job)[-#]/i.test(query)
    const operation = quickOperationsResults[0]
    const product = quickFindProducts[0]
    if (operationsFirst && operation) return window.location.assign(operation.href)
    if (product) return window.location.assign(`/products/${encodeURIComponent(product.sku)}`)
    if (operation) window.location.assign(operation.href)
  }
  const quickFindScannedBarcode = async (scannedValue: string) => {
    const barcode = scannedValue.trim()
    if (!barcode) return
    const requestId = ++quickFindScanRequestRef.current
    setQuickFindOpen(false)
    setQuickFindQuery(barcode)
    setQuickFindProducts([])
    setQuickOperationsResults([])
    setQuickFindSearching(true)
    try {
      const result = await api<{ products?: QuickProductResult[] }>(`/api/quick-search/products?q=${encodeURIComponent(barcode)}&limit=12`)
      if (requestId !== quickFindScanRequestRef.current) return
      const products = result.products || []
      const compact = (value: string) => value.replace(/[^a-z0-9]+/gi, "").toLowerCase()
      const normalizedBarcode = compact(barcode)
      const exactMatches = products.filter((product) => compact(String(product.barcode || "")) === normalizedBarcode || String(product.matchLabel || "").toLowerCase() === "upc")
      if (exactMatches.length === 1) {
        window.location.assign(`/products/${encodeURIComponent(exactMatches[0].sku)}`)
        return
      }
      setQuickFindProducts(exactMatches.length ? exactMatches : products)
      quickFindResolvedScanRef.current = barcode
      setQuickFindOpen(true)
      if (exactMatches.length > 1) toast.info(`${numberLabel(exactMatches.length)} products use UPC ${barcode}. Choose the correct SKU.`)
      else toast.error(`No exact catalog SKU was found for UPC ${barcode}.`)
    } catch (error) {
      if (requestId !== quickFindScanRequestRef.current) return
      quickFindResolvedScanRef.current = barcode
      setQuickFindOpen(true)
      toast.error(error instanceof Error ? error.message : "Unable to search this UPC.")
    } finally {
      if (requestId === quickFindScanRequestRef.current) setQuickFindSearching(false)
    }
  }

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon" variant="sidebar" className="dataplus-sidebar">
          <SidebarHeader className="p-3">
            <div className="flex items-center gap-3 rounded-md px-2 py-2">
              <SystemBrandMark settings={state.systemSettings} />
              <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-semibold leading-none">DataPlus</p><p className="mt-1 text-xs text-muted-foreground">Operations console</p></div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {visibleNavGroups.map((group) => <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const catalogActive = item.id === "catalog" && (view === "catalog" || view === "product-detail" || view === "category-detail" || view === "inventory-detail" || view === "inventory-reports")
                    const warehouseActive = item.id === "warehouse" && view === "warehouse"
                    const operationsActive = item.id === "operations" && (view === "operations" || view === "order-detail" || view === "return-detail" || view === "draft-detail" || view === "order-review" || view === "order-imports")
                    const customersActive = item.id === "customers" && (view === "customers" || view === "customer-detail")
                    return <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton isActive={view === item.id || catalogActive || warehouseActive || operationsActive || customersActive} tooltip={item.label} onClick={() => navigateTo(item.id)}><Icon /><span>{item.label}</span></SidebarMenuButton>
                      {item.id === "operations" && operationsActive && <SidebarMenuSub>{visibleOperationsSidebarItems.map((child) => {
                        const ChildIcon = child.icon
                        const active = (window.location.pathname === child.path || window.location.pathname.startsWith(`${child.path}/`)) && !(child.path === "/orders" && (view === "order-review" || view === "order-imports"))
                        return <SidebarMenuSubItem key={child.path}><SidebarMenuSubButton asChild isActive={active}><a href={child.path}><ChildIcon /><span>{child.label}</span></a></SidebarMenuSubButton></SidebarMenuSubItem>
                      })}</SidebarMenuSub>}
                      {item.id === "catalog" && catalogActive && <SidebarMenuSub>{visibleCatalogSidebarItems.map((child) => {
                        const ChildIcon = child.icon
                        const active = child.path === "/categories" ? window.location.pathname === "/categories" || window.location.pathname.startsWith("/categories/") : window.location.pathname === child.path
                        return <SidebarMenuSubItem key={child.path}><SidebarMenuSubButton asChild isActive={active}><a href={child.path}><ChildIcon /><span>{child.label}</span></a></SidebarMenuSubButton></SidebarMenuSubItem>
                      })}</SidebarMenuSub>}
                      {item.id === "warehouse" && warehouseActive && <SidebarMenuSub>{visibleWarehouseSidebarItems.map((child) => {
                        const ChildIcon = child.icon
                        const active = window.location.pathname === child.path || window.location.pathname.startsWith(`${child.path}/`)
                        return <SidebarMenuSubItem key={child.path}><SidebarMenuSubButton asChild isActive={active}><a href={child.path}><ChildIcon /><span>{child.label}</span></a></SidebarMenuSubButton></SidebarMenuSubItem>
                      })}</SidebarMenuSub>}
                      {item.id === "purchasing" && view === "purchasing" && <SidebarMenuSub>{visiblePurchasingSidebarItems.map((child) => {
                        const ChildIcon = child.icon
                        const active = child.path === "/purchasing" ? window.location.pathname === "/purchasing" : window.location.pathname === child.path
                        return <SidebarMenuSubItem key={child.path}><SidebarMenuSubButton asChild isActive={active}><a href={child.path}><ChildIcon /><span>{child.label}</span></a></SidebarMenuSubButton></SidebarMenuSubItem>
                      })}</SidebarMenuSub>}
                    </SidebarMenuItem>
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>)}
          </SidebarContent>
          <SidebarFooter className="p-3">
            <SidebarMenu>
              {userCanView(authUser, "settings") && <SidebarMenuItem><SidebarMenuButton isActive={view === "settings"} tooltip="Settings" onClick={() => navigateTo("settings")}><Settings /><span>Settings</span></SidebarMenuButton></SidebarMenuItem>}
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="dataplus-app-shell dataplus-mobile-shell min-w-0 text-foreground">
          <header className="dataplus-topbar sticky top-0 z-30 px-3 py-2 sm:px-5 sm:py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <SidebarTrigger className="hidden size-8 md:inline-flex" />
                <div className="hidden min-w-0 sm:block">
                  <CompanySwitcher/>
                </div>
                <a href="/" className="sm:hidden" aria-label="DataPlus home"><SystemBrandMark settings={state.systemSettings} /></a>
              </div>
              <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto sm:gap-2">
                <Badge className="hidden md:inline-flex" variant={workerStatus.online ? "success" : "secondary"}>
                  {workerStatus.online ? "Worker online" : "Worker idle"}
                </Badge>
                <Popover open={quickFindOpen} onOpenChange={setQuickFindOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none lg:w-72">
                      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input value={quickFindQuery} onFocus={() => setQuickFindOpen(true)} onChange={(event) => { setQuickFindQuery(event.target.value); setQuickFindOpen(true) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); openFirstQuickFindResult() } }} className="h-9 bg-background pl-8 pr-16 text-sm" placeholder="Quick find SKU, order, or PO" aria-label="Quick find SKU, order, or PO" />
                      <div className="absolute right-1 top-1 flex items-center gap-0.5">
                        {quickFindSearching ? <span className="grid size-6 place-items-center"><Loader2 className="pointer-events-none size-3.5 animate-spin text-muted-foreground" /></span> : quickFindQuery ? <button type="button" className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" title="Clear quick find" aria-label="Clear quick find" onClick={(event) => { event.stopPropagation(); setQuickFindQuery(""); setQuickFindProducts([]); setQuickOperationsResults([]) }}><X className="size-3.5" /></button> : null}
                        <QuickFindBarcodeScanner onScan={(barcode) => { void quickFindScannedBarcode(barcode) }} />
                      </div>
                    </div>
                  </PopoverTrigger>
                  <PopoverContent align="end" onOpenAutoFocus={(event) => event.preventDefault()} className="w-[min(34rem,calc(100vw-1rem))] p-0">
                    <div className="max-h-96 overflow-y-auto p-1">{quickFindQuery.trim().length < 2 ? <p className="p-3 text-sm text-muted-foreground">Type or scan a SKU, alias, internal order, marketplace order, or PO number.</p> : quickFindSearching ? <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching...</p> : quickFindProducts.length || quickOperationsResults.length ? <>{quickOperationsResults.length ? <div><p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-muted-foreground">Orders and POs</p>{quickOperationsResults.map((result) => <button key={`${result.type}-${result.id}`} type="button" className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left hover:bg-muted" onClick={() => window.location.assign(result.href)}>{result.type === "purchase-order" ? <Boxes className="size-4 shrink-0 text-muted-foreground" /> : <ShoppingBag className="size-4 shrink-0 text-muted-foreground" />}<div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium">{result.title}</span><Badge variant="outline" className="px-1.5 py-0 text-[10px]">{result.matchLabel || (result.type === "purchase-order" ? "PO" : "Order")}</Badge></div>{result.channelOrderId ? <p className="truncate text-xs text-muted-foreground">Walmart order {result.channelOrderId}</p> : null}{result.channelPoNumber ? <p className="truncate text-xs text-muted-foreground">Walmart PO {result.channelPoNumber}</p> : result.marketplaceNumber && result.marketplaceNumber !== result.title ? <p className="truncate text-xs text-muted-foreground">Marketplace {result.marketplaceNumber}</p> : null}<p className="truncate text-xs text-muted-foreground">{result.subtitle || "No additional details"}</p></div></button>)}</div> : null}{quickFindProducts.length ? <div><p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-muted-foreground">Products</p>{quickFindProducts.map((product) => <button key={product.id || product.sku} type="button" className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left hover:bg-muted" onClick={() => window.location.assign(`/products/${encodeURIComponent(product.sku)}`)}><PackageSearch className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold">{product.sku}</span><Badge variant="outline" className="px-1.5 py-0 text-[10px]">{product.matchLabel || "Product"}</Badge></div><p className="truncate text-sm">{product.title}</p><p className="truncate text-xs text-muted-foreground">{[product.brand, product.supplier].filter(Boolean).join(" · ") || "Catalog product"}</p></div><span className="shrink-0 text-xs text-muted-foreground">{numberLabel(product.qty)} available</span></button>)}</div> : null}</> : <p className="p-3 text-sm text-muted-foreground">No matching SKU, order, or purchase order.</p>}</div>
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setCommandOpen(true)} title="Search workspace" aria-label="Search workspace"><Search className="size-5" /></Button>
                <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => setCommandOpen(true)} title="Search workspace (Ctrl+K)">
                  <Search className="size-4" /> Search
                  <kbd className="ml-2 rounded border bg-muted px-1 text-[10px] text-muted-foreground">Ctrl K</kbd>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="inline-flex max-w-32 sm:max-w-48"><Users className="size-4" /><span className="truncate">{authUser.name || authUser.username}</span></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)]">
                    <DropdownMenuLabel>
                      <span className="block truncate">{authUser.name || authUser.username}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">{authUser.role || "User"}</span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <CompanyMenuItems />
                    <DropdownMenuSeparator />
                    {userCan(authUser, "warehouse", "view") && <DropdownMenuItem asChild className="sm:hidden"><a href="/warehouse/mobile"><Warehouse className="size-4" /> Warehouse Mobile</a></DropdownMenuItem>}
                    <DropdownMenuCheckboxItem checked={colorblindMode} onCheckedChange={(checked) => updateColorblindMode(checked === true)}><Accessibility className="size-4" /> Colorblind-friendly colors</DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setPasswordOpen(true)}><LockKeyhole className="size-4" /> Change password</DropdownMenuItem>
                    {userCan(authUser, "users", "read") && <DropdownMenuItem onClick={() => { window.history.pushState({}, "", "/settings?tab=users"); setView("settings") }}><Users className="size-4" /> Manage users</DropdownMenuItem>}
                    <DropdownMenuItem onClick={() => void signOut()}><UnlockKeyhole className="size-4" /> Sign out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden rounded-full sm:inline-flex"
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full sm:border sm:bg-background" onClick={() => { setDavidLoaded(true); setDavidOpen(true) }} title="Open David" aria-label="Open David">
                  <MessageSquare className="size-4" />
                </Button>
                <MentionCenter />
                <NotificationCenter />
                <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => refreshData()} disabled={refreshing}>
                  {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {refreshing ? "Refreshing" : "Refresh"}
                </Button>
              </div>
            </div>
          </header>

          <Dialog open={commandOpen} onOpenChange={(open) => { setCommandOpen(open); if (!open) setUniversalQuery("") }}>
            <DialogContent className="app-command-dialog overflow-hidden p-0 sm:max-w-xl">
              <DialogHeader className="sr-only"><DialogTitle>Search DataPlus</DialogTitle><DialogDescription>Search products, orders, customers, tracking numbers, purchase orders, and draft quotes.</DialogDescription></DialogHeader>
              <Command shouldFilter={false}>
                <CommandInput autoFocus value={universalQuery} onValueChange={setUniversalQuery} placeholder="Search SKU, UPC, customer, tracking, order, or PO..." />
                <CommandList>
                  {!universalQuery.trim() && <>
                    <CommandGroup heading="Navigate">
                      {commandNavItems.map((item) => <CommandItem key={item.label} value={item.label} onSelect={() => { setCommandOpen(false); window.history.pushState({}, "", item.path); setView(item.view) }}><Search className="size-4 text-muted-foreground" />{item.label}</CommandItem>)}
                    </CommandGroup>
                    <CommandGroup heading="Quick actions">
                      <CommandItem value="Refresh workspace" onSelect={() => { setCommandOpen(false); void refreshData() }}><RefreshCw className="size-4 text-muted-foreground" />Refresh workspace</CommandItem>
                      <CommandItem value="Ask David" onSelect={() => { setCommandOpen(false); setDavidOpen(true) }}><MessageSquare className="size-4 text-muted-foreground" />Ask David</CommandItem>
                    </CommandGroup>
                  </>}
                  {universalQuery.trim().length === 1 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type at least two characters to search records.</p>}
                  {universalQuery.trim().length >= 2 && universalSearching && <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching DataPlus...</p>}
                  {universalQuery.trim().length >= 2 && !universalSearching && universalResults.length === 0 && <CommandEmpty>No matching products, orders, customers, tracking numbers, POs, quotes, vendors, or returns.</CommandEmpty>}
                  {universalResults.length > 0 && <CommandGroup heading="Records">
                    {universalResults.map((result) => {
                      const ResultIcon = result.type === "product" ? PackageSearch : result.type === "order" ? ShoppingBag : result.type === "purchase-order" ? Boxes : result.type === "vendor" ? Store : result.type === "return" ? Archive : FileText
                      const label = result.type === "purchase-order" ? "Purchase order" : result.type === "draft" ? "Draft quote" : result.type
                      return <CommandItem key={`${result.type}-${result.id}`} value={`${result.title} ${result.subtitle || ""}`} onSelect={() => { setCommandOpen(false); window.location.assign(result.href) }}>
                        <ResultIcon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><p className="truncate font-medium">{highlightSearchMatch(result.title, universalQuery)}</p>{result.matchLabel && <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-medium">Matched {result.matchLabel}</Badge>}</div><p className="truncate text-xs text-muted-foreground">{highlightSearchMatch(result.subtitle || "No additional details", universalQuery)}</p></div>
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
                      </CommandItem>
                    })}
                  </CommandGroup>}
                </CommandList>
              </Command>
            </DialogContent>
          </Dialog>

          <Dialog open={passwordOpen || Boolean(authUser.passwordChangeRequired)} onOpenChange={(open) => { if (!authUser.passwordChangeRequired) setPasswordOpen(open) }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Change password</DialogTitle><DialogDescription>{authUser.passwordChangeRequired ? "Your 14-day grace period has ended. Set your permanent password to continue." : "Update the password for your signed-in account."}</DialogDescription></DialogHeader>
              <div className="grid gap-4">
                <Field label="Current password"><Input type="password" autoComplete="current-password" value={passwordDraft.currentPassword} onChange={(event) => setPasswordDraft((current) => ({ ...current, currentPassword: event.target.value }))} /></Field>
                <Field label="New password"><Input type="password" autoComplete="new-password" value={passwordDraft.password} onChange={(event) => setPasswordDraft((current) => ({ ...current, password: event.target.value }))} /></Field>
                <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={passwordDraft.confirm} onChange={(event) => setPasswordDraft((current) => ({ ...current, confirm: event.target.value }))} /></Field>
              </div>
              <DialogFooter>
                {!authUser.passwordChangeRequired && <Button variant="outline" onClick={() => setPasswordOpen(false)}>Cancel</Button>}
                <Button disabled={passwordSaving || !passwordDraft.currentPassword || !passwordDraft.password || !passwordDraft.confirm} onClick={() => void changeOwnPassword()}>{passwordSaving && <Loader2 className="size-4 animate-spin" />} Save password</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="mobile-app-content min-w-0 p-3 sm:p-5">
            {loading ? (
              <LoadingState />
            ) : (
              <Suspense fallback={<LoadingState label={view === "purchasing" || view === "po-detail" ? "Purchasing" : view === "fulfillment" ? "Fulfillment" : "workspace"} />}>
                {authUser.mustChangePassword && <Alert className="mb-4 border-amber-500/40 bg-amber-500/5"><LockKeyhole className="size-4" /><AlertTitle>{authUser.passwordChangeRequired ? "Password change required" : "Change your password within 14 days"}</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-2">{authUser.passwordChangeDueAt ? `Set your own password by ${dateLabel(authUser.passwordChangeDueAt)}.` : "Your 14-day grace period starts at your next sign-in."}<Button size="sm" variant="outline" onClick={() => setPasswordOpen(true)}>Change password</Button></AlertDescription></Alert>}
                {view === "overview" && (
                  <OverviewPage
                    jobs={jobs}
                    activeJobs={activeJobs}
                    attentionJobs={attentionJobs}
                    shopify={shopify}
                    vendors={state.vendors || []}
                    onOpenJobs={() => navigateTo("jobs")}
                    onOpenShopify={() => navigateTo("channels")}
                  />
                )}
                {view === "jobs" && (
                  <JobsPage
                    jobs={jobs}
                    activeJobs={activeJobs}
                    workerStatus={workerStatus}
                    channels={state.connections || []}
                    vendors={state.vendors || []}
                    systemSettings={state.systemSettings || {}}
                    totalJobs={jobPageMeta.total}
                    page={jobPageMeta.page}
                    pageSize={jobPageMeta.limit}
                    selectedJob={selectedJob}
                    onSelectJob={loadJobDetail}
                    onOpenJobDetail={openJobDetail}
                    onLoadJobs={(next) => loadJobs(next)}
                    onStopJob={(job) => mutateJob(`/api/import-jobs/${encodeURIComponent(job.id)}/stop`, "Job stopped.")}
                    onRetryJob={(job) => mutateJob(`/api/import-jobs/${encodeURIComponent(job.id)}/retry`, "Retry queued.")}
                    onCleanup={() => mutateJob("/api/import-jobs/cleanup", "Jobs cleaned.")}
                    onRefresh={() => refreshData()}
                  />
                )}
                {view === "job-detail" && (
                  <JobDetailPage
                    job={selectedJob}
                    onRetry={(job) => mutateJob(`/api/import-jobs/${encodeURIComponent(job.id)}/retry`, "Retry queued.")}
                    onStop={(job) => mutateJob(`/api/import-jobs/${encodeURIComponent(job.id)}/stop`, "Job stopped.")}
                    onUpdate={loadJobDetail}
                  />
                )}
                {view === "channels" && (
                  <ChannelsPage
                    channels={state.connections || []}
                    warehouses={state.warehouses || []}
                    auth={shopifyAuth}
                    checking={checkingShopify}
                    onCheckShopify={checkShopifyConnection}
                    onRefreshShopifyToken={refreshShopifyToken}
                    onSaveChannel={saveChannel}
                    onRunShopifyAction={runShopifyAction}
                    onRefreshData={() => refreshData({ quiet: true })}
                  />
                )}
                {view === "operations" && <OperationsPage />}
                {view === "customers" && <CustomersPage />}
                {view === "customer-detail" && <CustomerDetailPage />}
                {view === "messages" && <MessagesRoute />}
                {view === "order-review" && <OrderDataReview />}
                {view === "accounting" && <AccountingPage />}
                {view === "shipping-disputes" && <ShippingDisputes isSuperuser={authUser.isSuperuser === true} />}
                {view === "sales-reports" && <SalesReportsPage />}
                {view === "shipping-reports" && <ShippingReportsPage />}
                {view === "warehouse" && <WarehouseWorkspace />}
                {view === "fulfillment" && (window.location.pathname.replace(/\/+$/, "") === "/fulfillment/batches" ? <ShippingBatchesPage /> : <FulfillmentPage />)}
                {view === "purchasing" && <PurchasingRouter operatorName={authUser.name || authUser.username || "Buyer"} />}
                {view === "po-detail" && <PurchaseOrderDetailPage operatorName={authUser.name || authUser.username || "Buyer"} />}
                {view === "order-detail" && <OrderDetailWorkspace />}
                {view === "return-detail" && <RmaDetailPage />}
                {view === "draft-detail" && <DraftQuoteFieldDetailPage />}
                {view === "catalog" && <CatalogPage channels={state.connections || []} />}
                {view === "product-detail" && <StandaloneProductPage />}
                {view === "inventory-detail" && <InventorySkuDetailPage />}
                {view === "inventory-reports" && <InventoryReportsPage />}
                {view === "category-detail" && <StandaloneCategoryPage />}
                {view === "ai-chat" && <DavidChatPage settings={state.systemSettings || {}} onOpenSettings={() => navigateTo("settings")} />}
                {view === "wiki" && <WikiWorkspace settings={state.systemSettings || {}} onSaveSettings={saveSystemSettings} />}
                {view === "vendors" && (
                  <VendorsPage
                    vendors={state.vendors || []}
                    onSaveVendor={saveVendor}
                    onVendorCreated={(vendor) => setState((current) => {
                      const vendors = [vendor, ...(current.vendors || []).filter((row) => row.id !== vendor.id)]
                      updateAppReference("vendorDetails", vendors)
                      updateAppReference("vendors", vendors.map(vendorReferenceSummary))
                      return { ...current, vendors }
                    })}
                  />
                )}
                {view === "brands" && <BrandsPage vendors={state.vendors || []} onCreateBrand={createBrand} />}
                {view === "brand-detail" && <BrandDetailPage vendors={state.vendors || []} onCreateBrand={createBrand} onSaveBrand={saveBrand} onBrandAction={runBrandAction} />}
                {orderTools && <OrderImportsWorkspace/>}
                {view === "settings" && (companySettings ? <CompaniesSettings/> :
                  <SettingsPage
                    settings={state.systemSettings || {}}
                    workerStatus={workerStatus}
                    authUser={authUser}
                    permissionAreas={(auth.permissionAreas || state.systemSettings?.authPermissionAreas || []) as AuthPermissionArea[]}
                    onSaveSettings={saveSystemSettings}
                    onAuthUserChange={(user) => setAuth((current) => ({ ...current, user }))}
                  />
                )}
              </Suspense>
            )}
          </div>
          <nav aria-label="Primary mobile navigation" className="mobile-app-nav fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
            <div className="grid min-h-16 items-stretch px-1" style={{ gridTemplateColumns: `repeat(${mobilePrimaryItems.length + 1}, minmax(0, 1fr))` }}>
              {mobilePrimaryItems.map((item) => {
                const Icon = item.icon
                const active = mobileParentView === item.id
                return <button key={item.id} type="button" aria-current={active ? "page" : undefined} onClick={() => openMobileView(item.id)} className={cn("flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}><Icon className={cn("size-5", active && "stroke-[2.5]")} /><span className="max-w-full truncate">{item.label}</span></button>
              })}
              <button type="button" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)} className={cn("flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium", !mobilePrimaryItems.some((item) => item.id === mobileParentView) ? "text-primary" : "text-muted-foreground")}><MoreHorizontal className="size-5" /><span>More</span></button>
            </div>
          </nav>
          <Drawer open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <DrawerContent className="max-h-[88dvh] md:hidden">
              <DrawerHeader className="border-b text-left">
                <DrawerTitle>DataPlus</DrawerTitle>
                <DrawerDescription className="flex items-center justify-between gap-2"><span className="truncate">{authUser.name || authUser.username}</span><Badge variant={workerStatus.online ? "success" : "secondary"}>{workerStatus.online ? "Online" : "Idle"}</Badge></DrawerDescription>
              </DrawerHeader>
              <div className="overflow-y-auto px-3 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {mobileMoreGroups.map((group) => <section key={`mobile-${group.label}`} className="mb-4"><p className="mb-1 px-2 text-xs font-semibold text-muted-foreground">{group.label}</p><div className="grid grid-cols-2 gap-1">{group.items.map((item) => { const Icon = item.icon; const active = mobileParentView === item.id; return <Button key={`mobile-${item.id}`} variant={active ? "secondary" : "ghost"} className="h-11 min-w-0 justify-start px-3" onClick={() => openMobileView(item.id)}><Icon className="size-4 shrink-0" /><span className="truncate">{item.label}</span></Button> })}</div></section>)}
                <Separator className="my-3" />
                <div className="grid grid-cols-2 gap-1">
                  {userCanView(authUser, "settings") && <Button variant={view === "settings" ? "secondary" : "ghost"} className="h-11 justify-start" onClick={() => openMobileView("settings")}><Settings className="size-4" />Settings</Button>}
                  <Button variant="ghost" className="h-11 justify-start" onClick={() => { setTheme(resolvedTheme === "dark" ? "light" : "dark"); setMobileMenuOpen(false) }}>{resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}{resolvedTheme === "dark" ? "Light mode" : "Dark mode"}</Button>
                  <Button variant={colorblindMode ? "secondary" : "ghost"} className="h-11 justify-start" aria-pressed={colorblindMode} onClick={() => updateColorblindMode(!colorblindMode)}><Accessibility className="size-4" />Colorblind colors</Button>
                  <Button variant="ghost" className="h-11 justify-start" onClick={() => { setMobileMenuOpen(false); setPasswordOpen(true) }}><LockKeyhole className="size-4" />Password</Button>
                  <Button variant="ghost" className="h-11 justify-start" disabled={refreshing} onClick={() => { setMobileMenuOpen(false); void refreshData() }}>{refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing ? "Refreshing" : "Refresh"}</Button>
                  <Button variant="ghost" className="col-span-2 h-11 justify-start text-destructive hover:text-destructive" onClick={() => void signOut()}><UnlockKeyhole className="size-4" />Sign out</Button>
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        </SidebarInset>
        {davidLoaded ? <Suspense fallback={null}><DavidChatDrawer
          open={davidOpen}
          onOpenChange={setDavidOpen}
          settings={state.systemSettings || {}}
          onOpenFull={() => { setDavidOpen(false); navigateTo("ai-chat") }}
          onOpenSettings={() => { setDavidOpen(false); navigateTo("settings") }}
        /></Suspense> : null}
        </SidebarProvider>
        <CatalogImagePreviewLayer />
        <NotificationCapture />
        <Toaster richColors closeButton />
    </TooltipProvider>
  )
}

export function LoadingState({ label = "workspace" }: { label?: string } = {}) {
  return (
    <div className="grid gap-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading {label}...</span>
      </div>
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-96" />
    </div>
  )
}

function DataPlusApp() {
  // A separate mount prevents legacy state and job polling in a company workspace.
  if (['/orders/tools', '/orders/imports'].includes(window.location.pathname.replace(/\/+$/, ''))) return <App orderTools />
  if (window.location.pathname === '/organization') { window.location.replace('/settings?tab=companies'); return null }
  if (window.location.pathname.replace(/\/+$/, '') === '/settings' && new URLSearchParams(window.location.search).get('tab') === 'companies') return <App companySettings />
  return <App />
}

export default DataPlusApp

export async function launchWalmartExisting(selection: { skus: string[]; allFiltered?: boolean; query?: string; filters?: Record<string, string> }) {
  try {
    const response = await fetch('/api/walmart/launch/existing', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to launch on Walmart')
    toast.success(`Walmart launch queued: job ${result.job.jobNumber || result.job.id}. Eligible matches submit automatically in feeds of up to 1,000. Progress and automatic rate-limit waits appear in Jobs.`)
  } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to launch on Walmart') }
}
