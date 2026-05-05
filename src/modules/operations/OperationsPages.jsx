import React, { useState } from "react";
import { Icons, renderIcon } from "../../components/icons";
import {
  Badge,
  Button,
  Card,
  DetailHeader,
  IconButton,
  LinkedRecordsPanel,
  MetricGrid,
  Modal,
  PanelList,
  Tabs,
} from "../../components/ui";
import { getLinkedRecord } from "../../services/fieldCommercialEngine";

const resolveLinked = (store, record) => getLinkedRecord({ ...store.data, plans: store.plans }, record.type, record.id);

export function PortfolioView({ store }) {
  const { data, actions } = store;
  const totalBudget = data.sites.reduce((sum, site) => sum + site.budget, 0);
  const totalSpent = data.sites.reduce((sum, site) => sum + site.spent, 0);
  const totalCrew = data.sites.reduce((sum, site) => sum + site.crew, 0);
  const openIssues = data.problems.filter((problem) => problem.st === "open").length;

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Active Sites", value: data.sites.filter((site) => site.status === "active").length, color: "g" },
          { label: "Portfolio Budget", value: `$${(totalBudget / 1e6).toFixed(1)}M`, color: "a", subtle: `$${(totalSpent / 1e6).toFixed(1)}M spent` },
          { label: "Workforce", value: totalCrew, color: "b" },
          { label: "Open Issues", value: openIssues, color: "r" },
        ]}
      />

      <div className="g2">
        {data.sites.map((site) => {
          const siteRisk = store.derived.fieldCommercial.siteMetrics.find((entry) => entry.siteId === site.id);
          return (
            <div className="pc" key={site.id} onClick={() => actions.pickSite(site.id)}>
              <div className="fb mb4">
                <div>
                  <div className="md bb">{site.name}</div>
                  <div className="xs ct3">
                    {site.client} · {site.addr}
                  </div>
                </div>
                <div className="fx" style={{ gap: 3 }}>
                  <Badge tone={site.status}>{site.status}</Badge>
                  <Badge tone={site.risk === "high" ? "high" : site.risk === "medium" ? "medium" : "low"}>{site.risk}</Badge>
                </div>
              </div>
              <div className="pb mb4">
                <div className="pf" style={{ width: `${site.progress}%`, background: site.progress > 50 ? "var(--gn)" : "var(--am)" }} />
              </div>
              <div className="fb xs ct3">
                <span>{site.progress}% complete</span>
                <span>{site.type}</span>
              </div>
              <div className="metrics-compact">
                <div>
                  <div className="xs ct3">Budget</div>
                  <div className="mono b cam">${(site.budget / 1e3).toFixed(0)}k</div>
                </div>
                <div>
                  <div className="xs ct3">Exposure</div>
                  <div className="mono b" style={{ color: siteRisk?.costExposure ? "var(--rd)" : "var(--gn)" }}>
                    ${((siteRisk?.costExposure || 0) / 1e3).toFixed(1)}k
                  </div>
                </div>
                <div>
                  <div className="xs ct3">Time</div>
                  <div className="mono b cbl">{siteRisk?.timeExposure || 0}d</div>
                </div>
                <div>
                  <div className="xs ct3">Safety</div>
                  <div className="mono b" style={{ color: site.safety >= 90 ? "var(--gn)" : "var(--or)" }}>{site.safety}%</div>
                </div>
              </div>
              <div className="fb xs ct3" style={{ marginTop: 8 }}>
                <span>Super: {site.super}</span>
                <span className="fx">
                  {renderIcon(Icons.sun, 10)} {site.weather}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="g2" style={{ marginTop: 10 }}>
        <Card title="Director Margin At Risk" icon={Icons.trending}>
          <div className="mono bb" style={{ fontSize: 28, color: "var(--rd)" }}>
            ${store.derived.fieldCommercial.directorRisk.marginAtRisk.toLocaleString()}
          </div>
          <div className="xs ct3" style={{ marginTop: 4 }}>
            Total cost exposure ${store.derived.fieldCommercial.directorRisk.totalCostExposure.toLocaleString()} across the portfolio.
          </div>
        </Card>
        <Card title="Stalled Recovery Watchlist" icon={Icons.alert}>
          <PanelList
            items={store.data.approvals
              .filter((approval) => approval.status === "stalled" || approval.status === "awaiting-client")
              .slice(0, 4)
              .map((approval) => ({
                id: approval.id,
                dot: approval.status === "stalled" ? "var(--rd)" : "var(--am)",
                title: approval.title,
                meta: `${approval.type} · ${approval.clientId} · ${approval.timeImpact}d / $${approval.costImpact.toLocaleString()}`,
              }))}
          />
        </Card>
      </div>
    </div>
  );
}

export function DashPage({ store }) {
  const { data, derived } = store;
  const siteId = derived.site.id;
  const siteApprovals = data.approvals.filter((approval) => approval.siteId === siteId);
  const sitePresence = data.presence.attendance.filter((entry) => entry.siteId === siteId);
  const siteRisk = derived.fieldCommercial.siteMetrics.find((entry) => entry.siteId === siteId);
  const activeTasks = data.tasks.filter((task) => task.siteId === siteId && task.st !== "done").length;
  const openIssues = data.problems.filter((problem) => problem.siteId === siteId && problem.st === "open").length;
  const siteRfIs = data.rfis.filter((rfi) => rfi.siteId === siteId && rfi.st !== "closed").length;
  const onSite = data.checkins.filter((entry) => entry.siteId === siteId && entry.st === "on-site").length;

  return (
    <div className="oy fin">
      <MetricGrid
        columns={6}
        items={[
          { label: "Active Tasks", value: activeTasks, color: "a" },
          { label: "Open Issues", value: openIssues, color: "r" },
          { label: "Open RFIs", value: siteRfIs, color: "b" },
          { label: "Recovery Exposure", value: `$${((siteRisk?.costExposure || 0) / 1e3).toFixed(1)}k`, color: "o" },
          { label: "On Site", value: onSite, color: "g" },
          { label: "Time Exposure", value: `${siteRisk?.timeExposure || 0}d`, color: "p" },
        ]}
      />

      <div className="g23">
        <div>
          <Card title="Field-To-Commercial Feed" icon={Icons.clock} className="mb8">
            <PanelList
              items={[
                {
                  id: "fd-1",
                  dot: "var(--rd)",
                  title: "Issue -> Variation -> Approval",
                  meta: "Water ingress at west footing · awaiting client",
                  body: "Issue 1 created VO-001 and ClientFlow approval ap1 with 2 day recovery path.",
                },
                {
                  id: "fd-2",
                  dot: "var(--am)",
                  title: "Procurement delay -> EOT draft",
                  meta: "Steel lintels in-transit · stalled",
                  body: "Material 6 is linked to task 1 and EOT approval ap3 with 3 day programme impact.",
                },
                {
                  id: "fd-3",
                  dot: "var(--cy)",
                  title: "Weather diary -> Rain day claim",
                  meta: "Diary 2026-04-16 · question open",
                  body: "Weather event generated rain day approval ap2 and remains in client question state.",
                },
                {
                  id: "fd-4",
                  dot: "var(--or)",
                  title: "QA failure -> Rework risk",
                  meta: "Balcony waterproofing flood test failed",
                  body: "Hold point failure is feeding $4.5k waterproofing recovery exposure and retest sequencing.",
                },
              ]}
            />
          </Card>

          <div className="g2">
            <Card title="Linked Recovery Watchlist" icon={Icons.link}>
              <PanelList
                items={data.problems
                  .filter((problem) => problem.siteId === siteId && problem.st === "open")
                  .map((problem) => ({
                    id: problem.id,
                    dot: problem.pr === "critical" ? "var(--rd)" : "var(--or)",
                    title: problem.title,
                    meta: `${problem.days || 0}d · $${problem.cost.toLocaleString()} · ${problem.linkedRecords.length} linked`,
                    right: <Badge tone={problem.pr}>{problem.pr}</Badge>,
                  }))}
              />
            </Card>

            <Card title="Presence Exceptions" icon={Icons.eye}>
              <PanelList
                items={sitePresence
                  .filter((entry) => entry.anomalies.length > 0)
                  .map((entry) => ({
                    id: entry.id,
                    dot: entry.confidence < 60 ? "var(--rd)" : "var(--am)",
                    title: entry.person,
                    meta: `${entry.status} · ${entry.confidence}% confidence`,
                    body: entry.anomalies.join(" · "),
                  }))}
                empty="No anomalies on this site."
              />
            </Card>
          </div>
        </div>

        <div>
          <Card title="ClientFlow Queue" icon={Icons.briefcase} className="mb8">
            <PanelList
              items={siteApprovals.slice(0, 4).map((approval) => ({
                id: approval.id,
                dot: approval.status === "stalled" ? "var(--rd)" : approval.status === "approved" ? "var(--gn)" : "var(--am)",
                title: approval.title,
                meta: `${approval.type} · ${approval.status}`,
                body: `$${approval.costImpact.toLocaleString()} · ${approval.timeImpact}d`,
                right: <Badge tone={approval.status}>{approval.status}</Badge>,
              }))}
            />
          </Card>

          <Card title="Site Access and Safety" icon={Icons.qr} className="mb8">
            <div className="info-grid">
              <div className="info-row">
                <span className="ct3 xs">Blocked scans today</span>
                <span className="mono b crd">
                  {data.passport.scanEvents.filter((event) => event.siteId === siteId && event.result === "blocked").length}
                </span>
              </div>
              <div className="info-row">
                <span className="ct3 xs">Conditional scans</span>
                <span className="mono b cam">
                  {data.passport.scanEvents.filter((event) => event.siteId === siteId && event.result === "conditional").length}
                </span>
              </div>
              <div className="info-row">
                <span className="ct3 xs">Open safety alerts</span>
                <span className="mono b cbl">{data.safety.filter((entry) => entry.siteId === siteId && entry.type !== "toolbox").length}</span>
              </div>
            </div>
          </Card>

          <Card title="Director View" icon={Icons.trending}>
            <div className="fb">
              <div>
                <div className="xs ct3">Margin At Risk</div>
                <div className="mono bb crd" style={{ fontSize: 18 }}>
                  ${siteRisk?.marginAtRisk.toLocaleString()}
                </div>
              </div>
              <div className="tr">
                <div className="xs ct3">Affected Trades</div>
                <div className="xs ct2">{siteRisk?.affectedTrades.join(", ") || "None"}</div>
              </div>
            </div>
            <div className="pb" style={{ marginTop: 8 }}>
              <div className="pf" style={{ width: `${Math.min(100, (siteRisk?.costExposure || 0) / 150)}%`, background: "linear-gradient(90deg,var(--or),var(--rd))" }} />
            </div>
            <div className="xs ct3 tr" style={{ marginTop: 4 }}>
              {siteRisk?.risk || "low"} risk profile
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function TasksPage({ store }) {
  const { data, config, actions, derived } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ title: "", who: "", pr: "medium", due: "", trade: "", notes: "" });
  const tasks = data.tasks.filter((task) => task.siteId === derived.site.id);
  const filtered = filter === "all" ? tasks : tasks.filter((task) => task.st === filter);

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: `All (${tasks.length})` },
            { value: "todo", label: `Todo (${tasks.filter((task) => task.st === "todo").length})` },
            { value: "in-progress", label: `In Progress (${tasks.filter((task) => task.st === "in-progress").length})` },
            { value: "done", label: `Done (${tasks.filter((task) => task.st === "done").length})` },
          ]}
        />
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          Add
        </Button>
      </div>

      <Card>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Assigned</th>
              <th>Trade</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Progress</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((task) => (
              <tr key={task.id}>
                <td>
                  <div className="b">{task.title}</div>
                  {task.notes ? <div className="xs ct3">{task.notes}</div> : null}
                </td>
                <td className="sm">{task.who}</td>
                <td className="xs ct3">{task.trade}</td>
                <td>
                  <Badge tone={task.pr}>{task.pr}</Badge>
                </td>
                <td className="mono xs">{task.due}</td>
                <td style={{ minWidth: 80 }}>
                  <div className="pb">
                    <div
                      className="pf"
                      style={{
                        width: `${task.pct}%`,
                        background: task.pct === 100 ? "var(--gn)" : task.pct > 40 ? "var(--am)" : "var(--bl)",
                      }}
                    />
                  </div>
                </td>
                <td>
                  <Badge tone={task.st}>{task.st}</Badge>
                </td>
                <td>
                  <div className="fx" style={{ gap: 3 }}>
                    <Button small onClick={() => actions.cycleTask(task.id)}>
                      {task.st === "done" ? "Reset" : task.st === "todo" ? "Start" : "Done"}
                    </Button>
                    <Button
                      small
                      tone="bt-p"
                      onClick={() =>
                        actions.createApproval({
                          siteId: derived.site.id,
                          clientId: derived.site.clientId,
                          type: "Site Instruction",
                          title: `Task impact acknowledgement — ${task.title}`,
                          sourceType: "task",
                          sourceId: task.id,
                          sourceLabel: task.title,
                          timeImpact: task.st === "done" ? 0 : 1,
                          costImpact: 0,
                          createdBy: "Dave Mitchell",
                        })
                      }
                    >
                      Create From
                    </Button>
                    <Button small tone="bt-r" onClick={() => actions.deleteTask(task.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={addOpen} close={() => setAddOpen(false)} title="Add Task">
        <div className="ff">
          <label>Task</label>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Assign To</label>
            <select value={form.who} onChange={(event) => setForm({ ...form, who: event.target.value })}>
              <option value="">Select</option>
              {data.team.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Trade</label>
            <select value={form.trade} onChange={(event) => setForm({ ...form, trade: event.target.value })}>
              <option value="">Select</option>
              {config.trades.map((trade) => (
                <option key={trade}>{trade}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Priority</label>
            <select value={form.pr} onChange={(event) => setForm({ ...form, pr: event.target.value })}>
              {config.priorities.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.value}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Due</label>
            <input type="date" value={form.due} onChange={(event) => setForm({ ...form, due: event.target.value })} />
          </div>
        </div>
        <div className="ff">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.title.trim()) return;
              await actions.addTask({ ...form, siteId: derived.site.id });
              setForm({ title: "", who: "", pr: "medium", due: "", trade: "", notes: "" });
              setAddOpen(false);
            }}
          >
            Add Task
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function ProblemsPage({ store }) {
  const { data, actions, derived } = store;
  const [selectedId, setSelectedId] = useState(data.problems.find((problem) => problem.siteId === derived.site.id)?.id || null);
  const [reply, setReply] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", who: "", pr: "medium", cost: "", days: "", desc: "" });
  const problems = data.problems.filter((problem) => problem.siteId === derived.site.id);
  const selected = problems.find((problem) => problem.id === selectedId) || problems[0] || null;

  const createRfiFromIssue = async () => {
    if (!selected) return;
    await actions.addRfi({
      title: `${selected.title} — clarification / entitlement`,
      from: selected.who,
      to: "Project Consultant",
      pr: selected.pr === "critical" ? "high" : selected.pr,
      trade: "General",
      desc: `Raised from issue ${selected.title}. Clarify required resolution path and entitlement impacts.`,
      due: nowPlusDays(3),
      cost: selected.cost,
      days: selected.days,
      siteId: selected.siteId,
      linkedRecords: [{ type: "issue", id: selected.id, label: selected.title, siteId: selected.siteId }],
    });
  };

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div />
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          Report
        </Button>
      </div>
      <div className="g32">
        <Card>
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Impact</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {problems.map((problem) => (
                <tr
                  key={problem.id}
                  onClick={() => setSelectedId(problem.id)}
                  style={{ cursor: "pointer", background: selected?.id === problem.id ? "var(--s2)" : "" }}
                >
                  <td>
                    <div className="b">{problem.title}</div>
                    <div className="xs ct3">
                      {problem.who} · <Badge tone={problem.pr}>{problem.pr}</Badge>
                    </div>
                  </td>
                  <td className="xs">
                    {problem.cost > 0 ? <span className="crd">${problem.cost.toLocaleString()} </span> : null}
                    {problem.days > 0 ? <span className="cam">{problem.days}d</span> : <span className="ct3">0d</span>}
                  </td>
                  <td>
                    <Badge tone={problem.st}>{problem.st}</Badge>
                  </td>
                  <td>
                    {problem.st === "open" ? (
                      <Button small tone="bt-g" onClick={(event) => { event.stopPropagation(); actions.resolveProblem(problem.id); }}>
                        Resolve
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div>
          {selected ? (
            <Card>
              <DetailHeader
                title={selected.title}
                subtitle={`${selected.who} · ${selected.siteId}`}
                badges={[
                  { tone: selected.pr, label: selected.pr },
                  { tone: selected.st, label: selected.st },
                  ...(selected.cost > 0 ? [{ tone: "high", label: `$${selected.cost.toLocaleString()}` }] : []),
                  ...(selected.days > 0 ? [{ tone: "medium", label: `${selected.days}d` }] : []),
                ]}
                actions={[
                  { label: "Create RFI", tone: "", small: true, onClick: createRfiFromIssue },
                  {
                    label: "ClientFlow",
                    tone: "bt-p",
                    small: true,
                    onClick: () =>
                      actions.createApproval({
                        siteId: selected.siteId,
                        clientId: derived.site.clientId,
                        type: "Variation",
                        title: `${selected.title} recovery approval`,
                        sourceType: "issue",
                        sourceId: selected.id,
                        sourceLabel: selected.title,
                        costImpact: selected.cost,
                        timeImpact: selected.days,
                      }),
                  },
                ]}
              />
              <div className="mt">
                {selected.msgs.map((message, index) => (
                  <div className={`mm ${message.f === "Dave Mitchell" ? "me" : "them"}`} key={`${message.f}-${index}`}>
                    <div className="mf">{message.f}</div>
                    <div>{message.t}</div>
                    <div className="mt2">{message.tm}</div>
                  </div>
                ))}
              </div>
              <div className="mi">
                <input
                  value={reply}
                  placeholder="Reply with next action..."
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && reply.trim()) {
                      actions.replyProblem(selected.id, reply);
                      setReply("");
                    }
                  }}
                />
                <Button
                  small
                  tone="bt-p"
                  icon={Icons.send}
                  onClick={() => {
                    if (!reply.trim()) return;
                    actions.replyProblem(selected.id, reply);
                    setReply("");
                  }}
                />
                <IconButton icon={Icons.phone} />
              </div>
            </Card>
          ) : (
            <Card title="Issue Detail">
              <div className="ct3 sm empty">Select an issue.</div>
            </Card>
          )}

          <div className="mb8" />
          <LinkedRecordsPanel
            records={selected?.linkedRecords || []}
            resolveRecord={(record) => resolveLinked(store, record)}
          />
        </div>
      </div>

      <Modal open={addOpen} close={() => setAddOpen(false)} title="Report Problem">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Reporter</label>
            <select value={form.who} onChange={(event) => setForm({ ...form, who: event.target.value })}>
              <option value="">Select</option>
              {data.team.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Priority</label>
            <select value={form.pr} onChange={(event) => setForm({ ...form, pr: event.target.value })}>
              {store.config.priorities.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Cost Risk ($)</label>
            <input type="number" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} />
          </div>
          <div className="ff">
            <label>Delay Risk (days)</label>
            <input type="number" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
          </div>
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.desc} onChange={(event) => setForm({ ...form, desc: event.target.value })} />
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.title.trim()) return;
              await actions.addProblem({ ...form, siteId: derived.site.id });
              setForm({ title: "", who: "", pr: "medium", cost: "", days: "", desc: "" });
              setAddOpen(false);
            }}
          >
            Report
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function WorkforcePage({ store }) {
  const { data, actions, derived, config } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ w: "", co: "", trade: "" });
  const workforce = data.checkins.filter((entry) => entry.siteId === derived.site.id);
  const onSite = workforce.filter((entry) => entry.st === "on-site");
  const done = workforce.filter((entry) => entry.st === "done");

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "On Site", value: onSite.length, color: "g" },
          { label: "Checked Out", value: done.length, color: "b" },
          { label: "Total Hours", value: done.reduce((sum, entry) => sum + entry.hrs, 0).toFixed(1), color: "a" },
          { label: "Companies", value: new Set(workforce.map((entry) => entry.co)).size, color: "p" },
        ]}
      />
      <div className="fb mb8">
        <h3 className="b sm fx">
          {renderIcon(Icons.login, 13)} Workforce
        </h3>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          Check In
        </Button>
      </div>
      <div className="g2">
        <Card title={`On Site (${onSite.length})`} icon={Icons.login}>
          {onSite.map((entry) => (
            <div className="worker-row" key={entry.id}>
              <div className="worker-avatar">{entry.w.split(" ").map((part) => part[0]).join("")}</div>
              <div style={{ flex: 1 }}>
                <div className="b sm">{entry.w}</div>
                <div className="xs ct3">
                  {entry.co} · {entry.trade}
                </div>
              </div>
              <div className="tr">
                <div className="mono xs cgn">{entry.tin}</div>
                <Button small tone="bt-r" onClick={() => actions.checkOut(entry.id)}>
                  Out
                </Button>
              </div>
            </div>
          ))}
        </Card>

        <Card title={`Completed (${done.length})`} icon={Icons.clock}>
          {done.map((entry) => (
            <div className="worker-row" key={entry.id}>
              <div className="worker-avatar muted">{entry.w.split(" ").map((part) => part[0]).join("")}</div>
              <div style={{ flex: 1 }}>
                <div className="b sm">{entry.w}</div>
                <div className="xs ct3">
                  {entry.co} · {entry.trade}
                </div>
              </div>
              <div className="tr">
                <div className="mono xs ct3">
                  {entry.tin} — {entry.tout}
                </div>
                <div className="mono xs cam">{entry.hrs}h</div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Modal open={addOpen} close={() => setAddOpen(false)} title="Check In">
        <div className="ff">
          <label>Worker</label>
          <select
            value={form.w}
            onChange={(event) => {
              const member = data.team.find((item) => item.name === event.target.value);
              setForm({ w: event.target.value, co: member?.co || "", trade: member?.trade || "" });
            }}
          >
            <option value="">Select</option>
            {data.team.map((member) => (
              <option key={member.id} value={member.name}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Company</label>
            <input value={form.co} onChange={(event) => setForm({ ...form, co: event.target.value })} />
          </div>
          <div className="ff">
            <label>Trade</label>
            <select value={form.trade} onChange={(event) => setForm({ ...form, trade: event.target.value })}>
              <option value="">Select</option>
              {config.trades.map((trade) => (
                <option key={trade}>{trade}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            icon={Icons.login}
            onClick={async () => {
              if (!form.w) return;
              await actions.checkIn({ ...form, siteId: derived.site.id });
              setForm({ w: "", co: "", trade: "" });
              setAddOpen(false);
            }}
          >
            Check In
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function MaterialsPage({ store }) {
  const { data, actions, derived } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ item: "", qty: "", who: "", cost: "", supplier: "", eta: "" });
  const materials = data.materials.filter((entry) => entry.siteId === derived.site.id);

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Total", value: materials.length, color: "a" },
          { label: "Pending", value: materials.filter((entry) => ["pending", "requested"].includes(entry.st)).length, color: "r" },
          { label: "In Transit", value: materials.filter((entry) => entry.st === "in-transit").length, color: "c" },
          { label: "Value", value: `$${(materials.reduce((sum, entry) => sum + entry.cost, 0) / 1e3).toFixed(1)}k`, color: "g" },
        ]}
      />
      <div className="fb mb8">
        <h3 className="b sm fx">
          {renderIcon(Icons.box, 13)} Procurement
        </h3>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          Request
        </Button>
      </div>
      <Card>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Supplier</th>
              <th>PO</th>
              <th>Cost</th>
              <th>ETA</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {materials.map((material) => (
              <tr key={material.id}>
                <td>
                  <div className="b">{material.item}</div>
                  <div className="xs ct3">{material.who}</div>
                </td>
                <td className="mono xs">{material.qty}</td>
                <td className="xs">{material.supplier || "—"}</td>
                <td className="mono xs ct3">{material.po || "—"}</td>
                <td className="mono xs">${material.cost.toLocaleString()}</td>
                <td className="mono xs">{material.eta || "—"}</td>
                <td>
                  <Badge tone={material.st}>{material.st}</Badge>
                </td>
                <td>
                  <div className="fx" style={{ gap: 2, flexWrap: "wrap" }}>
                    {material.st === "pending" ? (
                      <Button small tone="bt-g" onClick={() => actions.updateMaterialStatus(material.id, "approved")}>
                        Approve
                      </Button>
                    ) : null}
                    {material.st === "approved" ? (
                      <Button small onClick={() => actions.updateMaterialStatus(material.id, "ordered")}>
                        Order
                      </Button>
                    ) : null}
                    {material.st === "ordered" ? (
                      <Button small onClick={() => actions.updateMaterialStatus(material.id, "in-transit")}>
                        Ship
                      </Button>
                    ) : null}
                    {material.st === "in-transit" ? (
                      <>
                        <Button small tone="bt-g" onClick={() => actions.updateMaterialStatus(material.id, "delivered")}>
                          Receive
                        </Button>
                        <Button
                          small
                          tone="bt-p"
                          onClick={() =>
                            actions.createApproval({
                              siteId: material.siteId,
                              clientId: derived.site.clientId,
                              type: "Extension of Time",
                              title: `Delay recovery for ${material.item}`,
                              sourceType: "material",
                              sourceId: material.id,
                              sourceLabel: material.item,
                              timeImpact: 3,
                              costImpact: material.cost,
                            })
                          }
                        >
                          EOT
                        </Button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={addOpen} close={() => setAddOpen(false)} title="Request Materials">
        <div className="ff">
          <label>Item</label>
          <input value={form.item} onChange={(event) => setForm({ ...form, item: event.target.value })} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Qty</label>
            <input value={form.qty} onChange={(event) => setForm({ ...form, qty: event.target.value })} />
          </div>
          <div className="ff">
            <label>Cost ($)</label>
            <input type="number" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Supplier</label>
            <input value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} />
          </div>
          <div className="ff">
            <label>ETA</label>
            <input type="date" value={form.eta} onChange={(event) => setForm({ ...form, eta: event.target.value })} />
          </div>
        </div>
        <div className="ff">
          <label>Requested By</label>
          <select value={form.who} onChange={(event) => setForm({ ...form, who: event.target.value })}>
            <option value="">Select</option>
            {data.team.map((member) => (
              <option key={member.id} value={member.name}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.item.trim()) return;
              await actions.addMaterial({ ...form, siteId: derived.site.id });
              setForm({ item: "", qty: "", who: "", cost: "", supplier: "", eta: "" });
              setAddOpen(false);
            }}
          >
            Submit
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function RFIsPage({ store }) {
  const { data, actions, derived, config } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(data.rfis.find((rfi) => rfi.siteId === derived.site.id)?.id || null);
  const [response, setResponse] = useState("");
  const [form, setForm] = useState({
    title: "",
    from: "",
    to: "",
    pr: "medium",
    trade: "",
    desc: "",
    due: "",
    cost: "",
    days: "",
  });
  const rfis = data.rfis.filter((rfi) => rfi.siteId === derived.site.id);
  const selected = rfis.find((rfi) => rfi.id === selectedId) || rfis[0] || null;

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <div className="fx">
          <h3 className="b sm fx">{renderIcon(Icons.help, 13)} RFIs</h3>
          <Badge tone="open" className="ml4">
            {rfis.filter((rfi) => rfi.st === "open").length} open
          </Badge>
        </div>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          New RFI
        </Button>
      </div>
      <div className="g32">
        <Card>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rfis.map((rfi) => (
                <tr key={rfi.id} onClick={() => setSelectedId(rfi.id)} style={{ cursor: "pointer", background: selected?.id === rfi.id ? "var(--s2)" : "" }}>
                  <td className="mono b cam">{rfi.num}</td>
                  <td>
                    <div className="b">{rfi.title}</div>
                    <div className="xs ct3">
                      {rfi.from} → {rfi.to}
                    </div>
                  </td>
                  <td className="mono xs">{rfi.due}</td>
                  <td>
                    <Badge tone={rfi.st}>{rfi.st}</Badge>
                  </td>
                  <td>
                    {rfi.st !== "closed" ? (
                      <Button small tone="bt-g" onClick={(event) => { event.stopPropagation(); actions.closeRfi(rfi.id); }}>
                        Close
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div>
          {selected ? (
            <Card>
              <DetailHeader
                title={`${selected.num}: ${selected.title}`}
                subtitle={`${selected.from} -> ${selected.to}`}
                badges={[
                  { tone: selected.pr, label: selected.pr },
                  { tone: selected.st, label: selected.st },
                  ...(selected.cost > 0 ? [{ tone: "high", label: `$${selected.cost}` }] : []),
                  ...(selected.days > 0 ? [{ tone: "medium", label: `${selected.days}d` }] : []),
                ]}
                actions={[
                  {
                    label: "Variation",
                    small: true,
                    onClick: () =>
                      actions.addVariation({
                        title: `${selected.title} variation allowance`,
                        from: selected.from,
                        val: selected.cost || 0,
                        trade: selected.trade,
                        desc: `Created from ${selected.num}.`,
                        days: selected.days || 0,
                        siteId: selected.siteId,
                        linkedRecords: [{ type: "rfi", id: selected.id, label: selected.title, siteId: selected.siteId }],
                      }),
                  },
                  {
                    label: "ClientFlow",
                    tone: "bt-p",
                    small: true,
                    onClick: () =>
                      actions.createApproval({
                        siteId: selected.siteId,
                        clientId: derived.site.clientId,
                        type: "Scope Clarification",
                        title: `${selected.num} client clarification`,
                        sourceType: "rfi",
                        sourceId: selected.id,
                        sourceLabel: selected.title,
                        costImpact: selected.cost,
                        timeImpact: selected.days,
                      }),
                  },
                ]}
              />
              <div className="sm ct2" style={{ lineHeight: 1.6, marginBottom: 8 }}>
                {selected.desc}
              </div>
              {selected.resp.length ? (
                <div className="timeline-card">
                  <div className="xs ct3 b mb4">RESPONSES</div>
                  {selected.resp.map((entry, index) => (
                    <div className="response-card" key={`${entry.f}-${index}`}>
                      <div className="xs b cam">
                        {entry.f} · {entry.d}
                      </div>
                      <div className="sm ct2" style={{ marginTop: 2 }}>
                        {entry.t}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mi" style={{ padding: "8px 0 0", borderTop: "1px solid var(--bd)", marginTop: 8 }}>
                <input value={response} placeholder="Add response..." onChange={(event) => setResponse(event.target.value)} />
                <Button
                  small
                  tone="bt-p"
                  icon={Icons.send}
                  onClick={() => {
                    if (!response.trim()) return;
                    actions.respondRfi(selected.id, response);
                    setResponse("");
                  }}
                />
              </div>
            </Card>
          ) : (
            <Card title="RFI Detail">
              <div className="ct3 sm empty">Select an RFI.</div>
            </Card>
          )}
          <div className="mb8" />
          <LinkedRecordsPanel records={selected?.linkedRecords || []} resolveRecord={(record) => resolveLinked(store, record)} />
        </div>
      </div>

      <Modal open={addOpen} close={() => setAddOpen(false)} title="New RFI" wide>
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Raised By</label>
            <select value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })}>
              <option value="">Select</option>
              {data.team.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Assigned To</label>
            <input value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} />
          </div>
        </div>
        <div className="g3">
          <div className="ff">
            <label>Priority</label>
            <select value={form.pr} onChange={(event) => setForm({ ...form, pr: event.target.value })}>
              {config.priorities.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.value}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Trade</label>
            <select value={form.trade} onChange={(event) => setForm({ ...form, trade: event.target.value })}>
              <option value="">Select</option>
              {config.trades.map((trade) => (
                <option key={trade}>{trade}</option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Due</label>
            <input type="date" value={form.due} onChange={(event) => setForm({ ...form, due: event.target.value })} />
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Cost Impact ($)</label>
            <input type="number" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} />
          </div>
          <div className="ff">
            <label>Time Impact (d)</label>
            <input type="number" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
          </div>
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.desc} onChange={(event) => setForm({ ...form, desc: event.target.value })} />
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.title.trim()) return;
              await actions.addRfi({ ...form, siteId: derived.site.id });
              setForm({ title: "", from: "", to: "", pr: "medium", trade: "", desc: "", due: "", cost: "", days: "" });
              setAddOpen(false);
            }}
          >
            Submit RFI
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function VariationsPage({ store }) {
  const { data, actions, derived, config } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", from: "", val: "", trade: "", desc: "", days: "" });
  const variations = data.variations.filter((entry) => entry.siteId === derived.site.id);
  const pendingValue = variations.filter((entry) => entry.st === "submitted").reduce((sum, entry) => sum + entry.val, 0);
  const approvedValue = variations.filter((entry) => entry.st === "approved").reduce((sum, entry) => sum + entry.val, 0);

  return (
    <div className="oy fin">
      <MetricGrid
        columns={3}
        items={[
          { label: "Pending", value: `$${(pendingValue / 1e3).toFixed(1)}k`, color: "o" },
          { label: "Approved", value: `$${(approvedValue / 1e3).toFixed(1)}k`, color: "g" },
          { label: "Total VOs", value: variations.length, color: "b" },
        ]}
      />
      <div className="fb mb8">
        <h3 className="b sm fx">{renderIcon(Icons.shuffle, 13)} Variations</h3>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          New VO
        </Button>
      </div>
      <Card>
        <table>
          <thead>
            <tr>
              <th>VO#</th>
              <th>Title</th>
              <th>Trade</th>
              <th>Value</th>
              <th>Time</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variations.map((variation) => (
              <tr key={variation.id}>
                <td className="mono b cam">{variation.num}</td>
                <td>
                  <div className="b">{variation.title}</div>
                  <div className="xs ct3">
                    {variation.from} · {variation.date}
                  </div>
                </td>
                <td className="xs">{variation.trade}</td>
                <td className="mono b">${variation.val.toLocaleString()}</td>
                <td className="mono xs">{variation.days > 0 ? `+${variation.days}d` : "—"}</td>
                <td>
                  <Badge tone={variation.st}>{variation.st}</Badge>
                </td>
                <td>
                  {variation.st === "submitted" ? (
                    <div className="fx" style={{ gap: 2, flexWrap: "wrap" }}>
                      <Button small tone="bt-g" onClick={() => actions.updateVariationStatus(variation.id, "approved")}>
                        Approve
                      </Button>
                      <Button small tone="bt-r" onClick={() => actions.updateVariationStatus(variation.id, "rejected")}>
                        Reject
                      </Button>
                      <Button
                        small
                        tone="bt-p"
                        onClick={() =>
                          actions.createApproval({
                            siteId: variation.siteId,
                            clientId: derived.site.clientId,
                            type: "Variation",
                            title: variation.title,
                            sourceType: "variation",
                            sourceId: variation.id,
                            sourceLabel: variation.title,
                            costImpact: variation.val,
                            timeImpact: variation.days,
                          })
                        }
                      >
                        ClientFlow
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={addOpen} close={() => setAddOpen(false)} title="New Variation">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Raised By</label>
            <select value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })}>
              <option value="">Select</option>
              {data.team.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Trade</label>
            <select value={form.trade} onChange={(event) => setForm({ ...form, trade: event.target.value })}>
              <option value="">Select</option>
              {config.trades.map((trade) => (
                <option key={trade}>{trade}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Value ($)</label>
            <input type="number" value={form.val} onChange={(event) => setForm({ ...form, val: event.target.value })} />
          </div>
          <div className="ff">
            <label>Time (days)</label>
            <input type="number" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
          </div>
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={form.desc} onChange={(event) => setForm({ ...form, desc: event.target.value })} />
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.title.trim()) return;
              await actions.addVariation({ ...form, siteId: derived.site.id });
              setForm({ title: "", from: "", val: "", trade: "", desc: "", days: "" });
              setAddOpen(false);
            }}
          >
            Submit
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function QAPage({ store }) {
  const { data, actions, derived, config } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", type: "Hold Point", trade: "", insp: "", date: "", notes: "" });
  const qa = data.qa.filter((entry) => entry.siteId === derived.site.id);

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Passed", value: qa.filter((entry) => entry.st === "passed").length, color: "g" },
          { label: "Scheduled", value: qa.filter((entry) => entry.st === "scheduled").length, color: "b" },
          { label: "In Progress", value: qa.filter((entry) => entry.st === "in-progress").length, color: "a" },
          { label: "Failed", value: qa.filter((entry) => entry.st === "failed").length, color: "r" },
        ]}
      />
      <div className="fb mb8">
        <h3 className="b sm fx">{renderIcon(Icons.clipboard, 13)} QA / Inspections</h3>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          Add
        </Button>
      </div>
      <Card>
        <table>
          <thead>
            <tr>
              <th>Inspection</th>
              <th>Type</th>
              <th>Trade</th>
              <th>Inspector</th>
              <th>Date</th>
              <th>Items</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {qa.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <div className="b">{entry.title}</div>
                  <div className="xs ct3">{entry.notes}</div>
                </td>
                <td>
                  <Badge tone={entry.type === "Hold Point" ? "high" : "medium"}>{entry.type}</Badge>
                </td>
                <td className="xs">{entry.trade}</td>
                <td className="xs">{entry.insp}</td>
                <td className="mono xs">{entry.date}</td>
                <td className="mono xs">
                  {entry.pass}/{entry.total}
                </td>
                <td>
                  <Badge tone={entry.st}>{entry.st}</Badge>
                </td>
                <td>
                  <div className="fx" style={{ gap: 2, flexWrap: "wrap" }}>
                    {entry.st === "scheduled" ? (
                      <Button small onClick={() => actions.updateQaStatus(entry.id, "in-progress")}>
                        Start
                      </Button>
                    ) : null}
                    {entry.st === "in-progress" ? (
                      <>
                        <Button small tone="bt-g" onClick={() => actions.updateQaStatus(entry.id, "passed")}>
                          Pass
                        </Button>
                        <Button small tone="bt-r" onClick={() => actions.updateQaStatus(entry.id, "failed")}>
                          Fail
                        </Button>
                      </>
                    ) : null}
                    {entry.st === "failed" ? (
                      <Button
                        small
                        tone="bt-p"
                        onClick={() =>
                          actions.createApproval({
                            siteId: entry.siteId,
                            clientId: derived.site.clientId,
                            type: "Site Instruction",
                            title: `QA failure recovery — ${entry.title}`,
                            sourceType: "qa",
                            sourceId: entry.id,
                            sourceLabel: entry.title,
                            costImpact: 1800,
                            timeImpact: 1,
                          })
                        }
                      >
                        Recovery
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={addOpen} close={() => setAddOpen(false)} title="Add Inspection">
        <div className="ff">
          <label>Title</label>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Type</label>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option>Hold Point</option>
              <option>Witness Point</option>
            </select>
          </div>
          <div className="ff">
            <label>Trade</label>
            <select value={form.trade} onChange={(event) => setForm({ ...form, trade: event.target.value })}>
              <option value="">Select</option>
              {config.trades.map((trade) => (
                <option key={trade}>{trade}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="ff">
            <label>Inspector</label>
            <input value={form.insp} onChange={(event) => setForm({ ...form, insp: event.target.value })} />
          </div>
          <div className="ff">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </div>
        </div>
        <div className="ff">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.title.trim()) return;
              await actions.addQa({ ...form, siteId: derived.site.id });
              setForm({ title: "", type: "Hold Point", trade: "", insp: "", date: "", notes: "" });
              setAddOpen(false);
            }}
          >
            Add
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function DocControlPage({ store }) {
  const { plans, data, derived } = store;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [filter, setFilter] = useState("All");
  const categories = ["All", ...new Set(plans.map((plan) => plan.cat))];
  const filteredPlans = plans.filter((plan) => filter === "All" || plan.cat === filter);
  const [selectedId, setSelectedId] = useState(plans[0]?.id || null);
  const selected = plans.find((plan) => plan.id === selectedId) || plans[0];

  return (
    <div className="oy fin">
      <div className="hero-panel mb8">
        <h3 className="cam b sm fx mb4">{renderIcon(Icons.zap, 13)} AI Plan Search</h3>
        <div className="fx" style={{ gap: 5 }}>
          <input
            className="search-input"
            placeholder="Search plans... e.g. lintels, drainage, roof"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            tone="bt-p"
            icon={Icons.search}
            onClick={() => {
              if (!query.trim()) return;
              const term = query.toLowerCase();
              const matches = plans.filter(
                (plan) =>
                  plan.n.toLowerCase().includes(term) ||
                  plan.tags.some((tag) => tag.includes(term)) ||
                  plan.cat.toLowerCase().includes(term),
              );
              setResults(matches);
            }}
          />
        </div>
        {results ? (
          <div className="search-results">
            <div>{results.length ? `Found ${results.length} plan(s)` : `No results for "${query}"`}</div>
            {results.map((plan) => (
              <div className="search-result" key={plan.id}>
                <span className="cam b">{plan.n}</span> — {plan.cat} ({plan.rev}) · {plan.linkedTrades.join(", ")}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <Tabs value={filter} onChange={setFilter} items={categories.map((item) => ({ value: item, label: item }))} />

      <div className="g32">
        <Card>
          <table>
            <thead>
              <tr>
                <th>Drawing</th>
                <th>Discipline</th>
                <th>Rev</th>
                <th>Date</th>
                <th>Revisions</th>
                <th>Pins</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.map((plan) => (
                <tr key={plan.id} onClick={() => setSelectedId(plan.id)} style={{ cursor: "pointer", background: selected?.id === plan.id ? "var(--s2)" : "" }}>
                  <td className="b">{plan.n}</td>
                  <td className="xs">{plan.cat}</td>
                  <td className="mono b cam">{plan.rev}</td>
                  <td className="mono xs">{plan.date}</td>
                  <td className="mono xs ct3">{plan.revs}</td>
                  <td>{plan.pins > 0 ? <Badge tone="medium">{plan.pins}</Badge> : <span className="ct3 xs">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div>
          <Card title={selected?.n || "Drawing detail"} icon={Icons.file}>
            {selected ? (
              <>
                <div className="fx mb4" style={{ gap: 4, flexWrap: "wrap" }}>
                  <Badge tone="medium">{selected.rev}</Badge>
                  <Badge tone="low">{selected.cat}</Badge>
                </div>
                <div className="sm ct2">
                  Tags: {selected.tags.join(", ")}
                </div>
                <div className="sm ct2" style={{ marginTop: 8 }}>
                  Linked trades: {selected.linkedTrades.join(", ")}
                </div>
                <div className="sm ct2" style={{ marginTop: 8 }}>
                  Impacted tasks:{" "}
                  {data.tasks.filter((task) => task.siteId === derived.site.id && task.linkedRecords?.some((record) => record.type === "plan" && record.id === selected.id)).length}
                </div>
                <div className="sm ct2" style={{ marginTop: 8 }}>
                  Impacted RFIs:{" "}
                  {data.rfis.filter((rfi) => rfi.siteId === derived.site.id && rfi.linkedRecords?.some((record) => record.type === "plan" && record.id === selected.id)).length}
                </div>
              </>
            ) : (
              <div className="ct3 sm empty">Select a plan.</div>
            )}
          </Card>
          <div className="mb8" />
          <Card title="Revision Impact" icon={Icons.link}>
            <PanelList
              items={[
                {
                  id: "plan-impact-1",
                  dot: "var(--or)",
                  title: "Drawing revision -> impacted trades",
                  meta: selected ? selected.linkedTrades.join(", ") : "No selection",
                },
                {
                  id: "plan-impact-2",
                  dot: "var(--bl)",
                  title: "Linked tasks",
                  meta: `${data.tasks.filter((task) => task.linkedRecords?.some((record) => record.type === "plan" && record.id === selected?.id)).length} tasks`,
                },
                {
                  id: "plan-impact-3",
                  dot: "var(--pu)",
                  title: "Linked RFIs",
                  meta: `${data.rfis.filter((rfi) => rfi.linkedRecords?.some((record) => record.type === "plan" && record.id === selected?.id)).length} RFIs`,
                },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

export function SchedulePage({ store }) {
  const { schedule, derived } = store;
  const totalDays = 82;
  const today = 39;
  const siteRisk = derived.fieldCommercial.siteMetrics.find((entry) => entry.siteId === derived.site.id);

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <h3 className="b sm fx">{renderIcon(Icons.cal, 13)} Schedule</h3>
        <Badge tone="in-progress">Day {today}/{totalDays}</Badge>
      </div>
      <Card className="mb8">
        <div className="cd-b" style={{ overflowX: "auto" }}>
          {schedule.map((item) => (
            <div className="gantt-r" key={item.id}>
              <div className="gantt-l">{item.t}</div>
              <div className="gantt-t">
                <div
                  className={`gantt-b ${item.done ? "dn" : ""}`}
                  style={{ left: `${(item.s / totalDays) * 100}%`, width: `${(item.d / totalDays) * 100}%`, background: item.c }}
                >
                  {item.p && !item.done ? `${item.p}%` : item.done ? "✓" : ""}
                </div>
                <div className="gantt-td" style={{ left: `${(today / totalDays) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Schedule Risk Feed" icon={Icons.alert}>
        <PanelList
          items={[
            {
              id: "sched-1",
              dot: "var(--rd)",
              title: "Steel lintel procurement delay",
              meta: `Programme risk ${siteRisk?.timeExposure || 0}d`,
              body: "Procurement delay is already linked to EOT approval ap3 and framing task 1.",
            },
            {
              id: "sched-2",
              dot: "var(--cy)",
              title: "Weather entitlement event",
              meta: "1 day rain day claim in review",
              body: "Diary weather event keeps float pressure visible in the client recovery workflow.",
            },
          ]}
        />
      </Card>
    </div>
  );
}

export function BudgetPage({ store }) {
  const { budget, derived } = store;
  const remaining = budget.total - budget.spent - budget.committed;
  const siteRisk = derived.fieldCommercial.siteMetrics.find((entry) => entry.siteId === derived.site.id);

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Total", value: `$${(budget.total / 1e3).toFixed(0)}k`, color: "b" },
          { label: "Spent", value: `$${(budget.spent / 1e3).toFixed(0)}k`, color: "a", subtle: `${Math.round((budget.spent / budget.total) * 100)}%` },
          { label: "Committed", value: `$${(budget.committed / 1e3).toFixed(0)}k`, color: "p" },
          { label: "Remaining", value: `$${(remaining / 1e3).toFixed(0)}k`, color: "g" },
        ]}
      />
      <div className="g2">
        <Card title="Cost Breakdown" icon={Icons.dollar}>
          {budget.items.map((item) => {
            const pct = item.b > 0 ? (item.s / item.b) * 100 : 0;
            const color = pct > 100 ? "var(--rd)" : pct > 60 ? "var(--am)" : pct > 0 ? "var(--gn)" : "var(--s4)";
            const state = pct > 100 ? "over" : pct === 0 ? "pending" : "on-track";
            return (
              <div className="bb-row" key={item.cat}>
                <div className="bb-l">{item.cat}</div>
                <div className="bb-t">
                  <div className="bb-f" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
                </div>
                <div className="bb-v">
                  ${item.s.toLocaleString()} / ${item.b.toLocaleString()}
                </div>
                <Badge tone={state}>{state}</Badge>
              </div>
            );
          })}
        </Card>
        <Card title="Commercial Recovery Overlay" icon={Icons.link}>
          <div className="info-grid">
            <div className="info-row">
              <span className="ct3 xs">Current cost exposure</span>
              <span className="mono b crd">${siteRisk?.costExposure.toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span className="ct3 xs">Margin at risk</span>
              <span className="mono b cam">${siteRisk?.marginAtRisk.toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span className="ct3 xs">Pending approvals</span>
              <span className="mono b cbl">{siteRisk?.stalledApprovals}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function DiaryPage({ store }) {
  const { data, actions, derived } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ date: "", wx: "", crew: "", sum: "", safety: "", delays: "" });
  const diary = data.diary.filter((entry) => entry.siteId === derived.site.id);

  return (
    <div className="oy fin">
      <div className="fb mb8">
        <h3 className="b sm fx">{renderIcon(Icons.book, 13)} Site Diary</h3>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          New
        </Button>
      </div>
      {diary.map((entry) => (
        <Card key={entry.id} className="mb8">
          <div className="fb">
            <div>
              <span className="mono xs cam b">{entry.date}</span>
              <div className="xs ct3 fx" style={{ marginTop: 2 }}>
                {renderIcon(Icons.sun, 10)} {entry.wx} · {entry.crew} crew
              </div>
            </div>
            <div className="fx" style={{ gap: 3 }}>
              {entry.weatherEvent ? <Badge tone="medium">weather</Badge> : null}
              <Button
                small
                tone="bt-p"
                onClick={() =>
                  actions.createApproval({
                    siteId: entry.siteId,
                    clientId: derived.site.clientId,
                    type: entry.weatherEvent ? "Rain Day" : "Delay Notice",
                    title: `${entry.weatherEvent ? "Rain day" : "Diary note"} — ${entry.date}`,
                    sourceType: "diary",
                    sourceId: entry.id,
                    sourceLabel: entry.date,
                    costImpact: 0,
                    timeImpact: entry.weatherEvent ? 1 : 0.5,
                  })
                }
              >
                Create From
              </Button>
            </div>
          </div>
          <div className="sm ct2" style={{ marginTop: 6, lineHeight: 1.6 }}>
            {entry.sum}
          </div>
          {entry.safety ? (
            <div className="callout callout-cy">
              {renderIcon(Icons.shield, 10)} {entry.safety}
            </div>
          ) : null}
          {entry.delays && entry.delays !== "Nil" ? <div className="callout callout-or">Delay: {entry.delays}</div> : null}
        </Card>
      ))}

      <Modal open={addOpen} close={() => setAddOpen(false)} title="New Entry">
        <div className="g2">
          <div className="ff">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </div>
          <div className="ff">
            <label>Weather</label>
            <input value={form.wx} onChange={(event) => setForm({ ...form, wx: event.target.value })} />
          </div>
        </div>
        <div className="ff">
          <label>Crew</label>
          <input type="number" value={form.crew} onChange={(event) => setForm({ ...form, crew: event.target.value })} />
        </div>
        <div className="ff">
          <label>Summary</label>
          <textarea value={form.sum} onChange={(event) => setForm({ ...form, sum: event.target.value })} />
        </div>
        <div className="ff">
          <label>Safety</label>
          <input value={form.safety} onChange={(event) => setForm({ ...form, safety: event.target.value })} />
        </div>
        <div className="ff">
          <label>Delays</label>
          <input value={form.delays} onChange={(event) => setForm({ ...form, delays: event.target.value })} />
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.sum.trim()) return;
              await actions.addDiary({ ...form, siteId: derived.site.id });
              setForm({ date: "", wx: "", crew: "", sum: "", safety: "", delays: "" });
              setAddOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function SafetyPage({ store }) {
  const { data, actions, derived } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ date: "", topic: "", by: "", notes: "", type: "toolbox" });
  const records = data.safety.filter((entry) => entry.siteId === derived.site.id);

  return (
    <div className="oy fin">
      <MetricGrid
        columns={3}
        items={[
          { label: "Days Since Incident", value: 4, color: "g" },
          { label: "Toolbox Talks", value: records.filter((entry) => entry.type === "toolbox").length, color: "c" },
          { label: "Incidents", value: records.filter((entry) => entry.type === "incident").length, color: "o" },
        ]}
      />
      <div className="fb mb8">
        <h3 className="b sm fx">{renderIcon(Icons.shield, 13)} Safety</h3>
        <Button tone="bt-p" icon={Icons.plus} onClick={() => setAddOpen(true)}>
          Log
        </Button>
      </div>
      {records.map((entry) => (
        <Card key={entry.id} className="mb8">
          <div className="fx mb4" style={{ gap: 3 }}>
            <Badge tone={entry.type === "alert" ? "medium" : entry.type}>{entry.type}</Badge>
            <span className="mono xs ct3">{entry.date}</span>
          </div>
          <div className="b md">{entry.topic}</div>
          <div className="xs ct3" style={{ marginTop: 1 }}>
            By {entry.by}
          </div>
          <div className="sm ct2" style={{ marginTop: 5, lineHeight: 1.5 }}>
            {entry.notes}
          </div>
          <div className="fx" style={{ marginTop: 6, gap: 3, flexWrap: "wrap" }}>
            {entry.who.map((person) => (
              <span className="chip" key={person}>
                {person}
              </span>
            ))}
          </div>
          {entry.type !== "toolbox" ? (
            <div className="fx" style={{ marginTop: 8, gap: 5 }}>
              <Button
                small
                tone="bt-p"
                onClick={() =>
                  actions.createApproval({
                    siteId: entry.siteId,
                    clientId: derived.site.clientId,
                    type: "Delay Notice",
                    title: `${entry.topic} acknowledgment`,
                    sourceType: "safety",
                    sourceId: entry.id,
                    sourceLabel: entry.topic,
                    costImpact: 0,
                    timeImpact: 0.5,
                  })
                }
              >
                Client Notice
              </Button>
            </div>
          ) : null}
        </Card>
      ))}

      <Modal open={addOpen} close={() => setAddOpen(false)} title="Log Safety">
        <div className="g2">
          <div className="ff">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </div>
          <div className="ff">
            <label>Type</label>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option value="toolbox">Toolbox Talk</option>
              <option value="incident">Incident</option>
              <option value="alert">Alert</option>
            </select>
          </div>
        </div>
        <div className="ff">
          <label>Topic</label>
          <input value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} />
        </div>
        <div className="ff">
          <label>Presenter</label>
          <select value={form.by} onChange={(event) => setForm({ ...form, by: event.target.value })}>
            <option value="">Select</option>
            {data.team.map((member) => (
              <option key={member.id} value={member.name}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ff">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>
        <div className="fa">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={async () => {
              if (!form.topic.trim()) return;
              await actions.addSafety({ ...form, siteId: derived.site.id });
              setForm({ date: "", topic: "", by: "", notes: "", type: "toolbox" });
              setAddOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function TeamPage({ store }) {
  const online = store.data.team.filter((member) => member.on);
  return (
    <div className="oy fin">
      <h3 className="b sm fx mb8">{renderIcon(Icons.users, 13)} Team — {online.length} Online</h3>
      <div className="team-grid">
        {store.data.team.map((member) => (
          <div key={member.id} className="cd team-card">
            <div className={`team-avatar ${member.on ? "" : "off"}`}>{member.av}</div>
            <div className="b sm">{member.name}</div>
            <div className="xs ct3">
              {member.role} · {member.trade}
            </div>
            <div className="fx" style={{ justifyContent: "center", marginTop: 4 }}>
              <div className={`presence-dot ${member.on ? "on" : ""}`} />
              <span className="xs" style={{ color: member.on ? "var(--gn)" : "var(--t3)" }}>{member.on ? "Online" : "Offline"}</span>
            </div>
            <div className="mono xs ct3" style={{ marginTop: 3 }}>
              {member.phone}
            </div>
            <div className="xs ct3" style={{ marginTop: 1 }}>
              {member.co} · ${member.rate}/hr
            </div>
            <div className="fx" style={{ justifyContent: "center", marginTop: 7, gap: 4 }}>
              <Button small icon={Icons.phone}>Call</Button>
              <Button small icon={Icons.chat}>Msg</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalculatorsPage() {
  const [concrete, setConcrete] = useState({ l: "", w: "", d: "" });
  const [brick, setBrick] = useState({ l: "", h: "" });
  const [timber, setTimber] = useState({ l: "", s: "450", w: "10" });
  const [paint, setPaint] = useState({ a: "", c: "2" });
  const concreteVol = concrete.l && concrete.w && concrete.d ? (concrete.l * concrete.w * (concrete.d / 1000)).toFixed(2) : "—";
  const brickCount = brick.l && brick.h ? Math.ceil(brick.l * brick.h * 50) : "—";
  const timberLm =
    timber.l && timber.s
      ? ((Math.ceil(Number(timber.l) / (Number(timber.s) / 1000)) + 1) * Number(timber.l) * (1 + Number(timber.w) / 100)).toFixed(1)
      : "—";
  const paintLitres = paint.a && paint.c ? ((Number(paint.a) * Number(paint.c)) / 12).toFixed(1) : "—";

  return (
    <div className="oy fin">
      <div className="g2">
        <CalcCard title="Concrete Volume" state={concrete} setState={setConcrete} fields={[["Length (m)", "l"], ["Width (m)", "w"], ["Depth (mm)", "d"]]} result={`${concreteVol} m³`} />
        <CalcCard title="Brick Count" state={brick} setState={setBrick} fields={[["Length (m)", "l"], ["Height (m)", "h"]]} result={`${brickCount}`} />
        <CalcCard title="Timber / Studs" state={timber} setState={setTimber} fields={[["Length (m)", "l"], ["Spacing (mm)", "s"], ["Waste %", "w"]]} result={`${timberLm} LM`} />
        <CalcCard title="Paint Coverage" state={paint} setState={setPaint} fields={[["Area (m²)", "a"], ["Coats", "c", "select"]]} options={{ c: ["1", "2", "3"] }} result={`${paintLitres} L`} />
      </div>
    </div>
  );
}

function CalcCard({ title, state, setState, fields, result, options = {} }) {
  return (
    <Card title={title} icon={Icons.calc}>
      {fields.map(([label, key, type]) => (
        <div className="cf" key={key}>
          <label>{label}</label>
          {type === "select" ? (
            <select value={state[key]} onChange={(event) => setState({ ...state, [key]: event.target.value })}>
              {options[key].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input type="number" value={state[key]} onChange={(event) => setState({ ...state, [key]: event.target.value })} />
          )}
        </div>
      ))}
      <div className="cr">
        <span>Result</span>
        {result}
      </div>
    </Card>
  );
}

export function ReportsPage({ store }) {
  const { data, derived } = store;
  const site = derived.site;
  const siteRisk = derived.fieldCommercial.siteMetrics.find((entry) => entry.siteId === site.id);

  return (
    <div className="oy fin">
      <h3 className="b sm fx mb8">{renderIcon(Icons.bar, 13)} Reports & Analytics</h3>
      <div className="g3 mb8">
        <Card title="Project">
          <div className="g2" style={{ gap: 6 }}>
            <MiniMetric label="Progress" value={`${site.progress}%`} color="var(--gn)" />
            <MiniMetric label="Budget" value={`${Math.round((site.spent / site.budget) * 100)}%`} color="var(--am)" />
            <MiniMetric label="Tasks" value={data.tasks.filter((task) => task.siteId === site.id && task.st !== "done").length} color="var(--bl)" />
            <MiniMetric label="Issues" value={data.problems.filter((problem) => problem.siteId === site.id && problem.st === "open").length} color="var(--rd)" />
          </div>
        </Card>
        <Card title="Commercial Risk">
          <div className="xs ct3">TOTAL EXPOSURE</div>
          <div className="mono bb" style={{ fontSize: 18, color: siteRisk?.costExposure > 5000 ? "var(--rd)" : "var(--am)" }}>
            ${siteRisk?.costExposure.toLocaleString()}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="xs ct3">RFIs: </span>
            <span className="mono b">{data.rfis.filter((rfi) => rfi.siteId === site.id && rfi.st !== "closed").length}</span>
            <span className="xs ct3" style={{ marginLeft: 8 }}>
              VOs:{" "}
            </span>
            <span className="mono b">{data.variations.filter((variation) => variation.siteId === site.id && variation.st === "submitted").length}</span>
          </div>
        </Card>
        <Card title="Safety & Presence">
          <div className="mono bb" style={{ fontSize: 30, color: site.safety >= 90 ? "var(--gn)" : "var(--or)", textAlign: "center" }}>
            {site.safety}%
          </div>
          <div className="xs ct3" style={{ textAlign: "center", marginTop: 2 }}>
            {data.safety.filter((entry) => entry.siteId === site.id && entry.type === "toolbox").length} talks · {data.presence.attendance.filter((entry) => entry.siteId === site.id && entry.anomalies.length > 0).length} anomalies
          </div>
        </Card>
      </div>
      <div className="g2">
        <Card title="Labour Confidence by Person">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {data.presence.attendance.filter((entry) => entry.siteId === site.id).map((entry) => (
                <tr key={entry.id}>
                  <td className="b sm">{entry.person}</td>
                  <td>
                    <Badge tone={entry.confidence > 80 ? "low" : entry.confidence > 60 ? "medium" : "high"}>{entry.status}</Badge>
                  </td>
                  <td className="mono">{entry.confidence}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="QA Summary">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {["passed", "scheduled", "in-progress", "failed"].map((status) => (
                <tr key={status}>
                  <td>
                    <Badge tone={status}>{status}</Badge>
                  </td>
                  <td className="mono b">{data.qa.filter((entry) => entry.siteId === site.id && entry.st === status).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, color }) {
  return (
    <div>
      <div className="xs ct3" style={{ textTransform: "uppercase" }}>
        {label}
      </div>
      <div className="mono bb" style={{ color, marginTop: 1 }}>
        {value}
      </div>
    </div>
  );
}

export function RiskIntelPage({ store }) {
  const { data, derived } = store;
  const metrics = derived.fieldCommercial.siteMetrics;

  return (
    <div className="oy fin">
      <MetricGrid
        columns={4}
        items={[
          { label: "Portfolio Exposure", value: `$${(derived.fieldCommercial.directorRisk.totalCostExposure / 1e3).toFixed(1)}k`, color: "r" },
          { label: "Time At Risk", value: `${derived.fieldCommercial.directorRisk.totalTimeExposure}d`, color: "o" },
          { label: "Margin At Risk", value: `$${(derived.fieldCommercial.directorRisk.marginAtRisk / 1e3).toFixed(1)}k`, color: "a" },
          { label: "Attendance Anomalies", value: derived.fieldCommercial.directorRisk.attendanceAnomalies, color: "b" },
        ]}
      />
      <div className="g2">
        <Card title="Portfolio Risk Heatmap" icon={Icons.trending}>
          <div className="list-stack">
            {metrics.map((entry) => {
              const site = data.sites.find((item) => item.id === entry.siteId);
              return (
                <div className="risk-row" key={entry.siteId}>
                  <div>
                    <div className="b sm">{site?.name}</div>
                    <div className="act-t">{entry.affectedTrades.join(", ") || "No trade impacts recorded"}</div>
                  </div>
                  <div className="risk-values">
                    <Badge tone={entry.risk}>{entry.risk}</Badge>
                    <span className="mono xs">${entry.costExposure.toLocaleString()}</span>
                    <span className="mono xs">{entry.timeExposure}d</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Recovery Status" icon={Icons.link}>
          <div className="list-stack">
            {metrics.map((entry) => {
              const site = data.sites.find((item) => item.id === entry.siteId);
              return (
                <div className="draft-row" key={`${entry.siteId}-recovery`}>
                  <div className="xs ct3">{site?.name}</div>
                  <div className="sm ct2">
                    {entry.stalledApprovals} stalled approvals · {entry.procurementRisks} procurement risks · {entry.qaFailures} QA failures
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function AdminPage({ store }) {
  return (
    <div className="oy fin">
      <h3 className="b sm fx mb8">{renderIcon(Icons.gear, 13)} Configuration</h3>
      <div className="g2">
        <Card title="Trades">
          {store.config.trades.map((trade) => (
            <div className="fb admin-row" key={trade}>
              <span className="sm">{trade}</span>
            </div>
          ))}
        </Card>
        <Card title="Priorities">
          {store.config.priorities.map((priority) => (
            <div className="fx admin-row" key={priority.value} style={{ gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: priority.color }} />
              <span className="sm">{priority.value}</span>
            </div>
          ))}
        </Card>
        <Card title="Roles">
          {store.config.roles.map((role) => (
            <div className="admin-row" key={role}>
              {role}
            </div>
          ))}
        </Card>
        <Card title="Demo">
          <div className="sm ct2">Reset all persisted demo data back to the seeded SiteForge operating model.</div>
          <div style={{ marginTop: 10 }}>
            <Button tone="bt-r" onClick={() => store.actions.resetCurrentMode()}>
              Reset Demo Data
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

const nowPlusDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
