import { AppState, RendererVideo } from 'main/types';
import { grouped } from '../../format';

import {
  Cell,
  flexRender,
  Header,
  Row,
  stockFeatures,
} from '@tanstack/react-table';
import React, { Fragment, RefObject, useCallback, useEffect } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { povDiskFirstNameSort } from '../../rendererutils';
import { Button } from '../Button/Button';
import { getLocalePhrase } from 'localisation/translations';
import { ScrollArea } from '../ScrollArea/ScrollArea';
import { Phrase } from 'localisation/phrases';
import useVideoSelectionTable from './useVideoSelectionTable';
import SelectAllShortcut from '../Shortcuts/SelectAllShortcut';
import SelectMultiShortcut from '../Shortcuts/SelectMultiShortcut';
import SelectRangeShortcut from '../Shortcuts/SelectRangeShortcut';
import NavigateShortcut from '../Shortcuts/NavigateShortcut';
import { TabContext } from '../../tabs/tabs';
import { FOCUS_RING_INSET, isActivation } from '../../a11y';

/** Columns whose text sits on the right edge, in tabular figures. */
const RIGHT_ALIGNED = new Set(['Pull', 'Duration']);
/** Columns in the muted text colour. */
const MUTED = new Set(['Difficulty', 'Date', 'Type']);

interface IProps {
  table: ReturnType<typeof useVideoSelectionTable>;
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
  dialogOpen: boolean;
}

/**
 * Table component for displaying available videos. Includes category appropriate
 * columns for a quick overview, the ability to sort by column.
 */
