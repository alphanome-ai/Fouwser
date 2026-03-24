import { Menu } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { AppSidebar } from '@/components/sidebar/AppSidebar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ShortcutsDialog } from '@/entrypoints/newtab/index/ShortcutsDialog'
import { useIsMobile } from '@/hooks/use-mobile'
import { SETTINGS_PAGE_VIEWED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { RpcClientProvider } from '@/lib/rpc/RpcClientProvider'
import { cn } from '@/lib/utils'

export const SidebarLayout: FC = () => {
  const location = useLocation()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false)

  const openShortcuts = useCallback(() => {
    setShortcutsDialogOpen(true)
  }, [])

  useEffect(() => {
    track(SETTINGS_PAGE_VIEWED_EVENT, { page: location.pathname })
  }, [location.pathname])

  useEffect(() => {
    setMobileOpen(false)
  }, [])

  if (isMobile) {
    return (
      <RpcClientProvider>
        <div className="flex min-h-screen flex-col bg-background">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 size-7"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
            <span className="font-semibold">Fouwser</span>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          </main>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-72 p-0">
              <AppSidebar expanded onOpenShortcuts={openShortcuts} />
            </SheetContent>
          </Sheet>
          <ShortcutsDialog
            open={shortcutsDialogOpen}
            onOpenChange={setShortcutsDialogOpen}
          />
        </div>
      </RpcClientProvider>
    )
  }

  return (
    <RpcClientProvider>
      <div className="relative min-h-screen bg-background">
        {/* Sidebar - fixed with manual toggle */}
        <div className="fixed inset-y-0 left-0 z-40">
          <AppSidebar
            expanded={sidebarOpen}
            onOpenShortcuts={openShortcuts}
            onToggleExpanded={() => setSidebarOpen((prev) => !prev)}
          />
        </div>

        {/* Main content - offset by sidebar width */}
        <main
          className={cn(
            'min-h-screen overflow-y-auto transition-[padding-left] duration-200',
            sidebarOpen ? 'pl-64' : 'pl-14',
          )}
        >
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
      <ShortcutsDialog
        open={shortcutsDialogOpen}
        onOpenChange={setShortcutsDialogOpen}
      />
    </RpcClientProvider>
  )
}
