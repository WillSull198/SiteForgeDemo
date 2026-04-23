export default function RoleSelector({ value, onChange, roles, currentUser }) {
  return (
    <div className="role-selector">
      <div className="xs ct3">Viewing As</div>
      <div className="fx" style={{ gap: 8, marginTop: 4 }}>
        <select className="role-select" value={value} onChange={(event) => onChange(event.target.value)}>
          {roles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <div>
          <div className="b sm">{currentUser?.name}</div>
          <div className="xs ct3">{currentUser?.company}</div>
        </div>
      </div>
    </div>
  );
}
