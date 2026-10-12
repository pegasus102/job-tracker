import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import { readCandidateVault, type VaultFact } from '@/lib/cv-v2/vault';
import { vaultReviewEnabled } from '@/lib/cv-v2/vault-review';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function VaultReviewPage() {
  if (!vaultReviewEnabled(process.env.ENABLE_VAULT_REVIEW)) {
    notFound();
  }
  const vault = await readCandidateVault(async () => {
    const { data, error } = await supabase
      .from('user_master_profile')
      .select('master_projects, master_experience, master_skills')
      .limit(1)
      .single();

    if (error) throw new Error(`Unable to load the master profile: ${error.message}`);
    return data ?? {};
  });

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900 md:p-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <h1 className="text-3xl font-bold">Evidence Vault Review</h1>
          <p className="mt-2 text-sm text-slate-600">
            Read-only facts derived from the existing master profile; edit source entries in the Master Profile modal.
          </p>
        </header>

        <Section title="Projects">
          {vault.projects.length === 0 ? <EmptyState /> : vault.projects.map((entry) => (
            <EntryCard
              key={entry.id}
              title={entry.title || entry.id}
              subtitle={entry.tools.join(', ') || 'No tools recorded'}
              facts={entry.facts}
            />
          ))}
        </Section>

        <Section title="Experience">
          {vault.experience.length === 0 ? <EmptyState /> : vault.experience.map((entry) => (
            <EntryCard
              key={entry.id}
              title={`${entry.role || entry.id}${entry.company ? ` — ${entry.company}` : ''}`}
              subtitle={entry.duration || 'No duration recorded'}
              facts={entry.facts}
            />
          ))}
        </Section>

        <Section title="Skills">
          {vault.skills.length === 0 ? <EmptyState /> : vault.skills.map((skill) => (
            <div key={`${skill.category}:${skill.items}`} className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-semibold">{skill.category || 'Uncategorized'}</h3>
              <p className="mt-1 text-sm text-slate-600">{skill.items || 'No skills listed'}</p>
            </div>
          ))}
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function EntryCard({ title, subtitle, facts }: { title: string; subtitle: string; facts: VaultFact[] }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold">{title}</h3>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-4 space-y-3">
        {facts.length === 0 ? <EmptyState /> : facts.map((fact) => (
          <div key={fact.id} className="border-l-2 border-indigo-200 pl-3">
            <p className="text-sm">{fact.text}</p>
            <p className="mt-1 text-xs text-slate-500">
              <span className="font-semibold">ID:</span> {fact.id}
              {' · '}<span className="font-semibold">Tools:</span> {fact.tools.join(', ') || 'None'}
              {' · '}<span className="font-semibold">Numbers:</span> {fact.numbers.join(', ') || 'None'}
            </p>
            {fact.warnings.map((warning) => (
              <p key={`${fact.id}:${warning}`} className="mt-1 text-xs font-medium text-amber-700">
                Warning: {warning}
              </p>
            ))}
          </div>
        ))}
      </div>
    </article>
  );
}

function EmptyState() {
  return <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-500">No entries found.</p>;
}
