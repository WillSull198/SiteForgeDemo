# testRigor Scripts

## Onboarding To Dashboard
```
open the SiteForge URL
click "Set up my company"
enter "Acme Homes" into "Company name"
enter "83 914 571 673" into "ABN"
enter "1 Builder Street" into "Street"
enter "Brisbane" into "Suburb"
select "QLD" from "State"
enter "4000" into "Postcode"
enter "0400 000 000" into "Phone"
enter "owner@example.com" into "Email"
click "Continue"
enter "Owner Builder" into "Your name"
enter "owner@example.com" into "Your email"
enter "0400 000 000" into "Your phone"
select "Project Manager" from "Your role"
click "Continue"
enter "Real Project" into "Project name"
enter "10 Site Road" into "Site address"
enter "Client" into "Client first name"
enter "Person" into "Client last name"
enter "client@example.com" into "Client email"
enter "550000" into "Contract value"
click "Create Project"
click "Skip"
click "Take me to my project"
check that page contains "Command Centre"
```

## Variation Lifecycle With Internal Gates
```
click "ClientFlow"
click "+ New Approval"
select "Type a fresh approval" from "Create From"
enter "Waterproofing upgrade" into "Title"
select the first client from "Client"
enter "Additional waterproofing required" into "Description"
enter "Site condition changed from original scope" into "Reason"
enter "4500" into "Estimated cost"
click "Create Draft"
click the element with data-testid "approval-submit-pm-review"
switch role to "Project Manager"
click the element with data-testid "approval-pm-approve"
switch role to "Contract Admin"
click the element with data-testid "approval-ca-approve"
check that page contains "#/approve/"
```

## Problem To RFI To Variation
```
click "Problems"
click "Report Problem"
enter "Water ingress at footing" into "Title"
enter "Requires consultant clarification" into "Description"
click "Save"
click "Water ingress at footing"
click the element with data-testid "problem-raise-rfi"
check that page contains "RFI"
click the element with data-testid "rfi-convert-variation"
check that page contains "Variation"
```

## Diary To Rain Day
```
click "Site Diary"
click "New Entry"
enter today's date into "Date"
enter "Rain stopped external works" into "Summary"
check "Rain Event"
click "Save"
click the element with data-testid "diary-claim-rain-day"
check that page contains "Rain day claim"
```

## Site Passport Scan
```
click "Site Passport"
click "Test Scan"
check that page contains either "GRANTED" or "DENIED"
```
