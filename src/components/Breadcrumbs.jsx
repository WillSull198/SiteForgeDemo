export default function Breadcrumbs({ items = [], onNavigate }) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="breadcrumbs">
      {items.map((item, index) => (
        <span className="crumb-wrap" key={`${item.label}-${index}`}>
          <button className={`crumb ${item.active ? "active" : ""}`.trim()} type="button" onClick={() => item.route && onNavigate?.(item.route)}>
            {item.label}
          </button>
          {index < items.length - 1 ? <span className="crumb-sep">›</span> : null}
        </span>
      ))}
    </div>
  );
}
