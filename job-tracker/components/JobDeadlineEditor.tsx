'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase using your existing environment variables
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface JobDeadlineProps {
  jobId: string;
  initialDeadline: string | null;
  onUpdate?: (newDeadline: string | null) => void;
}

export default function JobDeadlineEditor({ jobId, initialDeadline, onUpdate }: JobDeadlineProps) {
  const [isDeadlineActive, setIsDeadlineActive] = useState(initialDeadline !== null);
  const [deadline, setDeadline] = useState(initialDeadline || '');
  const [loading, setLoading] = useState(false);

  const updateDatabase = async (newDeadline: string | null) => {
    setLoading(true);
    
    const { error } = await supabase
      .from('job_applications')
      .update({ deadline: newDeadline })
      .eq('id', jobId);

    setLoading(false);
    
    if (error) {
      console.error('Failed to update deadline:', error.message);
      alert('Failed to update the deadline. Please try again.');
      return;
    }

    // Trigger the fetchJobs() refresh in your page.tsx
    if (onUpdate) {
      onUpdate(newDeadline);
    }
  };

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setIsDeadlineActive(isChecked);
    
    if (!isChecked) {
      // If toggled off, clear the date and save 'null' to the database
      setDeadline('');
      await updateDatabase(null);
    }
  };

  const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    setDeadline(newDate);
    if (newDate) {
      await updateDatabase(newDate);
    }
  };

  return (
    <div className="flex flex-col gap-2 my-2">
      {/* 1. Show toggle ONLY if the scraper found no deadline (null) */}
      {initialDeadline === null && (
        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-500 hover:text-slate-700 transition-colors">
          <input 
            type="checkbox" 
            checked={isDeadlineActive}
            onChange={handleToggle}
            disabled={loading}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
          />
          <span className="font-semibold">Set manual deadline</span>
        </label>
      )}

      {/* 2. Show the date picker if the toggle is ON or if a date already exists */}
      {isDeadlineActive && (
        <input 
          type="date" 
          value={deadline} 
          onChange={handleDateChange}
          disabled={loading}
          className="bg-white text-slate-900 text-xs font-mono border border-slate-300 rounded-lg p-2 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 shadow-sm w-full"
        />
      )}
    </div>
  );
}