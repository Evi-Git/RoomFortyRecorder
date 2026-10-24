import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

/** [RoomFortyRecorder] Logs page: click a column header to sort by it. */

export type SortState = { key: string; desc: boolean };

export const useSort = (initial: string, desc = true) => {
  const [state, setState] = React.useState<SortState>({ key: initial, desc });
  // Numbers start biggest first, names A to Z; a second click flips it.
  const toggle = (key: string, numeric = true) =>
    setState((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: numeric },
    );
  return [state, toggle] as const;
};

export const sortRows = <T,>(
  rows: T[],
  state: SortState,
  columns: Record<string, (row: T) => number | string>,
): T[] => {
  const get = columns[state.key];
  if (!get) return rows;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const c =
      typeof x === 'string' || typeof y === 'string'
        ? String(x).localeCompare(String(y))
        : x - y;
    return state.desc ? -c : c;
  });
};

/** A header cell that sorts its column. */
export const SortTh = ({
  label,
  column,
  state,
  onSort,
  className = '',
  numeric = true,
}: {
  label: React.ReactNode;
  column: string;
  state: SortState;
  onSort: (key: string, numeric?: boolean) => void;
  className?: string;
  numeric?: boolean;
}) => {
  const active = state.key === column;
  return (
    <th
      className={className}
      aria-sort={active ? (state.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column, numeric)}
        className={`inline-flex items-center gap-x-0.5 hover:text-foreground-lighter ${
          active ? 'text-foreground-lighter' : ''
        }`}
        title="Sort by this column"
      >
        {label}
        {active &&
          (state.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );
};
