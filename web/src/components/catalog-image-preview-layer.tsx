import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function CatalogImagePreviewLayer() {
  const [activeImage, setActiveImage] = useState<{ src: string; alt: string } | null>(null)
  useEffect(() => {
    const openPreview = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("img") : null
      if (!(target instanceof HTMLImageElement) || !target.currentSrc || !target.closest("main") || target.closest("[data-no-image-preview], [data-catalog-image-viewer]")) return
      event.preventDefault()
      event.stopPropagation()
      setActiveImage({ src: target.currentSrc, alt: target.alt || "Catalog image" })
    }
    document.addEventListener("click", openPreview, true)
    return () => document.removeEventListener("click", openPreview, true)
  }, [])
  return <Dialog open={Boolean(activeImage)} onOpenChange={(open) => !open && setActiveImage(null)}><DialogContent className="max-h-[92vh] max-w-[96vw] overflow-hidden p-3 sm:max-w-4xl"><DialogHeader className="sr-only"><DialogTitle>{activeImage?.alt || "Catalog image"}</DialogTitle></DialogHeader><div className="grid max-h-[84vh] place-items-center overflow-auto rounded-md bg-muted/40 p-2">{activeImage && <img src={activeImage.src} alt={activeImage.alt} className="max-h-[80vh] max-w-full object-contain" data-no-image-preview />}</div></DialogContent></Dialog>
}
