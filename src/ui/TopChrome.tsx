import { ProjectChip } from './ProjectChip'
import { ModeSwitcher } from './ModeSwitcher'
import { Toolbar } from './Toolbar'
import { GUTTER, toolbarSlot } from './viewportInsets'

/**
 * The global top row: identity and navigation on the left, tools on the right.
 * Both zones are anchored to a window edge, so nothing here moves when a panel
 * opens and the two groups can only ever meet in the middle — which the
 * `top-row` browser spec measures at every supported size.
 */
export function TopChrome() {
  const slot = toolbarSlot()

  return (
    <>
      <div
        data-top-row-left
        className="absolute z-50 flex items-center gap-3"
        style={{ top: GUTTER, left: GUTTER }}
      >
        <div data-project-chip-slot>
          <ProjectChip />
        </div>
        <div data-mode-switcher-slot>
          <ModeSwitcher />
        </div>
      </div>
      <div
        data-toolbar-slot
        className="absolute z-40"
        style={{ top: GUTTER, right: slot.right }}
      >
        <Toolbar />
      </div>
    </>
  )
}
