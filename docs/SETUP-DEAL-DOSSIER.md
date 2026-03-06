# Deal Dossier & Deal Scoring – Setup Checklist

This checklist covers what you need to configure so the Deal Dossier and Deal Scoring features work correctly.

---

## 1. Database

- **`DATABASE_URL`**  
  Set in the **API** environment (e.g. in `.env` for the API app or in Render for the API service).  
  Required for: profile, saved deals, deal signals, documents, and all property/listing data.

- **Migrations**  
  Run so the new tables exist:
  ```bash
  npm run db:migrate
  ```
  This applies migrations including:
  - `025_documents` – generated dossier/Excel files
  - `026_deal_signals` – deal score and metrics
  - `027_user_profile` – single user profile and assumption defaults
  - `028_saved_deals` – saved deals and deal status
  - `029_user_profile_seed` – ensures one default user row exists

Without these, Profile, Saved deals, Compute score, and Generate dossier will fail.

---

## 2. API environment variables

| Variable | Required for dossier? | Notes |
|----------|------------------------|--------|
| `DATABASE_URL` | **Yes** | Postgres connection string. |
| `GMAIL_CLIENT_ID` | Email only | Gmail OAuth2 client ID. |
| `GMAIL_CLIENT_SECRET` | Email only | Gmail OAuth2 client secret. |
| `GMAIL_REFRESH_TOKEN` | Email only | Refresh token with `gmail.send` scope. |
| `GMAIL_REDIRECT_URI` | Optional | Default: OAuth Playground URI. |
| `GENERATED_DOCS_PATH` | Optional | Default: `uploads/generated-docs`. Must be writable; use a stable path so generated files persist. |
| `CORS_ORIGIN` | **Yes** (for web) | Allowed frontend origin(s), e.g. `http://localhost:3000` or your Render web URL. |
| `PORT` | Optional | Default: 4000. |

If Gmail env vars are **not** set, dossier generation still runs and files are saved; only the “email to profile” step is skipped (no error, `emailSent: false`).

---

## 3. Gmail (for email after dossier generation)

To have the API send the generated dossier and Excel to the profile email:

1. **Google Cloud Console**  
   Create (or use) a project and enable the **Gmail API**.

2. **OAuth 2.0 credentials**  
   Create OAuth 2.0 Client ID (e.g. “Web application”). Note **Client ID** and **Client secret**.

3. **Refresh token**  
   - Use [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) (or your own flow).  
   - Use scope: `https://www.googleapis.com/auth/gmail.send` (and optionally `gmail.readonly` if you use process-inbox).  
   - Authorize and exchange the code for tokens.  
   - Copy the **Refresh token**.

4. **Env in API**  
   Set:
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN`  
   (and `GMAIL_REDIRECT_URI` only if you use a custom redirect).

5. **Profile email**  
   In the app: **Profile** → set **Email** and save. Dossier emails are sent to this address.

---

## 4. Web app environment

- **`NEXT_PUBLIC_API_URL`**  
  Set in the **web** app (e.g. `apps/web/.env` or Render web service).  
  Must point to the API the browser can call:
  - Local: `http://localhost:4000`
  - Production: e.g. `https://re-sourcing-api.onrender.com`

If this is wrong or missing, the UI will still build but calls to the API (properties, profile, compute score, generate dossier, document download) can fail or hit the wrong host.

---

## 5. Profile and assumptions (in the app)

- **Profile**  
  Open **Profile**, fill **Name**, **Email** (for dossier email), **Organization** and save.

- **Assumptions**  
  Open **Profile** → **Assumptions** (or **Dossier** with a property).  
  Set default underwriting assumptions, or click **Generate standard leverage** (65% LTV, 6.5% rate, 30-year amortization).  
  If you leave them blank, the dossier flow uses code defaults (e.g. 65, 6.5, 30, 5, 15, 2, 5 for LTV, rate, amortization, exit cap, rent uplift, expense increase, management fee).

---

## 6. Data needed for meaningful scores and dossiers

- **Property**  
  Must exist (e.g. created from **Property Data** → “Add to canonical properties” from raw listings).

- **Listing**  
  Property should have a **linked listing** (match) so we have:
  - **Price** (for cap rates, LTV, purchase price in dossier).
  - **City** (for location score and dossier).

- **Rental financials (optional but recommended)**  
  For deal score and underwriting we use:
  - `rentalFinancials.fromLlm.noi` (current NOI)
  - `rentalFinancials.fromLlm.grossRentTotal` (current gross rent)  
  These come from listing/OM extraction or rental API. Without them, score and dossier still run but with fallbacks (e.g. gross rent from NOI × 1.5).

- **Enrichment (optional)**  
  For risk deductions (HPD/DOB), we use `details.enrichment.hpd_violations_summary` and `dob_complaints_summary`. If enrichment hasn’t been run, risk score is not reduced by violations.

---

## 7. File storage (generated dossier/Excel)

- Generated files are written under **`GENERATED_DOCS_PATH`** (default: `uploads/generated-docs` relative to the API process **cwd**).
- The API must have **write** permission to that path (directory is created if missing).
- **Downloads** in the UI and **email attachments** read from these files; if the API is restarted from a different cwd or the path is cleared, old links may 404 until you generate again.
- On **Render** (or similar), use a path that persists (e.g. a mounted volume or a path under a persistent disk), or set `GENERATED_DOCS_PATH` to that path.

---

## 8. Running the app

- **Start API and web**  
  From repo root:
  ```bash
  npm run dev
  ```
  Or run API and web separately (e.g. `npm run dev -w @re-sourcing/api` and same for web).

- **Apply migrations once**  
  ```bash
  npm run db:migrate
  ```
  (with `DATABASE_URL` set in the environment used by the db package, e.g. same as API).

- **Use the flow**  
  1. **Property Data** → ensure you have canonical properties (and optionally run enrichment / rental extraction).  
  2. **Profile** → set email and assumptions.  
  3. **Property Data** → open a property, click **Compute score** if you want an updated score.  
  4. **Dossier** → open with `?property_id=<property-uuid>` (e.g. from a “Dossier” link that includes the id), then **Generate dossier**.  
  5. **Dossier success** → download dossier/Excel; if Gmail is configured and profile email is set, a copy is emailed.

---

## 9. Quick checklist

- [ ] `DATABASE_URL` set for API (and for `db:migrate`)
- [ ] `npm run db:migrate` run so `documents`, `deal_signals`, `user_profile`, `saved_deals` exist
- [ ] `CORS_ORIGIN` includes your web origin
- [ ] Web: `NEXT_PUBLIC_API_URL` points to the API URL
- [ ] Profile: Name, Email (for email), and Assumptions set (or use “Generate standard leverage”)
- [ ] (Optional) Gmail: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` set for dossier email
- [ ] (Optional) `GENERATED_DOCS_PATH` set to a persistent, writable path if needed
- [ ] Properties have linked listings (and optionally rental financials / enrichment) for better scores and dossiers
