import { useMemo, useState } from "react";
import { APP_CONFIG } from "../data/seedData";
import { useSiteForge } from "../services/siteforgeStore";
import { Icons } from "../components/icons";
import { Badge, Button, Card, Modal } from "../components/ui";

const ageLabel = (approval) => {
  const sent = approval.sentAt ? new Date(approval.sentAt.replace(" ", "T")) : null;
  if (!sent || Number.isNaN(sent.getTime())) return "Draft";
  const days = (Date.now() - sent.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 7) return "0-7 days";
  if (days < 14) return "7-14 days";
  if (days < 30) return "14-30 days";
  return "30+ days";
};

const EMPTY_PULSE = {
  revenueRecognised: 0,
  contingencyConsumed: 0,
  variationExposure: 0,
  marginAtRisk: 0,
  cashFlowTrend: [12, 18, 16, 22, 20, 26],
};

export default function DirectorBoardroom() {
  const { state, actions, derived } = useSiteForge();
  const [riskFilter, setRiskFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [writeOffTarget, setWriteOffTarget] = useState(null);
  const [siteActionTarget, setSiteActionTarget] = useState(null);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [overrideValue, setOverrideValue] = useState("");

  const financialPulse = state.financialPulse && typeof state.financialPulse === "object" ? state.financialPulse : {};
  const pulse = financialPulse[state.session.period] || financialPulse["This Week"] || Object.values(financialPulse)[0] || EMPTY_PULSE;
  const cashFlowTrend = Array.isArray(pulse.cashFlowTrend) && pulse.cashFlowTrend.length ? pulse.cashFlowTrend : EMPTY_PULSE.cashFlowTrend;
  const sites = Array.isArray(state.sites) ? state.sites : [];
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const toolboxTalks = Array.isArray(state.toolboxTalks) ? state.toolboxTalks : [];
  const presenceExports = Array.isArray(state.presence?.exports) ? state.presence.exports : [];
  const schedules = Array.isArray(state.schedules) ? state.schedules : [];
  const qa = Array.isArray(state.qa) ? state.qa : [];
  const safety = Array.isArray(state.safety) ? state.safety : [];
  const procurement = Array.isArray(state.procurement) ? state.procurement : [];
  const siteMetrics = (derived.metrics?.siteMetrics || []).filter((metric) => {
    const site = sites.find((entry) => entry.id === metric.siteId);
    if (riskFilter !== "all" && metric.riskBand !== riskFilter) return false;
    if (regionFilter !== "all" && site?.region !== regionFilter) return false;
    if (statusFilter !== "all" && site?.status !== statusFilter) return false;
    return true;
  });
  const exposureRows = approvals.filter((approval) => !["signed", "fully-signed", "declined", "archived"].includes(approval.status));
  const toolboxCompliance = Math.round(
    (toolboxTalks.reduce((sum, talk) => sum + (talk.acknowledgements?.length || 0), 0) /
      Math.max(1, toolboxTalks.reduce((sum, talk) => sum + (talk.requiredFor?.length || 0), 0))) *
      100,
  );

  const totalLabourHours = presenceExports.reduce((sum, entry) => sum + (Number(entry.verifiedHours) || 0) + (Number(entry.flaggedHours) || 0), 0);
  const avgCrew = Math.round(sites.reduce((sum, site) => sum + (Number(site.crewToday) || 0), 0) / Math.max(1, sites.length));
  const riskRadar = {
    commercial: Math.min(100, Math.round(((derived.metrics?.portfolio?.totalMarginAtRisk || 0) / Math.max(1, derived.metrics?.portfolio?.totalContractValue || 0)) * 600)),
    programme: Math.min(100, Math.round((schedules.flatMap((schedule) => (Array.isArray(schedule.impacts) ? schedule.impacts : [])).reduce((sum, impact) => sum + (Number(impact.days) || 0), 0) / 20) * 100)),
    quality: Math.min(100, Math.round((qa.filter((entry) => entry.status === "failed").length / Math.max(1, qa.length)) * 100)),
    safety: Math.min(100, Math.round((safety.filter((entry) => ["critical", "incident"].includes(entry.type)).length / Math.max(1, safety.length)) * 100)),
    client: Math.min(100, Math.round((100 - Object.values(state.clientSentiment || {}).reduce((sum, entry) => sum + (entry.score || 60), 0) / Math.max(1, Object.keys(state.clientSentiment || {}).length)))),
    procurement: Math.min(100, Math.round((procurement.filter((entry) => ["delayed", "escalated"].includes(entry.status)).length / Math.max(1, procurement.length)) * 100)),
  };

  return (
    <div className="oy fin">
      <div className="boardroom-header">
        <div>
          <div className="boardroom-kicker">{state.company?.legalName || state.settings?.company?.name || state.company?.name || "SiteForge"}</div>
          <h1>Director Boardroom</h1>
        </div>
        <div className="fx" style={{ gap: 8 }}>
          <select className="role-select" value={state.session.period} onChange={(event) => actions.setPeriod(event.target.value)}>
            {APP_CONFIG.periods.map((period) => (
              <option key={period}>{period}</option>
            ))}
          </select>
          <Button tone="bt-p" icon={Icons.download} onClick={() => actions.generateBoardReport()}>
            Generate Board Report
          </Button>
          <Button icon={Icons.zap} onClick={() => actions.generateWeeklyOperationsSummary()}>
            AI Ops Summary
          </Button>
        </div>
      </div>

      {state.boardInsightsCache?.aiWeeklySummary ? (
        <Card title="AI Weekly Operations Briefing" icon={Icons.zap} className="mb8">
          <div className="client-copy">{state.boardInsightsCache.aiWeeklySummary}</div>
          <div className="list-stack" style={{ marginTop: 10 }}>
            {(state.boardInsightsCache.suggestedActions || []).map((action) => (
              <div className="linked-row" key={action}>
                <span>{action}</span>
                <Badge tone="medium">recommended</Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {!sites.length ? (
        <Card title="Boardroom setup" icon={Icons.briefcase} className="mb8">
          <div className="sm ct2">
            No projects are available yet, so portfolio metrics are showing safe zero values. Restart onboarding or create a project to populate the boardroom.
          </div>
          <div className="fx" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button tone="bt-p" onClick={() => actions.restartOnboarding()}>
              Restart Onboarding
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="sts g4 mb8">
        <div className="si g">
          <div className="sl">Active Projects</div>
          <div className="sv">{derived.metrics?.portfolio?.activeProjects || 0}</div>
        </div>
        <div className="si a">
          <div className="sl">Total Contract Value</div>
          <div className="sv">${((derived.metrics?.portfolio?.totalContractValue || 0) / 1e6).toFixed(1)}M</div>
        </div>
        <div className="si r">
          <div className="sl">Margin At Risk</div>
          <div className="sv">${Math.round((derived.metrics?.portfolio?.totalMarginAtRisk || 0) / 1000)}k</div>
        </div>
        <div className="si b">
          <div className="sl">Margin Movement</div>
          <div className="sv">{Math.round(derived.metrics?.portfolio?.verifiedLabourPct || 0)}%</div>
        </div>
      </div>

      <div className="g4 mb8">
        <Card title="Revenue Recognised" icon={Icons.dollar}>
          <div className="cr">
            <span>{state.session.period}</span>${(pulse.revenueRecognised || 0).toLocaleString()}
          </div>
        </Card>
        <Card title="Contingency Consumed" icon={Icons.alert}>
          <div className="cr">
            <span>Current Period</span>${(pulse.contingencyConsumed || 0).toLocaleString()}
          </div>
        </Card>
        <Card title="Variation Exposure" icon={Icons.shuffle}>
          <div className="cr">
            <span>Unapproved</span>${(pulse.variationExposure || 0).toLocaleString()}
          </div>
        </Card>
        <Card title="Cash Flow Indicator" icon={Icons.trending}>
          <div className="sparkline">
            {cashFlowTrend.map((value, index) => (
              <span key={`${value}-${index}`} style={{ height: `${value}%` }} />
            ))}
          </div>
        </Card>
      </div>

      <div className="boardroom-filters">
        <select className="role-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="on-hold">On hold</option>
        </select>
        <select className="role-select" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
          <option value="all">All risk levels</option>
          <option value="green">Green</option>
          <option value="amber">Amber</option>
          <option value="red">Red</option>
        </select>
        <select className="role-select" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
          <option value="all">All regions</option>
          {APP_CONFIG.regions.map((region) => (
            <option key={region}>{region}</option>
          ))}
        </select>
      </div>

      <Card title="Portfolio Heatmap" icon={Icons.grid} className="mb8">
        <div className="heatmap-grid">
          {siteMetrics.map((metric) => {
            const site = sites.find((entry) => entry.id === metric.siteId);
            return (
              <button className={`heatmap-tile ${metric.riskBand}`} key={metric.siteId} onClick={() => actions.navigate({ kind: "director", page: "boardroom", siteId: metric.siteId, entityId: null })} type="button">
                <div className="b sm">{site?.name || metric.siteId}</div>
                <div className="xs ct3">{site?.progress ?? 0}% complete</div>
                <div className="heatmap-score">{metric.riskScore}</div>
                <div className="xs ct2" style={{ marginTop: 6 }}>
                  Margin position {(metric.marginPosition || 0).toFixed(1)}%
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="g23">
        <div>
          <Card title="Commercial Exposure" icon={Icons.bar} className="mb8">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Approval</th>
                    <th>Site</th>
                    <th>Ageing</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {exposureRows.map((approval) => (
                    <tr key={approval.id}>
                      <td>
                        <div className="b sm">{approval.title}</div>
                        <div className="xs ct3">{approval.type}</div>
                      </td>
                      <td className="xs">{sites.find((site) => site.id === approval.siteId)?.name || approval.siteId}</td>
                      <td className="xs">{ageLabel(approval)}</td>
                      <td className="mono xs">${(approval.costImpact || 0).toLocaleString()}</td>
                      <td>
                        <Badge tone={approval.status === "question" ? "high" : "medium"}>{approval.status}</Badge>
                      </td>
                      <td>
                        <div className="fx" style={{ gap: 4, flexWrap: "wrap" }}>
                          {["14-30 days", "30+ days"].includes(ageLabel(approval)) ? (
                            <Button small onClick={() => actions.sendDirectorEscalation(approval.siteId, approval.title)}>
                              Escalate
                            </Button>
                          ) : null}
                          {approval.status === "approved" || approval.status === "signed" ? (
                            <Button small tone="bt-r" onClick={() => setWriteOffTarget(approval)}>
                              Write Off
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="AI Insights" icon={Icons.zap}>
            <Badge tone={derived.boardInsight?.source === "openai" || derived.boardInsight?.source === "claude" ? "passed" : "medium"}>
              {derived.boardInsight?.source === "openai" ? "ChatGPT" : derived.boardInsight?.source === "claude" ? "Claude" : "Local template"}
            </Badge>
            <div className="client-copy">{derived.boardInsight?.summary || "No portfolio signals are available yet. Add projects and operational activity to generate board insights."}</div>
            <div className="g3" style={{ marginTop: 10 }}>
              <div className="mini-panel">
                <div className="xs ct3">Top risks</div>
                {(derived.boardInsight?.topRisks || []).map((item) => (
                  <div className="sm ct2" key={item} style={{ marginTop: 6 }}>
                    {item}
                  </div>
                ))}
              </div>
              <div className="mini-panel">
                <div className="xs ct3">Top wins</div>
                {(derived.boardInsight?.topWins || []).map((item) => (
                  <div className="sm ct2" key={item} style={{ marginTop: 6 }}>
                    {item}
                  </div>
                ))}
              </div>
              <div className="mini-panel">
                <div className="xs ct3">Suggested actions</div>
                {(derived.boardInsight?.suggestedActions || []).map((item) => (
                  <div className="sm ct2" key={item} style={{ marginTop: 6 }}>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card title="Risk Radar" icon={Icons.radar} className="mb8">
            <svg viewBox="0 0 220 220" className="radar-chart">
              {[20, 40, 60, 80, 100].map((radius) => (
                <circle key={radius} cx="110" cy="110" r={radius * 0.8} fill="none" stroke="rgba(138,155,181,0.18)" />
              ))}
              {Object.entries(riskRadar).map(([label, value], index, array) => {
                const angle = (Math.PI * 2 * index) / array.length - Math.PI / 2;
                const x = 110 + Math.cos(angle) * 90;
                const y = 110 + Math.sin(angle) * 90;
                return (
                  <g key={label}>
                    <line x1="110" y1="110" x2={x} y2={y} stroke="rgba(138,155,181,0.2)" />
                    <text x={x} y={y} fill="currentColor" fontSize="8" textAnchor="middle">
                      {label}
                    </text>
                  </g>
                );
              })}
              <polygon
                points={Object.values(riskRadar)
                  .map((value, index, array) => {
                    const angle = (Math.PI * 2 * index) / array.length - Math.PI / 2;
                    const radius = value * 0.8;
                    return `${110 + Math.cos(angle) * radius},${110 + Math.sin(angle) * radius}`;
                  })
                  .join(" ")}
                fill="rgba(245,158,11,0.24)"
                stroke="var(--am)"
                strokeWidth="2"
              />
            </svg>
          </Card>
        </div>

        <div>
          <Card title="Safety Record" icon={Icons.shield} className="mb8">
            <div className="cr">
              <span>Days Since Incident</span>4
            </div>
            <div className="bb-row">
              <div className="bb-l">Toolbox compliance</div>
              <div className="bb-t">
                <div className="bb-f" style={{ width: `${toolboxCompliance}%`, background: "var(--gn)" }} />
              </div>
              <div className="bb-v">{toolboxCompliance}%</div>
            </div>
            <div className="bb-row">
              <div className="bb-l">Near miss trend</div>
              <div className="bb-t">
                <div className="bb-f" style={{ width: "38%", background: "var(--or)" }} />
              </div>
              <div className="bb-v">Stable</div>
            </div>
          </Card>

          <Card title="Workforce Summary" icon={Icons.users} className="mb8">
            <div className="linked-row">
              <div>
                <div className="b sm">Total labour hours</div>
                <div className="xs ct3">This period across the portfolio</div>
              </div>
              <span className="mono bb">{totalLabourHours.toFixed(1)}h</span>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">Average daily crew size</div>
                <div className="xs ct3">All active projects</div>
              </div>
              <span className="mono bb">{avgCrew}</span>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">Presence verified</div>
                <div className="xs ct3">Of billed labour records</div>
              </div>
              <Badge tone="passed">{derived.metrics?.portfolio?.verifiedLabourPct || 0}%</Badge>
            </div>
          </Card>

          <Card title="Approval Velocity" icon={Icons.clock}>
            <div className="linked-row">
              <div>
                <div className="b sm">Avg client response time</div>
                <div className="xs ct3">Sent to decision</div>
              </div>
              <span className="mono bb">{derived.metrics?.portfolio?.clientVelocityHours || 0}h</span>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">Revenue recovered</div>
                <div className="xs ct3">Through signed approvals</div>
              </div>
              <span className="mono bb">
                $
                {approvals
                  .filter((approval) => approval.status === "signed")
                  .reduce((sum, approval) => sum + approval.costImpact, 0)
                  .toLocaleString()}
              </span>
            </div>
          </Card>
          <Card title="Director Controls" icon={Icons.flag}>
            <div className="list-stack">
              {sites.map((site) => (
                <div className="linked-row" key={site.id}>
                  <div>
                    <div className="b sm">{site.name}</div>
                    <div className="xs ct3">{site.status}</div>
                  </div>
                  <div className="fx" style={{ gap: 4 }}>
                    <Button small onClick={() => setSiteActionTarget(site)}>
                      Terminate Site
                    </Button>
                    <Button
                      small
                      tone="bt-p"
                      onClick={() => {
                        const budget = state.siteBudgets.find((entry) => entry.siteId === site.id)?.items?.[0];
                        if (budget) setOverrideTarget({ siteId: site.id, budget });
                      }}
                    >
                      Override Budget
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={Boolean(writeOffTarget)} close={() => setWriteOffTarget(null)} title="Write Off Item">
        <div className="ff">
          <label>Reason</label>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="fa">
          <Button onClick={() => setWriteOffTarget(null)}>Cancel</Button>
          <Button
            tone="bt-r"
            onClick={() => {
              if (writeOffTarget) actions.writeOffItem(writeOffTarget.id, reason);
              setWriteOffTarget(null);
              setReason("");
            }}
          >
            Confirm Write Off
          </Button>
        </div>
      </Modal>

      <Modal open={Boolean(siteActionTarget)} close={() => setSiteActionTarget(null)} title="Terminate Site">
        <div className="sm ct2">This is a severe authority action. Type the project name in the reason box to confirm.</div>
        <div className="ff" style={{ marginTop: 10 }}>
          <label>Project name confirmation</label>
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="fa">
          <Button onClick={() => setSiteActionTarget(null)}>Cancel</Button>
          <Button
            tone="bt-r"
            onClick={() => {
              if (siteActionTarget && reason === siteActionTarget.name) {
                actions.terminateSite(siteActionTarget.id, reason);
                setSiteActionTarget(null);
                setReason("");
              }
            }}
          >
            Terminate
          </Button>
        </div>
      </Modal>

      <Modal open={Boolean(overrideTarget)} close={() => setOverrideTarget(null)} title="Override Budget">
        <div className="ff">
          <label>New budget amount</label>
          <input value={overrideValue} onChange={(event) => setOverrideValue(event.target.value)} />
        </div>
        <div className="ff">
          <label>Reason</label>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="fa">
          <Button onClick={() => setOverrideTarget(null)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              if (overrideTarget) {
                actions.overrideBudget(overrideTarget.siteId, overrideTarget.budget.id, overrideValue, reason);
              }
              setOverrideTarget(null);
              setOverrideValue("");
              setReason("");
            }}
          >
            Save Override
          </Button>
        </div>
      </Modal>
    </div>
  );
}
