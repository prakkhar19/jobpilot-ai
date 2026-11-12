// Hand-written from docs/openapi.json and the backend sources for untyped endpoints.

export type ISODate = string

// ---------------------------------------------------------------- auth
export type UserRole = 'admin' | 'user' | string

export interface User {
  id: string
  email: string
  full_name: string
  role: UserRole
  onboarding_completed: boolean
  created_at: ISODate
  last_login_at: ISODate | null
}

export interface AuthStatus {
  user: User | null
  csrf_token?: string | null
  registration_open: boolean
  single_user_mode: boolean
  demo_mode: boolean
}

export interface SessionInfo {
  id: string
  created_at: ISODate
  last_seen_at: ISODate
  expires_at: ISODate
  ip_address: string
  user_agent: string
  current?: boolean
}

export interface AuditEntry {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  ip_address: string | null
  data: Record<string, unknown> | null
  created_at: ISODate
}

export interface AdminUser {
  id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  created_at: ISODate
  last_login_at: ISODate | null
}

// ---------------------------------------------------------------- profiles & resumes
export interface MasterResume {
  id: string
  label: string
  original_filename: string
  mime_type: string
  size_bytes: number
  sha256: string
  created_at: ISODate
  text_preview?: string
}

export interface Education {
  institution: string
  degree: string
  field_of_study: string
  start_date: string
  end_date: string
  grade: string
  details: string
}

export interface Experience {
  company: string
  title: string
  location: string
  start_date: string
  end_date: string
  is_current: boolean
  bullets: string[]
  technologies: string[]
}

export interface Skill {
  name: string
  category: string
}

export interface Project {
  name: string
  description: string
  bullets: string[]
  technologies: string[]
  url: string
  start_date: string
  end_date: string
}

export interface Certification {
  name: string
  issuer: string
  issue_date: string
  credential_url: string
}

export interface ProfileData {
  label: string
  full_name: string
  email: string
  phone: string
  location: string
  linkedin_url: string
  github_url: string
  portfolio_url: string
  headline: string
  summary: string
  motivation: string
  achievements: string[]
  publications: string[]
  spoken_languages: string[]
  application_facts: Record<string, string>
  educations: Education[]
  experiences: Experience[]
  skills: Skill[]
  projects: Project[]
  certifications: Certification[]
}

export type ProfileStatus = 'draft' | 'approved' | string

export interface Profile extends ProfileData {
  id: string
  status: ProfileStatus
  is_active: boolean
  version: number
  approved_at: ISODate | null
  parse_method: string
  parse_warnings: string[]
  master_resume_id: string | null
  created_at: ISODate
  updated_at: ISODate
}

export interface ProfileSummary {
  id: string
  label: string
  full_name: string
  status: ProfileStatus
  is_active: boolean
  version: number
  parse_method: string
  master_resume_id: string | null
  updated_at: ISODate
}

export interface UploadResult {
  resume: MasterResume
  profile: Profile
}

// ---------------------------------------------------------------- AI providers
export type AIProviderKind = 'openai_compatible' | 'anthropic'

export interface AIProviderInput {
  name: string
  provider: AIProviderKind
  base_url?: string
  model: string
  embedding_model?: string
  api_key?: string | null
  temperature?: number
  max_tokens?: number
  timeout_seconds?: number
  is_default?: boolean
  is_fallback?: boolean
  enabled?: boolean
  input_price_per_mtok?: number | null
  output_price_per_mtok?: number | null
}

export interface AIProvider {
  id: string
  name: string
  provider: AIProviderKind | string
  base_url: string
  model: string
  embedding_model: string
  has_api_key?: boolean
  api_key_last4: string
  temperature: number
  max_tokens: number
  timeout_seconds: number
  is_default: boolean
  is_fallback: boolean
  enabled: boolean
  input_price_per_mtok: number | null
  output_price_per_mtok: number | null
  total_requests: number
  total_input_tokens: number
  total_output_tokens: number
  total_errors: number
  estimated_cost_usd?: number | null
  last_error: string
  last_used_at: ISODate | null
  created_at: ISODate
}

export interface AITestResult {
  ok: boolean
  message: string
  latency_ms?: number | null
  model?: string | null
}

export interface AIProviderCatalogEntry {
  label: string
  requires_key: boolean
  default_base_url: string
  examples: { name: string; base_url: string; model: string }[]
}

export type AIProviderCatalog = Record<string, AIProviderCatalogEntry>

// ---------------------------------------------------------------- sources & jobs
export type SourceKind =
  | 'directory'
  | 'adzuna'
  | 'email_alerts'
  | 'remotive'
  | 'arbeitnow'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'career_page'
  | 'demo'

