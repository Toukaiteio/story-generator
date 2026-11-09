export interface DropdownItem {
  label?: string
  icon?: any
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  /** Section label; renders a separator plus a small heading. */
  heading?: string
  checked?: boolean
  /** Child items open a second-level panel beside the menu. */
  children?: DropdownItem[]
  action?: () => void
}
