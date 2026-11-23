'use client'

import dynamic from 'next/dynamic'

// The builder (canvas, dnd-kit sortable, blocks, terminal) loads only on the edit route and
// only in the browser: viewers never download it. Edit capability itself is enforced on the server
// (the page guard and the versions API), not by this lazy boundary.
const Builder = dynamic(() => import('./builder').then((m) => m.Builder), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-sm text-brand-text-muted">Loading the builder…</p>,
})

export { Builder as LazyBuilder }
