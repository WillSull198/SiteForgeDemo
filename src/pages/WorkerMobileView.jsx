import { useMemo, useRef, useState } from "react";
import { useSiteForge } from "../services/siteforgeStore";
import { Icons, renderIcon } from "../components/icons";
import { Badge, Button, Modal } from "../components/ui";

const callNumber = (value) => {
  const numeric = value.replace(/[^\d+]/g, "");
  window.location.href = `tel:${numeric}`;
};

export default function WorkerMobileView() {
  const { state, actions } = useSiteForge();
  const user = state.users.find((entry) => entry.id === state.session.userId);
  const siteId = user?.siteIds?.[0] || state.session.siteId;
  const site = state.sites.find((entry) => entry.id === siteId) || state.sites[0];
  const route = state.session.route;
  const [problemOpen, setProblemOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [listening, setListening] = useState(false);
  const [problemForm, setProblemForm] = useState({ title: "", priority: "medium", description: "" });
  const [materialsForm, setMaterialsForm] = useState({ item: "", quantity: "", urgency: "normal" });
  const recognitionRef = useRef(null);

  const tasks = useMemo(() => state.tasks.filter((task) => task.assigneeId === user?.id && task.siteId === siteId).slice(0, 3), [siteId, state.tasks, user?.id]);
  const taskDetail = state.tasks.find((task) => task.id === route.entityId) || tasks[0];
  const safetyAlerts = state.safety.filter((item) => item.siteId === siteId && (item.type === "critical" || item.type === "alert"));
  const toolbox = state.toolboxTalks.filter((talk) => talk.requiredFor.includes(user?.id));
  const unreadToolbox = toolbox.filter((talk) => !talk.acknowledgements.some((ack) => ack.userId === user?.id));
  const passport = user ? state.passports.records.find((record) => record.userId === user.id && record.siteId === siteId) : null;
  const presence = user ? state.presence.records.find((record) => record.userId === user.id && record.siteId === siteId) : null;
  const myDay = {
    checkIn: state.passports.scanLog.find((entry) => entry.passportId === passport?.id)?.at || "Not checked in",
    completed: state.tasks.filter((task) => task.assigneeId === user?.id && task.siteId === siteId && task.status === "done").length,
    remaining: state.tasks.filter((task) => task.assigneeId === user?.id && task.siteId === siteId && task.status !== "done").length,
    hours: presence ? Math.max(4, Math.round((presence.confidence / 100) * 8)) : 0,
  };

  const openTask = (task) => {
    actions.navigate({ kind: "worker", userId: user.id, page: "task", entityId: task.id });
  };

  const startVoiceCapture = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const transcript = "Lintel pack still missing on east wall. Crew is out of sequence and waiting on supplier confirmation.";
      setVoiceText(transcript);
      setProblemForm((current) => ({ ...current, description: transcript, title: current.title || "Supplier delay affecting east wall" }));
      return;
    }
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-AU";
    let silenceTimer = null;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      setVoiceText(transcript);
      setProblemForm((current) => ({ ...current, description: transcript, title: current.title || transcript.split(".")[0]?.slice(0, 70) || "Voice field note" }));
      if (silenceTimer) window.clearTimeout(silenceTimer);
      silenceTimer = window.setTimeout(() => recognition.stop(), 3000);
    };
    recognition.onend = () => {
      if (silenceTimer) window.clearTimeout(silenceTimer);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  if (!user || !site) {
    return (
      <div className="worker-shell">
        <div className="worker-page">
          <div className="worker-card">
            <div className="worker-card-title">Worker session unavailable</div>
            <div className="worker-card-copy">We couldn't restore the field-worker session from saved demo data.</div>
            <Button tone="bt-p" onClick={() => actions.resetDemo()} className="touch-button" style={{ marginTop: 12 }}>
              Reset Demo State
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="worker-shell">
      <div className="worker-header">
        <div>
          <div className="worker-greeting">G'day, {user.firstName}</div>
          <div className="worker-site">
            {site.name} · {site.weather}
          </div>
        </div>
        <div className="fx" style={{ gap: 8, alignItems: "center" }}>
          <Button small onClick={() => actions.setRole("Supervisor")}>
            Builder View
          </Button>
          <button className="worker-emergency" type="button" onClick={() => actions.navigate({ kind: "worker", userId: user.id, page: "emergency", entityId: null })}>
            Emergency
          </button>
        </div>
      </div>
      {!navigator.onLine ? (
        <div className="worker-alert">
          <strong>Offline mode</strong>
          <span>Records save locally and sync when your connection returns.</span>
        </div>
      ) : null}

      {route.page === "task" && taskDetail ? (
        <div className="worker-page">
          <button className="client-back" type="button" onClick={() => actions.navigate({ kind: "worker", userId: user.id, page: "home", entityId: null })}>
            {renderIcon(Icons.back, 14)} Back to today
          </button>
          <div className="worker-card feature">
            <div className="worker-card-title">{taskDetail.title}</div>
            <div className="worker-card-copy">{taskDetail.description}</div>
            <div className="worker-thumb">Drawing thumbnail · {taskDetail.linkedRecords?.[0]?.label || "No linked drawing"}</div>
            <div className="worker-checklist">
              {taskDetail.mobileMaterials.map((material) => (
                <label key={material} className="worker-check-row">
                  <input type="checkbox" />
                  <span>{material}</span>
                </label>
              ))}
            </div>
            <div className="fx" style={{ gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {taskDetail.status === "todo" ? (
                <Button tone="bt-p" icon={Icons.check} onClick={() => actions.updateTaskStatus(taskDetail.id, "in-progress")} className="touch-button">
                  Start Task
                </Button>
              ) : (
                <Button tone="bt-p" icon={Icons.check} onClick={() => actions.updateTaskStatus(taskDetail.id, "done")} className="touch-button">
                  Mark Complete
                </Button>
              )}
              <Button icon={Icons.alert} onClick={() => setProblemOpen(true)} className="touch-button">
                Report Problem Here
              </Button>
              <Button
                icon={Icons.camera}
                onClick={() => setVoiceText("Photo capture noted. The image will attach to this task and be visible in the PM review feed.")}
                className="touch-button"
              >
                Capture Photo
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {route.page === "emergency" ? (
        <div className="worker-page">
          <div className="worker-card danger">
            <div className="worker-card-title">Emergency Information</div>
            <div className="client-copy">{state.passports.siteAccess.find((entry) => entry.siteId === siteId)?.dailyBrief}</div>
            <div className="list-stack" style={{ marginTop: 12 }}>
              {(state.passports.siteAccess.find((entry) => entry.siteId === siteId)?.emergencyContacts || []).map((contact) => (
                <div className="linked-row" key={contact.label}>
                  <div>
                    <div className="b sm">{contact.label}</div>
                    <div className="xs ct3">{contact.value}</div>
                  </div>
                  <Button small tone="bt-r" onClick={() => callNumber(contact.value)}>
                    Call
                  </Button>
                </div>
              ))}
            </div>
            <Button tone="bt-r" className="touch-button" style={{ marginTop: 12 }} onClick={() => callNumber("000")}>
              Call 000
            </Button>
          </div>
        </div>
      ) : null}

      {(route.page === "home" || !route.page) && (
        <div className="worker-page">
          {safetyAlerts.map((alert) => (
            <div className="worker-alert" key={alert.id}>
              <strong>{alert.topic}</strong>
              <span>{alert.by}</span>
            </div>
          ))}

          <button className="worker-qr-button" type="button" onClick={() => actions.scanPassport(siteId, passport?.id)}>
            {renderIcon(Icons.qr, 24)}
            <span>Check In to Site</span>
          </button>

          <div className="worker-section-title">Today's priority tasks</div>
          <div className="worker-stack">
            {tasks.map((task) => (
              <button className="worker-card" key={task.id} type="button" onClick={() => openTask(task)}>
                <div className="fb">
                  <div className="worker-card-title">{task.title}</div>
                  <Badge tone={task.priority === "critical" ? "critical" : task.priority === "high" ? "high" : "medium"}>{task.priority}</Badge>
                </div>
                <div className="worker-card-copy">{task.description}</div>
                <div className="worker-card-meta">
                  <span>{task.trade}</span>
                  <span>{task.status}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="worker-section-title">Unread toolbox talks</div>
          <div className="worker-stack">
            {unreadToolbox.map((talk) => (
              <div className="worker-card" key={talk.id}>
                <div className="worker-card-title">{talk.title}</div>
                <div className="worker-card-copy">Read and acknowledge before continuing on site today.</div>
                <Button tone="bt-p" className="touch-button" onClick={() => actions.acknowledgeToolboxTalk(talk.id, user.id, user.name)}>
                  I have read and understood
                </Button>
              </div>
            ))}
          </div>

          <div className="worker-section-title">My day</div>
          <div className="worker-grid">
            <div className="worker-stat">
              <span>Check in</span>
              <strong>{myDay.checkIn}</strong>
            </div>
            <div className="worker-stat">
              <span>Hours so far</span>
              <strong>{myDay.hours}</strong>
            </div>
            <div className="worker-stat">
              <span>Completed</span>
              <strong>{myDay.completed}</strong>
            </div>
            <div className="worker-stat">
              <span>Remaining</span>
              <strong>{myDay.remaining}</strong>
            </div>
          </div>

          <div className="fx" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <Button onClick={() => actions.navigate({ kind: "worker", userId: user.id, page: "home", entityId: null })} className="touch-button">
              Pull-to-refresh
            </Button>
            <Button icon={Icons.alert} onClick={() => setProblemOpen(true)} className="touch-button">
              Report Problem
            </Button>
            <Button icon={Icons.box} onClick={() => setMaterialsOpen(true)} className="touch-button">
              Request Materials
            </Button>
            <Button tone="bt-p" icon={Icons.book} onClick={() => actions.generateWorkerEndOfDay(user.id)} className="touch-button">
              End-of-Day Summary
            </Button>
          </div>
        </div>
      )}

      <Modal open={problemOpen} close={() => setProblemOpen(false)} title="Report Problem">
        <div className="ff">
          <label>Voice to text</label>
          <Button
            tone="bt-p"
            icon={Icons.chat}
            onClick={startVoiceCapture}
          >
            {listening ? "Listening..." : "Start Voice Note"}
          </Button>
          {voiceText ? <div className="client-copy" style={{ marginTop: 8 }}>{voiceText}</div> : null}
        </div>
        <div className="ff">
          <label>What's the problem?</label>
          <input value={problemForm.title} onChange={(event) => setProblemForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description</label>
          <textarea value={problemForm.description} onChange={(event) => setProblemForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Priority</label>
          <select value={problemForm.priority} onChange={(event) => setProblemForm((current) => ({ ...current, priority: event.target.value }))}>
            {["critical", "high", "medium", "low"].map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
        </div>
        <div className="fa">
          <Button onClick={() => setProblemOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            icon={Icons.send}
            onClick={() => {
              actions.addProblem({
                siteId,
                title: problemForm.title,
                description: problemForm.description,
                priority: problemForm.priority,
              });
              setProblemOpen(false);
              setProblemForm({ title: "", priority: "medium", description: "" });
              setVoiceText("");
            }}
          >
            Submit
          </Button>
        </div>
      </Modal>

      <Modal open={materialsOpen} close={() => setMaterialsOpen(false)} title="Request Materials">
        <div className="ff">
          <label>Item</label>
          <input value={materialsForm.item} onChange={(event) => setMaterialsForm((current) => ({ ...current, item: event.target.value }))} />
        </div>
        <div className="g2">
          <div className="ff">
            <label>Quantity</label>
            <input value={materialsForm.quantity} onChange={(event) => setMaterialsForm((current) => ({ ...current, quantity: event.target.value }))} />
          </div>
          <div className="ff">
            <label>Urgency</label>
            <select value={materialsForm.urgency} onChange={(event) => setMaterialsForm((current) => ({ ...current, urgency: event.target.value }))}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
        <div className="fa">
          <Button onClick={() => setMaterialsOpen(false)}>Cancel</Button>
          <Button
            tone="bt-p"
            onClick={() => {
              actions.addProcurementRequest({
                siteId,
                item: materialsForm.item,
                quantity: materialsForm.quantity,
                requestedBy: user.id,
              });
              setMaterialsOpen(false);
              setMaterialsForm({ item: "", quantity: "", urgency: "normal" });
            }}
          >
            Submit Request
          </Button>
        </div>
      </Modal>

      <nav className="worker-bottom-nav" aria-label="Worker navigation">
        <button type="button" className={route.page === "home" || !route.page ? "on" : ""} onClick={() => actions.navigate({ kind: "worker", userId: user.id, page: "home", entityId: null })}>
          {renderIcon(Icons.sun, 16)} Today
        </button>
        <button type="button" className={route.page === "tasks" ? "on" : ""} onClick={() => tasks[0] && openTask(tasks[0])}>
          {renderIcon(Icons.check, 16)} Tasks
        </button>
        <button type="button" onClick={() => setProblemOpen(true)}>
          {renderIcon(Icons.alert, 16)} Report
        </button>
        <button type="button" onClick={() => actions.navigate({ kind: "worker", userId: user.id, page: "emergency", entityId: null })}>
          {renderIcon(Icons.shield, 16)} Profile
        </button>
      </nav>
    </div>
  );
}