export interface CredentialField {
  key: string
  label: string
  secret: boolean
}

export interface SourceInput {
  kind: SourceKind
  identifier: string
  display_name?: string
  enabled?: boolean
  credentials?: Record<string, string>
}

export interface JobSource {
  id: string
  kind: SourceKind | string
  identifier: string
  display_name: string
  enabled: boolean
  last_checked_at: ISODate | null
  last_status: string
  last_error: string
  jobs_found: number
  created_at: ISODate
  has_credentials?: boolean
}

export interface SourceCatalog {
  supported: {
    kind: SourceKind
    label: string
    description: string
    identifier_help: string
    identifier_default?: string
    credential_fields?: CredentialField[]
    min_interval_minutes?: number
    attribution?: string
  }[]
  unsupported: { platform: string; reason: string }[]
}

export interface SourceTestResult {
  ok: boolean
  message: string
  job_count?: number | null
}

export type WorkplaceType = 'remote' | 'hybrid' | 'onsite' | 'unknown'
export type Recommendation = 'strong_match' | 'good_match' | 'consider' | 'weak_match'

export interface Job {
  id: string
  source_kind: string
  source_id: string | null
  company: string
  title: string
  location: string
  workplace_type: WorkplaceType | string
  employment_type: string
  seniority: string
  department: string
  salary_min: number | null
  salary_max: number | null
  salary_currency: string
  salary_text: string
  posted_at: ISODate | null
  application_url: string
  posting_url: string
  discovered_at: ISODate
  last_verified_at: ISODate | null
  status: string
  is_demo: boolean
  hidden: boolean
  duplicate_of_id: string | null
  official_url?: string
  official_source?: string
  official_checked_at?: ISODate | null
  match_score?: number | null
  recommendation?: Recommendation | string | null
  saved?: boolean
  application_status?: string | null
  application_id?: string | null
}

export interface Requirement {
  kind: string
  text: string
  skill_name: string
  is_mandatory: boolean
  value_num: number | null
}

export type ComponentStatus = 'scored' | 'unknown' | 'not_applicable'

export interface MatchComponent {
  key: string
  label: string
  score: number | null
  weight: number
  status: ComponentStatus
  detail: string
  matched: string[]
  missing: string[]
}

/** The backend appends a pseudo-component {key: "_confidence", value} to the list. */
export interface ConfidenceEntry {
  key: '_confidence'
  value: number
}

export interface Match {
  overall_score: number
  recommendation: Recommendation | string
  components: (MatchComponent | ConfidenceEntry)[]
  strengths: string[]
  gaps: string[]
  unknowns: string[]
  weights: Record<string, number>
  llm_summary: string
  similarity_method: string
  computed_at: ISODate
  profile_version: number
}

export interface JobDetail extends Job {
  description_text: string
  requirements: Requirement[]
  match: Match | null
}

export interface JobPage {
  items: Job[]
  total: number
  page: number
  page_size: number
}

export type JobView = 'all' | 'recommended' | 'saved' | 'hidden' | 'expired'
export type JobSort = 'score' | 'newest' | 'company' | 'title'

export interface JobQuery {
  view?: JobView
  q?: string
  source_kind?: string
  workplace_type?: string
  min_score?: number | null
  sort?: JobSort
  page?: number
  page_size?: number
}

export interface ImportManualInput {
  title: string
  company: string
  description: string
  location?: string
  url?: string
  workplace_type?: WorkplaceType
  employment_type?: string
}

// ---------------------------------------------------------------- documents
export interface ResumeTemplate {
  key: string
  name: string
  description: string
}

export interface ResumeTemplatesResponse {
  templates: ResumeTemplate[]
  target_roles: string[]
}

export interface ResumeHeader {
  full_name?: string
  email?: string
  phone?: string
  location?: string
  linkedin_url?: string
  github_url?: string
  portfolio_url?: string
  headline?: string
}

export interface ResumeContent {
  header: ResumeHeader
  summary: string
  skills: { category: string; items: string[] }[]
  experiences: { company: string; title: string; location: string; dates: string; bullets: string[] }[]
  projects?: { name: string; description: string; url: string; technologies: string[]; bullets: string[] }[]
  education?: { institution: string; degree: string; field_of_study: string; dates: string; grade: string }[]
  certifications?: { name: string; issuer: string; date: string }[]
  achievements?: string[]
  publications?: string[]
  target_role?: string
  job?: { company: string; title: string } | null
  keyword_report?: KeywordReport | Record<string, never>
  [key: string]: unknown
}

