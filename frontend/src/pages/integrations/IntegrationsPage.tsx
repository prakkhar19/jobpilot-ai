import { useSearchParams } from 'react-router-dom'
import { AnswerBankPanel } from '@/components/integrations/AnswerBankPanel'
import { ProvidersPanel } from '@/components/integrations/ProvidersPanel'
import { SourcesPanel } from '@/components/integrations/SourcesPanel'
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'

const TABS = ['ai', 'sources', 'answers'] as const

export default function IntegrationsPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab') as (typeof TABS)[number]) ? (params.get('tab') as string) : 'ai'
  return (
    <div>
      <PageHeader title="Integrations" description="AI providers, job sources and your screening answer bank." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList aria-label="Integration sections">
          <TabsTrigger value="ai">AI providers</TabsTrigger>
          <TabsTrigger value="sources">Job sources</TabsTrigger>
          <TabsTrigger value="answers">Answer bank</TabsTrigger>
        </TabsList>
        <TabsContent value="ai">
          <ProvidersPanel />
        </TabsContent>
        <TabsContent value="sources">
          <SourcesPanel />
        </TabsContent>
        <TabsContent value="answers">
          <AnswerBankPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
