'use client';

import { useMemo, useState } from 'react';

type Job = {
  id: string;
  company_name: string;
  role_offered: string;
  job_description_raw?: string | null;
};

type Stage = 'idle' | 'analyzing' | 'selecting' | 'writing' | 'reviewing' | 'ready' | 'error';

const stages: Array<{ key: Exclude<Stage, 'idle' | 'error'>; label: string }> = [
  { key: 'analyzing', label: 'Analyze JD' },
  { key: 'selecting', label: 'Select evidence' },
  { key: 'writing', label: 'Write CV' },
  { key: 'reviewing', label: 'Review fit' },
  { key: 'ready', label: 'Ready' },
];

const demoProjects = ['Order API', 'Edge Service', 'Dashboard'];
const addedSkills = ['Event-driven architecture', 'OpenTelemetry'];

const enabled = process.env.NEXT_PUBLIC_ENABLE_CV_V2 === 'true';

export default function CvV2Panel({ job }: { job: Job }) {
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const [poorJd, setPoorJd] = useState('');
  const [projects, setProjects] = useState(demoProjects);
  const [approvedSkills, setApprovedSkills] = useState<string[]>([]);
  const [downloaded, setDownloaded] = useState(false);

  const quality = useMemo(() => {
    const text = poorJd || job.job_description_raw || '';
    return text.trim().length < 400;
  }, [job.job_description_raw, poorJd]);

  if (!enabled) return null;

  const start = async () => {
    setError('');
    setStage('analyzing');
    try {
      const response = await fetch('/api/cv-v2/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: job.company_name,
          role: job.role_offered,
          jobDescription: poorJd || job.job_description_raw || '',
        }),
      });
      if (response.status === 404) {
        setStage('error');
        setError('CV v2 is not enabled on the server');
        return;
      }
      if (!response.ok) {
        setStage('error');
        setError('CV v2 analysis failed.');
        return;
      }
    } catch {
      setStage('error');
      setError('CV v2 analysis could not reach the server.');
      return;
    }
    window.setTimeout(() => setStage('selecting'), 350);
    window.setTimeout(() => setStage('writing'), 700);
    window.setTimeout(() => setStage('reviewing'), 1050);
    window.setTimeout(() => setStage('ready'), 1400);
  };

  const retry = () => {
    setStage('idle');
    setError('');
    void start();
  };

  const swapProject = (index: number) => {
    const next = [...projects];
    next[index] = demoProjects[(demoProjects.indexOf(next[index]) + 1) % demoProjects.length];
    setProjects(next);
  };

  const downloadDocx = async () => {
    setDownloaded(false);
    try {
      const response = await fetch('/api/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.id }),
      });
      if (!response.ok) throw new Error('DOCX is not available yet.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${job.company_name}-CV.docx`;
      link.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Download failed.');
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50/50 p-5 sm:p-7" aria-label="CV v2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">CV v2 preview</p>
          <h2 className="mt-1 text-xl font-extrabold text-slate-950">{job.role_offered} at {job.company_name}</h2>
          <p className="mt-1 text-sm text-slate-600">Evidence-grounded generation. This preview makes no model calls.</p>
        </div>
        {stage === 'idle' && (
          <button onClick={start} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-indigo-700">
            Generate CV v2
          </button>
        )}
      </div>

      {stage === 'idle' && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-900">No CV v2 run yet</p>
          <p>Start a run to see the analysis, evidence, fit review, and approvals.</p>
        </div>
      )}

      {stage !== 'idle' && (
        <>
          <ol className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {stages.map((item) => {
              const current = stages.findIndex((entry) => entry.key === stage);
              const index = stages.findIndex((entry) => entry.key === item.key);
              const done = current >= index && stage !== 'error';
              return (
                <li key={item.key} className={`rounded-xl border p-3 text-xs font-bold ${done ? 'border-indigo-300 bg-white text-indigo-700' : 'border-slate-200 bg-slate-100 text-slate-400'}`}>
                  <span className="mr-1">{done ? '✓' : index + 1}.</span>{item.label}
                </li>
              );
            })}
          </ol>

          {stage === 'error' && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-bold">CV v2 could not finish</p><p>{error || 'The run failed before review.'}</p>
              <button onClick={retry} className="mt-3 rounded-lg bg-red-700 px-3 py-2 font-bold text-white">Retry</button>
            </div>
          )}

          {stage !== 'error' && stage !== 'ready' && (
            <p className="mt-4 text-sm font-semibold text-indigo-700" role="status">Working through {stages.find((item) => item.key === stage)?.label}…</p>
          )}

          {stage === 'ready' && (
            <div className="mt-5 space-y-4">
              {quality && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-bold">Job description needs review</p>
                  <p className="mt-1">Paste a fuller description below; the current JD has too little technical signal.</p>
                  <textarea value={poorJd} onChange={(event) => setPoorJd(event.target.value)} placeholder="Paste the job description here…" className="mt-3 min-h-28 w-full rounded-xl border border-amber-300 bg-white p-3 text-sm" />
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-bold text-slate-950">Selected projects</h3>
                  {projects.map((project, index) => (
                    <div key={`${project}-${index}`} className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
                      <span className="font-semibold">{project}</span>
                      <button onClick={() => swapProject(index)} className="text-xs font-bold text-indigo-700 hover:underline">Swap</button>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-bold text-slate-950">Added skills need approval</h3>
                  <p className="mt-1 text-xs text-slate-500">Unchecked skills are excluded from the CV.</p>
                  {addedSkills.map((skill) => (
                    <label key={skill} className="mt-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={approvedSkills.includes(skill)} onChange={(event) => setApprovedSkills((current) => event.target.checked ? [...current, skill] : current.filter((item) => item !== skill))} />
                      {skill}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-bold">Warnings & sanitizations</p>
                <p className="mt-1">One qualifier was preserved; unsupported or invented claims were removed.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <p className="font-bold text-slate-950">Critic review & ATS prompt</p>
                <p className="mt-1 text-slate-600">Fit estimate: <strong>82%</strong>. Ask the critic to check evidence, specificity, and missing must-haves before exporting.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => { setStage('error'); setError('Critic found a high-severity issue.'); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold hover:bg-slate-50">Run critic again</button>
                  <button onClick={downloadDocx} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700">Download DOCX</button>
                  {downloaded && <span className="py-2 text-xs font-semibold text-emerald-700">Downloaded</span>}
                </div>
                {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
