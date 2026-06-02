import type { CSSProperties, ReactNode, TableHTMLAttributes } from 'react'

/**
 * `<DataTable>` — opinionated wrapper around `<table>` that consumes the
 * design-system tokens used by the admin panels (LegalHoldPanel,
 * EKMPanel, TicketingSettingsPanel) and emits a single `<table>` with
 * a stable class name. The matching CSS targets nested `thead/th/tr/td`
 * inside `.ds-table` so adopters don't repeat per-row inline padding /
 * border styling.
 *
 * Usage:
 *
 *   <DataTable>
 *     <thead>
 *       <tr>
 *         <th>Name</th>
 *         <th>Status</th>
 *       </tr>
 *     </thead>
 *     <tbody>
 *       {rows.map(r => (
 *         <tr key={r.id}>
 *           <td>{r.name}</td>
 *           <td>{r.status}</td>
 *         </tr>
 *       ))}
 *     </tbody>
 *   </DataTable>
 *
 * Wrapped in a `<div class="ds-table-scroll">` that handles horizontal
 * overflow on narrow viewports without callers having to add their
 * own `overflow-x: auto` wrapper.
 */
export interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Add `<table style={{ width: '100%' }}>` (default true). */
  fullWidth?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function DataTable({
  fullWidth = true,
  className = '',
  style,
  children,
  ...rest
}: DataTableProps) {
  const tableClass = ['ds-table', fullWidth ? 'ds-table--full' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="ds-table-scroll">
      <table className={tableClass} style={style} {...rest}>
        {children}
      </table>
    </div>
  )
}