const VideoSelectionTable = (props: IProps) => {
  const { appState, setAppState, persistentProgressRef, table, dialogOpen } =
    props;

  const {
    videoFilterTags,
    dateRangeFilter,
    storageFilter,
    preferredViewpoint,
    language,
  } = appState;

  const { active: tabActive } = React.useContext(TabContext);

  const { pageIndex, pageSize } = table.state.pagination;

  // The columns' own minimums add up to the table's: narrower than that and
  // the table scrolls sideways rather than squeezing the columns.
  const tableMinWidth = table
    .getHeaderGroups()[0]
    .headers.reduce((sum, h) => sum + (h.column.columnDef.minSize ?? 0), 0);
  const selectedRowRef = React.useRef<HTMLTableRowElement>(null);
  const hasScrolledToSelection = React.useRef(false);

  /**
   * Mark the row as selected and update the video player to play the first
   * viewpoint.
   */
  const onRowClick = useCallback(
    (
      event:
        | React.MouseEvent<HTMLElement>
        | React.KeyboardEvent<HTMLElement>
        | KeyboardEvent,
      row: Row<typeof stockFeatures, RendererVideo>,
    ) => {
      const allRows = table.getSortedRowModel().rows;
      const selectedRows = table.getSelectedRowModel().rows;
      const isSelected = selectedRows.some((r) => r.id === row.id);
      const targetIndex = allRows.findIndex((r) => r.id === row.id);

      if (event.shiftKey) {
        const baseIndex = selectedRows[0]
          ? allRows.findIndex((r) => r.id === selectedRows[0].id)
          : 0;

        const start = Math.min(baseIndex, targetIndex);
        const end = Math.max(baseIndex, targetIndex) + 1;

        allRows.slice(start, end).forEach((r) => {
          if (!r.getIsSelected()) {
            r.toggleSelected(true);
          }
        });

        return;
      }

      const isClickedRowOnlySelected =
        selectedRows.length === 1 && row.getIsSelected();

      if (event.ctrlKey && !isClickedRowOnlySelected) {
        // Add a single row to the Selection.
        row.getToggleSelectedHandler()(event);
        return;
      }

      const video = row.original;
      const povs = [video, ...video.multiPov].sort(povDiskFirstNameSort);

      let toSelect: RendererVideo | undefined;

      if (preferredViewpoint) {
        toSelect = povs.find((pov) => pov.player?._name === preferredViewpoint);
      }

      if (!toSelect) {
        toSelect = povs[0];
      }

      if (!row.getIsSelected()) {
        persistentProgressRef.current = 0;
      }

      // It's a regular click, so unselect any other selected rows.
      selectedRows.forEach((r) => {
        if (r.id !== row.id) {
          r.getToggleSelectedHandler()(event);
        }
      });

      // Make sure the clicked row is selected after we're done.
      if (!isSelected) {
        row.getToggleSelectedHandler()(event);
      }

      setAppState((prevState) => ({
        ...prevState,
        selectedVideos: toSelect ? [toSelect] : [],
        multiPlayerMode: false,
        playing: false,
      }));
    },
    [persistentProgressRef, setAppState, table, preferredViewpoint],
  );

  /**
   * Allow control and shift to select multi or ranges of
   * selections, respectively. Also allow arrow key up and down
   * for navigation and selection.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      if (event.key === 'a' && event.ctrlKey) {
        const sortedRows = table.getSortedRowModel().rows;

        sortedRows.forEach((row) => {
          if (!row.getIsSelected()) {
            row.getToggleSelectedHandler()(event);
          }
        });

        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const sortedRows = table.getSortedRowModel().rows;
        const selectedRows = table.getSelectedRowModel().rows;

        if (selectedRows.length === 0) return;

        const currentRow =
          event.key === 'ArrowDown'
            ? selectedRows[selectedRows.length - 1]
            : selectedRows[0];

        const currentIndex = sortedRows.findIndex(
          (r) => r.id === currentRow.id,
        );
        const nextIndex =
          event.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;
        const nextRow = sortedRows[nextIndex];

        if (nextRow) {
          onRowClick(event, nextRow);
        }

        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.shiftKey || event.ctrlKey) event.preventDefault();
    };

    // [RoomFortyRecorder] Only the showing tab's table takes arrow keys.
    if (!dialogOpen && tabActive) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('mousedown', handleMouseDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [
    table,
    onRowClick,
    videoFilterTags,
    dateRangeFilter,
    storageFilter,
    dialogOpen,
    tabActive,
  ]);

  // If we've navigated here programatically (i.e. via the clip source button),
  // then we may already have a selected video that is not the first row. Just
  // call this whenever we mount. It's harmless if the first row is selected.
  useEffect(() => {
    if (hasScrolledToSelection.current) {
      return undefined;
    }

    const selectedIndex = table.getSelectedRowModel().rows[0]?.index ?? 0;
    const selectedPageIndex = Math.floor(selectedIndex / pageSize);

    if (selectedPageIndex !== pageIndex) {
      table.setPageIndex(selectedPageIndex);
      return undefined;
    }

    hasScrolledToSelection.current = true;
    const animationFrame = window.requestAnimationFrame(() => {
      if (!selectedRowRef.current) {
        return;
      }

      selectedRowRef.current.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [pageIndex, pageSize, table]);

  /**
   * Render an individual header.
   */
  const renderIndividualHeader = (
    header: Header<typeof stockFeatures, RendererVideo, unknown>,
  ) => {
    let tooltip;

    if (header.column.getCanSort()) {
      if (header.column.getNextSortingOrder() === 'asc') {
        tooltip = getLocalePhrase(language, Phrase.ClickToSortAsc);
      } else if (header.column.getNextSortingOrder() === 'desc') {
        tooltip = getLocalePhrase(language, Phrase.ClickToSortDec);
      } else {
        tooltip = getLocalePhrase(language, Phrase.ClickToClearSort);
      }
    }

    if (header.id === 'Select') {
      tooltip = getLocalePhrase(language, Phrase.ClickToSelectAll);
    }

    const width =
      header.column.getSize() === Number.MAX_SAFE_INTEGER
        ? 'auto'
        : header.column.getSize();

    const sorted = header.column.getIsSorted();
    const canSort = header.column.getCanSort();
    // A real button when the column sorts, so Tab and Enter/Space reach it.
    const Head = canSort ? 'button' : 'div';
    const SortArrow = sorted === 'asc' ? ArrowUp : ArrowDown;

    return (
      <th
        key={header.id}
        colSpan={header.colSpan}
        className="sticky top-0 z-10 overflow-hidden bg-panel p-0 text-left font-medium shadow-[inset_0_-1px_0_0_theme(colors.panel.line)]"
        style={{ width }}
        aria-sort={
          sorted === 'asc'
            ? 'ascending'
            : sorted === 'desc'
              ? 'descending'
              : undefined
        }
      >
        <Head
          type={canSort ? 'button' : undefined}
          className={`flex h-9 w-full min-w-0 cursor-pointer select-none items-center gap-x-1 px-3 text-left text-[13px] font-medium hover:text-foreground-lighter ${FOCUS_RING_INSET} ${
            RIGHT_ALIGNED.has(header.id) ? 'justify-end' : ''
          } ${sorted ? 'text-foreground-lighter' : 'text-foreground'}`}
          onClick={header.column.getToggleSortingHandler()}
          title={tooltip}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
          {sorted ? <SortArrow size={13} className="shrink-0" /> : null}
        </Head>
      </th>
    );
  };

  /**
   * Render the header of the selection table.
   */
  const renderTableHeader = () => {
    const groups = table.getHeaderGroups();
    const { headers } = groups[0];

    return (
      <thead>
        <tr>{headers.map(renderIndividualHeader)}</tr>
      </thead>
    );
  };

  /**
   * Render a cell in the base row.
   */
  const renderBaseCell = (
    cell: Cell<typeof stockFeatures, RendererVideo, unknown>,
    index: number,
    selected: boolean,
  ) => {
    const width =
      cell.column.getSize() === Number.MAX_SAFE_INTEGER
        ? 'auto'
        : cell.column.getSize();

    const id = cell.column.id;
    let className = 'overflow-hidden px-3';

    if (RIGHT_ALIGNED.has(id)) className += ' text-right tabular-nums';
    if (MUTED.has(id)) className += ' text-foreground';
    if (id === 'Date') className += ' whitespace-nowrap';
    // A brass edge on the selected row, so it shows even where the fill is
    // close to the rows around it.
    if (selected && index === 0) {
      className += ' shadow-[inset_2px_0_0_0_hsl(var(--brand))]';
    }

    return (
      <td className={className} key={cell.id} style={{ width }}>
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
      </td>
    );
  };

  /**
   * Render the base row.
   */
  const renderBaseRow = (
    row: Row<typeof stockFeatures, RendererVideo>,
    selected: boolean,
  ) => {
    const cells = row.getVisibleCells();
    const className = `h-11 cursor-pointer border-b border-panel-line text-sm text-foreground-lighter ${FOCUS_RING_INSET} ${
      selected ? 'bg-panel-raised' : 'hover:bg-panel-raised/60'
    }`;

    return (
      <tr
        key={row.id}
        ref={selected ? selectedRowRef : undefined}
        className={className}
        aria-selected={selected}
        onClick={(event) => onRowClick(event, row)}
        // Roving tab stop: the selected row is the one Tab lands on; the
        // arrow keys (handled above) move the selection from there.
        tabIndex={selected ? 0 : -1}
        onKeyDown={(event) => {
          if (isActivation(event)) onRowClick(event, row);
        }}
      >
        {cells.map((cell, i) => renderBaseCell(cell, i, selected))}
      </tr>
    );
  };

  /**
   * Render an individual row of the table.
   */
  const renderRow = (row: Row<typeof stockFeatures, RendererVideo>) => {
    const selected =
      row.getIsSelected() ||
      (!table.getIsSomeRowsSelected() && row.index === 0);

    return <Fragment key={row.id}>{renderBaseRow(row, selected)}</Fragment>;
  };

  const renderTableBody = () => {
    const { rows } = table.getRowModel();
    return <tbody>{rows.map((row) => renderRow(row))}</tbody>;
  };

  /**
   * For performance reasons we render videos in pages of 100. The component
   * returns buttons to navigate the pages in the list.
   */
  const renderPagnationButtons = () => {
    const current = table.state.pagination.pageIndex + 1;
    const total = grouped(table.getPageCount());
    const indicator = `${current} of ${total}`;

    return (
      <div className="grid w-full grid-cols-3 items-center px-3 py-2">
        <div className="flex gap-2">
          <SelectRangeShortcut language={language} />
          <SelectMultiShortcut language={language} />
        </div>

        <div className="flex justify-center items-center gap-2">
          <Button
            className="h-7 w-7 p-1 text-foreground hover:bg-panel-raised hover:text-foreground-lighter"
            onClick={() => table.firstPage()}
            aria-label="First page"
            disabled={!table.getCanPreviousPage()}
            size="xs"
            variant="ghost"
          >
            <ChevronsLeft size={16} />
          </Button>

          <Button
            className="h-7 w-7 p-1 text-foreground hover:bg-panel-raised hover:text-foreground-lighter"
            onClick={() => table.previousPage()}
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            size="xs"
            variant="ghost"
          >
            <ChevronLeft size={16} />
          </Button>

          <span className="flex items-center gap-1 text-foreground text-sm">
            {indicator}
          </span>

          <Button
            className="h-7 w-7 p-1 text-foreground hover:bg-panel-raised hover:text-foreground-lighter"
            onClick={() => table.nextPage()}
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            size="xs"
            variant="ghost"
          >
            <ChevronRight size={16} />
          </Button>

          <Button
            className="h-7 w-7 p-1 text-foreground hover:bg-panel-raised hover:text-foreground-lighter"
            onClick={() => table.lastPage()}
            aria-label="Last page"
            disabled={!table.getCanNextPage()}
            size="xs"
            variant="ghost"
          >
            <ChevronsRight size={16} />
          </Button>
        </div>

        <div className="justify-end flex gap-2 items-center text-foreground-lighter text-sm">
          <NavigateShortcut language={language} />
          <SelectAllShortcut language={language} />
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full min-h-0 overflow-hidden rounded-lg border border-panel-line bg-panel">
      <ScrollArea
        withScrollIndicators={false}
        horizontal
        className="h-full w-full"
      >
        <div>
          <table
            className="table-fixed w-full"
            style={{ minWidth: tableMinWidth }}
          >
            {renderTableHeader()}
            {renderTableBody()}
          </table>
          {renderPagnationButtons()}
        </div>
      </ScrollArea>
    </div>
  );
};

export default VideoSelectionTable;
