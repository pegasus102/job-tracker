'use client';
import { useState } from 'react';
import { XMarkIcon, SparklesIcon, ArrowDownTrayIcon, LinkIcon } from '@heroicons/react/24/solid';

interface AddedItem { section: string; item: string; justification: string; }
interface ResearchInsights {
  high_priority_skills?: string[];
  common_oa_topics?: string[];
  keyword_notes?: string;
  source_links?: { title: string; url: string }[];
}

interface Props {
  jobId: string;
  companyName: string;
  addedItems: AddedItem[];
  research: ResearchInsights | null;
  onClose: () => void;
}

export default function AuditDrawer({ jobId, companyName, addedItems, research, onClose }: Props) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch('/api/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${companyName || 'Tailored'}_CV.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end">
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-amber-500" />
            Tailoring Audit — {companyName}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><XMarkIcon className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-6">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:bg-slate-400 flex items-center justify-center gap-2"
          >
            <ArrowDownTrayIcon className="w-5 h-5" />
            {downloading ? 'Preparing...' : 'Download Tailored CV (.docx)'}
          </button>

          <div>
            <h3 className="text-sm font-bold text-slate-800 mb-2">AI-Added Items ({addedItems.length})</h3>
            {addedItems.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Nothing was added — the tailored CV uses only items already in your Master Profile.</p>
            ) : (
              <div className="space-y-3">
                {addedItems.map((item, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">{item.section}</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{item.item}</p>
                    <p className="text-xs text-slate-600 mt-1">{item.justification}</p>
                  </div>
                ))}
                <p className="text-[11px] text-slate-400">Review these before submitting — they weren't in your original vault. If you don't actually know a listed skill, remove it or study it first.</p>
              </div>
            )}
          </div>

          {research && (
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-2">Research Insights</h3>
              {research.keyword_notes && <p className="text-xs text-slate-600 mb-2">{research.keyword_notes}</p>}
              {research.high_priority_skills && research.high_priority_skills.length > 0 && (
                <div className="mb-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1">Recruiters seem to prioritize</p>
                  <div className="flex flex-wrap gap-1.5">
                    {research.high_priority_skills.map((s, i) => (
                      <span key={i} className="bg-indigo-50 text-indigo-800 text-xs px-2 py-0.5 rounded-full border border-indigo-100">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {research.common_oa_topics && research.common_oa_topics.length > 0 && (
                <div className="mb-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1">Common OA/interview topics</p>
                  <div className="flex flex-wrap gap-1.5">
                    {research.common_oa_topics.map((s, i) => (
                      <span key={i} className="bg-sky-50 text-sky-800 text-xs px-2 py-0.5 rounded-full border border-sky-100">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {research.source_links && research.source_links.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1">Sources (real, genuine posts — check them yourself)</p>
                  <div className="space-y-1">
                    {research.source_links.map((s, i) => (
                      <a key={i} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-indigo-600 hover:underline">
                        <LinkIcon className="w-3 h-3 flex-shrink-0" /> {s.title}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
