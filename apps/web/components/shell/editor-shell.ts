// The editor is a fixed-viewport app: the page never scrolls, the columns do. The chain from the shell
// down to a column must be definite top to bottom, so every link is listed here and asserted in tests.

export const isEditorPath = (pathname: string): boolean => /\/d\/[^/]+\/edit\/?$/.test(pathname) || pathname === '/dev/editor'

export const shellClasses = (editor: boolean) => ({
  outer: editor ? 'h-dvh overflow-hidden' : 'min-h-screen',
  inner: editor ? 'h-dvh' : 'min-h-screen',
  /** main is a flex child of a column flex container: flex-1 + min-h-0 gives it a definite height. */
  main: editor ? 'min-h-0 overflow-hidden' : '',
})

/** What every scrolling column must carry (see tests/editor-layout.test.tsx for the manual checklist). */
export const SCROLL_COLUMN = 'min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scroll-token'
