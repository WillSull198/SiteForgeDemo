import { useMemo, useState } from "react";
import { askSiteForgeAi } from "../services/aiService";
import { formatters } from "../utils/formatters";
import { validateStructuredAddress, validators } from "../utils/validators";
import { Badge, Button, Card } from "./ui";

const ROLES = ["Director", "Project Manager", "Contract Admin", "Supervisor"];
const CONTRACT_TYPES = ["HIA", "AS4000", "AS2124", "MBA", "Custom"];
const STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"];

async function resizeLogo(file) {
  if (!file) return "";
  const bitmap = await createImageBitmap(file);
  const max = 400;
  const scale = Math.min(max / bitmap.width, max / bitmap.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.86);
  });
}

function Field({ label, error, children }) {
  return (
    <label className="ff">
      <span>{label}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

function StepHeader({ eyebrow, title, body }) {
  return (
    <div className="onboarding-step-header">
      <div className="restricted-badge">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}

export default function Onboarding({ state, actions }) {
  const step = state.onboarding?.step || "welcome";
  const [company, setCompany] = useState({
    companyName: state.settings?.company?.name || "",
    abn: state.settings?.company?.abn || "",
    street: "",
    suburb: "",
    state: "QLD",
    postcode: "",
    phone: state.settings?.company?.phone || "",
    email: state.settings?.company?.email || "",
    website: state.settings?.company?.website || "",
    defaultContractType: state.settings?.contractDefaults?.defaultContractType || "HIA",
    logoDataUrl: state.settings?.company?.logoDataUrl || "",
  });
  const [owner, setOwner] = useState({
    name: state.settings?.user?.name || "",
    email: state.settings?.user?.email || "",
    phone: state.settings?.user?.phone || "",
    role: state.settings?.user?.defaultRole || "Director",
  });
  const [teammates, setTeammates] = useState([]);
  const [project, setProject] = useState({
    projectName: "",
    siteStreet: "",
    siteSuburb: "",
    siteState: "QLD",
    sitePostcode: "",
    clientFirstName: "",
    clientLastName: "",
    clientEmail: "",
    clientPhone: "",
    clientCompany: "",
    contractValue: "",
    contractType: company.defaultContractType || "HIA",
    startDate: "",
    expectedCompletionDate: "",
    lotNumber: "",
    planNumber: "",
    supervisorId: "",
    pmId: "",
    notes: "",
  });
  const [integrations, setIntegrations] = useState({ anthropicApiKey: "", buildxactApiKey: "", buildxactWorkspaceId: "" });
  const [aiStatus, setAiStatus] = useState("");
  const [testingAi, setTestingAi] = useState(false);

  const companyValid = useMemo(() => {
    const addressValid = validateStructuredAddress({ street: company.street, suburb: company.suburb, state: company.state, postcode: company.postcode });
    return validators.required(company.companyName) && validators.abn(company.abn) && addressValid && validators.ausPhone(company.phone) && validators.email(company.email);
  }, [company]);

  const profileValid = useMemo(() => validators.required(owner.name) && validators.email(owner.email) && validators.ausPhone(owner.phone) && validators.required(owner.role), [owner]);

  const projectValid = useMemo(() => {
    const addressValid = validateStructuredAddress({ street: project.siteStreet, suburb: project.siteSuburb, state: project.siteState, postcode: project.sitePostcode });
    return (
      validators.required(project.projectName) &&
      addressValid &&
      validators.required(project.clientFirstName) &&
      validators.required(project.clientLastName) &&
      validators.email(project.clientEmail) &&
      validators.positiveNumber(project.contractValue) &&
      validators.required(project.contractType)
    );
  }, [project]);

  const saveCompany = () => {
    if (!companyValid) return;
    actions.saveOnboardingCompany({
      ...company,
      addressText: `${company.street}, ${company.suburb} ${company.state} ${company.postcode}`,
    });
  };

  const saveTeam = () => {
    if (!profileValid) return;
    actions.saveOnboardingTeam({ owner, teammates });
  };

  const saveProject = () => {
    if (!projectValid) return;
    const defaultUser = state.users[0]?.id || "";
    actions.createProject({
      ...project,
      supervisorId: project.supervisorId || state.users.find((user) => user.role === "Supervisor")?.id || defaultUser,
      pmId: project.pmId || state.users.find((user) => user.role === "Project Manager")?.id || defaultUser,
      siteAddressText: `${project.siteStreet}, ${project.siteSuburb} ${project.siteState} ${project.sitePostcode}`,
    });
  };

  const testAi = async () => {
    if (!integrations.anthropicApiKey.trim()) {
      setAiStatus("Paste a key first, or skip this step.");
      return;
    }
    if (!/^sk-ant-/.test(integrations.anthropicApiKey.trim())) {
      setAiStatus("Anthropic keys normally start with sk-ant-. Check the value before saving.");
      return;
    }
    setTestingAi(true);
    const result = await askSiteForgeAi({ userMessage: "Reply with the word 'pong' only.", projectContext: {}, apiKey: integrations.anthropicApiKey.trim() });
    if (result.source === "claude" && /pong/i.test(result.text || "")) {
      window.localStorage.setItem("siteforge-anthropic-key", integrations.anthropicApiKey.trim());
      setAiStatus("Claude API key works.");
    } else {
      setAiStatus(result.text || "Claude did not return a valid test response.");
    }
    setTestingAi(false);
  };

  const saveIntegrations = () => {
    if (integrations.anthropicApiKey.trim()) {
      window.localStorage.setItem("siteforge-anthropic-key", integrations.anthropicApiKey.trim());
    }
    actions.saveOnboardingIntegrations({
      anthropicConfigured: Boolean(integrations.anthropicApiKey.trim()),
      buildxactConnected: Boolean(integrations.buildxactApiKey.trim() && integrations.buildxactWorkspaceId.trim()),
      buildxactApiKey: integrations.buildxactApiKey.trim(),
      buildxactWorkspaceId: integrations.buildxactWorkspaceId.trim(),
    });
  };

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        {step === "welcome" ? (
          <>
            <StepHeader
              eyebrow="SiteForge"
              title="Getting started"
              body="Choose whether this browser should load the worked demo or start a clean real account with your own company and project data."
            />
            <div className="g2">
              <Card title="Try the demo">
                <p className="sm ct2">Explore SiteForge with Riverside Residence, Hargraves Family, example variations, Passport, Presence and Buildxact workflows.</p>
                <Button tone="bt-p" onClick={actions.startDemoAccount}>Start Demo</Button>
              </Card>
              <Card title="Set up my company">
                <p className="sm ct2">Start fresh. Demo data will not load, and every workflow will use your company, project, client and team records.</p>
                <Button tone="bt-p" onClick={actions.beginRealOnboarding}>Set Up Company</Button>
              </Card>
            </div>
          </>
        ) : null}

        {step === "company" ? (
          <>
            <StepHeader eyebrow="Step 1 of 5" title="Company details" body="These details flow into contracts, signed PDFs, client portal headers and queued email payloads." />
            <div className="g2">
              <Field label="Company name" error={!validators.required(company.companyName) ? "Required" : ""}>
                <input value={company.companyName} onChange={(event) => setCompany({ ...company, companyName: event.target.value })} />
              </Field>
              <Field label="ABN" error={company.abn && !validators.abn(company.abn) ? "Enter a valid 11-digit ABN" : ""}>
                <input value={company.abn} onChange={(event) => setCompany({ ...company, abn: event.target.value })} placeholder="12 345 678 901" />
              </Field>
              <Field label="Street address"><input value={company.street} onChange={(event) => setCompany({ ...company, street: event.target.value })} /></Field>
              <Field label="Suburb"><input value={company.suburb} onChange={(event) => setCompany({ ...company, suburb: event.target.value })} /></Field>
              <Field label="State">
                <select value={company.state} onChange={(event) => setCompany({ ...company, state: event.target.value })}>{STATES.map((item) => <option key={item}>{item}</option>)}</select>
              </Field>
              <Field label="Postcode" error={company.postcode && !validators.ausPostcode(company.postcode) ? "Use 4 digits" : ""}>
                <input value={company.postcode} onChange={(event) => setCompany({ ...company, postcode: event.target.value })} />
              </Field>
              <Field label="Phone" error={company.phone && !validators.ausPhone(company.phone) ? "Use an AU phone number" : ""}>
                <input value={company.phone} onChange={(event) => setCompany({ ...company, phone: event.target.value })} placeholder="0412 345 678" />
              </Field>
              <Field label="Email" error={company.email && !validators.email(company.email) ? "Enter a valid email" : ""}>
                <input value={company.email} onChange={(event) => setCompany({ ...company, email: event.target.value })} />
              </Field>
              <Field label="Website"><input value={company.website} onChange={(event) => setCompany({ ...company, website: event.target.value })} /></Field>
              <Field label="Default contract type">
                <select value={company.defaultContractType} onChange={(event) => setCompany({ ...company, defaultContractType: event.target.value })}>{CONTRACT_TYPES.map((item) => <option key={item}>{item}</option>)}</select>
              </Field>
            </div>
            <div className="linked-row">
              <div>
                <div className="b sm">Logo</div>
                <div className="xs ct3">Optional. Resized locally to max 400px and stored with your settings.</div>
              </div>
              {company.logoDataUrl ? <img alt="Company logo preview" className="onboarding-logo-preview" src={company.logoDataUrl} /> : null}
              <input type="file" accept="image/*" onChange={async (event) => setCompany({ ...company, logoDataUrl: await resizeLogo(event.target.files?.[0]) })} />
            </div>
            <div className="fa"><Button tone="bt-p" disabled={!companyValid} onClick={saveCompany}>Continue</Button></div>
          </>
        ) : null}

        {step === "profile" ? (
          <>
            <StepHeader eyebrow="Step 2 of 5" title="Your profile and team" body={`You're setting up ${company.companyName || state.settings?.company?.name || "your company"}. Add yourself first, then optional teammates.`} />
            <div className="g2">
              <Field label="Your name"><input value={owner.name} onChange={(event) => setOwner({ ...owner, name: event.target.value })} /></Field>
              <Field label="Your email" error={owner.email && !validators.email(owner.email) ? "Enter a valid email" : ""}><input value={owner.email} onChange={(event) => setOwner({ ...owner, email: event.target.value })} /></Field>
              <Field label="Your phone" error={owner.phone && !validators.ausPhone(owner.phone) ? "Use an AU phone number" : ""}><input value={owner.phone} onChange={(event) => setOwner({ ...owner, phone: event.target.value })} /></Field>
              <Field label="Your role"><select value={owner.role} onChange={(event) => setOwner({ ...owner, role: event.target.value })}>{ROLES.map((role) => <option key={role}>{role}</option>)}</select></Field>
            </div>
            <div className="list-stack">
              {teammates.map((person, index) => (
                <div className="linked-row" key={person.id || index}>
                  <input placeholder="Name" value={person.name || ""} onChange={(event) => setTeammates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                  <input placeholder="Email" value={person.email || ""} onChange={(event) => setTeammates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, email: event.target.value } : item))} />
                  <select value={person.role || "Supervisor"} onChange={(event) => setTeammates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value } : item))}>{ROLES.map((role) => <option key={role}>{role}</option>)}</select>
                  <input placeholder="Trade specialty" value={person.trade || ""} onChange={(event) => setTeammates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, trade: event.target.value } : item))} />
                </div>
              ))}
            </div>
            <div className="fa">
              <Button onClick={() => setTeammates([...teammates, { id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: "", email: "", phone: "", role: "Supervisor", trade: "" }])}>+ Add teammate</Button>
              <Button tone="bt-p" disabled={!profileValid} onClick={saveTeam}>Continue</Button>
            </div>
          </>
        ) : null}

        {step === "first-project" ? (
          <>
            <StepHeader eyebrow="Step 3 of 5" title="First project" body="Create the project and client record that every SiteForge workflow will use first." />
            <div className="g2">
              <Field label="Project name"><input value={project.projectName} onChange={(event) => setProject({ ...project, projectName: event.target.value })} /></Field>
              <Field label="Contract value" error={project.contractValue && !validators.positiveNumber(project.contractValue) ? "Use a positive number" : ""}><input type="number" value={project.contractValue} onChange={(event) => setProject({ ...project, contractValue: event.target.value })} /></Field>
              <Field label="Street"><input value={project.siteStreet} onChange={(event) => setProject({ ...project, siteStreet: event.target.value })} /></Field>
              <Field label="Suburb"><input value={project.siteSuburb} onChange={(event) => setProject({ ...project, siteSuburb: event.target.value })} /></Field>
              <Field label="State"><select value={project.siteState} onChange={(event) => setProject({ ...project, siteState: event.target.value })}>{STATES.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Postcode"><input value={project.sitePostcode} onChange={(event) => setProject({ ...project, sitePostcode: event.target.value })} /></Field>
              <Field label="Client first name"><input value={project.clientFirstName} onChange={(event) => setProject({ ...project, clientFirstName: event.target.value })} /></Field>
              <Field label="Client last name"><input value={project.clientLastName} onChange={(event) => setProject({ ...project, clientLastName: event.target.value })} /></Field>
              <Field label="Client email" error={project.clientEmail && !validators.email(project.clientEmail) ? "Enter a valid email" : ""}><input value={project.clientEmail} onChange={(event) => setProject({ ...project, clientEmail: event.target.value })} /></Field>
              <Field label="Client phone"><input value={project.clientPhone} onChange={(event) => setProject({ ...project, clientPhone: event.target.value })} /></Field>
              <Field label="Contract type"><select value={project.contractType} onChange={(event) => setProject({ ...project, contractType: event.target.value })}>{CONTRACT_TYPES.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Supervisor"><select value={project.supervisorId} onChange={(event) => setProject({ ...project, supervisorId: event.target.value })}><option value="">Use current user</option>{state.users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></Field>
            </div>
            <div className="fa"><Button tone="bt-p" disabled={!projectValid} onClick={saveProject}>Create Project</Button></div>
          </>
        ) : null}

        {step === "integrations" ? (
          <>
            <StepHeader eyebrow="Step 4 of 5" title="Integrations" body="External services are optional. Anything not connected will queue locally with full payloads and manual send controls." />
            <div className="g3">
              <Card title="Buildxact">
                <p className="sm ct2">Until connected, signed variation and contract payloads remain queued in Settings → Integrations.</p>
                <input placeholder="API key" value={integrations.buildxactApiKey} onChange={(event) => setIntegrations({ ...integrations, buildxactApiKey: event.target.value })} />
                <input placeholder="Workspace ID" value={integrations.buildxactWorkspaceId} onChange={(event) => setIntegrations({ ...integrations, buildxactWorkspaceId: event.target.value })} style={{ marginTop: 8 }} />
              </Card>
              <Card title="Anthropic AI">
                <p className="sm ct2">AI drafting and plan search use Claude when a key is present. Without it, SiteForge uses local keyword/template fallback.</p>
                <input type="password" placeholder="sk-ant-..." value={integrations.anthropicApiKey} onChange={(event) => setIntegrations({ ...integrations, anthropicApiKey: event.target.value })} />
                <div className="fx" style={{ gap: 8, marginTop: 8 }}><Button small onClick={testAi}>{testingAi ? "Testing..." : "Test"}</Button>{aiStatus ? <span className="xs ct2">{aiStatus}</span> : null}</div>
              </Card>
              <Card title="Microsoft Teams">
                <p className="sm ct2">Teams adaptive cards are queued locally until the backend bot is configured.</p>
                <Badge tone="medium">Coming soon</Badge>
              </Card>
            </div>
            <div className="fa"><Button onClick={saveIntegrations}>Skip / Continue</Button><Button tone="bt-p" onClick={saveIntegrations}>Save Integrations</Button></div>
          </>
        ) : null}

        {step === "done" ? (
          <>
            <StepHeader eyebrow="Step 5 of 5" title="You're ready" body="Your blank real workspace is configured. Demo data has not been loaded." />
            <div className="g2">
              <Card title="Ready now">
                {["Diary → ClientFlow → client portal → e-sign → signed PDF", "Problems, RFIs, tasks, procurement, QA and safety against your project", "Site Passport records, induction evidence and scan logs", "Reports and audit exports"].map((item) => <div className="linked-row" key={item}><span>{item}</span><Badge tone="passed">Ready</Badge></div>)}
              </Card>
              <Card title="Queued until connected">
                {["Buildxact pushes", "Email/SMS sends", "Teams adaptive cards"].map((item) => <div className="linked-row" key={item}><span>{item}</span><Badge tone="medium">Queued</Badge></div>)}
              </Card>
            </div>
            <p className="sm ct2">First project: {state.sites[0]?.name || project.projectName}. Contract value: {formatters.aud(project.contractValue || state.sites[0]?.contractValue || 0)}.</p>
            <div className="fa"><Button tone="bt-p" onClick={actions.finishRealOnboarding}>Take me to my project</Button></div>
          </>
        ) : null}
      </div>
    </div>
  );
}
