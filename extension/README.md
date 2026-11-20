# JobPilot Auto-Apply (Chrome extension)

Applies to matching jobs on its own, in your own Chrome:

| Where | What it does |
|---|---|
| **LinkedIn** | Searches your roles × locations (+ remote), last 24h, Easy Apply only → scores each job → uploads a resume tailored to that job → answers every step → submits |
| **Naukri** | Searches your roles (+ work-from-home) → applies → answers the recruiter questionnaire |
| **Instahyre** | Goes through your matching opportunities → applies to the good ones |
| **Company career pages** | Greenhouse, Lever, Ashby, Workable, SmartRecruiters jobs that JobPilot discovered → fills the form, uploads the tailored resume, submits |
| **LinkedIn outreach** | After applying, sends a short personal connection note to 1–2 recruiters/people at that company |

When a job has a **CAPTCHA** or a question only you can answer (salary, notice period…), it skips it (LinkedIn/Naukri) or
leaves the filled-in tab open for you (company pages), and lists it under **Needs you** in the popup. Answer there
once — it's saved and used on every future application.

## Setup (5 minutes)

1. Run JobPilot (`docker compose up -d` in the repo root) and open http://localhost:8080.
   * Upload your resume and **approve** your profile.
   * **Agent settings**: set *Target roles* (e.g. "Backend Engineer", "Full Stack Developer"), *Locations*
     (e.g. Bengaluru, Pune), country *India*, workplace types, and the *Minimum match score* (start at 55–60).
   * Optional: add an AI provider (free Groq/Gemini key) for much better tailored resumes and answers.
   * Profile → *Application facts*: add Notice period, Expected CTC, Current CTC, Work authorization, Willing to relocate.
     Most "needs you" questions come from these.
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this `extension/` folder.
3. Log in to **LinkedIn, Naukri and Instahyre** in that same Chrome.
4. Click the extension icon → log in with your JobPilot email/password → **Start auto-apply**.

Leave Chrome open. It works in a background tab, one job at a time, at a human pace, runs a new cycle every hour,
and stops for the day at your daily cap (popup → Settings).

## Notes

* It only acts in the tab it opened itself — your normal browsing on LinkedIn/Naukri is never touched.
* Every application, resume version and connection request is recorded in JobPilot → Applications.
* Site layouts change. If a site stops working, the popup's Activity log says where it stopped; the selectors live in
  `content/<site>.js`.
