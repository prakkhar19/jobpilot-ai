import { Download, KeyRound, Lock, ServerCog, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AuditLogCard } from '@/components/security/AuditLogCard'
import { DeleteAccountDialog } from '@/components/security/DeleteAccountDialog'
import { DiagnosticsPanel } from '@/components/security/DiagnosticsPanel'
import { SessionsCard } from '@/components/security/SessionsCard'
import { Button, Card, CardBody, CardHeader, PageHeader, buttonClasses } from '@/components/ui'
import { systemService } from '@/services/agent'

const NOTES = [
  {
    icon: ServerCog,
    title: 'Your data stays on this server',
    text: 'JobPilot AI is self-hosted. Your resumes, profile, jobs and applications are stored only in this installation’s database and file storage.',
  },
  {
    icon: KeyRound,
    title: 'Keys encrypted at rest',
    text: 'AI provider API keys are encrypted before they are stored and are never sent back to the browser — only the last four characters are shown.',
  },
  {
    icon: Lock,
    title: 'AI calls only to providers you configure',
    text: 'Text is sent to an AI provider only when you configure one and use an AI feature. Without a provider, all features fall back to deterministic processing.',
  },
]

export default function SecurityPage() {
  const [deleteOpen, setDeleteOpen] = useState(false)
  return (
    <div className="space-y-6">
      <PageHeader title="Security & Privacy" description="Sessions, audit trail, your data, and the health of this installation." />

      <div className="grid gap-4 md:grid-cols-3">
        {NOTES.map((n) => (
          <Card key={n.title}>
            <CardBody className="flex gap-3">
              <n.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-fg">{n.title}</h2>
                <p className="mt-1 text-xs text-subtle">{n.text}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Export your data" description="Download a ZIP archive with everything stored for your account." />
          <CardBody>
            <a href={systemService.exportUrl} download className={buttonClasses('outline')}>
              <Download className="h-4 w-4" aria-hidden="true" /> Download export
            </a>
          </CardBody>
        </Card>
        <Card className="border-danger/40">
          <CardHeader title="Delete account" description="Permanently remove your account and all associated data." />
          <CardBody>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account…
            </Button>
          </CardBody>
        </Card>
      </div>

      <SessionsCard />
      <AuditLogCard />
      <DiagnosticsPanel />
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  )
}
