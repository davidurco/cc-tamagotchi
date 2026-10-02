// What the tests share: Claude Code's answers to the calls the mod makes, and the props of the
// sites it draws.

export const T0 = Date.UTC(2026, 9, 2, 10, 0, 0)

export const PANE = (columns = 100, placement: 'dock' | 'inline' = 'inline', rows = 30) =>
  ({
    plugin: 'cc-tamagotchi',
    component: 'Pane',
    requestId: 'tama',
    viewport: { columns, rows, isFullscreen: placement === 'dock' },
    props: { title: 'Mochi', isFocused: true, bodyColumns: columns - 4, placement, scroll: { offset: 0, bodyRows: rows - 6 }, view: {} },
  }) as const

export const BAND = (isWorking = false, columns = 120) =>
  ({
    plugin: 'cc-tamagotchi',
    component: 'AbovePrompt',
    viewport: { columns, rows: 40, isFullscreen: false },
    props: { hasSurvey: false, isWorking, maxRows: 12, bodyColumns: columns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as const

export const SURFACES = ['terminal', 'desktop'] as const
export const ALL_SURFACES = ['terminal', 'desktop', 'mobile', 'vscode'] as const
