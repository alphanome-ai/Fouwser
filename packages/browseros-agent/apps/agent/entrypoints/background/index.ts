import { sessionStorage } from '@/lib/auth/sessionStorage'
import { Capabilities } from '@/lib/browseros/capabilities'
import { getHealthCheckUrl, getMcpServerUrl } from '@/lib/browseros/helpers'
import { openSidePanel, toggleSidePanel } from '@/lib/browseros/toggleSidePanel'
import { checkAndShowChangelog } from '@/lib/changelog/changelog-notifier'
import {
  setupLlmProvidersBackupToBrowserOS,
  setupLlmProvidersSyncToBackend,
  syncLlmProviders,
} from '@/lib/llm-providers/storage'
import { fetchMcpTools } from '@/lib/mcp/client'
import { onServerMessage } from '@/lib/messaging/server/serverMessages'
import { onOpenSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { authRedirectPathStorage } from '@/lib/onboarding/onboardingStorage'
import { syncOnboardingProfile } from '@/lib/onboarding/syncOnboardingProfile'
import {
  setupScheduledJobsSyncToBackend,
  syncScheduledJobs,
} from '@/lib/schedules/scheduleStorage'
import { searchActionsStorage } from '@/lib/search-actions/searchActionsStorage'
import { stopAgentStorage } from '@/lib/stop-agent/stop-agent-storage'
import { scheduledJobRuns } from './scheduledJobRuns'

export default defineBackground(() => {
  const SIDEPANEL_STICKY_OPEN_KEY = 'sidepanelStickyOpen'
  let sidepanelStickyOpen = false

  const enableSidePanelEverywhere = async () => {
    await chrome.sidePanel.setOptions({ enabled: true })
    await chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => null)
  }

  const openSidePanelForWindowIfSticky = async (windowId?: number) => {
    if (!sidepanelStickyOpen || windowId === undefined) return

    await chrome.sidePanel.open({ windowId }).catch(() => null)
  }

  const setStickySidePanelOpen = async (
    open: boolean,
    sourceWindowId?: number,
  ) => {
    sidepanelStickyOpen = open
    await chrome.storage.local.set({ [SIDEPANEL_STICKY_OPEN_KEY]: open })
    if (!open) return

    await enableSidePanelEverywhere().catch(() => null)

    if (sourceWindowId !== undefined) {
      await openSidePanelForWindowIfSticky(sourceWindowId)
    }

    const windows = await chrome.windows.getAll()
    await Promise.all(
      windows.map((window) => openSidePanelForWindowIfSticky(window.id)),
    )
  }

  const restoreStickySidePanel = async () => {
    await enableSidePanelEverywhere().catch(() => null)

    const saved = await chrome.storage.local.get(SIDEPANEL_STICKY_OPEN_KEY)
    sidepanelStickyOpen = Boolean(saved[SIDEPANEL_STICKY_OPEN_KEY])
    if (!sidepanelStickyOpen) return

    const windows = await chrome.windows.getAll()
    await Promise.all(
      windows.map((window) => openSidePanelForWindowIfSticky(window.id)),
    )
  }

  restoreStickySidePanel().catch(() => null)

  Capabilities.initialize().catch(() => null)
  setupLlmProvidersBackupToBrowserOS()
  setupLlmProvidersSyncToBackend()
  setupScheduledJobsSyncToBackend()

  scheduledJobRuns()

  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      const { opened } = await toggleSidePanel(tab.id)
      await setStickySidePanelOpen(opened, tab.windowId)
    }
  })

  chrome.tabs.onActivated.addListener(async ({ windowId }) => {
    await openSidePanelForWindowIfSticky(windowId)
  })

  chrome.tabs.onCreated.addListener(async (tab) => {
    if (!tab.active) return
    await openSidePanelForWindowIfSticky(tab.windowId)
  })

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return
    await openSidePanelForWindowIfSticky(windowId)
  })

  onOpenSidePanelWithSearch('open', async (messageData) => {
    const currentTabsList = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    const currentTabInfo = currentTabsList?.[0]
    const currentTab = currentTabInfo?.id
    if (currentTab) {
      const { opened } = await openSidePanel(currentTab)
      await setStickySidePanelOpen(opened, currentTabInfo?.windowId)

      if (opened) {
        setTimeout(() => {
          searchActionsStorage.setValue(messageData.data)
        }, 500)
      }
    }
  })

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('app.html#/onboarding'),
      })
    }

    if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
      checkAndShowChangelog().catch(() => null)
    }
  })

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'AUTH_SUCCESS' && sender.tab?.id) {
      const tabId = sender.tab.id
      authRedirectPathStorage
        .getValue()
        .then((redirectPath) => {
          const hash = redirectPath || '/home'
          chrome.tabs.update(tabId, {
            url: chrome.runtime.getURL(`app.html#${hash}`),
          })
          if (redirectPath) authRedirectPathStorage.removeValue()
        })
        .catch(() => {
          chrome.tabs.update(tabId, {
            url: chrome.runtime.getURL('app.html#/home'),
          })
        })
    }

    if (message?.type === 'stop-agent' && message?.conversationId) {
      stopAgentStorage.setValue({
        conversationId: message.conversationId,
        timestamp: Date.now(),
      })
    }
  })

  sessionStorage.watch(async (newSession) => {
    if (newSession?.user?.id) {
      try {
        await syncLlmProviders()
      } catch {}
      try {
        await syncScheduledJobs()
      } catch {}
      try {
        await syncOnboardingProfile(newSession.user.id)
      } catch {}
    }
  })

  onServerMessage('checkHealth', async () => {
    try {
      const url = await getHealthCheckUrl()
      const response = await fetch(url)
      return { healthy: response.ok }
    } catch {
      return { healthy: false }
    }
  })

  onServerMessage('fetchMcpTools', async () => {
    try {
      const url = await getMcpServerUrl()
      const tools = await fetchMcpTools(url)
      return { tools }
    } catch (err) {
      return {
        tools: [],
        error: err instanceof Error ? err.message : 'Failed to fetch tools',
      }
    }
  })
})
