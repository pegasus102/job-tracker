'use client';
import { useState, useEffect } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid';

interface Education { degree: string; institution: string; start_date: string; end_date: string; cgpa: string; }
interface SkillCategory { category: string; items: string; }
interface Project { id: string; title: string; tech_stack: string; bullets: string[]; }
interface Experience { id: string; role: string; company: string; duration: string; bullets: string[]; }
interface Cert { id: string; name: string; issuer: string; date: string; }
interface Extra { id: string; title: string; detail: string; }

interface FixedDetails {
  full_name: string; phone: string; email: string; linkedin: string; github: string; portfolio: string;
  education: Education[];
}

const uid = () => Math.random().toString(36).slice(2, 10);
const TABS = ['Fixed Details', 'Skills', 'Projects', 'Experience', 'Certifications'] as const;

export default function MasterProfileModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<typeof TABS[number]>('Fixed Details');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fixed, setFixed] = useState<FixedDetails>({
    full_name: '', phone: '', email: '', linkedin: '', github: '', portfolio: '', education: [],
  });
  const [skills, setSkills] = useState<SkillCategory[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [experience, setExperience] = useState<Experience[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/master-profile');
        const json = await res.json();
        if (json.success && json.data) {
          setFixed({ full_name: '', phone: '', email: '', linkedin: '', github: '', portfolio: '', education: [], ...json.data.fixed_details });
          setSkills(json.data.master_skills || []);
          setProjects(json.data.master_projects || []);
          setExperience(json.data.master_experience || []);
          setCerts(json.data.master_certifications || []);
          setExtras(json.data.master_extracurriculars || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/master-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fixed_details: fixed,
          master_skills: skills,
          master_projects: projects,
          master_experience: experience,
          master_certifications: certs,
          master_extracurriculars: extras,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      onClose();
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400';
  const labelCls = 'text-xs font-semibold text-slate-600 mb-1 block';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-950">Master Profile / Vault</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><XMarkIcon className="w-5 h-5" /></button>
        </div>

        <div className="flex gap-1 px-5 pt-3 border-b border-slate-200 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg whitespace-nowrap ${tab === t ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-slate-500 text-sm">Loading your vault...</p>
          ) : (
            <>
              {tab === 'Fixed Details' && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">These fields are never edited by AI — they appear on every generated CV exactly as written.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={labelCls}>Full Name</label><input className={inputCls} value={fixed.full_name} onChange={(e) => setFixed({ ...fixed, full_name: e.target.value })} /></div>
                    <div><label className={labelCls}>Phone</label><input className={inputCls} value={fixed.phone} onChange={(e) => setFixed({ ...fixed, phone: e.target.value })} /></div>
                    <div><label className={labelCls}>Email</label><input className={inputCls} value={fixed.email} onChange={(e) => setFixed({ ...fixed, email: e.target.value })} /></div>
                    <div><label className={labelCls}>LinkedIn</label><input className={inputCls} value={fixed.linkedin} onChange={(e) => setFixed({ ...fixed, linkedin: e.target.value })} /></div>
                    <div><label className={labelCls}>GitHub</label><input className={inputCls} value={fixed.github} onChange={(e) => setFixed({ ...fixed, github: e.target.value })} /></div>
                    <div><label className={labelCls}>Portfolio (optional)</label><input className={inputCls} value={fixed.portfolio} onChange={(e) => setFixed({ ...fixed, portfolio: e.target.value })} /></div>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <h3 className="font-bold text-slate-800 text-sm">Education</h3>
                    <button onClick={() => setFixed({ ...fixed, education: [...fixed.education, { degree: '', institution: '', start_date: '', end_date: '', cgpa: '' }] })} className="text-indigo-600 text-xs font-semibold flex items-center gap-1"><PlusIcon className="w-4 h-4" />Add</button>
                  </div>
                  {fixed.education.map((edu, i) => (
                    <div key={i} className="grid grid-cols-5 gap-2 items-end bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div className="col-span-2"><label className={labelCls}>Degree</label><input className={inputCls} value={edu.degree} onChange={(e) => { const arr = [...fixed.education]; arr[i].degree = e.target.value; setFixed({ ...fixed, education: arr }); }} /></div>
                      <div className="col-span-2"><label className={labelCls}>Institution</label><input className={inputCls} value={edu.institution} onChange={(e) => { const arr = [...fixed.education]; arr[i].institution = e.target.value; setFixed({ ...fixed, education: arr }); }} /></div>
                      <button onClick={() => setFixed({ ...fixed, education: fixed.education.filter((_, idx) => idx !== i) })} className="p-2 text-red-500"><TrashIcon className="w-4 h-4" /></button>
                      <div><label className={labelCls}>Start</label><input className={inputCls} value={edu.start_date} onChange={(e) => { const arr = [...fixed.education]; arr[i].start_date = e.target.value; setFixed({ ...fixed, education: arr }); }} /></div>
                      <div><label className={labelCls}>End</label><input className={inputCls} value={edu.end_date} onChange={(e) => { const arr = [...fixed.education]; arr[i].end_date = e.target.value; setFixed({ ...fixed, education: arr }); }} /></div>
                      <div><label className={labelCls}>CGPA</label><input className={inputCls} value={edu.cgpa} onChange={(e) => { const arr = [...fixed.education]; arr[i].cgpa = e.target.value; setFixed({ ...fixed, education: arr }); }} /></div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'Skills' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Group by category (e.g. Languages, Frameworks, Databases). The AI will only ever pick from what you list here, plus a few flagged additions.</p>
                  <button onClick={() => setSkills([...skills, { category: '', items: '' }])} className="text-indigo-600 text-xs font-semibold flex items-center gap-1"><PlusIcon className="w-4 h-4" />Add Category</button>
                  {skills.map((s, i) => (
                    <div key={i} className="grid grid-cols-6 gap-2 items-end bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div><label className={labelCls}>Category</label><input className={inputCls} value={s.category} onChange={(e) => { const arr = [...skills]; arr[i].category = e.target.value; setSkills(arr); }} /></div>
                      <div className="col-span-4"><label className={labelCls}>Skills (comma-separated)</label><input className={inputCls} value={s.items} onChange={(e) => { const arr = [...skills]; arr[i].items = e.target.value; setSkills(arr); }} /></div>
                      <button onClick={() => setSkills(skills.filter((_, idx) => idx !== i))} className="p-2 text-red-500"><TrashIcon className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'Projects' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">The AI can only select and reword projects from this list — it can never invent a new one.</p>
                  <button onClick={() => setProjects([...projects, { id: uid(), title: '', tech_stack: '', bullets: [''] }])} className="text-indigo-600 text-xs font-semibold flex items-center gap-1"><PlusIcon className="w-4 h-4" />Add Project</button>
                  {projects.map((p, i) => (
                    <div key={p.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1"><label className={labelCls}>Title</label><input className={inputCls} value={p.title} onChange={(e) => { const arr = [...projects]; arr[i].title = e.target.value; setProjects(arr); }} /></div>
                        <div className="flex-1"><label className={labelCls}>Tech Stack</label><input className={inputCls} value={p.tech_stack} onChange={(e) => { const arr = [...projects]; arr[i].tech_stack = e.target.value; setProjects(arr); }} /></div>
                        <button onClick={() => setProjects(projects.filter((_, idx) => idx !== i))} className="p-2 text-red-500"><TrashIcon className="w-4 h-4" /></button>
                      </div>
                      <label className={labelCls}>Bullet points (one fact per line — what you built/achieved)</label>
                      <textarea
                        className={`${inputCls} min-h-[80px]`}
                        value={p.bullets.join('\n')}
                        onChange={(e) => { const arr = [...projects]; arr[i].bullets = e.target.value.split('\n'); setProjects(arr); }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {tab === 'Experience' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Internships, freelance, open-source, club leadership — real roles only.</p>
                  <button onClick={() => setExperience([...experience, { id: uid(), role: '', company: '', duration: '', bullets: [''] }])} className="text-indigo-600 text-xs font-semibold flex items-center gap-1"><PlusIcon className="w-4 h-4" />Add Experience</button>
                  {experience.map((exp, i) => (
                    <div key={exp.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1"><label className={labelCls}>Role</label><input className={inputCls} value={exp.role} onChange={(e) => { const arr = [...experience]; arr[i].role = e.target.value; setExperience(arr); }} /></div>
                        <div className="flex-1"><label className={labelCls}>Company</label><input className={inputCls} value={exp.company} onChange={(e) => { const arr = [...experience]; arr[i].company = e.target.value; setExperience(arr); }} /></div>
                        <div className="w-32"><label className={labelCls}>Duration</label><input className={inputCls} value={exp.duration} onChange={(e) => { const arr = [...experience]; arr[i].duration = e.target.value; setExperience(arr); }} /></div>
                        <button onClick={() => setExperience(experience.filter((_, idx) => idx !== i))} className="p-2 text-red-500"><TrashIcon className="w-4 h-4" /></button>
                      </div>
                      <label className={labelCls}>Bullet points</label>
                      <textarea
                        className={`${inputCls} min-h-[80px]`}
                        value={exp.bullets.join('\n')}
                        onChange={(e) => { const arr = [...experience]; arr[i].bullets = e.target.value.split('\n'); setExperience(arr); }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {tab === 'Certifications' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-800 text-sm">Certifications</h3>
                      <button onClick={() => setCerts([...certs, { id: uid(), name: '', issuer: '', date: '' }])} className="text-indigo-600 text-xs font-semibold flex items-center gap-1"><PlusIcon className="w-4 h-4" />Add</button>
                    </div>
                    {certs.map((c, i) => (
                      <div key={c.id} className="grid grid-cols-7 gap-2 items-end bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="col-span-3"><label className={labelCls}>Name</label><input className={inputCls} value={c.name} onChange={(e) => { const arr = [...certs]; arr[i].name = e.target.value; setCerts(arr); }} /></div>
                        <div className="col-span-2"><label className={labelCls}>Issuer</label><input className={inputCls} value={c.issuer} onChange={(e) => { const arr = [...certs]; arr[i].issuer = e.target.value; setCerts(arr); }} /></div>
                        <div><label className={labelCls}>Date</label><input className={inputCls} value={c.date} onChange={(e) => { const arr = [...certs]; arr[i].date = e.target.value; setCerts(arr); }} /></div>
                        <button onClick={() => setCerts(certs.filter((_, idx) => idx !== i))} className="p-2 text-red-500"><TrashIcon className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-800 text-sm">Extracurriculars (rank, hackathons, etc.)</h3>
                      <button onClick={() => setExtras([...extras, { id: uid(), title: '', detail: '' }])} className="text-indigo-600 text-xs font-semibold flex items-center gap-1"><PlusIcon className="w-4 h-4" />Add</button>
                    </div>
                    {extras.map((ex, i) => (
                      <div key={ex.id} className="grid grid-cols-6 gap-2 items-end bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="col-span-2"><label className={labelCls}>Title</label><input className={inputCls} value={ex.title} onChange={(e) => { const arr = [...extras]; arr[i].title = e.target.value; setExtras(arr); }} /></div>
                        <div className="col-span-3"><label className={labelCls}>Detail</label><input className={inputCls} value={ex.detail} onChange={(e) => { const arr = [...extras]; arr[i].detail = e.target.value; setExtras(arr); }} /></div>
                        <button onClick={() => setExtras(extras.filter((_, idx) => idx !== i))} className="p-2 text-red-500"><TrashIcon className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-400">
            {saving ? 'Saving...' : 'Save Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}
