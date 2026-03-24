import { useCallback, useEffect, useState } from 'react'
import {
  JTBD_POPUP_CLICKED_EVENT,
  JTBD_POPUP_DISMISSED_EVENT,
  JTBD_POPUP_SHOWN_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { JTBD_POPUP_CONSTANTS, JTBD_POPUP_ENABLED } from './constants'
import { type JtbdPopupState, jtbdPopupStorage } from './storage'

// Round 2 directions for random assignment (churn excluded — manual links only)
const R2_DIRECTIONS = [
  'competitor',
  'switching',
  'workflow',
  'activation',
] as const

function pickRandomDirection(): string {
  return R2_DIRECTIONS[Math.floor(Math.random() * R2_DIRECTIONS.length)]
}

const isEligible = (state: JtbdPopupState): boolean => {
  if (!JTBD_POPUP_ENABLED) return false
  if (state.dontShowAgain) return false
  if (state.surveyTaken) return false
  if (state.messageCount < JTBD_POPUP_CONSTANTS.MESSAGE_THRESHOLD) return false
  if (state.messageCount % JTBD_POPUP_CONSTANTS.MESSAGE_THRESHOLD !== 0)
    return false
  if (state.samplingId % JTBD_POPUP_CONSTANTS.SAMPLING_DIVISOR !== 0)
    return false
  return true
}

export function useJtbdPopup() {
  const [popupVisible, setPopupVisible] = useState(false)
  const [showDontShowAgain, setShowDontShowAgain] = useState(false)

  useEffect(() => {
    if (!JTBD_POPUP_ENABLED) return
    jtbdPopupStorage.getValue().then(async (val) => {
      if (val.samplingId === -1) {
        const newVal = { ...val, samplingId: Math.floor(Math.random() * 100) }
        await jtbdPopupStorage.setValue(newVal)
      }
    })
  }, [])

  const recordMessageSent = useCallback(async () => {
    if (!JTBD_POPUP_ENABLED) return
    const current = await jtbdPopupStorage.getValue()
    const newState = { ...current, messageCount: current.messageCount + 1 }
    await jtbdPopupStorage.setValue(newState)
  }, [])

  const triggerIfEligible = useCallback(async () => {
    if (!JTBD_POPUP_ENABLED) return
    const current = await jtbdPopupStorage.getValue()
    if (isEligible(current)) {
      const newShownCount = current.shownCount + 1
      await jtbdPopupStorage.setValue({ ...current, shownCount: newShownCount })
      track(JTBD_POPUP_SHOWN_EVENT, {
        messageCount: current.messageCount,
        shownCount: newShownCount,
      })
      setShowDontShowAgain(
        newShownCount >= JTBD_POPUP_CONSTANTS.DONT_SHOW_AGAIN_AFTER,
      )
      setPopupVisible(true)
    }
  }, [])

  const onTakeSurvey = useCallback(
    async ({
      maxTurns = 20,
      experimentId,
      dontShowAgain = false,
    }: {
      maxTurns?: number
      experimentId?: string
      dontShowAgain?: boolean
    } = {}) => {
      if (!JTBD_POPUP_ENABLED) return
      // Direction is encoded in experimentId (e.g., "r2_competitor")
      const expId = experimentId ?? `r2_${pickRandomDirection()}`
      const current = await jtbdPopupStorage.getValue()
      // Persist dontShowAgain without firing a dismiss event
      if (dontShowAgain) {
        await jtbdPopupStorage.setValue({ ...current, dontShowAgain: true })
      }
      track(JTBD_POPUP_CLICKED_EVENT, {
        messageCount: current.messageCount,
        experimentId: expId,
        dontShowAgain,
      })
      setPopupVisible(false)
      window.open(
        `/app.html?page=survey&maxTurns=${maxTurns}&experimentId=${expId}#/settings/survey`,
        '_blank',
      )
    },
    [],
  )

  const onDismiss = useCallback(async () => {
    if (!JTBD_POPUP_ENABLED) return
    const current = await jtbdPopupStorage.getValue()
    track(JTBD_POPUP_DISMISSED_EVENT, {
      messageCount: current.messageCount,
      dontShowAgain,
    })
    if (dontShowAgain) {
      await jtbdPopupStorage.setValue({ ...current, dontShowAgain: true })
    }
    setPopupVisible(false)
  }, [])

  return {
    popupVisible,
    showDontShowAgain,
    recordMessageSent,
    triggerIfEligible,
    onTakeSurvey,
    onDismiss,
  }
}
