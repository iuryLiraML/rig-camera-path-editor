import type { ReactNode } from 'react'
import { CursorIcon } from './icons'
import type { usePlanEditorStore } from '../lib/planEditor'

type Tool = ReturnType<typeof usePlanEditorStore.getState>['tool']

function Icon({ children }: { children: ReactNode }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

const tools: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: <CursorIcon size={16} aria-hidden="true" /> },
  { id: 'wall', label: 'Wall', key: 'W', icon: <Icon><path d="M3 13V3h10v4H7v6z" /></Icon> },
  { id: 'room', label: 'Room', key: 'R', icon: <Icon><rect x="3" y="3" width="10" height="10" /><path d="M6 3v3H3m7 7v-3h3" /></Icon> },
  { id: 'door', label: 'Door', key: 'D', icon: <Icon><path d="M2 13h3V3m0 0a10 10 0 0 1 10 10H5" strokeDasharray="2 2" /><path d="M5 13V3M1 13h4m8 0h2" /></Icon> },
  { id: 'window', label: 'Window', key: 'N', icon: <Icon><path d="M2 4v8m12-8v8M2 6h12M2 10h12M8 6v4" /></Icon> },
]

export function PlanToolbar({ tool, setTool, snap, toggleSnap, fit, undo, redo, canUndo, canRedo }: {
  tool: Tool; setTool: (tool: Tool) => void; snap: boolean; toggleSnap: () => void
  fit: () => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean
}) {
  const button = (label: string, shortcut: string, icon: ReactNode, onClick: () => void, pressed?: boolean, disabled = false) => (
    <button key={label} type="button" aria-label={label} title={`${label} (${shortcut})`} aria-pressed={pressed} disabled={disabled} onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30 ${pressed ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'}`}>
      {icon}
    </button>
  )
  const divider = <div role="separator" className="my-1 w-6 shrink-0 border-t border-line" />
  return <div role="toolbar" aria-label="Floor plan tools" aria-orientation="vertical"
    className="flex w-[52px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-panel py-2"
    onKeyDown={(event) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }}>
    {tools.map((item) => button(item.label, item.key, item.icon, () => setTool(item.id), tool === item.id))}
    {divider}
    {button('Snap', 'G', <Icon><path d="M3 3v6a5 5 0 0 0 10 0V3h-3v6a2 2 0 0 1-4 0V3zM3 6h3m4 0h3" /></Icon>, toggleSnap, snap)}
    {button('Fit', '0', <Icon><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" /><rect x="5" y="5" width="6" height="6" /></Icon>, fit)}
    {divider}
    {button('Undo', 'Ctrl/Cmd Z', <Icon><path d="M6 3 2 7l4 4M2 7h7a4 4 0 0 1 4 4v2" /></Icon>, undo, undefined, !canUndo)}
    {button('Redo', 'Ctrl/Cmd Shift Z', <Icon><path d="m10 3 4 4-4 4m4-4H7a4 4 0 0 0-4 4v2" /></Icon>, redo, undefined, !canRedo)}
  </div>
}
