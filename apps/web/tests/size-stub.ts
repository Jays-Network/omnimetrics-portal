// jsdom has no layout. Panels measure their own layout box (clientWidth/clientHeight) through
// `[data-panel-content]`; this stub gives that box a size so renderers get real numbers.
/** `viewport` = the width of the scrolling column holding the artboard (the scale-to-fit input). */
export function stubPanelSize(get: () => { width: number; height: number }, viewport = 960) {
  const w = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
  const h = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.hasAttribute('data-artboard-viewport') ? viewport : this.hasAttribute('data-panel-content') ? get().width : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.hasAttribute('data-panel-content') ? get().height : 0 } })
  return () => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
    if (w) Object.defineProperty(Element.prototype, 'clientWidth', w)
    if (h) Object.defineProperty(Element.prototype, 'clientHeight', h)
  }
}