export interface KeywordReport {
  job_skills: string[]
  covered: string[]
  not_in_profile: string[]
  note: string
}

export interface ChangeLogEntry {
  section: string
  type: string
  detail?: string
  item?: string
  before?: string
  after?: string
}

export interface FactCheckRejection {
  section: string
  text: string
  original?: string
  reasons: string[]
}

export interface ResumeFactCheck {
  checked?: number
  accepted?: number
  rejected?: number
  rejections?: FactCheckRejection[]
  final_check?: { ok: boolean; notes: string[] }
}

export interface ResumeVersionSummary {
  id: string
  job_id: string | null
  profile_id: string | null
  parent_version_id: string | null
  version_number: number
  label: string
  target_role: string
  template: string
  generation_method: string
  provider: string
  model: string
  created_at: ISODate
}

export interface ResumeVersion extends ResumeVersionSummary {
  content: ResumeContent
  change_log: ChangeLogEntry[]
  fact_check: ResumeFactCheck
}

export interface ResumeCompare {
  original: ResumeContent
  tailored: ResumeContent
  change_log: ChangeLogEntry[]
}

export interface ResumeGenerateInput {
  job_id?: string | null
  template?: string
  target_role?: string
  use_llm?: boolean
}

export interface CoverLetterFactCheck {
  removed_sentences?: string[]
  note?: string
}

export interface CoverLetter {
  id: string
  job_id: string | null
  version_number: number
  content: string
  generation_method: string
  provider: string
  model: string
  fact_check: CoverLetterFactCheck
  edited_by_user: boolean
  created_at: ISODate
  updated_at: ISODate
}

// ---------------------------------------------------------------- applications
export type ApplicationMode = 'review' | 'assisted' | 'authorized'

export interface FormField {
  name: string
  label: string
  type: string
  required: boolean
  options: string[]
  kind: string
}

export type AnswerSource = 'profile' | 'facts' | 'answer_bank' | 'user' | 'document' | string

export interface FieldAnswer {
  value: string
  source: AnswerSource
}

export interface ProviderCapabilities {
  key?: string
  label?: string
  inspection?: boolean
  assisted_fill?: boolean
  automated_submit?: boolean
  note?: string
}

export interface Application {
  id: string
  job_id: string
  status: string
  mode: ApplicationMode | string
  provider: string
  resume_version_id: string | null
  cover_letter_id: string | null
  match_score: number | null
  form_fields: FormField[]
  answers: Record<string, FieldAnswer>
  missing_fields: FormField[]
  preparation_screenshot: string
  approved_at: ISODate | null
  submitted_at: ISODate | null
  submitted_by: string
  confirmation_text: string
  confirmation_screenshot: string
  submit_attempts: number
  last_error: string
  notes: string
  follow_up_date: string | null
  busy: boolean
  created_at: ISODate
  updated_at: ISODate
  company?: string
  job_title?: string
  job_url?: string
  source_kind?: string
  is_demo?: boolean
  provider_capabilities?: ProviderCapabilities
}

export interface ApplicationPage {
  items: Application[]
  total: number
  page: number
  page_size: number
}

export interface ApplicationStatuses {
  statuses: { key: string; label: string }[]
  manual: string[]
  providers: ProviderCapabilities[]
}

export interface ApplicationEvent {
  id: string
  event_type: string
  from_status: string
  to_status: string
  actor: string
  message: string
  data: Record<string, unknown>
  created_at: ISODate
}

export interface ApplicationUpdate {
  notes?: string | null
  follow_up_date?: string | null
  clear_follow_up?: boolean
  resume_version_id?: string | null
  cover_letter_id?: string | null
}

export type InterviewKind =
  | 'phone_screen'
  | 'technical'
  | 'system_design'
  | 'behavioral'
  | 'onsite'
  | 'hr'
  | 'final'
  | 'other'
export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled'

export interface InterviewInput {
  application_id: string
  scheduled_at?: string | null
  kind?: InterviewKind
  location?: string
  interviewers?: string
  status?: InterviewStatus
  outcome?: string
  notes?: string
}

export interface Interview extends Required<Omit<InterviewInput, 'scheduled_at'>> {
  id: string
  scheduled_at: string | null
  created_at: ISODate
  company?: string
  job_title?: string
}

export interface ScreeningAnswer {
  id: string
  question_key: string
  question_text: string
  answer: string
  updated_at: ISODate
}

// ---------------------------------------------------------------- agent
export type WorkplacePref = 'remote' | 'hybrid' | 'onsite'
export type ExperienceLevel = 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'staff' | 'principal'

