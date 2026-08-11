'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { differenceInDays, parseISO } from 'date-fns';
import { PlusIcon, LinkIcon, MapPinIcon, BriefcaseIcon, ClockIcon, ExclamationTriangleIcon, AcademicCapIcon, BoltIcon, CalendarDaysIcon, CheckCircleIcon, TrashIcon } from '@heroicons/react/24/solid';

// 1. Database Interface
interface Job {
  id: string;
  company_name: string;
  role_offered: string;
  package: string;
  location: string;
  required_skills: string;
  deadline: string | null;
  apply_link: string;
  status: 'Wishlist' | 'Applied' | 'Assessment' | 'Interview' | 'Rejected' | 'Expired';
  created_at: string;
  date_found: string | null;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Dashboard() {
  const [url, setUrl] = useState<string>('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<string>('');

  useEffect(() => {
    fetchJobs();
    const savedLockout = localStorage.getItem('api_lockout_time');
    if (savedLockout) {
      setLockoutUntil(parseInt(savedLockout, 10));
    }
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (lockoutUntil) {
      interval = setInterval(() => {
        const now = new Date().getTime();
        const distance = lockoutUntil - now;

        if (distance <= 0) {
          clearInterval(interval);
          setLockoutUntil(null);
          setCountdown('');
          localStorage.removeItem('api_lockout_time');
        } else {
          const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((distance % (1000 * 60)) / 1000);
          setCountdown(`${minutes}m ${seconds}s`);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const fetchJobs = async () => {
    const { data } = await supabase
      .from('job_applications')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setJobs(data as Job[]);
  };

  const handleAddJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (res.status === 429) {
        const lockoutTime = new Date().getTime() + (30 * 60 * 1000); 
        setLockoutUntil(lockoutTime);
        localStorage.setItem('api_lockout_time', lockoutTime.toString());
        return; 
      }

      if (res.ok) {
        setUrl('');
        fetchJobs();
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error || 'Failed to fetch job'}`);
      }
    } catch (error) {
      alert("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this job posting?")) return;
    
    await supabase.from('job_applications').delete().eq('id', id);
    setJobs(jobs.filter(job => job.id !== id));
  };

  // ADDED: Function to toggle the "Applied" status when the checkbox is clicked
  const toggleAppliedStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Applied' ? 'Wishlist' : 'Applied';
    
    // Update the UI immediately for a snappy feel
    setJobs(jobs.map(job => job.id === id ? { ...job, status: newStatus } : job));

    // Update Supabase in the background
    const { error } = await supabase
      .from('job_applications')
      .update({ status: newStatus })
      .eq('id', id);

    if (error) {
      alert("Failed to update status. Please try again.");
      fetchJobs(); // Refresh if there is a database error
    }
  };

  const getDeadlineAlertProps = (deadlineDate: string | null) => {
    if (!deadlineDate) return { text: 'N/D', badgeClass: 'bg-zinc-100 text-zinc-700', rowClass: 'bg-white' };
    
    const daysLeft = differenceInDays(parseISO(deadlineDate), new Date());
    
    if (daysLeft < 0) return { 
      text: 'Expired', 
      badgeClass: 'bg-slate-200 text-slate-700', 
      rowClass: 'bg-slate-50 text-slate-500 border-slate-200' 
    }; 
    if (daysLeft <= 2) return { 
      text: `${daysLeft === 0 ? 'Today' : `${daysLeft} days left`}`, 
      badgeClass: 'bg-red-100 text-red-800 border border-red-200', 
      rowClass: 'bg-red-50' 
    }; 
    if (daysLeft <= 7) return { 
      text: `${daysLeft} days left`, 
      badgeClass: 'bg-amber-100 text-amber-900 border border-amber-200', 
      rowClass: 'bg-amber-50' 
    }; 
    return { 
      text: `${daysLeft} days left`, 
      badgeClass: 'bg-emerald-100 text-emerald-900 border border-emerald-200', 
      rowClass: 'bg-emerald-50' 
    }; 
  };

  const statCount = (status: Job['status']) => jobs.filter(j => j.status === status).length;

  return (
    <div className="p-6 md:p-10 min-h-screen bg-slate-50 text-slate-900 font-sans" suppressHydrationWarning>
      
      {/* --- HEADER --- */}
      <div className="flex items-center justify-between mb-10 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-950 flex items-center gap-2">
            <AcademicCapIcon className="w-8 h-8 text-indigo-600" />
            Off-Campus Placement Hub
          </h1>
          <p className="text-slate-600 mt-1">Keep track of every application link and deadline, automated.</p>
        </div>
        <div className="bg-white p-3 rounded-2xl shadow-inner border border-slate-200 text-center">
            <p className="text-sm text-slate-500 font-medium">Synced Database</p>
            <p className="text-2xl font-bold text-indigo-700">{jobs.length} <span className="text-lg font-medium text-slate-500">Opportunities</span></p>
        </div>
      </div>

      {/* --- QUICK STATS --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        {[
            // FIXED: 'Applied Total' now uses statCount('Applied') instead of jobs.length
            {label: 'Applied Total', value: statCount('Applied'), icon: BriefcaseIcon, color: 'text-indigo-600'},
            {label: 'Assessment Pending', value: statCount('Assessment'), icon: BoltIcon, color: 'text-amber-600'},
            {label: 'Active Interviews', value: statCount('Interview'), icon: CalendarDaysIcon, color: 'text-sky-600'},
            {label: 'Deadlines Over', value: statCount('Expired') + jobs.filter(j => j.deadline && differenceInDays(parseISO(j.deadline), new Date()) < 0).length, icon: ExclamationTriangleIcon, color: 'text-red-600'}
        ].map(stat => (
            <div key={stat.label} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex items-start gap-4">
                <stat.icon className={`w-12 h-12 p-3 bg-slate-100 rounded-xl ${stat.color}`} />
                <div>
                    <p className="text-4xl font-extrabold text-slate-950">{stat.value}</p>
                    <p className="text-sm font-semibold text-slate-600 mt-1">{stat.label}</p>
                </div>
            </div>
        ))}
      </div>
      
      {/* --- INPUT CARD --- */}
      <div className="bg-white p-8 rounded-3xl shadow-lg shadow-slate-100 border border-slate-200 mb-10">
        <h2 className="text-xl font-bold mb-5 text-slate-950 flex items-center gap-2">
          <LinkIcon className="w-6 h-6 text-indigo-500" />
          Add New Placement Link
        </h2>
        
        <form onSubmit={handleAddJob} className="flex flex-col gap-4" suppressHydrationWarning>
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input 
                type="url" 
                required
                placeholder="https://company.careers.com/job/software-engineer..." 
                className="w-full pl-12 pr-4 py-4 border border-slate-300 rounded-2xl shadow-inner bg-slate-50 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition disabled:bg-slate-200 disabled:cursor-not-allowed text-slate-950"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={lockoutUntil !== null} 
              />
            </div>
            <button 
              type="submit" 
              disabled={loading || lockoutUntil !== null} 
              className="w-full md:w-auto bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 whitespace-nowrap shadow-lg shadow-indigo-100 active:scale-95"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </>
              ) : lockoutUntil ? 'API Limited' : (
                <>
                  <PlusIcon className="w-5 h-5" />
                  Scrape & Save Opportunity
                </>
              )}
            </button>
          </div>
          
          {lockoutUntil && (
            <div className="text-red-700 font-semibold bg-red-50 p-4 rounded-2xl border-2 border-red-200 inline-flex items-center gap-3 w-fit shadow-md">
              <ExclamationTriangleIcon className="w-8 h-8 text-red-600" />
              <div>
                <p>Gemini free tier limit reached.</p>
                <p className="text-sm font-medium text-red-600">Please wait <span className="font-mono bg-white px-2 py-0.5 rounded border">{countdown}</span> before adding another link.</p>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* --- DATABASE TABLE SECTION --- */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-950">Active Job Pipeline</h2>
        </div>
        
        <div className="overflow-x-auto pb-4">
          <table className="w-full text-left border-collapse min-w-[1400px]">
            <thead>
              <tr className="bg-slate-100/50 border-b border-slate-200">
                {/* ADDED: Empty header for the checkbox column */}
                <th className="p-5 w-12 text-center"></th>
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider">Company & Role</th>
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider">Package</th>
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider">Location</th>
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider">Skills</th>
                {/* FIXED: Changed Timeline to Deadline */}
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider">Deadline</th>
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider">Status</th>
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider">Date Added</th>
                <th className="p-5 text-xs font-bold text-slate-600 uppercase tracking-wider text-center">Action</th>
                <th className="p-5 w-10"></th> 
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 ? (
                <tr>
                    <td colSpan={10} className="text-center p-16 text-slate-500">
                        <AcademicCapIcon className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        No jobs added yet. Paste a career link above to begin.
                    </td>
                </tr>
              ) : jobs.map((job) => {
                const alertProps = getDeadlineAlertProps(job.deadline);
                return (
                  <tr 
                    key={job.id} 
                    className={`transition-colors font-medium text-slate-950 group relative ${alertProps.rowClass}`}
                  >
                    {/* ADDED: Checkbox Column */}
                    <td className="p-5 align-middle text-center">
                      <input 
                        type="checkbox" 
                        checked={job.status === 'Applied'}
                        onChange={() => toggleAppliedStatus(job.id, job.status)}
                        className="w-5 h-5 text-indigo-600 bg-slate-100 border-slate-300 rounded cursor-pointer focus:ring-indigo-500"
                        title="Mark as Applied"
                      />
                    </td>

                    <td className="p-5 align-top">
                        <p className="font-bold text-lg text-slate-950 leading-tight">{job.company_name}</p>
                        <p className="text-slate-700 flex items-center gap-1.5 mt-1">
                            <BriefcaseIcon className="w-4 h-4 text-indigo-400" />
                            {job.role_offered}
                        </p>
                    </td>
                    <td className="p-5 align-top font-mono font-bold text-slate-700 tabular-nums">
                        {job.package}
                    </td>
                    <td className="p-5 align-top">
                        <span className="inline-flex items-center gap-1 text-slate-700">
                            <MapPinIcon className="w-4 h-4 text-rose-400" />
                            {job.location || 'Remote'}
                        </span>
                    </td>
                    <td className="p-5 align-top">
                        <div className="flex flex-wrap gap-1.5 max-w-sm">
                            {job.required_skills && job.required_skills !== "Not specified in the provided text" ? (
                              job.required_skills.split(',').map((skill, index) => (
                                <span key={index} className="bg-indigo-50 text-indigo-800 text-xs px-3 py-1 rounded-full font-semibold border border-indigo-100">
                                    {skill.trim()}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400 text-xs italic">N/A</span>
                            )}
                        </div>
                    </td>
                    <td className="p-5 align-top">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold shadow-inner ${alertProps.badgeClass}`}>
                            <ClockIcon className="w-4 h-4" />
                            {alertProps.text}
                        </div>
                        {job.deadline && <p className="text-xs text-slate-500 mt-2 font-mono">End: {job.deadline}</p>}
                    </td>
                    
                    <td className="p-5 align-top">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${job.status === 'Applied' ? 'bg-indigo-100 text-indigo-800 border border-indigo-200' : 'bg-slate-200 text-slate-700'}`}>
                        {job.status || 'Wishlist'}
                      </span>
                    </td>

                    <td className="p-5 align-top font-mono text-sm text-slate-600">
                      {job.created_at ? new Date(job.created_at).toLocaleDateString() : 'N/A'}
                    </td>

                    <td className="p-5 align-top text-center">
                      {job.apply_link && job.apply_link !== "Not specified in the provided text" ? (
                        <a 
                          href={job.apply_link.startsWith('http') ? job.apply_link : `https://${job.apply_link}`} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="inline-flex items-center gap-1.5 bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-700 transition shadow-md whitespace-nowrap active:scale-95"
                        >
                          <CheckCircleIcon className="w-5 h-5 text-emerald-400" />
                          Apply Now
                        </a>
                      ) : (
                        <span className="text-red-500 text-sm font-bold">Link Broken</span>
                      )}
                    </td>
                    
                    <td className="p-5 align-middle">
                      <button
                        onClick={() => handleDelete(job.id)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        title="Delete Job"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}