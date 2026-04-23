import { useEffect, useMemo, useState } from "react";
import { useSiteForge } from "../services/siteforgeStore";
import { exportCsv } from "../services/pdfService";
import { Button, Badge } from "./ui";
import { Icons, renderIcon } from "./icons";

const PAGE_SIZES = [25, 50, 100];

const compareValues = (left, right, direction = "asc") => {
  const a = left ?? "";
  const b = right ?? "";
  const multiplier = direction === "desc" ? -1 : 1;

  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * multiplier;
  }

  const aDate = Date.parse(a);
  const bDate = Date.parse(b);
  if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) {
    return (aDate - bDate) * multiplier;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) * multiplier;
};

function detectFilterKind(column) {
  if (column.filterType) return column.filterType;
  if (column.type === "number") return "range";
  if (column.type === "date") return "date";
  if (column.options?.length) return "enum";
  return "text";
}

export default function DataTable({
  storageKey,
  columns,
  rows,
  title = "",
  loading = false,
  emptyTitle = "Nothing to show yet.",
  emptyBody = "Try changing filters or creating a new record.",
  rowId = (row) => row.id,
  onRowClick,
  rowActions = [],
  bulkActions = [],
  defaultSort = [],
}) {
  const { state, actions } = useSiteForge();
  const savedState = state.tableViews?.state?.[storageKey] || {};
  const [search, setSearch] = useState(savedState.search || "");
  const [sorts, setSorts] = useState(savedState.sorts || defaultSort);
  const [filters, setFilters] = useState(savedState.filters || {});
  const [visibleColumns, setVisibleColumns] = useState(savedState.visibleColumns || columns.map((column) => column.key));
  const [pageSize, setPageSize] = useState(savedState.pageSize || PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [viewName, setViewName] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  const savedViews = state.tableViews?.saved?.[storageKey] || [];

  useEffect(() => {
    actions.saveTableViewState?.(storageKey, {
      search,
      sorts,
      filters,
      visibleColumns,
      pageSize,
    });
  }, [actions, filters, pageSize, search, sorts, storageKey, visibleColumns]);

  useEffect(() => {
    setPage(1);
  }, [search, sorts, filters, pageSize]);

  const visibleDefs = useMemo(
    () => columns.filter((column) => visibleColumns.includes(column.key)),
    [columns, visibleColumns],
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !needle ||
        visibleDefs.some((column) => {
          const value = column.accessor ? column.accessor(row) : row[column.key];
          return String(value ?? "").toLowerCase().includes(needle);
        });
      if (!matchesSearch) return false;

      return columns.every((column) => {
        const filterValue = filters[column.key];
        if (!filterValue || filterValue === "all" || (typeof filterValue === "object" && Object.values(filterValue).every((item) => !item))) {
          return true;
        }
        const value = column.accessor ? column.accessor(row) : row[column.key];
        const filterKind = detectFilterKind(column);
        if (filterKind === "text") {
          return String(value ?? "").toLowerCase().includes(String(filterValue).toLowerCase());
        }
        if (filterKind === "enum") {
          return Array.isArray(filterValue)
            ? filterValue.length === 0 || filterValue.includes(String(value))
            : String(value) === String(filterValue);
        }
        if (filterKind === "range") {
          const numeric = Number(value ?? 0);
          const min = filterValue.min === "" || filterValue.min === undefined ? -Infinity : Number(filterValue.min);
          const max = filterValue.max === "" || filterValue.max === undefined ? Infinity : Number(filterValue.max);
          return numeric >= min && numeric <= max;
        }
        if (filterKind === "date") {
          return String(value || "").startsWith(String(filterValue));
        }
        return true;
      });
    });
  }, [columns, filters, rows, search, visibleDefs]);

  const sortedRows = useMemo(() => {
    if (!sorts.length) return filteredRows;
    return [...filteredRows].sort((left, right) => {
      for (const sort of sorts) {
        const column = columns.find((item) => item.key === sort.key);
        const leftValue = column?.accessor ? column.accessor(left) : left[sort.key];
        const rightValue = column?.accessor ? column.accessor(right) : right[sort.key];
        const result = compareValues(leftValue, rightValue, sort.direction);
        if (result !== 0) return result;
      }
      return 0;
    });
  }, [columns, filteredRows, sorts]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [page, pageSize, sortedRows]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  const activeFilterChips = useMemo(
    () =>
      Object.entries(filters)
        .filter(([, value]) => {
          if (!value) return false;
          if (typeof value === "string") return value !== "" && value !== "all";
          if (Array.isArray(value)) return value.length > 0;
          return Object.values(value).some(Boolean);
        })
        .map(([key, value]) => ({
          key,
          label: `${columns.find((column) => column.key === key)?.label || key}: ${
            typeof value === "object" && !Array.isArray(value) ? Object.entries(value).filter(([, item]) => item).map(([, item]) => item).join(" - ") : Array.isArray(value) ? value.join(", ") : value
          }`,
        })),
    [columns, filters],
  );

  const allVisibleSelected = pagedRows.length > 0 && pagedRows.every((row) => selectedIds.includes(rowId(row)));

  const handleSort = (columnKey, append) => {
    setSorts((current) => {
      const existing = current.find((item) => item.key === columnKey);
      if (!append) {
        if (!existing) return [{ key: columnKey, direction: "asc" }];
        if (existing.direction === "asc") return [{ key: columnKey, direction: "desc" }];
        return [];
      }
      if (!existing) return [...current, { key: columnKey, direction: "asc" }];
      return current.map((item) => (item.key === columnKey ? { ...item, direction: item.direction === "asc" ? "desc" : "asc" } : item));
    });
  };

  const toggleSelection = (id) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const applySavedView = (view) => {
    setSearch(view.search || "");
    setSorts(view.sorts || []);
    setFilters(view.filters || {});
    setVisibleColumns(view.visibleColumns || columns.map((column) => column.key));
    setPageSize(view.pageSize || PAGE_SIZES[0]);
    setViewMenuOpen(false);
  };

  return (
    <div className="data-table-shell">
      <div className="data-table-toolbar">
        <div className="data-table-title-wrap">
          {title ? <div className="b sm">{title}</div> : null}
          <div className="xs ct3">{sortedRows.length} row{sortedRows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="data-table-actions">
          <div className="sb">
            {renderIcon(Icons.search, 13)}
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search visible columns..." />
          </div>
          <div className="dt-menu-wrap">
            <Button small onClick={() => setColumnMenuOpen((current) => !current)} icon={Icons.grid}>
              Columns
            </Button>
            {columnMenuOpen ? (
              <div className="dt-menu">
                {columns.map((column) => (
                  <label className="dt-menu-check" key={column.key}>
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(column.key)}
                      onChange={(event) =>
                        setVisibleColumns((current) =>
                          event.target.checked ? [...new Set([...current, column.key])] : current.filter((item) => item !== column.key),
                        )
                      }
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <div className="dt-menu-wrap">
            <Button small onClick={() => setViewMenuOpen((current) => !current)} icon={Icons.book}>
              Views
            </Button>
            {viewMenuOpen ? (
              <div className="dt-menu">
                <div className="ff" style={{ marginBottom: 8 }}>
                  <label>Save current view</label>
                  <div className="fx" style={{ gap: 6 }}>
                    <input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="My filtered view" />
                    <Button
                      small
                      tone="bt-p"
                      onClick={() => {
                        if (!viewName.trim()) return;
                        actions.createNamedTableView?.(storageKey, viewName, {
                          search,
                          sorts,
                          filters,
                          visibleColumns,
                          pageSize,
                        });
                        setViewName("");
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                {savedViews.length ? (
                  savedViews.map((view) => (
                    <div className="linked-row" key={view.id}>
                      <button className="text-button" type="button" onClick={() => applySavedView(view)}>
                        <div className="b sm">{view.name}</div>
                        <div className="xs ct3">{view.updatedAt}</div>
                      </button>
                      <Button small tone="bt-r" onClick={() => actions.deleteNamedTableView?.(storageKey, view.id)}>
                        Delete
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="ct3 xs">No saved views yet.</div>
                )}
              </div>
            ) : null}
          </div>
          <Button
            small
            icon={Icons.download}
            onClick={() =>
              exportCsv(
                `${storageKey}.csv`,
                visibleDefs.map((column) => column.label),
                sortedRows.map((row) => visibleDefs.map((column) => (column.accessor ? column.accessor(row) : row[column.key]))),
              )
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      {activeFilterChips.length ? (
        <div className="filter-chip-row">
          {activeFilterChips.map((chip) => (
            <button className="filter-chip" key={chip.key} onClick={() => setFilters((current) => ({ ...current, [chip.key]: undefined }))} type="button">
              {chip.label} ×
            </button>
          ))}
          <button className="filter-chip clear" onClick={() => setFilters({})} type="button">
            Clear all
          </button>
        </div>
      ) : null}

      <div className="data-table-filters">
        {columns.map((column) => {
          const filterKind = detectFilterKind(column);
          const filterValue = filters[column.key];
          if (!column.filterable) return null;
          if (filterKind === "text") {
            return (
              <div className="dt-filter" key={column.key}>
                <label>{column.label}</label>
                <input value={filterValue || ""} onChange={(event) => setFilters((current) => ({ ...current, [column.key]: event.target.value }))} />
              </div>
            );
          }
          if (filterKind === "date") {
            return (
              <div className="dt-filter" key={column.key}>
                <label>{column.label}</label>
                <input type="date" value={filterValue || ""} onChange={(event) => setFilters((current) => ({ ...current, [column.key]: event.target.value }))} />
              </div>
            );
          }
          if (filterKind === "range") {
            return (
              <div className="dt-filter" key={column.key}>
                <label>{column.label}</label>
                <div className="dt-range">
                  <input
                    type="number"
                    placeholder="Min"
                    value={filterValue?.min || ""}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        [column.key]: { ...(current[column.key] || {}), min: event.target.value },
                      }))
                    }
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={filterValue?.max || ""}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        [column.key]: { ...(current[column.key] || {}), max: event.target.value },
                      }))
                    }
                  />
                </div>
              </div>
            );
          }
          return (
            <div className="dt-filter" key={column.key}>
              <label>{column.label}</label>
              <select value={filterValue || "all"} onChange={(event) => setFilters((current) => ({ ...current, [column.key]: event.target.value }))}>
                <option value="all">All</option>
                {(column.options || []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      {selectedIds.length ? (
        <div className="bulk-bar">
          <div className="b sm">{selectedIds.length} selected</div>
          <div className="fx" style={{ gap: 6, flexWrap: "wrap" }}>
            {bulkActions.map((action) => (
              <Button key={action.label} small tone={action.tone} onClick={() => action.onClick(selectedIds)}>
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setSelectedIds((current) => [...new Set([...current, ...pagedRows.map((row) => rowId(row))])]);
                    } else {
                      setSelectedIds((current) => current.filter((id) => !pagedRows.some((row) => rowId(row) === id)));
                    }
                  }}
                />
              </th>
              {visibleDefs.map((column) => {
                const activeSort = sorts.find((item) => item.key === column.key);
                return (
                  <th key={column.key}>
                    <button className="th-button" type="button" onClick={(event) => handleSort(column.key, event.shiftKey)}>
                      <span>{column.label}</span>
                      {activeSort ? <span className="xs ct3">{activeSort.direction === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  </th>
                );
              })}
              {rowActions.length ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={`sk-${index}`}>
                  <td colSpan={visibleDefs.length + 2}>
                    <div className="skeleton-row" />
                  </td>
                </tr>
              ))
            ) : pagedRows.length ? (
              pagedRows.map((row) => {
                const id = rowId(row);
                return (
                  <tr key={id} onClick={() => onRowClick?.(row)}>
                    <td onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.includes(id)} onChange={() => toggleSelection(id)} />
                    </td>
                    {visibleDefs.map((column) => {
                      const value = column.accessor ? column.accessor(row) : row[column.key];
                      return (
                        <td key={`${id}-${column.key}`}>
                          {column.render ? column.render(value, row) : value}
                        </td>
                      );
                    })}
                    {rowActions.length ? (
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="fx" style={{ gap: 4, flexWrap: "wrap" }}>
                          {rowActions.map((action) => {
                            const visible = action.when ? action.when(row) : true;
                            if (!visible) return null;
                            return (
                              <Button key={`${id}-${action.label}`} small tone={action.tone} onClick={() => action.onClick(row)}>
                                {action.label}
                              </Button>
                            );
                          })}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={visibleDefs.length + 2}>
                  <div className="table-empty">
                    <div className="table-empty-icon">{renderIcon(Icons.search, 18)}</div>
                    <div className="b sm">{emptyTitle}</div>
                    <div className="xs ct3">{emptyBody}</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table-footer">
        <div className="xs ct3">
          Showing {sortedRows.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, sortedRows.length)} of {sortedRows.length}
        </div>
        <div className="fx" style={{ gap: 6, flexWrap: "wrap" }}>
          <select className="role-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <Button small onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
            Prev
          </Button>
          <Badge tone="medium">
            {page}/{totalPages}
          </Badge>
          <Button small onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