export interface AgentConfigInput {
  enabled: boolean
  frequency_minutes: number
  alert_on_new_matches: boolean
  email_alerts: boolean
  run_days: number[]
  window_start_hour: number
  window_end_hour: number
  timezone: string
  target_roles: string[]
  keywords: string[]
  excluded_keywords: string[]
  locations: string[]
  countries: string[]
  workplace_types: WorkplacePref[]
  experience_levels: ExperienceLevel[]
  employment_types: string[]
  salary_min: number | null
  include_companies: string[]
  exclude_companies: string[]
  industries: string[]
  required_technologies: string[]
  posted_within_days: number | null
  min_match_score: number
  daily_discovery_limit: number
  max_preparations_per_day: number
  auto_generate_documents: boolean
  auto_prepare_applications: boolean
  application_mode: ApplicationMode
  acknowledge_authorized_automation?: boolean
  matching_weights: Record<string, number>
  resume_template: string
  use_llm: boolean
}

export interface AgentConfig extends AgentConfigInput {
  paused: boolean
  authorized_automation_ack_at: ISODate | null
  last_run_at: ISODate | null
  next_run_at: ISODate | null
  effective_weights: Record<string, number>
}

export type TaskState =
  | 'IDLE'
  | 'DISCOVERING'
  | 'ANALYZING'
  | 'MATCHING'
  | 'GENERATING_RESUME'
  | 'PREPARING_APPLICATION'
  | 'SUBMITTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PAUSED'
  | 'CANCELLED'
  | 'AWAITING_APPROVAL'

export interface AgentTask {
  id: string
  kind: string
  trigger: string
  state: TaskState | string
  cancel_requested: boolean
  attempt: number
  stats: Record<string, unknown>
  error: string
  created_at: ISODate
  started_at: ISODate | null
  finished_at: ISODate | null
  heartbeat_at: ISODate | null
}

export interface AgentLog {
  id: string
  task_id: string
  level: string
  step: string
  message: string
  data: Record<string, unknown>
  created_at: ISODate
}

export interface Notification {
  id: string
  kind: string
  title: string
  body: string
  link: string
  read_at: ISODate | null
  created_at: ISODate
}

export interface NotificationList {
  items: Notification[]
  unread: number
}

// ---------------------------------------------------------------- analytics
export interface AnalyticsTotals {
  jobs_discovered: number
  active_jobs: number
  qualified: number
  shortlisted: number
  prepared: number
  pending_approval: number
  submitted: number
  interviews: number
  rejections: number
  offers: number
  response_rate: number | null
  interview_rate: number | null
  threshold: number
}

export interface BreakdownRow {
  key: string
  applications: number
  submitted: number
  responses: number
  interviews: number
  offers: number
  response_rate: number | null
  interview_rate: number | null
}

export interface AnalyticsSummary {
  totals: AnalyticsTotals
  funnel: { stage: string; count: number }[]
  weekly: { week: string; discovered: number; submitted: number; interviews: number }[]
  status_counts: Record<string, number>
  by_source: BreakdownRow[]
  by_role: BreakdownRow[]
  by_company: BreakdownRow[]
  by_resume: BreakdownRow[]
  insights: string[]
  disclaimer: string
}

export interface WeeklyReport {
  since: ISODate
  discovered: number
  submitted: number
  responses: number
  pending: number
  text: string
}

// ---------------------------------------------------------------- diagnostics
export interface HeartbeatCheck {
  status: 'ok' | 'stale' | 'unknown' | string
  last_seen_at: ISODate | null
  age_seconds?: number
}

export interface Diagnostics {
  version: string
  environment: string
  python: string
  checks: {
    database?: { status: string; detail?: string }
    redis?: { status: string; detail?: string }
    worker?: HeartbeatCheck
    scheduler?: HeartbeatCheck
    [key: string]: { status: string; detail?: string; last_seen_at?: ISODate | null; age_seconds?: number } | undefined
  }
  connectors: {
    id: string
    kind: string
    name: string
    enabled: boolean
    last_status: string
    last_error: string
    last_checked_at: ISODate | null
  }[]
  ai_providers: {
    id: string
    name: string
    provider: string
    model: string
    enabled: boolean
    errors: number
    last_error: string
  }[]
  recent_failures: { id: string; error: string; created_at: ISODate }[]
  application_providers: ProviderCapabilities[]
  unsupported_platforms: { platform: string; reason: string }[]
  settings: {
    demo_mode: boolean
    single_user_mode: boolean
    registration: boolean
    cookie_secure: boolean
    max_upload_mb: number
  }
}
