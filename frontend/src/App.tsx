import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from '@/components/RouteGuards'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'))
const OnboardingPage = lazy(() => import('@/pages/onboarding/OnboardingPage'))
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const JobsPage = lazy(() => import('@/pages/jobs/JobsPage'))
const JobDetailPage = lazy(() => import('@/pages/jobs/JobDetailPage'))
const ResumeStudioPage = lazy(() => import('@/pages/resumes/ResumeStudioPage'))
const CoverLetterStudioPage = lazy(() => import('@/pages/cover-letters/CoverLetterStudioPage'))
const ApplicationsPage = lazy(() => import('@/pages/applications/ApplicationsPage'))
const ApplicationDetailPage = lazy(() => import('@/pages/applications/ApplicationDetailPage'))
const InterviewsPage = lazy(() => import('@/pages/interviews/InterviewsPage'))
const AnalyticsPage = lazy(() => import('@/pages/analytics/AnalyticsPage'))
const AgentActivityPage = lazy(() => import('@/pages/agent/AgentActivityPage'))
const IntegrationsPage = lazy(() => import('@/pages/integrations/IntegrationsPage'))
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const SecurityPage = lazy(() => import('@/pages/security/SecurityPage'))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

export default function App() {
  return (
    <Routes>
      <Route
        element={
          <RedirectIfAuthed>
            <AuthLayout />
          </RedirectIfAuthed>
        }
      >
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route element={<AuthLayout />}>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="jobs" element={<JobsPage view="all" />} />
        <Route path="jobs/recommended" element={<JobsPage view="recommended" />} />
        <Route path="jobs/saved" element={<JobsPage view="saved" />} />
        <Route path="jobs/:jobId" element={<JobDetailPage />} />
        <Route path="resumes" element={<ResumeStudioPage />} />
        <Route path="resumes/:versionId" element={<ResumeStudioPage />} />
        <Route path="cover-letters" element={<CoverLetterStudioPage />} />
        <Route path="cover-letters/:letterId" element={<CoverLetterStudioPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="applications/:appId" element={<ApplicationDetailPage />} />
        <Route path="interviews" element={<InterviewsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="agent" element={<AgentActivityPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
