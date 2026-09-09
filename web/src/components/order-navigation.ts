import { FileText, FileUp, FileWarning, History, RotateCcw, ShoppingBag } from 'lucide-react'

export const orderSidebarItems = [
  { label: 'Open Orders', path: '/orders', icon: ShoppingBag },
  { label: 'All Orders', path: '/orders/all', icon: History },
  { label: 'Drafts & Quotes', path: '/drafts', icon: FileText },
  { label: 'Returns', path: '/returns', icon: RotateCcw },
  { label: 'Data Review', path: '/orders/data-review', icon: FileWarning },
  { label: 'Tools', path: '/orders/tools', icon: FileUp },
]
