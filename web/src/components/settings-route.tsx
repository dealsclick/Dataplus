import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Copy, Database, Eye, FileDown, FileUp, Loader2, LockKeyhole, Mail, PackageSearch, Pencil, Play, Power, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Trash2, Users, Warehouse } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useIsCompactDevice } from "@/hooks/use-mobile"
import { ReturnTemplateSettings } from "./return-template-settings"
import { settingsTabItems } from "./settings-navigation"
import { UserCompanyAccess } from "./user-company-access"
import { SuperuserActivity } from "./superuser-activity"
import { api, dateLabel, numberLabel } from "../lib/client-api"
import {
  Detail, Field, PageHeader, permissionActionLabel, ReleaseHistorySettings, ToggleField,
  userCan, VendorFeedScheduleManager,
} from "../App"
import type {
  AuthPermission, AuthPermissionArea, AuthPermissionAuditEvent, AuthPermissionMatrix,
  AuthPermissionTemplate, AuthUser, ImportJob, LiteState, SupplierIndexStatus,
  SystemSettings, WorkerStatus,
} from "../App"
function SettingsPage({
  settings,
  workerStatus,
  authUser,
  permissionAreas,
  onSaveSettings,
  onAuthUserChange,
}: {
  settings: SystemSettings
  workerStatus: WorkerStatus
  authUser: AuthUser
  permissionAreas: AuthPermissionArea[]
  onSaveSettings: (patch: Record<string, unknown>) => Promise<void>
  onAuthUserChange: (user: AuthUser) => void
}) {
  const compactSettingsNav = useIsCompactDevice()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [testingSmtp, setTestingSmtp] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [testingVeeqo, setTestingVeeqo] = useState(false)
  const [catalogMaintenanceLoading, setCatalogMaintenanceLoading] = useState(false)
  const [catalogMaintenanceConfirm, setCatalogMaintenanceConfirm] = useState<{
    path: string
    label: string
    description: string
    body?: Record<string, unknown>
  } | null>(null)
  const [catalogMaintenanceFeedback, setCatalogMaintenanceFeedback] = useState<{
    kind: "success" | "error"
    message: string
  } | null>(null)
  const [supplierIndexStatus, setSupplierIndexStatus] = useState<SupplierIndexStatus | null>(null)
  const [supplierIndexLoading, setSupplierIndexLoading] = useState(false)
  const [aiUsage, setAiUsage] = useState<Record<string, unknown> | null>(null)
  const [loadingAiUsage, setLoadingAiUsage] = useState(false)
  const [runtime, setRuntime] = useState<Record<string, number> | null>(null)
  const [fulfillmentDiagnostics, setFulfillmentDiagnostics] = useState<Record<string, any> | null>(null)
  const [fulfillmentDiagnosticsLoading, setFulfillmentDiagnosticsLoading] = useState(false)
  const [orderWorkflowSettings, setOrderWorkflowSettings] = useState<Record<string, unknown>>({})
  const [orderWorkflowDraft, setOrderWorkflowDraft] = useState<Record<string, unknown>>({})
  const [orderWorkflowLoading, setOrderWorkflowLoading] = useState(true)
  const [routingResetOpen, setRoutingResetOpen] = useState(false)
  const [routingResetLoading, setRoutingResetLoading] = useState(false)
  const [settingsWarehouses, setSettingsWarehouses] = useState<Array<Record<string, unknown>>>([])
  const [users, setUsers] = useState<AuthUser[]>(() => (Array.isArray(settings.systemUsers) ? settings.systemUsers as AuthUser[] : []))
  const [savedUsers, setSavedUsers] = useState<AuthUser[]>(() => (Array.isArray(settings.systemUsers) ? settings.systemUsers as AuthUser[] : []))
  const [permissionTemplates, setPermissionTemplates] = useState<AuthPermissionTemplate[]>(() => (Array.isArray(settings.authPermissionTemplates) ? settings.authPermissionTemplates as AuthPermissionTemplate[] : []))
  const [savedPermissionTemplates, setSavedPermissionTemplates] = useState<AuthPermissionTemplate[]>(() => (Array.isArray(settings.authPermissionTemplates) ? settings.authPermissionTemplates as AuthPermissionTemplate[] : []))
  const [permissionAuditLog, setPermissionAuditLog] = useState<AuthPermissionAuditEvent[]>(() => (Array.isArray(settings.authPermissionAuditLog) ? settings.authPermissionAuditLog as AuthPermissionAuditEvent[] : []))
  const [selectedUserId, setSelectedUserId] = useState("")
  const [selectedPermissionAreaId, setSelectedPermissionAreaId] = useState("")
  const [permissionSearch, setPermissionSearch] = useState("")
  const [copyUserId, setCopyUserId] = useState("")
  const [copyTemplateId, setCopyTemplateId] = useState("")
  const [userAdminView, setUserAdminView] = useState<"users" | "roles">("users")
  const [templateSearch, setTemplateSearch] = useState("")
  const [compareTemplateId, setCompareTemplateId] = useState("")
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [bulkTemplateId, setBulkTemplateId] = useState("")
  const [showArchivedUsers, setShowArchivedUsers] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [newUserOpen, setNewUserOpen] = useState(false)
  const [newUser, setNewUser] = useState({ name: "", fullName: "", firstName: "", lastName: "", username: "", email: "", phone: "", jobTitle: "", department: "", password: "", permissionTemplateId: "custom" })
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateDraft, setTemplateDraft] = useState<{ id?: string; name: string; description: string; permissions: AuthPermissionMatrix; builtIn?: boolean }>({ name: "", description: "", permissions: {} })
  const [userSaving, setUserSaving] = useState(false)
  const [temporaryPassword, setTemporaryPassword] = useState("")
  const [ownPasswordDraft, setOwnPasswordDraft] = useState({ currentPassword: "", password: "", confirm: "" })
  const [ownPasswordSaving, setOwnPasswordSaving] = useState(false)
  const requestedTab = new URLSearchParams(window.location.search).get("tab")

  const hasActivityAccess = authUser.isSuperuser === true || (authUser.featureAccess || []).includes("user_activity_audit")
  const visibleSettingsTabItems = hasActivityAccess
    ? [...settingsTabItems, { id: "superuser", label: authUser.isSuperuser ? "Superuser" : "User activity" }]
    : settingsTabItems
  const settingsTabs = new Set(visibleSettingsTabItems.map((item) => item.id))
  const [activeTab, setActiveTab] = useState(settingsTabs.has(requestedTab || "") ? String(requestedTab) : "operations")
  const value = (field: string) => draft[field] ?? settings[field]
  const boolValue = (field: string) => Boolean(value(field))
  const physicalSettingsWarehouses = settingsWarehouses.filter((warehouse) => warehouse.isPhysical === true)
  const statenIslandWarehouse = physicalSettingsWarehouses.find((warehouse) => String(warehouse.code || "").toUpperCase() === "WH-SI2" || String(warehouse.name || "").toLowerCase().includes("staten island"))
  const defaultShipFromWarehouseValue = String(value("inventoryDefaultFulfillmentWarehouseId") || statenIslandWarehouse?.id || "none")
  const aiProvider = String(value("aiProvider") || "openai") === "google-ai-studio" ? "google-ai-studio" : "openai"
  const aiKeyField = aiProvider === "google-ai-studio" ? "geminiApiKey" : "openAiApiKey"
  const aiDefaultModel = aiProvider === "google-ai-studio" ? "gemini-3.6-flash" : "gpt-4o-mini"
  const aiKeyConfigured = aiProvider === "google-ai-studio" ? Boolean(settings.geminiApiKeyConfigured) : Boolean(settings.openAiApiKeyConfigured)
  const productDumpProfile = String(value("productDumpResourceProfile") || "large")
  const productDumpProfiles: Record<string, { heapMb: number; batchSize: number }> = {
    conservative: { heapMb: 1024, batchSize: 50 },
    standard: { heapMb: 2048, batchSize: 100 },
    large: { heapMb: 3072, batchSize: 100 },
  }
  const productDumpResources = productDumpProfiles[productDumpProfile] || productDumpProfiles.large
  const aiToolScopeDefinitions = (Array.isArray(settings.aiToolScopeDefinitions) ? settings.aiToolScopeDefinitions : []) as Array<Record<string, unknown>>
  const aiToolScopes = () => (value("aiToolScopes") && typeof value("aiToolScopes") === "object" ? value("aiToolScopes") as Record<string, unknown> : {})
  const usageNumber = (field: string, period = "thirtyDays") => Number((aiUsage?.[period] as Record<string, unknown> | undefined)?.[field] || 0).toLocaleString()
  const workflowValue = (section: string, field: string, fallback: unknown) => orderWorkflowDraft[`${section}.${field}`] ?? ((orderWorkflowSettings[section] as Record<string, unknown> | undefined)?.[field]) ?? fallback
  const canEditUserAccounts = userCan(authUser, "users.accounts", "edit")
  const canCreateUsers = userCan(authUser, "users.accounts", "create")
  const canResetUserPasswords = userCan(authUser, "users.accounts", "passwords")
  const canDeactivateUsers = userCan(authUser, "users.accounts", "deactivate")
  const canEditUserPermissions = userCan(authUser, "users.permissions", "permissions")
  const userAreas = permissionAreas.length ? permissionAreas : ((Array.isArray(settings.authPermissionAreas) ? settings.authPermissionAreas : []) as AuthPermissionArea[])
  const selectedUser = users.find((user) => user.id === selectedUserId) || users[0]
  const savedSelectedUser = savedUsers.find((user) => user.id === selectedUser?.id)
  const selectedTemplateId = selectedUser?.isMasterAdmin ? "master-admin" : (selectedUser?.permissionTemplateId || "custom")
  const selectedUserDirty = Boolean(selectedUser && JSON.stringify(selectedUser) !== JSON.stringify(savedSelectedUser || null))

  const loadAiUsage = async () => {
    setLoadingAiUsage(true)
    try {
      const result = await api<{ usage?: Record<string, unknown> }>("/api/ai/usage")
      setAiUsage(result.usage || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load AI usage.")
    } finally { setLoadingAiUsage(false) }
  }

  useEffect(() => { void loadAiUsage() }, [])
  useEffect(() => {
    void api<Record<string, number>>("/api/system/runtime").then(setRuntime).catch(() => setRuntime(null))
  }, [])
  useEffect(() => {
    setOrderWorkflowLoading(true)
    void api<{ settings?: Record<string, unknown> }>("/api/order-workflows")
      .then((result) => setOrderWorkflowSettings(result.settings || {}))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Unable to load order-routing settings."))
      .finally(() => setOrderWorkflowLoading(false))
  }, [])
  useEffect(() => {
    void api<LiteState>("/api/state?lite=1")
      .then((state) => setSettingsWarehouses((state.warehouses || []) as Array<Record<string, unknown>>))
      .catch(() => setSettingsWarehouses([]))
  }, [])
  useEffect(() => {
    if (activeTab === "users" && users.length) return
    const nextUsers = Array.isArray(settings.systemUsers) ? settings.systemUsers as AuthUser[] : []
    setUsers(nextUsers)
    setSavedUsers(nextUsers)
  }, [settings.systemUsers, activeTab, users.length])
  useEffect(() => {
    if (activeTab === "users" && permissionTemplates.length) return
    const nextTemplates = Array.isArray(settings.authPermissionTemplates) ? settings.authPermissionTemplates as AuthPermissionTemplate[] : []
    setPermissionTemplates(nextTemplates)
    setSavedPermissionTemplates(nextTemplates)
  }, [settings.authPermissionTemplates, activeTab, permissionTemplates.length])
  useEffect(() => {
    if (activeTab !== "users") return
    void loadUsers()
  }, [activeTab])
  useEffect(() => {
    if (selectedUserId || !users.length) return
    setSelectedUserId(users[0].id)
  }, [users, selectedUserId])
  useEffect(() => {
    if (!userAreas.length) return
    if (selectedPermissionAreaId && userAreas.some((area) => area.id === selectedPermissionAreaId)) return
    setSelectedPermissionAreaId(userAreas[0].id)
  }, [userAreas, selectedPermissionAreaId])

  const loadSupplierIndexStatus = async () => {
    setSupplierIndexLoading(true)
    try {
      setSupplierIndexStatus(await api<SupplierIndexStatus>("/api/catalog/supplier-index/status"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load supplier index status.")
    } finally {
      setSupplierIndexLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === "catalog") void loadSupplierIndexStatus()
  }, [activeTab])

  const loadFulfillmentDiagnostics = async () => {
    setFulfillmentDiagnosticsLoading(true)
    try {
      setFulfillmentDiagnostics(await api<Record<string, any>>("/api/fulfillment/diagnostics"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load Fulfillment diagnostics.")
    } finally {
      setFulfillmentDiagnosticsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === "fulfillment") void loadFulfillmentDiagnostics()
  }, [activeTab])

  function update(field: string, next: unknown) {
    setDraft((current) => ({ ...current, [field]: next }))
  }

  const shippingPackagePresets = (Array.isArray(value("shippingPackagePresets")) ? value("shippingPackagePresets") as Array<Record<string, unknown>> : [])
  const updateShippingPackagePreset = (index: number, patch: Record<string, unknown>) => {
    const next = shippingPackagePresets.map((preset, presetIndex) => presetIndex === index ? { ...preset, ...patch } : preset)
    update("shippingPackagePresets", next)
  }
  const addShippingPackagePreset = () => {
    update("shippingPackagePresets", [...shippingPackagePresets, { id: `package-${Date.now()}`, name: "New package", packageType: "box", weight: 0, length: 0, width: 0, height: 0, maxWeight: 150, weightUnit: "lb", dimensionUnit: "in", default: shippingPackagePresets.length === 0 }])
  }
  const removeShippingPackagePreset = (index: number) => {
    const next = shippingPackagePresets.filter((_, presetIndex) => presetIndex !== index)
    update("shippingPackagePresets", next.length && !next.some((preset) => preset.default) ? next.map((preset, presetIndex) => ({ ...preset, default: presetIndex === 0 })) : next)
  }

  function updateWorkflow(section: string, field: string, next: unknown) {
    setOrderWorkflowDraft((current) => ({ ...current, [`${section}.${field}`]: next }))
  }

  async function loadUsers() {
    try {
      const result = await api<{ users?: AuthUser[]; permissionAreas?: AuthPermissionArea[]; permissionTemplates?: AuthPermissionTemplate[]; permissionAuditLog?: AuthPermissionAuditEvent[] }>("/api/users")
      setUsers(result.users || [])
      setSavedUsers(result.users || [])
      setPermissionTemplates(result.permissionTemplates || [])
      setSavedPermissionTemplates(result.permissionTemplates || [])
      setPermissionAuditLog(result.permissionAuditLog || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load users.")
    }
  }

  async function createLogin() {
    setUserSaving(true)
    setTemporaryPassword("")
    try {
      const result = await api<{ user?: AuthUser; users?: AuthUser[]; temporaryPassword?: string }>("/api/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      })
      setUsers(result.users || (result.user ? [...users, result.user] : users))
      setSavedUsers(result.users || (result.user ? [...savedUsers, result.user] : savedUsers))
      if (result.user?.id) setSelectedUserId(result.user.id)
      setTemporaryPassword(result.temporaryPassword || "")
      setNewUser({ name: "", fullName: "", firstName: "", lastName: "", username: "", email: "", phone: "", jobTitle: "", department: "", password: "", permissionTemplateId: "custom" })
      setNewUserOpen(false)
      void loadUsers()
      toast.success("Login created.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create login.")
    } finally {
      setUserSaving(false)
    }
  }

  async function saveUser(userId: string, patch: Partial<AuthUser>) {
    setUserSaving(true)
    try {
      const result = await api<{ user?: AuthUser; users?: AuthUser[] }>(`/api/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setUsers(result.users || users.map((user) => user.id === userId ? { ...user, ...(result.user || patch) } : user))
      setSavedUsers(result.users || users.map((user) => user.id === userId ? { ...user, ...(result.user || patch) } : user))
      void loadUsers()
      toast.success("User profile saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save user.")
    } finally {
      setUserSaving(false)
    }
  }

  async function resetUserPassword(userId: string) {
    setUserSaving(true)
    setTemporaryPassword("")
    try {
      const result = await api<{ user?: AuthUser; users?: AuthUser[]; temporaryPassword?: string }>(`/api/users/${encodeURIComponent(userId)}/password`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      setUsers(result.users || users)
      setSavedUsers(result.users || users)
      void loadUsers()
      setTemporaryPassword(result.temporaryPassword || "")
      toast.success("Temporary password generated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reset password.")
    } finally {
      setUserSaving(false)
    }
  }

  async function changeOwnPassword() {
    if (!ownPasswordDraft.currentPassword) return toast.error("Enter your current password.")
    if (ownPasswordDraft.password.length < 8) return toast.error("New password must be at least 8 characters.")
    if (ownPasswordDraft.password !== ownPasswordDraft.confirm) return toast.error("New passwords do not match.")
    setOwnPasswordSaving(true)
    try {
      const result = await api<{ user?: AuthUser }>(`/api/users/${encodeURIComponent(authUser.id)}/password`, {
        method: "POST",
        body: JSON.stringify({ currentPassword: ownPasswordDraft.currentPassword, password: ownPasswordDraft.password }),
      })
      if (result.user) {
        onAuthUserChange(result.user)
        setUsers((current) => current.map((user) => user.id === result.user?.id ? result.user : user))
        setSavedUsers((current) => current.map((user) => user.id === result.user?.id ? result.user : user))
      }
      setOwnPasswordDraft({ currentPassword: "", password: "", confirm: "" })
      toast.success("Password changed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change password.")
    } finally {
      setOwnPasswordSaving(false)
    }
  }

  function updateSelectedUserField(field: keyof AuthUser, value: string) {
    if (!selectedUser) return
    setUsers((current) => current.map((user) => user.id === selectedUser.id ? { ...user, [field]: value } : user))
  }

  function updateSelectedUserStatus(nextStatus: string) {
    if (!selectedUser || selectedUser.isMasterAdmin) return
    if (["inactive", "archived"].includes(nextStatus) && selectedUser.status !== nextStatus && !window.confirm(`${nextStatus === "archived" ? "Archive" : "Deactivate"} ${selectedUser.name || selectedUser.username}? This signs out their active sessions after you save.`)) return
    setUsers((current) => current.map((user) => user.id === selectedUser.id ? { ...user, status: nextStatus } : user))
  }

  async function archiveSelectedUser() {
    if (!selectedUser || selectedUser.isMasterAdmin) return
    if (!window.confirm(`Archive ${selectedUser.name || selectedUser.username}? They will no longer be able to sign in.`)) return
    setUserSaving(true)
    try {
      const result = await api<{ user?: AuthUser; users?: AuthUser[] }>(`/api/users/${encodeURIComponent(selectedUser.id)}`, { method: "DELETE" })
      setUsers(result.users || users.map((user) => user.id === selectedUser.id ? { ...user, status: "archived" } : user))
      setSavedUsers(result.users || savedUsers.map((user) => user.id === selectedUser.id ? { ...user, status: "archived" } : user))
      void loadUsers()
      toast.success("User archived.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to archive user.")
    } finally {
      setUserSaving(false)
    }
  }

  async function bulkUpdateUsers(action: "template" | "inactive" | "archived") {
    const selectedIds = Array.from(selectedUserIds)
    if (!selectedIds.length) return
    const selectedNames = users.filter((user) => selectedIds.includes(user.id)).map((user) => user.name || user.username).join(", ")
    if (!window.confirm(`Apply this bulk change to ${selectedIds.length} user${selectedIds.length === 1 ? "" : "s"}: ${selectedNames}?`)) return
    setUserSaving(true)
    try {
      for (const userId of selectedIds) {
        const user = users.find((candidate) => candidate.id === userId)
        if (!user || user.isMasterAdmin) continue
        if (action === "template") {
          const template = permissionTemplates.find((candidate) => candidate.id === bulkTemplateId)
          if (!template) continue
          await api(`/api/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ ...user, permissionTemplateId: template.id }) })
        } else if (action === "inactive") {
          await api(`/api/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ ...user, status: "inactive" }) })
        } else {
          await api(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" })
        }
      }
      setSelectedUserIds(new Set())
      await loadUsers()
      toast.success("Bulk user update completed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk update failed.")
    } finally {
      setUserSaving(false)
    }
  }

  function exportSelectedPermissions() {
    if (!selectedUser) return
    const payload = {
      exportedAt: new Date().toISOString(),
      user: { id: selectedUser.id, username: selectedUser.username, name: selectedUser.name },
      permissionTemplateId: selectedUser.permissionTemplateId || "custom",
      permissions: selectedUser.permissions || {},
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `dataplus-permissions-${selectedUser.username || selectedUser.id}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function importSelectedPermissions(file?: File | null) {
    if (!selectedUser || selectedUser.isMasterAdmin || !file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"))
        const permissions = parsed.permissions && typeof parsed.permissions === "object" ? parsed.permissions as AuthPermissionMatrix : parsed
        if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) throw new Error("Invalid permission file.")
        setSelectedPermissions(permissions)
        toast.success("Permissions imported. Save the user to apply them.")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to import permissions.")
      }
    }
    reader.readAsText(file)
  }


  function updateSelectedPermission(areaId: string, action: keyof AuthPermission, enabled: boolean) {
    if (!selectedUser || selectedUser.isMasterAdmin) return
    const permissions = { ...(selectedUser.permissions || {}) }
    permissions[areaId] = { ...(permissions[areaId] || {}), [action]: enabled }
    setUsers((current) => current.map((user) => user.id === selectedUser.id ? { ...user, permissionTemplateId: "custom", permissions } : user))
  }

  function setSelectedPermissions(nextPermissions: AuthPermissionMatrix) {
    if (!selectedUser || selectedUser.isMasterAdmin) return
    setUsers((current) => current.map((user) => user.id === selectedUser.id ? { ...user, permissionTemplateId: "custom", permissionTemplateVersion: 0, permissions: nextPermissions } : user))
  }

  function applyPermissionTemplate(templateId: string) {
    if (!selectedUser || selectedUser.isMasterAdmin) return
    if (templateId !== "custom" && (selectedUserDirty || selectedTemplateId === "custom") && !window.confirm("Apply this template and replace the user's current permission checks?")) return
    if (templateId === "custom") {
      setUsers((current) => current.map((user) => user.id === selectedUser.id ? { ...user, permissionTemplateId: "custom", permissionTemplateVersion: 0 } : user))
      return
    }
    const template = permissionTemplates.find((candidate) => candidate.id === templateId)
    if (!template) return
    setUsers((current) => current.map((user) => user.id === selectedUser.id ? { ...user, permissionTemplateId: template.id, permissionTemplateVersion: template.version || 1, permissions: template.permissions } : user))
  }

  function copyPermissionsFromUser() {
    if (!selectedUser || selectedUser.isMasterAdmin || !copyUserId) return
    const source = users.find((user) => user.id === copyUserId)
    if (!source || !window.confirm(`Copy permissions from ${source.name || source.username} to ${selectedUser.name || selectedUser.username}?`)) return
    setSelectedPermissions({ ...(source.permissions || {}) })
  }

  function copyPermissionsFromTemplate() {
    if (!selectedUser || selectedUser.isMasterAdmin || !copyTemplateId) return
    const source = permissionTemplates.find((template) => template.id === copyTemplateId)
    if (!source || !window.confirm(`Copy template ${source.name} to ${selectedUser.name || selectedUser.username}?`)) return
    setSelectedPermissions({ ...(source.permissions || {}) })
  }

  function openTemplateDialog(template?: AuthPermissionTemplate) {
    setTemplateDraft(template ? { id: template.id, name: template.name, description: template.description || "", permissions: template.permissions, builtIn: template.builtIn } : { name: "", description: "", permissions: selectedUser?.permissions || {} })
    setTemplateDialogOpen(true)
  }

  function openBlankTemplateDialog() {
    setTemplateDraft({ name: "", description: "", permissions: {} })
    setTemplateDialogOpen(true)
  }

  function updateTemplateDraftPermission(areaId: string, action: keyof AuthPermission, enabled: boolean) {
    setTemplateDraft((current) => ({
      ...current,
      permissions: {
        ...(current.permissions || {}),
        [areaId]: { ...(current.permissions?.[areaId] || {}), [action]: enabled },
      },
    }))
  }

  async function savePermissionTemplate() {
    setUserSaving(true)
    try {
      const editingTemplate = Boolean(templateDraft.id)
      const result = await api<{ template?: AuthPermissionTemplate; permissionTemplates?: AuthPermissionTemplate[] }>(editingTemplate ? `/api/users/templates/${encodeURIComponent(String(templateDraft.id))}` : "/api/users/templates", {
        method: editingTemplate ? "PATCH" : "POST",
        body: JSON.stringify(templateDraft),
      })
      setPermissionTemplates(result.permissionTemplates || (result.template ? [...permissionTemplates.filter((template) => template.id !== result.template?.id), result.template] : permissionTemplates))
      setSavedPermissionTemplates(result.permissionTemplates || (result.template ? [...savedPermissionTemplates.filter((template) => template.id !== result.template?.id), result.template] : savedPermissionTemplates))
      setTemplateDialogOpen(false)
      void loadUsers()
      toast.success(editingTemplate ? "Permission template saved." : "Permission template created.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save permission template.")
    } finally {
      setUserSaving(false)
    }
  }

  async function deletePermissionTemplate(templateId: string) {
    if (!window.confirm("Delete this permission template? Users using it will become Custom.")) return
    setUserSaving(true)
    try {
      const result = await api<{ users?: AuthUser[]; permissionTemplates?: AuthPermissionTemplate[] }>(`/api/users/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" })
      setPermissionTemplates(result.permissionTemplates || permissionTemplates.filter((template) => template.id !== templateId))
      setSavedPermissionTemplates(result.permissionTemplates || savedPermissionTemplates.filter((template) => template.id !== templateId))
      setUsers(result.users || users.map((user) => user.permissionTemplateId === templateId ? { ...user, permissionTemplateId: "custom" } : user))
      setSavedUsers(result.users || savedUsers.map((user) => user.permissionTemplateId === templateId ? { ...user, permissionTemplateId: "custom" } : user))
      void loadUsers()
      toast.success("Permission template deleted.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete permission template.")
    } finally {
      setUserSaving(false)
    }
  }

  async function duplicatePermissionTemplate(template: AuthPermissionTemplate) {
    const name = window.prompt("Name for duplicated template", `${template.name} copy`)
    if (!name?.trim()) return
    setUserSaving(true)
    try {
      const result = await api<{ template?: AuthPermissionTemplate; permissionTemplates?: AuthPermissionTemplate[] }>("/api/users/templates", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: template.description ? `Copied from ${template.name}. ${template.description}` : `Copied from ${template.name}.`,
          permissions: template.permissions || {},
        }),
      })
      setPermissionTemplates(result.permissionTemplates || (result.template ? [...permissionTemplates, result.template] : permissionTemplates))
      setSavedPermissionTemplates(result.permissionTemplates || (result.template ? [...savedPermissionTemplates, result.template] : savedPermissionTemplates))
      if (result.template?.id) setCompareTemplateId(result.template.id)
      void loadUsers()
      toast.success("Permission template duplicated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to duplicate permission template.")
    } finally {
      setUserSaving(false)
    }
  }

  function permissionEnabled(row: AuthPermission, action: string) {
    return Boolean(selectedUser?.isMasterAdmin || row[action] === true || row.admin === true || row.write === true)
  }

  function permissionMatrixCount(permissions?: AuthPermissionMatrix) {
    return userAreas.reduce((sum, area) => sum + areaPermissionRows(area).reduce((areaSum, row) => areaSum + (row.actions || []).filter((action) => permissions?.[row.id]?.[action] === true || permissions?.[row.id]?.write === true || permissions?.[row.id]?.admin === true).length, 0), 0)
  }

  function templateName(id?: string) {
    if (!id || id === "custom") return "Custom"
    if (id === "master-admin") return "Master admin"
    return permissionTemplates.find((template) => template.id === id)?.name || "Custom"
  }

  function userPermissionSummary(user: AuthUser) {
    if (user.isMasterAdmin) return "Master admin"
    return `${templateName(user.permissionTemplateId)} · ${permissionMatrixCount(user.permissions)} enabled`
  }

  function userCanFromMatrix(user: AuthUser, areaId: string, action: string) {
    if (user.isMasterAdmin) return true
    const row = user.permissions?.[areaId] || {}
    return row[action] === true || row.write === true || row.admin === true || (action === "view" && (row.view === true || row.read === true))
  }

  function matrixActionEnabled(matrix: AuthPermissionMatrix | undefined, areaId: string, action: string) {
    const row = matrix?.[areaId] || {}
    return row[action] === true || row.write === true || row.admin === true || (action === "view" && (row.view === true || row.read === true))
  }

  function templateUsers(templateId: string) {
    return users.filter((user) => user.permissionTemplateId === templateId)
  }

  function permissionMatrixDiffs(left?: AuthPermissionMatrix, right?: AuthPermissionMatrix) {
    const diffs: Array<{ areaId: string; label: string; action: string; left: boolean; right: boolean }> = []
    for (const area of userAreas.flatMap((item) => areaPermissionRows(item))) {
      for (const action of area.actions || []) {
        const leftEnabled = matrixActionEnabled(left, area.id, action)
        const rightEnabled = matrixActionEnabled(right, area.id, action)
        if (leftEnabled !== rightEnabled) diffs.push({ areaId: area.id, label: area.label, action, left: leftEnabled, right: rightEnabled })
      }
    }
    return diffs
  }

  function permissionRowEnabled(area: AuthPermissionArea, action: string) {
    return permissionEnabled(selectedUser?.permissions?.[area.id] || {}, action)
  }

  function areaPermissionRows(area?: AuthPermissionArea) {
    return area ? [area, ...(area.sections || [])] : []
  }

  function permissionAreaCounts(area: AuthPermissionArea) {
    const rows = areaPermissionRows(area)
    const total = rows.reduce((sum, row) => sum + (row.actions?.length || 0), 0)
    const enabled = rows.reduce((sum, row) => sum + (row.actions || []).filter((action) => permissionRowEnabled(row, action)).length, 0)
    return { total, enabled }
  }

  function areaMatchesPermissionSearch(area: AuthPermissionArea) {
    const query = permissionSearch.trim().toLowerCase()
    if (!query) return true
    const haystack = [area.id, area.label, area.path, ...(area.actions || []), ...(area.sections || []).flatMap((section) => [section.id, section.label, section.path, ...(section.actions || [])])].join(" ").toLowerCase()
    return haystack.includes(query)
  }

  const filteredPermissionAreas = userAreas.filter(areaMatchesPermissionSearch)
  const selectedPermissionAreaCandidate = userAreas.find((area) => area.id === selectedPermissionAreaId)
  const selectedPermissionArea = permissionSearch.trim() && selectedPermissionAreaCandidate && !filteredPermissionAreas.some((area) => area.id === selectedPermissionAreaCandidate.id)
    ? filteredPermissionAreas[0]
    : (selectedPermissionAreaCandidate || filteredPermissionAreas[0] || userAreas[0])
  const selectedPermissionRows = areaPermissionRows(selectedPermissionArea).filter((area) => areaMatchesPermissionSearch(area) || !permissionSearch.trim())
  const filteredPermissionTemplates = permissionTemplates.filter((template) => {
    const query = templateSearch.trim().toLowerCase()
    if (!query) return true
    return [template.name, template.description, template.id].join(" ").toLowerCase().includes(query)
  })
  const compareTemplate = permissionTemplates.find((template) => template.id === compareTemplateId)
  const compareDiffs = selectedUser && compareTemplate ? permissionMatrixDiffs(selectedUser.permissions, compareTemplate.permissions) : []
  const visibleUsers = users.filter((user) => showArchivedUsers || user.status !== "archived")
  const selectedUsersForBulk = users.filter((user) => selectedUserIds.has(user.id) && !user.isMasterAdmin)
  const selectedUserTemplate = selectedUser && selectedUser.permissionTemplateId && selectedUser.permissionTemplateId !== "custom" ? permissionTemplates.find((template) => template.id === selectedUser.permissionTemplateId) : undefined
  const selectedUserTemplateDrift = Boolean(selectedUserTemplate && selectedUser && Number(selectedUser.permissionTemplateVersion || 0) > 0 && Number(selectedUser.permissionTemplateVersion || 0) < Number(selectedUserTemplate.version || 1))
  const commonPermissionActions = ["view", "create", "edit", "delete", "export"]
  const standardPermissionActions = new Set(["view", "read", "edit", "create", "notes", "export", "pick", "pack", "ship", "labels", "receive", "adjust", "transfer", "audit", "map", "map_sku", "resource", "files", "feeds", "sync", "import", "chat", "run"])

  function applyPermissionPreset(area: AuthPermissionArea, preset: "none" | "view" | "standard" | "full") {
    if (!selectedUser || selectedUser.isMasterAdmin) return
    if (preset === "none" && !window.confirm(`Remove all access for ${area.label}?`)) return
    const permissions = { ...(selectedUser.permissions || {}) }
    for (const rowArea of areaPermissionRows(area)) {
      const row: AuthPermission = { ...(permissions[rowArea.id] || {}) }
      for (const action of rowArea.actions || []) {
        row[action] = preset === "full" || (preset === "view" && action === "view") || (preset === "standard" && standardPermissionActions.has(action))
      }
      row.view = preset !== "none"
      row.read = preset !== "none"
      row.write = preset === "full"
      row.admin = false
      permissions[rowArea.id] = row
    }
    setSelectedPermissions(permissions)
  }

  function permissionCheckbox(area: AuthPermissionArea, action: string) {
    if (!(area.actions || []).includes(action)) return <span className="text-xs text-muted-foreground">-</span>
    return <Checkbox disabled={!canEditUserPermissions || selectedUser?.isMasterAdmin} checked={permissionRowEnabled(area, action)} onCheckedChange={(checked) => updateSelectedPermission(area.id, action as keyof AuthPermission, checked === true)} />
  }

  function templatePermissionCheckbox(area: AuthPermissionArea, action: string) {
    if (!(area.actions || []).includes(action)) return <span className="text-xs text-muted-foreground">-</span>
    const row = templateDraft.permissions?.[area.id] || {}
    return <Checkbox disabled={!canEditUserPermissions} checked={row[action] === true || row.write === true || row.admin === true} onCheckedChange={(checked) => updateTemplateDraftPermission(area.id, action as keyof AuthPermission, checked === true)} />
  }

  function permissionSummary(area: AuthPermissionArea) {
    const { total, enabled } = permissionAreaCounts(area)
    if (!total) return "No actions"
    if (enabled === total) return "Full access"
    if (!enabled) return "No access"
    return `${enabled}/${total} enabled`
  }

  function requestCatalogMaintenance(request: NonNullable<typeof catalogMaintenanceConfirm>) {
    setCatalogMaintenanceFeedback(null)
    setCatalogMaintenanceConfirm(request)
  }

  async function runCatalogMaintenance(path: string, label: string, body: Record<string, unknown> = {}) {
    setCatalogMaintenanceLoading(true)
    setCatalogMaintenanceFeedback(null)
    try {
      const result = await api<{ job?: ImportJob; message?: string }>(path, { method: "POST", body: JSON.stringify(body) })
      const jobReference = result.job?.jobNumber ? `Job ${result.job.jobNumber}` : result.job?.id ? `Job ${result.job.id}` : "the job queue"
      const message = result.message || `${label} queued as ${jobReference}. Monitor it in Jobs.`
      setCatalogMaintenanceFeedback({ kind: "success", message })
      setCatalogMaintenanceConfirm(null)
      toast.success(message)
      if (path === "/api/catalog/supplier-index/rebuild") void loadSupplierIndexStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to start ${label.toLowerCase()}.`
      setCatalogMaintenanceFeedback({ kind: "error", message })
      setCatalogMaintenanceConfirm(null)
      toast.error(message)
    } finally {
      setCatalogMaintenanceLoading(false)
    }
  }

  function updateAiToolScope(scopeId: string, enabled: boolean) {
    update("aiToolScopes", { ...aiToolScopes(), [scopeId]: enabled })
    if (scopeId === "shopify.launch") update("aiShopifyLaunchEnabled", enabled)
  }

  function aiCategoryChannels() {
    const configured = value("aiCategoryReviewChannels")
    return Array.isArray(configured) ? configured.map(String) : ["shopify", "ebay"]
  }

  function updateAiCategoryChannel(channel: "shopify" | "ebay", enabled: boolean) {
    const next = new Set(aiCategoryChannels())
    if (enabled) next.add(channel)
    else next.delete(channel)
    update("aiCategoryReviewChannels", Array.from(next))
  }

  async function save() {
    await onSaveSettings(draft)
    if (Object.keys(orderWorkflowDraft).length) {
      const allocationPolicy = { ...((orderWorkflowSettings.allocationPolicy as Record<string, unknown> | undefined) || {}) }
      const automation = { ...((orderWorkflowSettings.automation as Record<string, unknown> | undefined) || {}) }
      const purchasePooling = { ...((orderWorkflowSettings.purchasePooling as Record<string, unknown> | undefined) || {}) }
      for (const [key, next] of Object.entries(orderWorkflowDraft)) {
        const [section, field] = key.split(".")
        if (section === "allocationPolicy") allocationPolicy[field] = next
        if (section === "automation") automation[field] = next
        if (section === "purchasePooling") purchasePooling[field] = next
      }
      const result = await api<{ settings?: Record<string, unknown> }>("/api/order-workflows", { method: "PUT", body: JSON.stringify({ allocationPolicy, automation, purchasePooling }) })
      setOrderWorkflowSettings(result.settings || { allocationPolicy, automation, purchasePooling })
      setOrderWorkflowDraft({})
    }
    setDraft({})
    setEditing(false)
  }

  async function resetRoutingAndPurchasing() {
    setRoutingResetLoading(true)
    try {
      const routingStartDate = String(workflowValue("automation", "routingStartDate", "") || new Date().toISOString().slice(0, 10))
      const result = await api<{ settings?: Record<string, unknown>; message?: string }>("/api/order-workflows/reset-routing", {
        method: "POST",
        body: JSON.stringify({ confirmation: "RESET ROUTING AND PURCHASE ORDERS", routingStartDate, user: "Luis" }),
      })
      setOrderWorkflowSettings(result.settings || {})
      setOrderWorkflowDraft({})
      setRoutingResetOpen(false)
      toast.success(result.message || "Routing and purchase-order test data were reset.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reset routing and purchase orders.")
    } finally {
      setRoutingResetLoading(false)
    }
  }

  async function sendSmtpTest() {
    const recipient = window.prompt("Send the SMTP test email to:", String(value("smtpFromEmail") || ""))
    if (!recipient) return
    setTestingSmtp(true)
    try {
      const result = await api<{ message?: string }>("/api/system-settings/smtp-test", { method: "POST", body: JSON.stringify({ recipient }) })
      toast.success(result.message || "SMTP test email sent.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "SMTP test delivery failed.")
    } finally { setTestingSmtp(false) }
  }

  function configureResend() {
    setDraft((current) => ({
      ...current,
      smtpProvider: "resend",
      smtpEnabled: true,
      smtpHost: "smtp.resend.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUsername: "resend",
    }))
  }

  async function testVeeqoConnection() {
    setTestingVeeqo(true)
    try {
      const result = await api<{ message?: string; systemSettings?: SystemSettings }>("/api/system-settings/veeqo-test", {
        method: "POST",
        body: JSON.stringify(draft),
      })
      if (result.systemSettings) setDraft((current) => ({ ...current, ...result.systemSettings }))
      toast.success(result.message || "Veeqo connection verified.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Veeqo connection test failed.")
    } finally { setTestingVeeqo(false) }
  }

  async function testAiConnection() {
    setTestingAi(true)
    try {
      const result = await api<{ message?: string; systemSettings?: SystemSettings }>("/api/system-settings/ai-test", {
        method: "POST",
        body: JSON.stringify({ provider: aiProvider, apiKey: String(draft[aiKeyField] || ""), model: String(value("aiModel") || aiDefaultModel) }),
      })
      const verified = result.systemSettings || {}
      setDraft((current) => ({
        ...current,
        aiProvider: verified.aiProvider || aiProvider,
        aiModel: verified.aiModel || value("aiModel") || aiDefaultModel,
        aiConnectionVerifiedAt: verified.aiConnectionVerifiedAt || new Date().toISOString(),
        aiConnectionVerifiedProvider: verified.aiConnectionVerifiedProvider || aiProvider,
        aiConnectionVerifiedModel: verified.aiConnectionVerifiedModel || value("aiModel") || aiDefaultModel,
        aiConnectionKeyFingerprint: verified.aiConnectionKeyFingerprint || "verified",
      }))
      toast.success(result.message || "OpenAI connection verified.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI connection test failed.")
    } finally { setTestingAi(false) }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Admin"
        title="System Settings"
        description="Operations, workers, catalog controls, integrations, and deployment history in compact tabs."
        action={["releases", "superuser"].includes(activeTab) ? undefined : editing ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditing(false); setDraft({}) }}>Cancel</Button>
            <Button onClick={save}>Save changes</Button>
          </div>
        ) : <Button onClick={() => setEditing(true)}>Edit</Button>}
      />

      <Tabs value={activeTab} onValueChange={tab => { if (tab === "companies") window.location.assign("/settings?tab=companies"); else setActiveTab(tab) }}>
        {compactSettingsNav ? (
          <Field label="Settings section">
            <Select value={activeTab} onValueChange={tab => { if (tab === "companies") window.location.assign("/settings?tab=companies"); else setActiveTab(tab) }}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visibleSettingsTabItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <TabsList className="flex flex-wrap">
            {visibleSettingsTabItems.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
          </TabsList>
        )}
        {activeTab === "email" && <Card className="mt-4 border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Shared email provider</CardTitle>
            <CardDescription>DataPlus uses this provider for operational email. BookStack sends its invitations and password resets through DataPlus's private relay, so there is only one credential to maintain.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Provider"><Select disabled={!editing} value={String(value("smtpProvider") || "custom")} onValueChange={(next) => { update("smtpProvider", next); if (next === "resend") configureResend() }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="resend">Resend</SelectItem><SelectItem value="custom">Custom SMTP</SelectItem></SelectContent></Select></Field>
            <div className="flex items-end"><Button type="button" variant="outline" onClick={() => { if (!editing) setEditing(true); configureResend() }}>Configure Resend</Button></div>
            <Field label="Resend API key"><Input disabled={!editing} type="password" value={String(draft.smtpPassword || "")} onChange={(event) => update("smtpPassword", event.target.value)} placeholder={settings.smtpPasswordConfigured ? "Configured (enter only to replace)" : "re_..."} /><p className="text-xs text-muted-foreground">Click Configure Resend, paste the key, then save. It is never returned after saving.</p></Field>
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Resend uses <span className="font-mono">smtp.resend.com</span>, port <span className="font-mono">587</span>, and username <span className="font-mono">resend</span>. Add a verified sender email below, then save and send a test.</div>
          </CardContent>
        </Card>}
        <TabsContent value="releases"><ReleaseHistorySettings active={activeTab === "releases"} /></TabsContent>
        {hasActivityAccess && <TabsContent value="superuser"><SuperuserActivity isSuperuser={authUser.isSuperuser === true} /></TabsContent>}
        <TabsContent value="templates" className="grid gap-4"><ReturnTemplateSettings settings={{ ...settings, ...draft }} editing={editing} onChange={update} /></TabsContent>
        <TabsContent value="organization" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Company profile</CardTitle><CardDescription>Shared identity and regional defaults used by documents, notifications, purchasing, and warehouse operations.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Display name"><Input disabled={!editing} value={String(value("organizationName") || "")} onChange={(event) => update("organizationName", event.target.value)} /></Field>
              <Field label="Legal name"><Input disabled={!editing} value={String(value("organizationLegalName") || "")} onChange={(event) => update("organizationLegalName", event.target.value)} /></Field>
              <Field label="Operations email"><Input disabled={!editing} type="email" value={String(value("organizationEmail") || "")} onChange={(event) => update("organizationEmail", event.target.value)} /></Field>
              <Field label="Phone"><Input disabled={!editing} value={String(value("organizationPhone") || "")} onChange={(event) => update("organizationPhone", event.target.value)} /></Field>
              <Field label="Address line 1"><Input disabled={!editing} value={String(value("organizationAddressLine1") || "")} onChange={(event) => update("organizationAddressLine1", event.target.value)} /></Field>
              <Field label="Address line 2"><Input disabled={!editing} value={String(value("organizationAddressLine2") || "")} onChange={(event) => update("organizationAddressLine2", event.target.value)} /></Field>
              <Field label="City"><Input disabled={!editing} value={String(value("organizationCity") || "")} onChange={(event) => update("organizationCity", event.target.value)} /></Field>
              <Field label="State / region"><Input disabled={!editing} value={String(value("organizationState") || "")} onChange={(event) => update("organizationState", event.target.value)} /></Field>
              <Field label="Postal code"><Input disabled={!editing} value={String(value("organizationPostalCode") || "")} onChange={(event) => update("organizationPostalCode", event.target.value)} /></Field>
              <Field label="Country code"><Input disabled={!editing} maxLength={2} value={String(value("organizationCountry") || "US")} onChange={(event) => update("organizationCountry", event.target.value.toUpperCase())} /></Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Regional defaults</CardTitle><CardDescription>These values keep dates, money, weights, and dimensions consistent across workspaces.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Timezone"><Select disabled={!editing} value={String(value("organizationTimezone") || "America/New_York")} onValueChange={(next) => update("organizationTimezone", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="America/New_York">Eastern</SelectItem><SelectItem value="America/Chicago">Central</SelectItem><SelectItem value="America/Denver">Mountain</SelectItem><SelectItem value="America/Los_Angeles">Pacific</SelectItem><SelectItem value="UTC">UTC</SelectItem></SelectContent></Select></Field>
              <Field label="Currency"><Input disabled={!editing} maxLength={3} value={String(value("organizationCurrency") || "USD")} onChange={(event) => update("organizationCurrency", event.target.value.toUpperCase())} /></Field>
              <Field label="Locale"><Input disabled={!editing} value={String(value("organizationLocale") || "en-US")} onChange={(event) => update("organizationLocale", event.target.value)} /></Field>
              <Field label="Measurement system"><Select disabled={!editing} value={String(value("organizationMeasurementSystem") || "imperial")} onValueChange={(next) => update("organizationMeasurementSystem", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="imperial">Imperial</SelectItem><SelectItem value="metric">Metric</SelectItem></SelectContent></Select></Field>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="orders" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Order safeguards</CardTitle><CardDescription>Defaults that protect unpaid, risky, canceled, and refunded orders before they reach purchasing or fulfillment.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <ToggleField label="Hold unpaid orders" checked={boolValue("ordersAutoHoldUnpaid")} disabled={!editing} onCheckedChange={(next) => update("ordersAutoHoldUnpaid", next)} />
              <ToggleField label="Hold high-risk orders" checked={boolValue("ordersAutoHoldHighRisk")} disabled={!editing} onCheckedChange={(next) => update("ordersAutoHoldHighRisk", next)} />
              <ToggleField label="Release canceled reservations" checked={boolValue("ordersReleaseCanceledReservations")} disabled={!editing} onCheckedChange={(next) => update("ordersReleaseCanceledReservations", next)} />
              <ToggleField label="Remove canceled lines from draft POs" checked={boolValue("ordersRemoveCanceledLinesFromDraftPos")} disabled={!editing} onCheckedChange={(next) => update("ordersRemoveCanceledLinesFromDraftPos", next)} />
              <ToggleField label="Remove refunded lines from draft POs" checked={boolValue("ordersRemoveRefundedLinesFromDraftPos")} disabled={!editing} onCheckedChange={(next) => update("ordersRemoveRefundedLinesFromDraftPos", next)} />
              <ToggleField label="Notify routing exceptions" checked={boolValue("ordersNotifyRoutingExceptions")} disabled={!editing} onCheckedChange={(next) => update("ordersNotifyRoutingExceptions", next)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Import and recovery defaults</CardTitle><CardDescription>Channel settings can override import lookback. Routing lifecycle remains controlled from Purchasing.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Default import lookback (days)"><Input disabled={!editing} type="number" min="1" max="3650" value={String(value("ordersDefaultImportLookbackDays") || 60)} onChange={(event) => update("ordersDefaultImportLookbackDays", Number(event.target.value || 60))} /></Field>
              <Field label="Archive after (days)"><Input disabled={!editing} type="number" min="30" max="3650" value={String(value("ordersArchiveAfterDays") || 365)} onChange={(event) => update("ordersArchiveAfterDays", Number(event.target.value || 365))} /></Field>
              <Field label="Routing retry (minutes)"><Input disabled={!editing} type="number" min="1" max="1440" value={String(value("ordersRoutingRetryMinutes") || 15)} onChange={(event) => update("ordersRoutingRetryMinutes", Number(event.target.value || 15))} /></Field>
              <Field label="Maximum routing attempts"><Input disabled={!editing} type="number" min="1" max="20" value={String(value("ordersRoutingMaxAttempts") || 3)} onChange={(event) => update("ordersRoutingMaxAttempts", Number(event.target.value || 3))} /></Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Return recovery priority</CardTitle><CardDescription>After inspection passes, offer returned stock to paid open orders before restocking it or creating a vendor return. Allocation follows ship-by date, then order date, then internal order number.</CardDescription></CardHeader>
            <CardContent>
              <ToggleField label="Prioritize open orders before return disposition" checked={boolValue("returnsPrioritizeOpenOrderAllocation")} disabled={!editing} onCheckedChange={(next) => update("returnsPrioritizeOpenOrderAllocation", next)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="inventory" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Inventory allocation</CardTitle><CardDescription>Physical warehouse defaults only. Supplier-feed and marketplace quantities remain separate sourcing snapshots.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Default fulfillment warehouse"><Select disabled={!editing} value={defaultShipFromWarehouseValue} onValueChange={(next) => update("inventoryDefaultFulfillmentWarehouseId", next === "none" ? "" : next)}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent><SelectItem value="none">No default</SelectItem>{physicalSettingsWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Default receiving warehouse"><Select disabled={!editing} value={String(value("inventoryDefaultReceivingWarehouseId") || "none")} onValueChange={(next) => update("inventoryDefaultReceivingWarehouseId", next === "none" ? "" : next)}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent><SelectItem value="none">No default</SelectItem>{physicalSettingsWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Allocation strategy"><Select disabled={!editing} value={String(value("inventoryAllocationStrategy") || "priority")} onValueChange={(next) => update("inventoryAllocationStrategy", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="priority">Warehouse priority</SelectItem><SelectItem value="fifo">FIFO</SelectItem><SelectItem value="fefo">FEFO</SelectItem></SelectContent></Select></Field>
              <ToggleField label="Expire warehouse reservations" description="Off by default. Paid, unshipped orders keep physical stock reserved until shipment, cancellation, or a deliberate reassignment." checked={boolValue("inventoryReservationExpiryEnabled")} disabled={!editing} onCheckedChange={(next) => update("inventoryReservationExpiryEnabled", next)} />
              <Field label="Reservation expiry (hours)"><Input disabled={!editing || !boolValue("inventoryReservationExpiryEnabled")} type="number" min="1" max="720" value={String(value("inventoryReservationExpiryHours") || 48)} onChange={(event) => update("inventoryReservationExpiryHours", Number(event.target.value || 48))} /></Field>
              <Field label="Default safety stock"><Input disabled={!editing} type="number" min="0" value={String(value("inventoryDefaultSafetyStock") || 0)} onChange={(event) => update("inventoryDefaultSafetyStock", Number(event.target.value || 0))} /></Field>
              <ToggleField label="Allow negative physical stock" checked={boolValue("inventoryAllowNegativePhysicalStock")} disabled={!editing} onCheckedChange={(next) => update("inventoryAllowNegativePhysicalStock", next)} />
              <ToggleField label="Auto-release canceled reservations" checked={boolValue("inventoryAutoReleaseCanceledReservations")} disabled={!editing} onCheckedChange={(next) => update("inventoryAutoReleaseCanceledReservations", next)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="fulfillment" className="grid gap-4">
          <Card>
            <CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Fulfillment performance</CardTitle>
                <CardDescription>Live API, projection, payload, and browser rendering measurements from the last hour. Samples are memory-only and reset when DataPlus restarts.</CardDescription>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={fulfillmentDiagnosticsLoading} onClick={() => void loadFulfillmentDiagnostics()}>
                <RefreshCw className={cn("size-4", fulfillmentDiagnosticsLoading && "animate-spin")} /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 pt-6">
              {fulfillmentDiagnosticsLoading && !fulfillmentDiagnostics ? <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading performance samples...</div> : <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <Detail label="API p50" value={`${Number(fulfillmentDiagnostics?.server?.p50TotalMs || 0).toLocaleString()} ms`} />
                  <Detail label="API p95" value={`${Number(fulfillmentDiagnostics?.server?.p95TotalMs || 0).toLocaleString()} ms`} />
                  <Detail label="Projection p95" value={`${Number(fulfillmentDiagnostics?.server?.p95ReadMs || 0).toLocaleString()} ms`} />
                  <Detail label="Browser render p95" value={`${Number(fulfillmentDiagnostics?.client?.p95RenderMs || 0).toLocaleString()} ms`} />
                  <Detail label="Average payload" value={`${(Number(fulfillmentDiagnostics?.server?.averagePayloadBytes || 0) / 1024).toFixed(1)} KB`} />
                  <Detail label="Samples / slow" value={`${numberLabel(fulfillmentDiagnostics?.server?.sampleCount || 0)} / ${numberLabel((fulfillmentDiagnostics?.server?.slowCount || 0) + (fulfillmentDiagnostics?.client?.slowCount || 0))}`} />
                </div>
                <Alert variant={Number(fulfillmentDiagnostics?.server?.slowCount || 0) + Number(fulfillmentDiagnostics?.client?.slowCount || 0) > 0 ? "destructive" : "default"}>
                  {Number(fulfillmentDiagnostics?.server?.slowCount || 0) + Number(fulfillmentDiagnostics?.client?.slowCount || 0) > 0 ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
                  <AlertTitle>{Number(fulfillmentDiagnostics?.server?.slowCount || 0) + Number(fulfillmentDiagnostics?.client?.slowCount || 0) > 0 ? "Slow samples need review" : "No slow Fulfillment samples recorded"}</AlertTitle>
                  <AlertDescription>Slow means API time over {numberLabel(fulfillmentDiagnostics?.thresholds?.totalMs || 1000)} ms, projection time over {numberLabel(fulfillmentDiagnostics?.thresholds?.readMs || 750)} ms, browser rendering over {numberLabel(fulfillmentDiagnostics?.thresholds?.renderMs || 250)} ms, or a payload larger than {(Number(fulfillmentDiagnostics?.thresholds?.payloadBytes || 2097152) / 1048576).toFixed(0)} MB.</AlertDescription>
                </Alert>
                {Array.isArray(fulfillmentDiagnostics?.byView) && fulfillmentDiagnostics.byView.length > 0 ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Queue</TableHead><TableHead className="text-right">Samples</TableHead><TableHead className="text-right">API p95</TableHead><TableHead className="text-right">Projection p95</TableHead><TableHead className="text-right">Payload p95</TableHead><TableHead className="text-right">Slow</TableHead></TableRow></TableHeader><TableBody>{fulfillmentDiagnostics.byView.map((row: Record<string, any>) => <TableRow key={String(row.view)}><TableCell className="font-medium">{String(row.view || "ready").replaceAll("-", " ")}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.sampleCount)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.p95TotalMs)} ms</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.p95ReadMs)} ms</TableCell><TableCell className="text-right tabular-nums">{(Number(row.p95PayloadBytes || 0) / 1024).toFixed(1)} KB</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.slowCount)}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty className="min-h-32 rounded-md border border-dashed"><EmptyHeader><EmptyTitle>No samples yet</EmptyTitle><EmptyDescription>Open or refresh Fulfillment, then return here to inspect its load profile.</EmptyDescription></EmptyHeader></Empty>}
                {Array.isArray(fulfillmentDiagnostics?.recentSlow) && fulfillmentDiagnostics.recentSlow.length > 0 ? <div className="grid gap-2"><div><p className="text-sm font-medium">Recent slow samples</p><p className="text-xs text-muted-foreground">Use the stage with the highest duration to choose the next optimization.</p></div><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Stage</TableHead><TableHead>Queue</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Projection / render</TableHead><TableHead className="text-right">Payload</TableHead><TableHead>Recorded</TableHead></TableRow></TableHeader><TableBody>{fulfillmentDiagnostics.recentSlow.map((row: Record<string, any>, index: number) => <TableRow key={`${String(row.kind)}-${String(row.recordedAt)}-${index}`}><TableCell><Badge variant={row.kind === "server" ? "outline" : "secondary"}>{row.kind === "server" ? "API" : "Browser"}</Badge></TableCell><TableCell className="font-medium">{String(row.view || "ready").replaceAll("-", " ")}</TableCell><TableCell>{String(row.source || (row.kind === "browser" ? "React commit" : "projection")).replaceAll("_", " ")}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.totalMs)} ms</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.kind === "server" ? row.readMs : row.renderMs)} ms</TableCell><TableCell className="text-right tabular-nums">{row.kind === "server" ? `${(Number(row.payloadBytes || 0) / 1024).toFixed(1)} KB` : "-"}</TableCell><TableCell className="whitespace-nowrap">{dateLabel(String(row.recordedAt || ""))}</TableCell></TableRow>)}</TableBody></Table></div></div> : null}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Detail label="Snapshot generated" value={fulfillmentDiagnostics?.runtime?.snapshotGeneratedAt ? dateLabel(String(fulfillmentDiagnostics.runtime.snapshotGeneratedAt)) : "Not loaded"} />
                  <Detail label="Snapshot state" value={fulfillmentDiagnostics?.runtime?.snapshotRefreshing ? "Refreshing" : fulfillmentDiagnostics?.runtime?.snapshotDirty ? "Refresh pending" : "Current"} />
                  <Detail label="Projection patch" value={fulfillmentDiagnostics?.runtime?.projectionPatchPending ? "Pending" : "Idle"} />
                  <Detail label="Orders awaiting patch" value={numberLabel(fulfillmentDiagnostics?.runtime?.pendingProjectionOrders || 0)} />
                </div>
              </>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Fulfillment gates</CardTitle><CardDescription>Required operational checks before items can be labeled and shipped.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Default ship-from warehouse"><Select disabled={!editing} value={defaultShipFromWarehouseValue} onValueChange={(next) => update("inventoryDefaultFulfillmentWarehouseId", next === "none" ? "" : next)}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent><SelectItem value="none">No default</SelectItem>{physicalSettingsWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">Used by shipping rates and labels. Defaults to Staten Island - WH-SI2 when no saved warehouse is set.</p></Field>
              <ToggleField label="Allow partial shipments" checked={boolValue("fulfillmentAllowPartialShipments")} disabled={!editing} onCheckedChange={(next) => update("fulfillmentAllowPartialShipments", next)} />
              <div className="rounded-md border bg-muted/20 p-3"><p className="font-medium">Pick lists are optional</p><p className="mt-1 text-xs text-muted-foreground">Warehouse employees can buy labels directly from Ready to ship. Picking remains available for teams that want scan or batch controls.</p></div>
              <ToggleField label="Require package data before labels" checked={boolValue("fulfillmentRequirePackageDataBeforeLabel")} disabled={!editing} onCheckedChange={(next) => update("fulfillmentRequirePackageDataBeforeLabel", next)} />
              <ToggleField label="Auto-create pick lists" checked={boolValue("fulfillmentAutoCreatePickLists")} disabled={!editing} onCheckedChange={(next) => update("fulfillmentAutoCreatePickLists", next)} />
              <Field label="Default weight unit"><Select disabled={!editing} value={String(value("fulfillmentDefaultWeightUnit") || "lb")} onValueChange={(next) => update("fulfillmentDefaultWeightUnit", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lb">Pounds</SelectItem><SelectItem value="oz">Ounces</SelectItem><SelectItem value="kg">Kilograms</SelectItem><SelectItem value="g">Grams</SelectItem></SelectContent></Select></Field>
              <Field label="Default dimension unit"><Select disabled={!editing} value={String(value("fulfillmentDefaultDimensionUnit") || "in")} onValueChange={(next) => update("fulfillmentDefaultDimensionUnit", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in">Inches</SelectItem><SelectItem value="cm">Centimeters</SelectItem></SelectContent></Select></Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Shipping providers and universal rater</CardTitle><CardDescription>Use one label workflow while DataPlus loads channel-native labels, Veeqo rates, and future direct carrier providers.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ToggleField label="Enable Veeqo rates and labels" checked={boolValue("shippingRaterVeeqoEnabled")} disabled={!editing} onCheckedChange={(next) => update("shippingRaterVeeqoEnabled", next)} />
              <div className="rounded-md border bg-muted/25 p-3 text-sm xl:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Veeqo connection</p>
                  <Badge variant={settings.veeqoAccessTokenConfigured || settings.veeqoApiKeyConfigured ? "default" : String(value("veeqoLastAuthStatus") || "").toLowerCase() === "failed" || String(value("veeqoLastTestStatus") || "").toLowerCase() === "failed" ? "destructive" : "outline"}>{settings.veeqoAccessTokenConfigured ? "OAuth token stored" : settings.veeqoApiKeyConfigured ? "API key stored" : "Not connected"}</Badge>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>Auth mode: {String(settings.veeqoAuthMode || "not_connected").replace(/_/g, " ")}</span>
                  <span>Connected: {value("veeqoConnectedAt") ? dateLabel(String(value("veeqoConnectedAt"))) : "Not yet"}</span>
                  <span>Last OAuth: {value("veeqoLastAuthStatus") ? `${String(value("veeqoLastAuthStatus"))} / ${dateLabel(String(value("veeqoLastAuthCallbackAt") || value("veeqoLastAuthStartedAt") || ""))}` : "No attempt yet"}</span>
                  <span>Last test: {value("veeqoLastTestStatus") ? `${String(value("veeqoLastTestStatus"))} / ${dateLabel(String(value("veeqoLastTestedAt") || ""))}` : "Not tested"}</span>
                </div>
                {Boolean(value("veeqoLastAuthMessage") || value("veeqoLastTestMessage")) && <p className="mt-2 text-xs text-muted-foreground">{String(value("veeqoLastTestMessage") || value("veeqoLastAuthMessage"))}</p>}
              </div>
              <Field label="Veeqo API base URL"><Input disabled={!editing} value={String(value("veeqoApiBaseUrl") || "https://api.veeqo.com")} onChange={(event) => update("veeqoApiBaseUrl", event.target.value)} /></Field>
              <Field label="OAuth redirect URI"><Input disabled={!editing} value={String(value("veeqoRedirectUri") || "https://dataplusapp.duckdns.org/")} onChange={(event) => update("veeqoRedirectUri", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Use the exact URI registered with Veeqo. For your current Veeqo app, use https://dataplusapp.duckdns.org/.</p></Field>
              <Field label="Veeqo client ID"><Input disabled={!editing} value={String(value("veeqoClientId") || "")} onChange={(event) => update("veeqoClientId", event.target.value)} /></Field>
              <Field label="Veeqo client secret"><Input disabled={!editing} type="password" value={String(draft.veeqoClientSecret || "")} onChange={(event) => update("veeqoClientSecret", event.target.value)} placeholder={settings.veeqoClientSecretConfigured ? "Configured (enter only to replace)" : "OAuth client secret"} /></Field>
              <Field label="Private API key fallback"><Input disabled={!editing} type="password" value={String(draft.veeqoApiKey || "")} onChange={(event) => update("veeqoApiKey", event.target.value)} placeholder={settings.veeqoApiKeyConfigured ? "Configured (enter only to replace)" : "Optional x-api-key"} /></Field>
              <Field label="Seller display name"><Input disabled={!editing} value={String(value("veeqoSellerDisplayName") || "DataPlus")} onChange={(event) => update("veeqoSellerDisplayName", event.target.value)} /></Field>
              <Field label="Default label format"><Select disabled={!editing} value={String(value("veeqoDefaultLabelFormat") || "PDF")} onValueChange={(next) => update("veeqoDefaultLabelFormat", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PDF">PDF</SelectItem><SelectItem value="PNG">PNG</SelectItem><SelectItem value="ZPL">ZPL</SelectItem><SelectItem value="JPEG">JPEG</SelectItem></SelectContent></Select></Field>
              <div className="flex flex-wrap items-end gap-2 xl:col-span-3">
                <Button type="button" variant="outline" disabled={editing || !String(value("veeqoClientId") || "").trim()} asChild><a href="/auth/veeqo/launch" target="_blank" rel="noreferrer"><ShieldCheck className="size-4" /> Connect Veeqo OAuth</a></Button>
                <Button type="button" variant="outline" disabled={testingVeeqo || (!settings.veeqoAccessTokenConfigured && !settings.veeqoApiKeyConfigured && !String(draft.veeqoApiKey || "").trim())} onClick={() => void testVeeqoConnection()}>{testingVeeqo ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Test Veeqo</Button>
              </div>
              <Field label="Auto-select rate"><Select disabled={!editing} value={String(value("shippingLabelAutoSelectRule") || "cheapest")} onValueChange={(next) => update("shippingLabelAutoSelectRule", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cheapest">Cheapest</SelectItem><SelectItem value="preferred">Preferred carrier/service</SelectItem><SelectItem value="fastest">Fastest</SelectItem><SelectItem value="none">Do not auto-select</SelectItem></SelectContent></Select></Field>
              <Field label="Preferred carrier"><Input disabled={!editing} value={String(value("shippingLabelPreferredCarrier") || "")} onChange={(event) => update("shippingLabelPreferredCarrier", event.target.value)} placeholder="UPS, USPS, FedEx" /></Field>
              <Field label="Preferred service"><Input disabled={!editing} value={String(value("shippingLabelPreferredService") || "")} onChange={(event) => update("shippingLabelPreferredService", event.target.value)} placeholder="Ground, Priority, 2 Day" /></Field>
              <Field label="Max label cost"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(value("shippingLabelMaxCost") || 0)} onChange={(event) => update("shippingLabelMaxCost", Number(event.target.value || 0))} /></Field>
              <ToggleField label="Confirm labels above max cost" checked={boolValue("shippingLabelRequireConfirmationAboveMax")} disabled={!editing} onCheckedChange={(next) => update("shippingLabelRequireConfirmationAboveMax", next)} />
              <ToggleField label="Open packing slip with label" checked={boolValue("shippingLabelPrintPackingSlipWithLabel")} disabled={!editing} onCheckedChange={(next) => update("shippingLabelPrintPackingSlipWithLabel", next)} />
              <div className="rounded-md border bg-muted/25 p-3 text-sm text-muted-foreground xl:col-span-3">Veeqo rate shopping uses package dimensions, ship-from address, order value, and selected order lines. Temu orders can still show the marketplace label option in the same print workflow.</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">RMA document templates</CardTitle><CardDescription>Edit the customer instructions used in downloadable RMA PDFs. Supported fields: {"{{rma_number}}"}, {"{{order_number}}"}, {"{{customer_name}}"}, and {"{{return_warehouse}}"}.</CardDescription></CardHeader>
            <CardContent className="grid gap-5 xl:grid-cols-2">
              <div className="grid gap-3 rounded-md border p-4"><p className="font-medium">Prepaid return label</p><Field label="Document title"><Input disabled={!editing} value={String(value("returnMerchantLabelTemplateTitle") || "")} onChange={(event) => update("returnMerchantLabelTemplateTitle", event.target.value)} /></Field><Field label="Customer instructions"><Textarea disabled={!editing} className="min-h-28" value={String(value("returnMerchantLabelTemplateInstructions") || "")} onChange={(event) => update("returnMerchantLabelTemplateInstructions", event.target.value)} /></Field></div>
              <div className="grid gap-3 rounded-md border p-4"><p className="font-medium">Customer ships at own cost</p><Field label="Document title"><Input disabled={!editing} value={String(value("returnCustomerLabelTemplateTitle") || "")} onChange={(event) => update("returnCustomerLabelTemplateTitle", event.target.value)} /></Field><Field label="Customer instructions"><Textarea disabled={!editing} className="min-h-28" value={String(value("returnCustomerLabelTemplateInstructions") || "")} onChange={(event) => update("returnCustomerLabelTemplateInstructions", event.target.value)} /></Field></div>
              <Alert className="xl:col-span-2"><Warehouse className="size-4" /><AlertTitle>Return address</AlertTitle><AlertDescription>The selected RMA return warehouse supplies the address. When its address is incomplete, the PDF safely falls back to Dealsclick, 388 South Ave, Attn: Returns, Staten Island, NY 10303.</AlertDescription></Alert>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div><CardTitle className="text-base">Package presets</CardTitle><CardDescription>Warehouse boxes and mailers used by the label modal and shipment cartonization preview.</CardDescription></div>
              <Button size="sm" variant="outline" disabled={!editing} onClick={addShippingPackagePreset}>Add preset</Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {shippingPackagePresets.map((preset, index) => <div key={String(preset.id || index)} className="grid gap-3 rounded-md border p-3 md:grid-cols-2 xl:grid-cols-8">
                <Field label="Name"><Input disabled={!editing} value={String(preset.name || "")} onChange={(event) => updateShippingPackagePreset(index, { name: event.target.value })} /></Field>
                <Field label="Type"><Select disabled={!editing} value={String(preset.packageType || "box")} onValueChange={(next) => updateShippingPackagePreset(index, { packageType: next })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="box">Box</SelectItem><SelectItem value="poly_mailer">Poly mailer</SelectItem><SelectItem value="envelope">Envelope</SelectItem><SelectItem value="tube">Tube</SelectItem></SelectContent></Select></Field>
                <Field label="Weight (lb)"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(preset.weight || 0)} onChange={(event) => updateShippingPackagePreset(index, { weight: Number(event.target.value || 0) })} /></Field>
                <Field label="Length (in)"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(preset.length || 0)} onChange={(event) => updateShippingPackagePreset(index, { length: Number(event.target.value || 0) })} /></Field>
                <Field label="Width (in)"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(preset.width || 0)} onChange={(event) => updateShippingPackagePreset(index, { width: Number(event.target.value || 0) })} /></Field>
                <Field label="Height (in)"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(preset.height || 0)} onChange={(event) => updateShippingPackagePreset(index, { height: Number(event.target.value || 0) })} /></Field>
                <Field label="Maximum weight (lb)"><Input disabled={!editing} type="number" min="1" max="150" step="0.1" value={String(preset.maxWeight || 150)} onChange={(event) => updateShippingPackagePreset(index, { maxWeight: Number(event.target.value || 150) })} /></Field>
                <div className="flex flex-wrap items-end gap-2">
                  <Button size="sm" variant={preset.default ? "secondary" : "outline"} disabled={!editing || Boolean(preset.default)} onClick={() => update("shippingPackagePresets", shippingPackagePresets.map((entry, presetIndex) => ({ ...entry, default: presetIndex === index })))}>{preset.default ? "Default" : "Set default"}</Button>
                  <Button size="sm" variant="ghost" disabled={!editing || shippingPackagePresets.length <= 1} onClick={() => removeShippingPackagePreset(index)}>Remove</Button>
                </div>
              </div>)}
              {!shippingPackagePresets.length && <p className="rounded-md border p-4 text-sm text-muted-foreground">No package presets configured.</p>}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="notifications" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Notification policy</CardTitle><CardDescription>One master switch with separate delivery methods and operational alert types.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ToggleField label="Enable notifications" checked={boolValue("notificationsEnabled")} disabled={!editing} onCheckedChange={(next) => update("notificationsEnabled", next)} />
              <ToggleField label="In-app notifications" checked={boolValue("notificationInAppEnabled")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notificationInAppEnabled", next)} />
              <ToggleField label="Email notifications" checked={boolValue("notificationEmailEnabled")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notificationEmailEnabled", next)} />
              <ToggleField label="Job failures" checked={boolValue("notifyJobFailures")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notifyJobFailures", next)} />
              <ToggleField label="Feed failures" checked={boolValue("notifyFeedFailures")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notifyFeedFailures", next)} />
              <ToggleField label="Channel authentication failures" checked={boolValue("notifyChannelAuthFailures")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notifyChannelAuthFailures", next)} />
              <ToggleField label="Low stock" checked={boolValue("notifyLowStock")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notifyLowStock", next)} />
              <ToggleField label="Stale supplier feeds" checked={boolValue("notifyStaleFeeds")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notifyStaleFeeds", next)} />
              <ToggleField label="Overdue purchase orders" checked={boolValue("notifyOverduePurchaseOrders")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notifyOverduePurchaseOrders", next)} />
              <ToggleField label="Receiving exceptions" checked={boolValue("notifyReceivingExceptions")} disabled={!editing || !boolValue("notificationsEnabled")} onCheckedChange={(next) => update("notifyReceivingExceptions", next)} />
              <Field label="Recipients"><Input disabled={!editing} value={Array.isArray(value("notificationRecipients")) ? (value("notificationRecipients") as string[]).join(", ") : ""} onChange={(event) => update("notificationRecipients", event.target.value.split(",").map((email) => email.trim()).filter(Boolean))} placeholder="ops@example.com, buyer@example.com" /></Field>
              <Field label="Low-stock threshold"><Input disabled={!editing || !boolValue("notifyLowStock")} type="number" min="0" value={String(value("notificationLowStockThreshold") || 5)} onChange={(event) => update("notificationLowStockThreshold", Number(event.target.value || 0))} /></Field>
              <Field label="Feed stale after (hours)"><Input disabled={!editing || !boolValue("notifyStaleFeeds")} type="number" min="1" value={String(value("notificationStaleFeedHours") || 24)} onChange={(event) => update("notificationStaleFeedHours", Number(event.target.value || 24))} /></Field>
              <Field label="Escalate after (minutes)"><Input disabled={!editing} type="number" min="1" value={String(value("notificationEscalationMinutes") || 60)} onChange={(event) => update("notificationEscalationMinutes", Number(event.target.value || 60))} /></Field>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="security" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Security and audit policy</CardTitle><CardDescription>Controls destructive confirmations, audit history, and protected warehouse-audit actions.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ToggleField label="Admin confirmation for deletes" checked={boolValue("requireAdminConfirmationForDeletes")} disabled={!editing} onCheckedChange={(next) => update("requireAdminConfirmationForDeletes", next)} />
              <ToggleField label="System audit logging" checked={boolValue("securityAuditLoggingEnabled")} disabled={!editing} onCheckedChange={(next) => update("securityAuditLoggingEnabled", next)} />
              <ToggleField label="Log credential changes" checked={boolValue("securityCredentialChangeLoggingEnabled")} disabled={!editing} onCheckedChange={(next) => update("securityCredentialChangeLoggingEnabled", next)} />
              <Field label="Audit retention (days)"><Input disabled={!editing} type="number" min="30" max="3650" value={String(value("securityAuditRetentionDays") || 365)} onChange={(event) => update("securityAuditRetentionDays", Number(event.target.value || 365))} /></Field>
              <Field label={Boolean(settings.warehouseAuditAdminPinConfigured) ? "Operations admin PIN (set to replace)" : "Operations admin PIN"}><Input disabled={!editing} type="password" inputMode="numeric" value={String(draft.warehouseAuditAdminPin || "")} onChange={(event) => update("warehouseAuditAdminPin", event.target.value)} placeholder={Boolean(settings.warehouseAuditAdminPinConfigured) ? "PIN configured" : "Set a 4-12 digit PIN"} /><p className="mt-1 text-xs text-muted-foreground">Used for protected warehouse-audit actions and canceled-marketplace label overrides.</p></Field>
              <Field label="Warehouse audit administrator roles"><Input disabled={!editing} value={Array.isArray(value("warehouseAuditAdminRoles")) ? (value("warehouseAuditAdminRoles") as string[]).join(", ") : "Master Admin, Owner, Admin"} onChange={(event) => update("warehouseAuditAdminRoles", event.target.value.split(",").map((role) => role.trim()).filter(Boolean))} /></Field>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="jobs" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Job execution defaults</CardTitle><CardDescription>Bounded concurrency, retry, timeout, and stale-job recovery defaults for background workers.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Field label="Maximum parallel jobs"><Input disabled={!editing} type="number" min="1" max="20" value={String(value("jobsMaxParallel") || 2)} onChange={(event) => update("jobsMaxParallel", Number(event.target.value || 2))} /></Field>
              <Field label="Maximum attempts"><Input disabled={!editing} type="number" min="1" max="20" value={String(value("jobsMaxAttempts") || 3)} onChange={(event) => update("jobsMaxAttempts", Number(event.target.value || 3))} /></Field>
              <Field label="Retry backoff (seconds)"><Input disabled={!editing} type="number" min="5" value={String(value("jobsRetryBackoffSeconds") || 60)} onChange={(event) => update("jobsRetryBackoffSeconds", Number(event.target.value || 60))} /></Field>
              <Field label="Default timeout (minutes)"><Input disabled={!editing} type="number" min="5" value={String(value("jobsDefaultTimeoutMinutes") || 120)} onChange={(event) => update("jobsDefaultTimeoutMinutes", Number(event.target.value || 120))} /></Field>
              <Field label="Stale after (minutes)"><Input disabled={!editing} type="number" min="1" value={String(value("jobsStaleAfterMinutes") || 15)} onChange={(event) => update("jobsStaleAfterMinutes", Number(event.target.value || 15))} /></Field>
              <ToggleField label="Clean expired artifacts" checked={boolValue("jobsRetentionAutoCleanupEnabled")} disabled={!editing} onCheckedChange={(next) => update("jobsRetentionAutoCleanupEnabled", next)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Maintenance window</CardTitle><CardDescription>Optionally reserve a quiet period for backups, index work, and large imports.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ToggleField label="Enable maintenance window" checked={boolValue("jobsMaintenanceWindowEnabled")} disabled={!editing} onCheckedChange={(next) => update("jobsMaintenanceWindowEnabled", next)} />
              <Field label="Starts"><Input disabled={!editing || !boolValue("jobsMaintenanceWindowEnabled")} type="time" value={String(value("jobsMaintenanceWindowStart") || "02:00")} onChange={(event) => update("jobsMaintenanceWindowStart", event.target.value)} /></Field>
              <Field label="Ends"><Input disabled={!editing || !boolValue("jobsMaintenanceWindowEnabled")} type="time" value={String(value("jobsMaintenanceWindowEnd") || "05:00")} onChange={(event) => update("jobsMaintenanceWindowEnd", event.target.value)} /></Field>
              <ToggleField label="Pause marketplace writes" checked={boolValue("jobsPauseMarketplaceWritesDuringMaintenance")} disabled={!editing || !boolValue("jobsMaintenanceWindowEnabled")} onCheckedChange={(next) => update("jobsPauseMarketplaceWritesDuringMaintenance", next)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="operations" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Operations</CardTitle>
              <CardDescription>Controls background work and job history behavior.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Background jobs mode">
                <Select disabled={!editing} value={String(value("backgroundJobsMode") || "inline")} onValueChange={(next) => update("backgroundJobsMode", next)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inline">Inline</SelectItem>
                    <SelectItem value="worker">External worker</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <ToggleField label="Auto quality scan after imports" checked={boolValue("autoDataQualityScanAfterImports")} disabled={!editing} onCheckedChange={(next) => update("autoDataQualityScanAfterImports", next)} />
              <Field label="Channel activity retention">
                <Input disabled value={`${String(value("channelLogRetentionDays") || 365)} days`} />
                <p className="mt-1 text-xs text-muted-foreground">Searchable channel activity metadata is retained for one year.</p>
              </Field>
              <Field label="Download and artifact retention">
                <Input disabled value={`${String(value("jobArtifactRetentionDays") || 7)} days`} />
                <p className="mt-1 text-xs text-muted-foreground">Large CSVs, exports, and job downloads expire after seven days.</p>
              </Field>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="purchasing" className="grid gap-4">
          <Card>
            <CardHeader className="gap-3 border-b lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Purchasing workflow</CardTitle>
                <CardDescription>Control which paid orders enter purchasing, how supplier demand is grouped, and when draft purchase orders are prepared.</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild><a href="/purchasing">Open purchasing</a></Button>
            </CardHeader>
            <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
              {orderWorkflowLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground md:col-span-2"><Loader2 className="size-4 animate-spin" /> Loading order-routing settings...</div> : <>
                <ToggleField label="Enable order routing" description="Master switch for automatic and manual routing, physical allocation, supplier demand, and PO cutoff processing." checked={Boolean(workflowValue("automation", "routePaidOrders", false))} disabled={!editing} onCheckedChange={(next) => updateWorkflow("automation", "routePaidOrders", next)} />
                <Field label="Route orders created on or after"><Input disabled={!editing} type="date" value={String(workflowValue("automation", "routingStartDate", ""))} onChange={(event) => updateWorkflow("automation", "routingStartDate", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Orders before this date remain visible but cannot be routed manually or by the scheduler.</p></Field>
                <ToggleField label="Reroute after PO receiving" description="Re-evaluate linked order lines when purchased inventory reaches a physical warehouse." checked={Boolean(workflowValue("automation", "rerouteAfterReceiving", true))} disabled={!editing || !Boolean(workflowValue("automation", "routePaidOrders", false))} onCheckedChange={(next) => updateWorkflow("automation", "rerouteAfterReceiving", next)} />
                <ToggleField label="Pool supplier demand" description="Hold supplier-backed lines until their cutoff so one supplier PO can cover multiple customer orders." checked={Boolean(workflowValue("purchasePooling", "enabled", true))} disabled={!editing || !Boolean(workflowValue("automation", "routePaidOrders", false))} onCheckedChange={(next) => updateWorkflow("purchasePooling", "enabled", next)} />
                <ToggleField label="Create draft POs at cutoff" description="Run the lightweight cutoff scheduler and create tracked draft purchase orders for due pools." checked={Boolean(workflowValue("purchasePooling", "autoCreateDraftsAtCutoff", true))} disabled={!editing || !Boolean(workflowValue("automation", "routePaidOrders", false)) || !Boolean(workflowValue("purchasePooling", "enabled", true))} onCheckedChange={(next) => updateWorkflow("purchasePooling", "autoCreateDraftsAtCutoff", next)} />
                <Field label="Default supplier cutoff"><Input disabled={!editing || !Boolean(workflowValue("automation", "routePaidOrders", false)) || !Boolean(workflowValue("purchasePooling", "enabled", true))} type="time" value={String(workflowValue("purchasePooling", "defaultCutoffTime", "15:00"))} onChange={(event) => updateWorkflow("purchasePooling", "defaultCutoffTime", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Supplier profiles can override this time.</p></Field>
                <Field label="Default cutoff timezone"><Select disabled={!editing || !Boolean(workflowValue("automation", "routePaidOrders", false)) || !Boolean(workflowValue("purchasePooling", "enabled", true))} value={String(workflowValue("purchasePooling", "timezone", "America/New_York"))} onValueChange={(next) => updateWorkflow("purchasePooling", "timezone", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="America/New_York">Eastern</SelectItem><SelectItem value="America/Chicago">Central</SelectItem><SelectItem value="America/Denver">Mountain</SelectItem><SelectItem value="America/Los_Angeles">Pacific</SelectItem><SelectItem value="UTC">UTC</SelectItem></SelectContent></Select></Field>
                <ToggleField label="Skip weekends" description="Roll pools created after cutoff to the next weekday." checked={Boolean(workflowValue("purchasePooling", "skipWeekends", true))} disabled={!editing || !Boolean(workflowValue("automation", "routePaidOrders", false)) || !Boolean(workflowValue("purchasePooling", "enabled", true))} onCheckedChange={(next) => updateWorkflow("purchasePooling", "skipWeekends", next)} />
                <Alert className="md:col-span-2" variant={Boolean(workflowValue("automation", "routePaidOrders", false)) ? "default" : "destructive"}><Power className="size-4" /><AlertTitle>{Boolean(workflowValue("automation", "routePaidOrders", false)) ? "Routing is enabled" : "Routing is paused"}</AlertTitle><AlertDescription>{Boolean(workflowValue("automation", "routePaidOrders", false)) ? `Only eligible orders created on or after ${String(workflowValue("automation", "routingStartDate", "the configured start date"))} can enter the workflow.` : "No automatic routing, manual rerouting, supplier pooling, or PO cutoff work will run."}</AlertDescription></Alert>
                <Alert className="md:col-span-2"><ShieldCheck className="size-4" /><AlertTitle>Line-level routing and shortage retention are always enforced</AlertTitle><AlertDescription>Mixed orders stay linked while each line follows its own physical-stock or supplier-purchase route. Unmet quantities remain visible until they are received, fulfilled, canceled, or explicitly resolved.</AlertDescription></Alert>
                <Alert className="md:col-span-2"><ShieldCheck className="size-4" /><AlertTitle>Supplier and destination separation is enforced</AlertTitle><AlertDescription>Each purchase order contains one supplier and one physical receiving warehouse. This prevents mixed receipts from allocating inventory to the wrong customer order or location.</AlertDescription></Alert>
                <Alert className="md:col-span-2"><Warehouse className="size-4" /><AlertTitle>Physical inventory is the fulfillment gate</AlertTitle><AlertDescription>Supplier feeds and DataWarehouse quantities are supply signals. They enter purchasing unless stock was received or audited into a physical warehouse. Mixed orders remain linked while each line follows its own route.</AlertDescription></Alert>
                <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm font-medium">Reset test routing and purchasing data</p><p className="text-xs text-muted-foreground">Preserves customer orders and products, releases active physical reservations, deletes routes, purchase requirements, draft POs, and pick-list test data, then leaves routing paused.</p></div>
                  <Button type="button" variant="destructive" onClick={() => setRoutingResetOpen(true)}>Reset test data</Button>
                </div>
              </>}
            </CardContent>
          </Card>
          <AlertDialog open={routingResetOpen} onOpenChange={(open) => !routingResetLoading && setRoutingResetOpen(open)}>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Reset routing and purchase orders?</AlertDialogTitle><AlertDialogDescription>This deletes current fulfillment routes, purchase requirements, purchase orders, and pick-list test data. Physical reservations created by routing will be released. Customer orders, products, inventory on hand, and history events remain.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel disabled={routingResetLoading}>Cancel</AlertDialogCancel><AlertDialogAction disabled={routingResetLoading} onClick={(event) => { event.preventDefault(); void resetRoutingAndPurchasing() }}>{routingResetLoading ? <><Loader2 className="mr-2 size-4 animate-spin" /> Resetting...</> : "Reset and pause routing"}</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
        <TabsContent value="data-sources"><VendorFeedScheduleManager vendors={[]} dataSource /></TabsContent>
        <TabsContent value="barcode" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">External barcode enrichment</CardTitle><CardDescription>DataPlus always searches the local catalog first. Enable this only when an unknown UPC may be sent to Open Food Facts for basic enrichment; it is not used for matching known catalog SKUs.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2"><ToggleField label="Enable Open Food Facts for unknown UPCs" checked={boolValue("openFoodFactsLookupEnabled")} disabled={!editing} onCheckedChange={(next) => update("openFoodFactsLookupEnabled", next)} /><Field label="Open Food Facts API base URL"><Input disabled={!editing} value={String(value("openFoodFactsApiBaseUrl") || "https://world.openfoodfacts.org/api/v3")} onChange={(event) => update("openFoodFactsApiBaseUrl", event.target.value)} /></Field></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Warehouse scanner feedback</CardTitle><CardDescription>Control the sound and haptic confirmation after each scan. Visual matched and not-found feedback remains available on every device.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <ToggleField label="Enable scanner sound" checked={boolValue("warehouseScannerSoundEnabled")} disabled={!editing} onCheckedChange={(next) => update("warehouseScannerSoundEnabled", next)} />
              <Field label="Sound intensity"><Select disabled={!editing || !boolValue("warehouseScannerSoundEnabled")} value={String(value("warehouseScannerSoundIntensity") || "medium")} onValueChange={(next) => update("warehouseScannerSoundIntensity", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></Field>
              <ToggleField label="Enable scanner vibration" checked={boolValue("warehouseScannerVibrationEnabled")} disabled={!editing} onCheckedChange={(next) => update("warehouseScannerVibrationEnabled", next)} />
              <Field label="Vibration intensity"><Select disabled={!editing || !boolValue("warehouseScannerVibrationEnabled")} value={String(value("warehouseScannerVibrationIntensity") || "medium")} onValueChange={(next) => update("warehouseScannerVibrationIntensity", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></Field>
              <p className="text-sm text-muted-foreground md:col-span-2">Vibration is applied only when the device browser supports it. iPhone Safari generally uses the on-screen confirmation and scanner sound instead.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="ai" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI integration</CardTitle>
              <CardDescription>Connect DataPlus once, verify the key, then enable AI-powered capabilities where they add value. Credentials are stored securely and never displayed after saving.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Provider">
                <Select disabled={!editing} value={aiProvider} onValueChange={(next) => setDraft((current) => ({ ...current, aiProvider: next, aiModel: next === "google-ai-studio" ? "gemini-3.6-flash" : "gpt-4o-mini", aiEnabled: false }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="google-ai-studio">Google AI Studio (Gemini)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default model">
                <Input disabled={!editing} value={String(value("aiModel") || aiDefaultModel)} onChange={(event) => update("aiModel", event.target.value)} placeholder={aiDefaultModel} />
              </Field>
              <Field label={aiProvider === "google-ai-studio" ? "Google AI Studio API key" : "OpenAI API key"}>
                <Input disabled={!editing} type="password" value={String(draft[aiKeyField] || "")} onChange={(event) => update(aiKeyField, event.target.value)} placeholder={aiKeyConfigured ? "Configured (enter only to replace)" : aiProvider === "google-ai-studio" ? "Paste a Gemini API key" : "Paste an OpenAI API key"} />
                <p className="mt-1 text-xs text-muted-foreground">Use Verify connection after adding or replacing a key. Enabling AI requires a successful verification for the active key.</p>
              </Field>
              <div className="flex flex-col justify-end gap-2">
                <Button type="button" variant="outline" disabled={!editing || testingAi} onClick={() => void testAiConnection()}>
                  {testingAi ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Verify connection
                </Button>
                <p className="text-xs text-muted-foreground">{value("aiConnectionVerifiedAt") ? `Verified ${dateLabel(String(value("aiConnectionVerifiedAt")))}` : "Not verified yet"}</p>
              </div>
              <div className="md:col-span-2">
                <ToggleField label="Enable AI integration" checked={boolValue("aiEnabled")} disabled={!editing || !Boolean(value("aiConnectionVerifiedAt")) || String(value("aiConnectionVerifiedProvider") || "") !== aiProvider || String(value("aiConnectionVerifiedModel") || "") !== String(value("aiModel") || aiDefaultModel)} onCheckedChange={(next) => update("aiEnabled", next)} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">DataPlus AI usage</CardTitle>
                <CardDescription>Recorded usage from this system only. Provider account balance and free-tier limits remain in Google AI Studio or OpenAI.</CardDescription>
              </div>
              <Button size="sm" variant="outline" disabled={loadingAiUsage} onClick={() => void loadAiUsage()}>{loadingAiUsage && <Loader2 className="size-4 animate-spin" />} Refresh</Button>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <Detail label="30-day requests" value={usageNumber("requests")} />
              <Detail label="30-day input tokens" value={usageNumber("inputTokens")} />
              <Detail label="30-day output tokens" value={usageNumber("outputTokens")} />
              <Detail label="30-day total tokens" value={usageNumber("totalTokens")} />
              <div className="md:col-span-4 grid gap-3 border-t pt-3 md:grid-cols-3">
                <Detail label="Today" value={`${usageNumber("totalTokens", "today")} tokens / ${usageNumber("requests", "today")} requests`} />
                <Detail label="Last 7 days" value={`${usageNumber("totalTokens", "sevenDays")} tokens / ${usageNumber("requests", "sevenDays")} requests`} />
                <Detail label="Last recorded" value={aiUsage?.lastUpdatedAt ? dateLabel(String(aiUsage.lastUpdatedAt)) : "No recorded AI usage yet"} />
              </div>
              {Array.isArray(aiUsage?.byFeature) && aiUsage.byFeature.length > 0 && <div className="md:col-span-4 overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Feature</TableHead><TableHead>Requests</TableHead><TableHead>Input</TableHead><TableHead>Output</TableHead><TableHead>Thinking</TableHead><TableHead>Total</TableHead></TableRow></TableHeader><TableBody>{(aiUsage.byFeature as Array<Record<string, unknown>>).map((row) => <TableRow key={String(row.feature)}><TableCell className="font-medium">{String(row.feature || "Other").replaceAll("_", " ")}</TableCell><TableCell>{numberLabel(Number(row.requests || 0))}</TableCell><TableCell>{numberLabel(Number(row.inputTokens || 0))}</TableCell><TableCell>{numberLabel(Number(row.outputTokens || 0))}</TableCell><TableCell>{numberLabel(Number(row.thoughtTokens || 0))}</TableCell><TableCell>{numberLabel(Number(row.totalTokens || 0))}</TableCell></TableRow>)}</TableBody></Table></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Background category review</CardTitle>
              <CardDescription>David can review all unlocked main-category mappings as a worker job. High-confidence results are applied automatically; uncertain results stay in the Categories approval queue.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <ToggleField label="Enable background category review" checked={boolValue("aiCategoryBackgroundReviewEnabled")} disabled={!editing || !boolValue("aiEnabled")} onCheckedChange={(next) => update("aiCategoryBackgroundReviewEnabled", next)} />
                <ToggleField label="Auto-approve high-confidence mappings" checked={boolValue("aiCategoryAutoApproveEnabled")} disabled={!editing || !boolValue("aiEnabled") || !boolValue("aiCategoryBackgroundReviewEnabled")} onCheckedChange={(next) => update("aiCategoryAutoApproveEnabled", next)} />
                <Field label="Automatic approval threshold (%)">
                  <Input disabled={!editing || !boolValue("aiCategoryAutoApproveEnabled")} type="number" min="50" max="99" value={String(Math.round(Number(value("aiCategoryAutoApproveThreshold") || 0.75) * 100))} onChange={(event) => update("aiCategoryAutoApproveThreshold", Math.max(50, Math.min(99, Number(event.target.value || 75))) / 100)} />
                </Field>
                <Field label="Checkpoint batch size">
                  <Input disabled={!editing || !boolValue("aiCategoryBackgroundReviewEnabled")} type="number" min="1" max="50" value={String(value("aiCategoryReviewBatchSize") || 10)} onChange={(event) => update("aiCategoryReviewBatchSize", Number(event.target.value || 10))} />
                </Field>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <ToggleField label="Review Shopify / Google mappings" checked={aiCategoryChannels().includes("shopify")} disabled={!editing || !boolValue("aiCategoryBackgroundReviewEnabled")} onCheckedChange={(next) => updateAiCategoryChannel("shopify", next)} />
                <ToggleField label="Review eBay mappings" checked={aiCategoryChannels().includes("ebay")} disabled={!editing || !boolValue("aiCategoryBackgroundReviewEnabled")} onCheckedChange={(next) => updateAiCategoryChannel("ebay", next)} />
              </div>
              <Alert><ShieldCheck className="size-4" /><AlertTitle>Approved mappings are protected</AlertTitle><AlertDescription>A result meeting the threshold is saved and locked. A lower-confidence result is stored for manual approval. Existing locked or manually approved mappings are skipped until a user unlocks them.</AlertDescription></Alert>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Warehouse package analysis</CardTitle>
              <CardDescription>For unmatched audit scans, analyze a product photo and suggest only text visibly present on the package. Users can review and edit every suggested field before creating a SKU.</CardDescription>
            </CardHeader>
            <CardContent>
              <ToggleField label="Enable package photo suggestions" checked={boolValue("warehouseImageAnalysisEnabled")} disabled={!editing || !boolValue("aiEnabled")} onCheckedChange={(next) => update("warehouseImageAnalysisEnabled", next)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">David operational actions</CardTitle>
              <CardDescription>Enable individual capabilities instead of giving David broad access. Read scopes provide compact page context; every write scope is opt-in, approval-gated, and audited.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
              <ToggleField label="Enable David operational actions" checked={boolValue("aiOperationalActionsEnabled")} disabled={!editing || !boolValue("aiEnabled")} onCheckedChange={(next) => update("aiOperationalActionsEnabled", next)} />
              <ToggleField label="Share current page context" checked={boolValue("aiAllowPageContext")} disabled={!editing || !boolValue("aiEnabled")} onCheckedChange={(next) => update("aiAllowPageContext", next)} />
              <Field label="Approval expiry (minutes)">
                <Input disabled={!editing || !boolValue("aiOperationalActionsEnabled")} type="number" min="5" max="60" value={String(value("aiActionProposalExpiryMinutes") || 15)} onChange={(event) => update("aiActionProposalExpiryMinutes", Number(event.target.value || 15))} />
              </Field>
              <Field label="Maximum records per proposed action"><Input disabled={!editing || !boolValue("aiOperationalActionsEnabled")} type="number" min="1" max="100" value={String(value("aiMaxActionItems") || 25)} onChange={(event) => update("aiMaxActionItems", Number(event.target.value || 25))} /></Field>
              <ToggleField label="Keep David action audit log" checked={boolValue("aiAuditLoggingEnabled")} disabled={!editing} onCheckedChange={(next) => update("aiAuditLoggingEnabled", next)} />
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Explicit approval is always required for a write action. DataPlus checks the target again at approval time, then queues the regular workflow job.</div>
              </div>
              {Array.from(new Set(aiToolScopeDefinitions.map((scope) => String(scope.group || "Capabilities")))).map((group) => <div key={group} className="grid gap-2"><p className="text-sm font-medium">{group}</p><div className="grid gap-2 md:grid-cols-2">{aiToolScopeDefinitions.filter((scope) => String(scope.group || "Capabilities") === group).map((scope) => { const id = String(scope.id || ""); const implemented = scope.implemented === true; const enabled = Boolean(aiToolScopes()[id]); return <div key={id} className="flex items-start justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{String(scope.label || id)}</p><p className="mt-1 text-xs text-muted-foreground">{String(scope.description || "")}</p></div><div className="grid justify-items-end gap-1"><Switch checked={enabled} disabled={!editing || !boolValue("aiEnabled") || !implemented || (group === "Approved actions" && id !== "categories.apply" && !boolValue("aiOperationalActionsEnabled"))} onCheckedChange={(next) => updateAiToolScope(id, next)} /><span className="text-[11px] text-muted-foreground">{implemented ? "Available" : "Coming soon"}</span></div></div>})}</div></div>)}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="email"><Card><CardHeader><CardTitle className="text-base">SMTP delivery</CardTitle><CardDescription>Configure the outbound email transport used for supplier PO reminders. Credentials are stored in system settings and never displayed after save.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><ToggleField label="Enable SMTP delivery" checked={boolValue("smtpEnabled")} disabled={!editing} onCheckedChange={(next) => update("smtpEnabled", next)} /><ToggleField label="Use TLS / SSL" checked={boolValue("smtpSecure")} disabled={!editing} onCheckedChange={(next) => update("smtpSecure", next)} /><Field label="SMTP host"><Input disabled={!editing} value={String(value("smtpHost") || "")} onChange={(event) => update("smtpHost", event.target.value)} placeholder="smtp.example.com" /></Field><Field label="SMTP port"><Input disabled={!editing} type="number" value={String(value("smtpPort") || 587)} onChange={(event) => update("smtpPort", Number(event.target.value || 587))} /></Field><Field label="Username"><Input disabled={!editing} value={String(value("smtpUsername") || "")} onChange={(event) => update("smtpUsername", event.target.value)} /></Field><Field label="Password"><Input disabled={!editing} type="password" value={String(draft.smtpPassword || "")} onChange={(event) => update("smtpPassword", event.target.value)} placeholder={settings.smtpPasswordConfigured ? "Configured (enter only to replace)" : "SMTP password or app password"} /></Field><Field label="Sender name"><Input disabled={!editing} value={String(value("smtpFromName") || "DataPlus")} onChange={(event) => update("smtpFromName", event.target.value)} /></Field><Field label="Sender email"><Input disabled={!editing} type="email" value={String(value("smtpFromEmail") || "")} onChange={(event) => update("smtpFromEmail", event.target.value)} placeholder="purchasing@yourcompany.com" /></Field><div className="md:col-span-2"><Button type="button" variant="outline" disabled={testingSmtp || !boolValue("smtpEnabled")} onClick={() => void sendSmtpTest()}>{testingSmtp ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Send SMTP test</Button></div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Overdue reminder schedule</CardTitle><CardDescription>The external worker scans overdue POs once daily and sends only enabled supplier reminders. A PO is never emailed twice on the same day.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><ToggleField label="Run daily overdue reminder scan" checked={boolValue("smtpReminderScheduleEnabled")} disabled={!editing} onCheckedChange={(next) => update("smtpReminderScheduleEnabled", next)} /><Field label="Daily scan time"><Input disabled={!editing} type="time" value={String(value("smtpReminderScheduleTime") || "08:00")} onChange={(event) => update("smtpReminderScheduleTime", event.target.value)} /></Field></CardContent></Card></TabsContent>
        <TabsContent value="worker">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datadump import resources</CardTitle>
              <CardDescription>Safe server-side profiles for the large DataWarehouse product feed. The choice applies to the next run and cannot be changed while a datadump job is active.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Field label="Resource profile">
                <Select disabled={!editing} value={String(value("productDumpResourceProfile") || "large")} onValueChange={(next) => update("productDumpResourceProfile", next)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative - 1 GB / 50 rows</SelectItem>
                    <SelectItem value="standard">Standard - 2 GB / 100 rows</SelectItem>
                    <SelectItem value="large">Large datadump - 3 GB / 100 rows</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Detail label="Worker heap limit" value={`${productDumpResources.heapMb / 1024} GB`} />
              <Detail label="Database batch size" value={`${productDumpResources.batchSize} records`} />
              <Detail label="Server RAM" value={runtime ? `${(runtime.totalMemoryMb / 1024).toFixed(1)} GB total` : "Checking..."} />
              <Detail label="Available memory" value={runtime ? `${(runtime.freeMemoryMb / 1024).toFixed(1)} GB available` : "Checking..."} />
              <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-5">Large datadump is the recommended profile for this 8 GB Droplet. It reserves headroom for PostgreSQL, Redis, and the web app while allowing full BSON normalization.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Worker health</CardTitle>
              <CardDescription>Current external worker state.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <Detail label="Status" value={workerStatus.online ? "online" : "offline"} />
              <Detail label="Worker ID" value={workerStatus.workerId || "n/a"} />
              <Detail label="Current task" value={workerStatus.currentTask || "idle"} />
              <Detail label="Last seen" value={dateLabel(workerStatus.lastSeenAt)} />
              <ToggleField label="Quality scans on worker" checked={boolValue("dataQualityWorkerEnabled")} disabled={!editing} onCheckedChange={(next) => update("dataQualityWorkerEnabled", next)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="backups">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Backups and retention</CardTitle>
              <CardDescription>Define how system backups are created, checked, stored, and retained. Manual runs remain available regardless of the schedule.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ToggleField label="Enable scheduled backups" checked={boolValue("backupScheduleEnabled")} disabled={!editing} onCheckedChange={(next) => update("backupScheduleEnabled", next)} />
              <Field label="Daily backup time"><Input disabled={!editing || !boolValue("backupScheduleEnabled")} type="time" value={String(value("backupScheduleTime") || "01:00")} onChange={(event) => update("backupScheduleTime", event.target.value)} /></Field>
              <Field label="Backup destination"><Select disabled={!editing} value={String(value("backupDestination") || "local")} onValueChange={(next) => update("backupDestination", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local">Local server</SelectItem><SelectItem value="digitalocean-spaces">DigitalOcean Spaces</SelectItem><SelectItem value="s3">Amazon S3 compatible</SelectItem></SelectContent></Select></Field>
              <Field label="Backup retention days"><Input disabled={!editing} type="number" min="1" max="3650" value={String(value("backupRetentionDays") || 30)} onChange={(event) => update("backupRetentionDays", Number(event.target.value || 30))} /></Field>
              <ToggleField label="Include source catalog" checked={boolValue("backupIncludeSourceCatalog")} disabled={!editing} onCheckedChange={(next) => update("backupIncludeSourceCatalog", next)} />
              <ToggleField label="Encrypt backup files" checked={boolValue("backupEncryptionEnabled")} disabled={!editing} onCheckedChange={(next) => update("backupEncryptionEnabled", next)} />
              <ToggleField label="Verify after creation" checked={boolValue("backupVerifyAfterCreate")} disabled={!editing} onCheckedChange={(next) => update("backupVerifyAfterCreate", next)} />
              <div className="flex items-end"><Button className="w-full" variant="outline" onClick={() => api("/api/system/backup", { method: "POST", body: JSON.stringify({}) }).then((result) => toast.success(`Backup queued${result && typeof result === "object" && "jobNumber" in result ? ` as Job ${String((result as Record<string, unknown>).jobNumber)}` : ""}.`)).catch((error) => toast.error(error.message))}><Database className="size-4" /> Run backup now</Button></div>
              <Alert className="md:col-span-2 xl:col-span-4"><ShieldCheck className="size-4" /><AlertTitle>Backups run as jobs</AlertTitle><AlertDescription>Each run is visible in Jobs with progress, verification status, and its downloadable artifact while the file is retained.</AlertDescription></Alert>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="catalog">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Catalog participation</CardTitle>
                <CardDescription>Control which suppliers and records are visible, searchable, and eligible for marketplace workflows.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <ToggleField label="Show enabled vendors by default" description="The main catalog starts with suppliers included in catalog participation." checked={boolValue("catalogEnabledVendorsOnly")} disabled={!editing} onCheckedChange={(next) => update("catalogEnabledVendorsOnly", next)} />
                <ToggleField label="Allow direct searches for excluded vendors" description="A deliberate SKU search can still reveal a record outside the default vendor scope." checked={boolValue("catalogAllowExplicitDisabledVendorSearch")} disabled={!editing} onCheckedChange={(next) => update("catalogAllowExplicitDisabledVendorSearch", next)} />
                <ToggleField label="Refresh after enabling a vendor" description="Queue the catalog refresh immediately when a supplier is turned on." checked={boolValue("catalogAutoRefreshAfterVendorEnable")} disabled={!editing} onCheckedChange={(next) => update("catalogAutoRefreshAfterVendorEnable", next)} />
                <ToggleField label="True Value category becomes main category" description="Use the verified True Value path as the system category when a mapping exists." checked={boolValue("trueValueSourceCategoryAsMainCategory")} disabled={!editing} onCheckedChange={(next) => update("trueValueSourceCategoryAsMainCategory", next)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Import and launch safeguards</CardTitle>
                <CardDescription>These switches define how refreshes treat new, changed, discontinued, and incomplete catalog records.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <ToggleField label="Import new SKUs" description="Allow approved feed imports to create new catalog records." checked={boolValue("catalogImportNewSkusEnabled")} disabled={!editing} onCheckedChange={(next) => update("catalogImportNewSkusEnabled", next)} />
                <ToggleField label="Update changed rows only" description="Skip unchanged records to reduce import time and database work." checked={boolValue("catalogUpdateChangedRowsOnly")} disabled={!editing} onCheckedChange={(next) => update("catalogUpdateChangedRowsOnly", next)} />
                <ToggleField label="Track discontinued rows" description="Keep discontinuation changes visible for review instead of silently dropping them." checked={boolValue("catalogMarkDiscontinuedRows")} disabled={!editing} onCheckedChange={(next) => update("catalogMarkDiscontinuedRows", next)} />
                <ToggleField label="Block discontinued launches" description="Prevent discontinued products from being sent to Shopify, eBay, or another channel." checked={boolValue("catalogDiscontinuedLaunchBlocked")} disabled={!editing} onCheckedChange={(next) => update("catalogDiscontinuedLaunchBlocked", next)} />
                <ToggleField label="Require a main category to launch" description="Stop a marketplace launch until the system category is mapped." checked={boolValue("catalogRequireCategoryForLaunch")} disabled={!editing} onCheckedChange={(next) => update("catalogRequireCategoryForLaunch", next)} />
                <ToggleField label="Require an image to launch" description="Use this when the channel requires a product image before publication." checked={boolValue("catalogRequireImageForLaunch")} disabled={!editing} onCheckedChange={(next) => update("catalogRequireImageForLaunch", next)} />
                <Field label="Default source catalog import mode">
                  <Select disabled={!editing} value={String(value("sourceCatalogDefaultImportMode") || "new-and-update")} onValueChange={(next) => update("sourceCatalogDefaultImportMode", next)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new-and-update">New SKUs + changed existing records</SelectItem>
                      <SelectItem value="new-only">New SKUs only</SelectItem>
                      <SelectItem value="update-existing">Changed existing records only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">Used as the default for manual source-catalog imports. Feed schedules can choose Full or Refresh separately.</p>
                </Field>
                <Field label="Source catalog import limit per job">
                  <Input disabled={!editing} type="number" min="1000" max="250000" step="1000" value={String(value("sourceCatalogImportBatchLimit") || 25000)} onChange={(event) => update("sourceCatalogImportBatchLimit", Number(event.target.value || 25000))} />
                  <p className="mt-1 text-xs text-muted-foreground">Allowed range: 1,000 to 250,000 records.</p>
                </Field>
              </CardContent>
            </Card>
            <section className="grid gap-4 border-y py-5">
              <h3 className="text-base font-semibold">Shipping classification</h3>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {([
                  ["shippingParcelMaxLength", "FedEx Ground: maximum length (in)", 108],
                  ["shippingParcelMaxGirth", "FedEx Ground: maximum length + girth (in)", 165],
                  ["shippingParcelMaxWeight", "FedEx Ground: maximum actual weight (lb)", 150],
                  ["shippingDimensionalDivisor", "Dimensional divisor (cost estimate only)", 139],
                ] as const).map(([key, label, fallback]) => <Field key={key} label={label}><Input type="number" min="1" max={key === "shippingDimensionalDivisor" ? undefined : fallback} step="1" disabled={!editing} value={String(value(key) ?? fallback)} onChange={(event) => update(key, Number(event.target.value))} /></Field>)}
              </div>
              <ToggleField label="Honor supplier freight requirements" description="Supplier-designated freight remains blocked when channel freight restrictions are enabled." checked={value("shippingHonorSupplierFreight") !== false} disabled={!editing} onCheckedChange={(next) => update("shippingHonorSupplierFreight", next)} />
              <a href="/channels" className="text-sm text-primary underline">Channel inventory and launch restrictions</a>
            </section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Matching and performance</CardTitle>
                <CardDescription>Keep cross-supplier matching explainable while making repeated catalog searches lighter on the database.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <ToggleField label="Match by UPC" description="Use UPC equality as the strongest supplier-product match." checked={boolValue("catalogMatchByUpcEnabled")} disabled={!editing} onCheckedChange={(next) => update("catalogMatchByUpcEnabled", next)} />
                <ToggleField label="Match by manufacturer part number" description="Show exact manufacturer part numbers as reviewable candidates without using brand as identity evidence." checked={boolValue("catalogMatchByManufacturerPartEnabled")} disabled={!editing} onCheckedChange={(next) => update("catalogMatchByManufacturerPartEnabled", next)} />
                <ToggleField label="Require approval for close matches" description="Keep uncertain supplier matches pending until a user approves them." checked={boolValue("catalogCloseMatchApprovalRequired")} disabled={!editing} onCheckedChange={(next) => update("catalogCloseMatchApprovalRequired", next)} />
                <ToggleField label="Cache filter facets" description="Reuse indexed supplier, brand, category, and status values between visits." checked={boolValue("catalogFacetCacheEnabled")} disabled={!editing} onCheckedChange={(next) => update("catalogFacetCacheEnabled", next)} />
                <Field label="Catalog cache lifetime (seconds)">
                  <Input disabled={!editing} type="number" min="15" max="3600" step="15" value={String(value("catalogCacheTtlSeconds") || 300)} onChange={(event) => update("catalogCacheTtlSeconds", Number(event.target.value || 300))} />
                  <p className="mt-1 text-xs text-muted-foreground">Allowed range: 15 to 3,600 seconds.</p>
                </Field>
                <Field label="Search debounce (milliseconds)">
                  <Input disabled={!editing} type="number" min="100" max="1500" step="50" value={String(value("catalogSearchDebounceMs") || 350)} onChange={(event) => update("catalogSearchDebounceMs", Number(event.target.value || 350))} />
                  <p className="mt-1 text-xs text-muted-foreground">Wait this long after typing before a broad search starts.</p>
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Supplier index status</CardTitle>
                  <CardDescription>Stored supplier relationships power audit selection and multi-supplier catalog filters without live full-catalog matching.</CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={supplierIndexLoading} onClick={() => void loadSupplierIndexStatus()}>
                    <RefreshCw className={cn("size-4", supplierIndexLoading && "animate-spin")} /> Refresh
                  </Button>
                  <Button type="button" size="sm" disabled={catalogMaintenanceLoading || Boolean(supplierIndexStatus?.activeJob)} onClick={() => requestCatalogMaintenance({
                    path: "/api/catalog/supplier-index/rebuild",
                    label: "Supplier matching index",
                    description: "Rebuild stored UPC, vendor/source SKU, exact-SKU, MPN candidates, and approved supplier relationships and generate a downloadable matching report.",
                  })}>
                    {supplierIndexStatus?.activeJob ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    {supplierIndexStatus?.activeJob ? "Rebuilding" : "Rebuild"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    ["Linked products", supplierIndexStatus?.linkedProducts],
                    ["Supplier links", supplierIndexStatus?.totalLinks],
                    ["Multiple suppliers", supplierIndexStatus?.multiSupplierProducts],
                    ["Pending review", supplierIndexStatus?.pendingReviews],
                    ["Unmatched", supplierIndexStatus?.unmatchedProducts],
                  ].map(([label, count]) => <div key={String(label)} className="rounded-md border bg-muted/30 p-3"><p className="text-xs font-medium uppercase text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{supplierIndexLoading && !supplierIndexStatus ? <Loader2 className="size-5 animate-spin" /> : numberLabel(Number(count || 0))}</p></div>)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={supplierIndexStatus?.activeJob ? "secondary" : "outline"}>{supplierIndexStatus?.activeJob ? "Rebuild running" : supplierIndexStatus?.lastRebuiltAt ? "Index ready" : "Not built"}</Badge>
                  <span>Last rebuilt: {supplierIndexStatus?.lastRebuiltAt ? new Date(supplierIndexStatus.lastRebuiltAt).toLocaleString() : "Never"}</span>
                  {(supplierIndexStatus?.methodCounts || []).map((method) => <Badge key={String(method.matchType)} variant="outline">{method.matchType === "manufacturer-part-number" ? "MPN candidate" : method.matchType === "linked-vendor-sku" ? "Linked SKU candidate" : method.matchType === "vendor-sku" ? "Vendor SKU" : method.matchType === "source-sku" ? "Source SKU" : method.matchType === "exact-sku" ? "Exact SKU" : method.matchType === "approved-mfr-part-number" ? "Approved MPN" : method.matchType === "approved-vendor-sku" ? "Approved linked SKU" : String(method.matchType || "Unknown").toUpperCase()}: {numberLabel(Number(method.productCount || 0))}</Badge>)}
                  {supplierIndexStatus?.activeJob && <Button size="sm" variant="link" className="h-auto p-0 text-xs" asChild><a href={`/jobs/${encodeURIComponent(String(supplierIndexStatus.activeJob.id || ""))}`}>Open job</a></Button>}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Catalog maintenance</CardTitle>
                <CardDescription>These are background jobs. Every action is confirmed first, returns a job reference, and can be inspected from Jobs.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {catalogMaintenanceFeedback && <Alert variant={catalogMaintenanceFeedback.kind === "error" ? "destructive" : "default"}>
                  {catalogMaintenanceFeedback.kind === "error" ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
                  <AlertTitle>{catalogMaintenanceFeedback.kind === "error" ? "Maintenance could not start" : "Maintenance queued"}</AlertTitle>
                  <AlertDescription>{catalogMaintenanceFeedback.message}</AlertDescription>
                </Alert>}
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    { path: "/api/catalog/source-search-index/build", label: "Keyword search index", description: "Enables broad text search across the full source feed.", icon: <Search className="size-4" /> },
                    { path: "/api/catalog/performance-indexes/build", label: "Filter performance indexes", description: "Builds PostgreSQL indexes for supplier, status, category, stock, and lifecycle filters.", icon: <Database className="size-4" /> },
                    { path: "/api/catalog/facets/refresh", label: "Refresh filter values", description: "Recounts supplier, brand, category, and stock-status options.", icon: <RefreshCw className="size-4" /> },
                    { path: "/api/catalog/supplier-index/rebuild", label: "Supplier matching index", description: "Rebuilds cached supplier relationships and creates a downloadable match-method report.", icon: <Users className="size-4" /> },
                    { path: "/api/catalog/datawarehouse-inventory/reclassify", label: "Reclassify DataWarehouse inventory", description: "Moves imported supplier-feed stock into the virtual DataWarehouse location while preserving receipt- and audit-backed physical stock.", icon: <Warehouse className="size-4" />, body: { dryRun: false } },
                    { path: "/api/source-catalog/pricing-inventory/refresh", label: "Refresh pricing and inventory", description: "Imports cost, price, stock, promotions, and closeout changes from the product dump.", icon: <PackageSearch className="size-4" /> },
                    { path: "/api/categories/summary-index/rebuild", label: "Rebuild category index", description: "Rebuilds category summaries used by the main catalog and category mappings.", icon: <RotateCcw className="size-4" />, body: { scope: "both" } },
                  ].map((action) => <div key={action.path} className="flex min-h-20 items-center gap-3 rounded-md border bg-background p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/50">{action.icon}</span>
                    <span className="min-w-0 flex-1"><span className="block font-medium">{action.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{action.description}</span></span>
                    <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={catalogMaintenanceLoading} onClick={() => requestCatalogMaintenance({ ...action, description: action.description })}>
                      {catalogMaintenanceLoading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run
                    </Button>
                  </div>)}
                </div>
              </CardContent>
            </Card>
          </div>
          <AlertDialog open={Boolean(catalogMaintenanceConfirm)} onOpenChange={(open) => { if (!open && !catalogMaintenanceLoading) setCatalogMaintenanceConfirm(null) }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to run this job?</AlertDialogTitle>
                <AlertDialogDescription><span className="font-medium text-foreground">{catalogMaintenanceConfirm?.label}</span>: {catalogMaintenanceConfirm?.description} This will create a background job and may take several minutes on the full catalog. You can monitor the job and cancel it from Jobs.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={catalogMaintenanceLoading}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={catalogMaintenanceLoading} onClick={() => { if (catalogMaintenanceConfirm) void runCatalogMaintenance(catalogMaintenanceConfirm.path, catalogMaintenanceConfirm.label, catalogMaintenanceConfirm.body) }}>
                  {catalogMaintenanceLoading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run job
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
        <TabsContent value="users">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-2">
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="sm" variant={userAdminView === "users" ? "default" : "ghost"} onClick={() => setUserAdminView("users")}><Users className="size-4" /> Users</Button>
                <Button type="button" size="sm" variant={userAdminView === "roles" ? "default" : "ghost"} onClick={() => setUserAdminView("roles")}><ShieldCheck className="size-4" /> Roles</Button>
              </div>
              <p className="text-xs text-muted-foreground">Manage logins separately from reusable role templates.</p>
            </div>
            {userAdminView === "roles" ? <div className="grid gap-4">
              <Card>
                <CardHeader className="gap-3 border-b">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Roles</CardTitle>
                      <CardDescription>Reusable permission templates for warehouse, purchasing, catalog, operations, and read-only access.</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" disabled={!canEditUserPermissions} onClick={openBlankTemplateDialog}><Save className="size-4" /> Create role</Button>
                      <div className="flex min-w-64 items-center gap-2 rounded-md border bg-background px-2">
                        <Search className="size-4 text-muted-foreground" />
                        <Input className="h-9 border-0 px-0 shadow-none focus-visible:ring-0" placeholder="Search roles..." value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 p-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filteredPermissionTemplates.map((template) => {
                      const assignedUsers = templateUsers(template.id)
                      const assignedPreview = assignedUsers.slice(0, 3).map((user) => user.displayName || user.name || user.username).join(", ")
                      return <div key={template.id} className="grid gap-3 rounded-md border bg-background p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{template.name}</p>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.description || "No description."}</p>
                          </div>
                          <div className="flex shrink-0 gap-1">{template.builtIn && <Badge variant="outline">Built-in</Badge>}<Badge variant="secondary">v{numberLabel(template.version || 1)}</Badge></div>
                        </div>
                        <div className="grid gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                          <span><span className="font-medium text-foreground">{numberLabel(permissionMatrixCount(template.permissions))}</span> enabled permission{permissionMatrixCount(template.permissions) === 1 ? "" : "s"}</span>
                          <span><span className="font-medium text-foreground">{numberLabel(assignedUsers.length)}</span> user{assignedUsers.length === 1 ? "" : "s"} assigned{assignedPreview ? `: ${assignedPreview}${assignedUsers.length > 3 ? ` +${assignedUsers.length - 3}` : ""}` : "."}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" disabled={!canEditUserPermissions} onClick={() => openTemplateDialog(template)}><Pencil className="size-3.5" /> Edit</Button>
                          <Button type="button" size="sm" variant="outline" disabled={!canEditUserPermissions || userSaving} onClick={() => void duplicatePermissionTemplate(template)}><Copy className="size-3.5" /> Duplicate</Button>
                          <Button type="button" size="sm" variant={compareTemplateId === template.id ? "default" : "outline"} disabled={!selectedUser} onClick={() => setCompareTemplateId(compareTemplateId === template.id ? "" : template.id)}><Eye className="size-3.5" /> Compare</Button>
                          {!template.builtIn && <Button type="button" size="sm" variant="outline" disabled={!canEditUserPermissions || userSaving} onClick={() => void deletePermissionTemplate(template.id)}><Trash2 className="size-3.5" /> Delete</Button>}
                        </div>
                      </div>
                    })}
                    {!filteredPermissionTemplates.length && <p className="rounded-md border p-4 text-sm text-muted-foreground">No roles match this search.</p>}
                  </div>
                  {compareTemplate && selectedUser && <div className="rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Compare {selectedUser.name || selectedUser.username} to {compareTemplate.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{compareDiffs.length ? `${numberLabel(compareDiffs.length)} permission difference${compareDiffs.length === 1 ? "" : "s"}.` : "This user's saved permissions match the selected role."}</p>
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => setCompareTemplateId("")}>Close compare</Button>
                    </div>
                    {!!compareDiffs.length && <ScrollArea className="mt-3 max-h-64 rounded-md border">
                      <Table>
                        <TableHeader><TableRow><TableHead>Section</TableHead><TableHead>Action</TableHead><TableHead>{selectedUser.name || selectedUser.username}</TableHead><TableHead>{compareTemplate.name}</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {compareDiffs.slice(0, 120).map((diff) => <TableRow key={`${diff.areaId}-${diff.action}`}>
                            <TableCell>{diff.label}</TableCell>
                            <TableCell>{permissionActionLabel(diff.action)}</TableCell>
                            <TableCell><Badge variant={diff.left ? "secondary" : "outline"}>{diff.left ? "On" : "Off"}</Badge></TableCell>
                            <TableCell><Badge variant={diff.right ? "secondary" : "outline"}>{diff.right ? "On" : "Off"}</Badge></TableCell>
                          </TableRow>)}
                        </TableBody>
                      </Table>
                    </ScrollArea>}
                  </div>}
                </CardContent>
              </Card>
            </div> : (
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <CardHeader className="gap-3 border-b">
                <div>
                  <CardTitle className="text-base">Manage users</CardTitle>
                  <CardDescription>Create logins and choose each user's page and action access.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void loadUsers()}><RefreshCw className="size-4" /> Refresh</Button>
                  <Button size="sm" disabled={!canCreateUsers} onClick={() => setNewUserOpen(true)}><Users className="size-4" /> Add login</Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-2 p-3">
                <label className="flex items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground"><Checkbox checked={showArchivedUsers} onCheckedChange={(checked) => setShowArchivedUsers(checked === true)} /> Show archived users</label>
                {!!selectedUsersForBulk.length && <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
                  <p className="text-xs font-medium">{numberLabel(selectedUsersForBulk.length)} selected</p>
                  <Select value={bulkTemplateId || "none"} onValueChange={(value) => setBulkTemplateId(value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">Bulk template</SelectItem>{permissionTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!canEditUserPermissions || !bulkTemplateId || userSaving} onClick={() => void bulkUpdateUsers("template")}>Apply template</Button>
                    <Button size="sm" variant="outline" disabled={!canDeactivateUsers || userSaving} onClick={() => void bulkUpdateUsers("inactive")}>Deactivate</Button>
                    <Button size="sm" variant="outline" disabled={!canDeactivateUsers || userSaving} onClick={() => void bulkUpdateUsers("archived")}>Archive</Button>
                  </div>
                </div>}
                {visibleUsers.map((user) => {
                  const template = user.permissionTemplateId && user.permissionTemplateId !== "custom" ? permissionTemplates.find((candidate) => candidate.id === user.permissionTemplateId) : undefined
                  const hasDrift = Boolean(template && Number(user.permissionTemplateVersion || 0) > 0 && Number(user.permissionTemplateVersion || 0) < Number(template.version || 1))
                  return <div key={user.id} className={cn("rounded-md border p-3 transition-colors hover:border-primary", selectedUser?.id === user.id && "border-primary bg-primary/5")}>
                    <div className="flex items-start gap-2">
                      <Checkbox disabled={user.isMasterAdmin} checked={selectedUserIds.has(user.id)} onCheckedChange={(checked) => setSelectedUserIds((current) => { const next = new Set(current); if (checked === true) next.add(user.id); else next.delete(user.id); return next })} />
                      <button type="button" onClick={() => setSelectedUserId(user.id)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{user.displayName || user.fullName || user.name || user.username}</p><p className="truncate text-xs text-muted-foreground">{user.jobTitle || user.username || user.email}</p></div><Badge variant={user.status === "active" ? "success" : user.status === "archived" ? "outline" : "secondary"}>{user.status || "active"}</Badge></div>
                        <div className="mt-2 flex flex-wrap gap-1"><Badge variant={user.isMasterAdmin ? "default" : "secondary"}>{user.role || "Operator"}</Badge><Badge variant="outline">{userPermissionSummary(user)}</Badge>{hasDrift && <Badge variant="warning">Template v{numberLabel(user.permissionTemplateVersion || 0)} → v{numberLabel(template?.version || 1)}</Badge>}{JSON.stringify(user) !== JSON.stringify(savedUsers.find((saved) => saved.id === user.id) || null) && <Badge variant="warning">Unsaved</Badge>}{user.mustChangePassword && <Badge variant="warning">{user.passwordChangeRequired ? "Password change overdue" : user.passwordChangeDueAt ? `Password due ${dateLabel(user.passwordChangeDueAt)}` : "Password change: 14 days after sign-in"}</Badge>}</div>
                      </button>
                    </div>
                  </div>
                })}
                {!visibleUsers.length && <p className="rounded-md border p-4 text-sm text-muted-foreground">No users found.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">{selectedUser ? `Profile: ${selectedUser.name || selectedUser.username}` : "User profile"}{selectedUserDirty && <Badge variant="warning">Unsaved changes</Badge>}{previewOpen && <Badge variant="secondary">Preview open</Badge>}</CardTitle>
                    <CardDescription>{selectedUser?.isMasterAdmin ? "Luis is the protected master admin and always keeps full access." : "Save profile changes and permission edits for the selected login."}</CardDescription>
                  </div>
                  {selectedUser && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPreviewOpen((open) => !open)}><Eye className="size-4" /> Preview</Button>{selectedUser.id !== authUser.id && <Button size="sm" variant="outline" disabled={!canResetUserPasswords || userSaving || selectedUser.status === "archived"} onClick={() => void resetUserPassword(selectedUser.id)}><LockKeyhole className="size-4" /> Generate temporary password</Button>}<Button size="sm" variant="outline" disabled={!canDeactivateUsers || userSaving || selectedUser.isMasterAdmin || selectedUser.status === "archived"} onClick={() => void archiveSelectedUser()}><Trash2 className="size-4" /> Archive</Button><Button size="sm" disabled={!(canEditUserAccounts || canEditUserPermissions) || userSaving || !selectedUserDirty} onClick={() => void saveUser(selectedUser.id, selectedUser)}>{userSaving && <Loader2 className="size-4 animate-spin" />} Save user</Button></div>}
                </div>
              </CardHeader>
              <CardContent className="grid gap-5 p-4">
                {temporaryPassword && <Alert className="border-amber-500/40 bg-amber-500/5"><LockKeyhole className="size-4" /><AlertTitle>Temporary password generated — change within 14 days</AlertTitle><AlertDescription><span className="font-mono">{temporaryPassword}</span></AlertDescription></Alert>}
                {selectedUser ? <>
                  {selectedUserTemplateDrift && <Alert className="border-amber-500/40 bg-amber-500/5"><AlertCircle className="size-4" /><AlertTitle>Template version drift</AlertTitle><AlertDescription>{selectedUser.name || selectedUser.username} was assigned {selectedUserTemplate?.name} v{numberLabel(selectedUser.permissionTemplateVersion || 0)}, but the template is now v{numberLabel(selectedUserTemplate?.version || 1)}. Apply the template again to sync it.</AlertDescription></Alert>}
                  {selectedUser.id === authUser.id && <Card className="border-primary/30 bg-primary/[0.03]">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-sm"><LockKeyhole className="size-4 text-primary" /> Change your password</CardTitle>
                      <CardDescription>Verify your current password, then choose the new password you want to use.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" onSubmit={(event) => { event.preventDefault(); void changeOwnPassword() }}>
                        <Field label="Current password"><Input type="password" autoComplete="current-password" value={ownPasswordDraft.currentPassword} onChange={(event) => setOwnPasswordDraft((current) => ({ ...current, currentPassword: event.target.value }))} /></Field>
                        <Field label="New password"><Input type="password" autoComplete="new-password" minLength={8} value={ownPasswordDraft.password} onChange={(event) => setOwnPasswordDraft((current) => ({ ...current, password: event.target.value }))} /></Field>
                        <Field label="Confirm new password"><Input type="password" autoComplete="new-password" minLength={8} value={ownPasswordDraft.confirm} onChange={(event) => setOwnPasswordDraft((current) => ({ ...current, confirm: event.target.value }))} /></Field>
                        <Button type="submit" disabled={ownPasswordSaving || !ownPasswordDraft.currentPassword || ownPasswordDraft.password.length < 8 || ownPasswordDraft.password !== ownPasswordDraft.confirm}>{ownPasswordSaving ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />} Update password</Button>
                      </form>
                    </CardContent>
                  </Card>}
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-sm">Company profile</CardTitle><CardDescription>Identity, contact, team, and HR context for this login.</CardDescription></CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="Full name"><Input disabled={!canEditUserAccounts || selectedUser.isMasterAdmin} value={selectedUser.fullName || selectedUser.name || ""} onChange={(event) => { updateSelectedUserField("fullName", event.target.value); updateSelectedUserField("name", event.target.value) }} /></Field>
                      <Field label="Preferred display name"><Input disabled={!canEditUserAccounts || selectedUser.isMasterAdmin} value={selectedUser.displayName || ""} onChange={(event) => updateSelectedUserField("displayName", event.target.value)} /></Field>
                      <Field label="First name"><Input disabled={!canEditUserAccounts || selectedUser.isMasterAdmin} value={selectedUser.firstName || ""} onChange={(event) => updateSelectedUserField("firstName", event.target.value)} /></Field>
                      <Field label="Last name"><Input disabled={!canEditUserAccounts || selectedUser.isMasterAdmin} value={selectedUser.lastName || ""} onChange={(event) => updateSelectedUserField("lastName", event.target.value)} /></Field>
                      <Field label="Username"><Input disabled={!canEditUserAccounts || selectedUser.isMasterAdmin} value={selectedUser.username || ""} onChange={(event) => updateSelectedUserField("username", event.target.value)} /></Field>
                      <Field label="Email"><Input disabled={!canEditUserAccounts} type="email" value={selectedUser.email || ""} onChange={(event) => updateSelectedUserField("email", event.target.value)} /></Field>
                      <Field label="Phone"><Input disabled={!canEditUserAccounts} value={selectedUser.phone || ""} onChange={(event) => updateSelectedUserField("phone", event.target.value)} /></Field>
                      <Field label="Mobile phone"><Input disabled={!canEditUserAccounts} value={selectedUser.mobilePhone || ""} onChange={(event) => updateSelectedUserField("mobilePhone", event.target.value)} /></Field>
                      <Field label="Job title"><Input disabled={!canEditUserAccounts} value={selectedUser.jobTitle || ""} onChange={(event) => updateSelectedUserField("jobTitle", event.target.value)} /></Field>
                      <Field label="Department"><Input disabled={!canEditUserAccounts} value={selectedUser.department || ""} onChange={(event) => updateSelectedUserField("department", event.target.value)} /></Field>
                      <Field label="Team"><Input disabled={!canEditUserAccounts} value={selectedUser.team || ""} onChange={(event) => updateSelectedUserField("team", event.target.value)} /></Field>
                      <Field label="Manager"><Input disabled={!canEditUserAccounts} value={selectedUser.manager || ""} onChange={(event) => updateSelectedUserField("manager", event.target.value)} /></Field>
                      <Field label="Location"><Input disabled={!canEditUserAccounts} value={selectedUser.location || ""} onChange={(event) => updateSelectedUserField("location", event.target.value)} /></Field>
                      <Field label="Employee ID"><Input disabled={!canEditUserAccounts} value={selectedUser.employeeId || ""} onChange={(event) => updateSelectedUserField("employeeId", event.target.value)} /></Field>
                      <Field label="Timezone"><Input disabled={!canEditUserAccounts} value={selectedUser.timezone || ""} onChange={(event) => updateSelectedUserField("timezone", event.target.value)} placeholder="America/New_York" /></Field>
                      <Field label="Start date"><Input disabled={!canEditUserAccounts} type="date" value={selectedUser.startDate || ""} onChange={(event) => updateSelectedUserField("startDate", event.target.value)} /></Field>
                      <Field label="Avatar URL"><Input disabled={!canEditUserAccounts} value={selectedUser.avatarUrl || ""} onChange={(event) => updateSelectedUserField("avatarUrl", event.target.value)} /></Field>
                      <Field label="Status"><Select disabled={!(canEditUserAccounts && canDeactivateUsers) || selectedUser.isMasterAdmin} value={selectedUser.status || "active"} onValueChange={updateSelectedUserStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></Field>
                      <Field label="Profile notes"><Textarea disabled={!canEditUserAccounts} className="min-h-24 xl:col-span-2" value={selectedUser.notes || ""} onChange={(event) => updateSelectedUserField("notes", event.target.value)} /></Field>
                    </CardContent>
                  </Card>
                  <UserCompanyAccess key={selectedUser.id} userId={selectedUser.id} canEdit={canEditUserPermissions && selectedUser.status === "active"}/>
                  <Card className="border-dashed">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">User access template</CardTitle>
                      <CardDescription>This applies a reusable template to {selectedUser.name || selectedUser.username}. Choose Custom when this user should have individual checks.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <Select disabled={!canEditUserPermissions || selectedUser.isMasterAdmin} value={selectedTemplateId} onValueChange={applyPermissionTemplate}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom</SelectItem>
                          {selectedUser.isMasterAdmin && <SelectItem value="master-admin">Master admin</SelectItem>}
                          {permissionTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => setUserAdminView("roles")}><ShieldCheck className="size-4" /> Manage roles</Button>
                        <Button type="button" variant="outline" disabled={!canEditUserPermissions || selectedUser.isMasterAdmin} onClick={() => openTemplateDialog()}><Save className="size-4" /> Create template from user</Button>
                        <Button type="button" variant="outline" disabled={!selectedUser} onClick={exportSelectedPermissions}><FileDown className="size-4" /> Export JSON</Button>
                        <Button type="button" variant="outline" disabled={!canEditUserPermissions || selectedUser.isMasterAdmin} asChild>
                          <label className="cursor-pointer"><FileUp className="size-4" /> Import JSON<input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { importSelectedPermissions(event.target.files?.[0]); event.currentTarget.value = "" }} /></label>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                  {!selectedUser.isMasterAdmin && <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Copy access</CardTitle>
                      <CardDescription>Copy a full permission set from another user or from a template, then save this user.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      <div className="flex gap-2">
                        <Select value={copyUserId || "none"} onValueChange={(value) => setCopyUserId(value === "none" ? "" : value)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="none">Copy from user</SelectItem>{users.filter((user) => user.id !== selectedUser.id).map((user) => <SelectItem key={user.id} value={user.id}>{user.name || user.username}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button type="button" variant="outline" disabled={!canEditUserPermissions || !copyUserId} onClick={copyPermissionsFromUser}><Copy className="size-4" /> Copy</Button>
                      </div>
                      <div className="flex gap-2">
                        <Select value={copyTemplateId || "none"} onValueChange={(value) => setCopyTemplateId(value === "none" ? "" : value)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="none">Copy from template</SelectItem>{permissionTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button type="button" variant="outline" disabled={!canEditUserPermissions || !copyTemplateId} onClick={copyPermissionsFromTemplate}><Copy className="size-4" /> Copy</Button>
                      </div>
                    </CardContent>
                  </Card>}
                  {previewOpen && selectedUser && <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Preview as {selectedUser.name || selectedUser.username}</CardTitle>
                      <CardDescription>Visible areas and access summary before you hand over this login.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {userAreas.map((area) => {
                        const visible = userCanFromMatrix(selectedUser, area.id, "view") || (area.sections || []).some((section) => userCanFromMatrix(selectedUser, section.id, "view"))
                        return <div key={`preview-${area.id}`} className={cn("rounded-md border p-3", visible ? "bg-background" : "bg-muted/30 opacity-70")}>
                          <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{area.label}</p><Badge variant={visible ? "secondary" : "outline"}>{visible ? "Visible" : "Hidden"}</Badge></div>
                          <p className="mt-1 text-xs text-muted-foreground">{permissionSummary(area)}</p>
                        </div>
                      })}
                    </CardContent>
                  </Card>}
                  {selectedUser.isMasterAdmin ? <Alert>
                    <ShieldCheck className="size-4" />
                    <AlertTitle>Master admin access is locked on</AlertTitle>
                    <AlertDescription>Luis always has full access across every page, feature, and action. The detailed permission matrix is hidden for this protected account.</AlertDescription>
                  </Alert> : <Card className="overflow-hidden">
                    <CardHeader className="gap-3 border-b">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">User permission matrix <Badge variant="secondary">Editing {selectedUser.name || selectedUser.username}</Badge></CardTitle>
                          <CardDescription>These checks change only this user. Use the Roles view to create or edit reusable templates.</CardDescription>
                        </div>
                        <div className="flex min-w-64 items-center gap-2 rounded-md border bg-background px-2">
                          <Search className="size-4 text-muted-foreground" />
                          <Input className="h-9 border-0 px-0 shadow-none focus-visible:ring-0" placeholder="Search permissions..." value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-0 p-0 lg:grid-cols-[260px_minmax(0,1fr)]">
                      <div className="border-b bg-muted/20 p-3 lg:border-b-0 lg:border-r">
                        <ScrollArea className="h-[32rem] pr-3">
                          <div className="grid gap-2">
                            {filteredPermissionAreas.map((area) => {
                              const active = selectedPermissionArea?.id === area.id
                              return <button key={area.id} type="button" onClick={() => setSelectedPermissionAreaId(area.id)} className={cn("rounded-md border bg-background p-3 text-left transition-colors hover:border-primary", active && "border-primary bg-primary/5")}>
                                <div className="flex items-start justify-between gap-2">
                                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{area.label}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{area.sections?.length || 0} deeper section{area.sections?.length === 1 ? "" : "s"}</span></span>
                                  <Badge variant={permissionAreaCounts(area).enabled ? "secondary" : "outline"}>{permissionSummary(area)}</Badge>
                                </div>
                              </button>
                            })}
                            {!filteredPermissionAreas.length && <p className="rounded-md border bg-background p-4 text-sm text-muted-foreground">No permission categories match this search.</p>}
                          </div>
                        </ScrollArea>
                      </div>
                      <div className="min-w-0 p-4">
                        {selectedPermissionArea ? <div className="grid gap-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-semibold">{selectedPermissionArea.label}</p>
                              <p className="text-xs text-muted-foreground">{selectedPermissionArea.path} · {permissionSummary(selectedPermissionArea)} · saved as {templateName(selectedUser.permissionTemplateId)}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="outline" disabled={!canEditUserPermissions} onClick={() => applyPermissionPreset(selectedPermissionArea, "none")}>No access</Button>
                              <Button type="button" size="sm" variant="outline" disabled={!canEditUserPermissions} onClick={() => applyPermissionPreset(selectedPermissionArea, "view")}>View only</Button>
                              <Button type="button" size="sm" variant="outline" disabled={!canEditUserPermissions} onClick={() => applyPermissionPreset(selectedPermissionArea, "standard")}>Standard</Button>
                              <Button type="button" size="sm" disabled={!canEditUserPermissions} onClick={() => applyPermissionPreset(selectedPermissionArea, "full")}>Full access</Button>
                            </div>
                          </div>
                          <ScrollArea className="max-h-[30rem] rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="min-w-56">Section</TableHead>
                                  {commonPermissionActions.map((action) => <TableHead key={action} className="w-24 text-center">{permissionActionLabel(action)}</TableHead>)}
                                  <TableHead>Special actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {selectedPermissionRows.map((area) => {
                                  const specialActions = (area.actions || []).filter((action) => !commonPermissionActions.includes(action))
                                  return <TableRow key={area.id}>
                                    <TableCell className="align-top">
                                      <div className="font-medium">{area.label}</div>
                                      <div className="text-xs text-muted-foreground">{area.path}</div>
                                      <Badge className="mt-2" variant={permissionAreaCounts(area).enabled ? "secondary" : "outline"}>{permissionSummary(area)}</Badge>
                                    </TableCell>
                                    {commonPermissionActions.map((action) => <TableCell key={`${area.id}-${action}`} className="text-center align-top">{permissionCheckbox(area, action)}</TableCell>)}
                                    <TableCell className="align-top">
                                      <div className="flex flex-wrap gap-2">
                                        {specialActions.map((action) => <label key={`${area.id}-${action}`} className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs">
                                          {permissionCheckbox(area, action)}
                                          <span>{permissionActionLabel(action)}</span>
                                        </label>)}
                                        {!specialActions.length && <span className="text-xs text-muted-foreground">No special actions</span>}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                })}
                              </TableBody>
                            </Table>
                          </ScrollArea>
                        </div> : <Empty className="rounded-md border py-10"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheck /></EmptyMedia><EmptyTitle>No category selected</EmptyTitle><EmptyDescription>Select a permission category to edit access.</EmptyDescription></EmptyHeader></Empty>}
                      </div>
                    </CardContent>
                  </Card>}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">User activity</CardTitle>
                      <CardDescription>Password resets, permission changes, template changes, deactivation, and archive events for this login.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2">
                      {permissionAuditLog.filter((event) => event.targetId === selectedUser.id).slice(0, 8).map((event) => <div key={`user-activity-${event.id}`} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{event.message || event.type || "Activity"}</span><span className="text-xs text-muted-foreground">{dateLabel(event.createdAt)}</span></div>
                        <p className="mt-1 text-xs text-muted-foreground">By {event.actorName || "System"} · {numberLabel(event.beforeCount)} to {numberLabel(event.afterCount)} enabled actions</p>
                      </div>)}
                      {!permissionAuditLog.some((event) => event.targetId === selectedUser.id) && <p className="rounded-md border p-4 text-sm text-muted-foreground">No recorded user activity yet.</p>}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
                      <div>
                        <CardTitle className="text-sm">Permission audit log</CardTitle>
                        <CardDescription>Recent user, template, and password permission events.</CardDescription>
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => void loadUsers()}><RefreshCw className="size-4" /> Refresh</Button>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="max-h-64">
                        <Table>
                          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Target</TableHead><TableHead>Change</TableHead><TableHead className="text-right">Enabled</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {permissionAuditLog.slice(0, 40).map((event) => <TableRow key={event.id}>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(event.createdAt)}</TableCell>
                              <TableCell>{event.actorName || "System"}</TableCell>
                              <TableCell>{event.targetName || event.targetId || "-"}</TableCell>
                              <TableCell className="max-w-md">
                                <span className="line-clamp-2">{event.message || event.type || "Permission change"}</span>
                                {!!event.diffs?.length && <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
                                  {event.diffs.slice(0, 3).map((diff, index) => <span key={`${event.id}-${diff.area}-${diff.action}-${index}`}>{diff.areaLabel || diff.area} / {permissionActionLabel(diff.action || "")}: {diff.before ? "on" : "off"} to {diff.after ? "on" : "off"}</span>)}
                                  {event.diffs.length > 3 && <span>+{event.diffs.length - 3} more permission change{event.diffs.length - 3 === 1 ? "" : "s"}</span>}
                                </div>}
                              </TableCell>
                              <TableCell className="text-right">{numberLabel(event.beforeCount)} <span className="text-muted-foreground">to</span> {numberLabel(event.afterCount)}</TableCell>
                            </TableRow>)}
                            {!permissionAuditLog.length && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No permission audit events yet.</TableCell></TableRow>}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </> : <Empty className="rounded-md border py-10"><EmptyHeader><EmptyMedia variant="icon"><Users /></EmptyMedia><EmptyTitle>Select a user</EmptyTitle><EmptyDescription>Choose a login to edit profile and permissions.</EmptyDescription></EmptyHeader></Empty>}
              </CardContent>
            </Card>
          </div>
            )}
          </div>

          <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
            <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle>{templateDraft.id ? "Edit permission template" : "Create permission template"}</DialogTitle>
                <DialogDescription>{templateDraft.id ? "You are changing this reusable template for future use. Assigned users keep their saved permissions until you apply the template again." : Object.keys(templateDraft.permissions || {}).length ? "This creates a new reusable template from the selected user's current checks." : "This creates a blank reusable template. Choose the permissions below, then save it."}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <Field label="Template name"><Input disabled={!canEditUserPermissions} value={templateDraft.name} onChange={(event) => setTemplateDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Warehouse receiver" /></Field>
                <Field label="Description"><Textarea disabled={!canEditUserPermissions} value={templateDraft.description} onChange={(event) => setTemplateDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this template allows." /></Field>
                <div className="rounded-md border">
                  <div className="border-b p-3">
                    <p className="text-sm font-medium">Template permissions</p>
                    <p className="text-xs text-muted-foreground">Edit the same permission rows that can be applied to users.</p>
                  </div>
                  <ScrollArea className="h-[26rem]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-56">Section</TableHead>
                          {commonPermissionActions.map((action) => <TableHead key={`template-head-${action}`} className="w-24 text-center">{permissionActionLabel(action)}</TableHead>)}
                          <TableHead>Special actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {userAreas.flatMap((area) => areaPermissionRows(area)).map((area) => {
                          const specialActions = (area.actions || []).filter((action) => !commonPermissionActions.includes(action))
                          return <TableRow key={`template-${area.id}`}>
                            <TableCell className="align-top"><div className="font-medium">{area.label}</div><div className="text-xs text-muted-foreground">{area.path}</div></TableCell>
                            {commonPermissionActions.map((action) => <TableCell key={`template-${area.id}-${action}`} className="text-center align-top">{templatePermissionCheckbox(area, action)}</TableCell>)}
                            <TableCell className="align-top">
                              <div className="flex flex-wrap gap-2">
                                {specialActions.map((action) => <label key={`template-${area.id}-${action}`} className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs">
                                  {templatePermissionCheckbox(area, action)}
                                  <span>{permissionActionLabel(action)}</span>
                                </label>)}
                                {!specialActions.length && <span className="text-xs text-muted-foreground">No special actions</span>}
                              </div>
                            </TableCell>
                          </TableRow>
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
                <Button disabled={!canEditUserPermissions || userSaving || !templateDraft.name.trim()} onClick={() => void savePermissionTemplate()}>{userSaving && <Loader2 className="size-4 animate-spin" />} Save template</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Create login</DialogTitle><DialogDescription>The user has 14 days to change their password after account creation. Leave password empty to generate one.</DialogDescription></DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name"><Input disabled={!canCreateUsers} value={newUser.fullName} onChange={(event) => setNewUser((current) => ({ ...current, fullName: event.target.value, name: event.target.value }))} /></Field>
                <Field label="Preferred name"><Input disabled={!canCreateUsers} value={newUser.name} onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))} /></Field>
                <Field label="First name"><Input disabled={!canCreateUsers} value={newUser.firstName} onChange={(event) => setNewUser((current) => ({ ...current, firstName: event.target.value }))} /></Field>
                <Field label="Last name"><Input disabled={!canCreateUsers} value={newUser.lastName} onChange={(event) => setNewUser((current) => ({ ...current, lastName: event.target.value }))} /></Field>
                <Field label="Username"><Input disabled={!canCreateUsers} value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} placeholder="first.last" /></Field>
                <Field label="Email"><Input disabled={!canCreateUsers} type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} /></Field>
                <Field label="Phone"><Input disabled={!canCreateUsers} value={newUser.phone} onChange={(event) => setNewUser((current) => ({ ...current, phone: event.target.value }))} /></Field>
                <Field label="Job title"><Input disabled={!canCreateUsers} value={newUser.jobTitle} onChange={(event) => setNewUser((current) => ({ ...current, jobTitle: event.target.value }))} /></Field>
                <Field label="Department"><Input disabled={!canCreateUsers} value={newUser.department} onChange={(event) => setNewUser((current) => ({ ...current, department: event.target.value }))} /></Field>
                </div>
                <Field label="Permission template">
                  <Select disabled={!canCreateUsers} value={newUser.permissionTemplateId} onValueChange={(value) => setNewUser((current) => ({ ...current, permissionTemplateId: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Custom</SelectItem>
                      {permissionTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Temporary password"><Input disabled={!canCreateUsers} type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} placeholder="Generate automatically" /></Field>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setNewUserOpen(false)}>Cancel</Button><Button disabled={!canCreateUsers || userSaving || !newUser.username} onClick={() => void createLogin()}>{userSaving && <Loader2 className="size-4 animate-spin" />} Create login</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  )
}


export { SettingsPage }
