'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

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
  // We use a fake past date as a secret flag to trigger the "Expired" UI automatically
  const EXPIRED_FLAG = '1999-12-31';
  
  const isManuallyExpired = initialDeadline === EXPIRED_FLAG;
  const [loading, setLoading] = useState(false);

  // ONLY show this toggle if the scraper found NO deadline (null) OR if we already checked this box
  if (initialDeadline !== null && initialDeadline !== EXPIRED_FLAG) {
    return null;
  }

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    
    // If checked, send the expired flag date. If unchecked, revert back to null (N/D)
    const newDeadline = isChecked ? EXPIRED_FLAG : null;
    
    setLoading(true);
    const { error } = await supabase
      .from('job_applications')
      .update({ deadline: newDeadline })
      .eq('id', jobId);
    setLoading(false);

    if (error) {
      console.error('Failed to update deadline:', error.message);
      alert('Failed to update. Please try again.');
      return;
    }

    // Refresh the dashboard instantly
    if (onUpdate) {
      onUpdate(newDeadline);
    }
  };

  return (
    <div className="mt-1">
      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-500 hover:text-slate-800 transition-colors">
        <input 
          type="checkbox" 
          checked={isManuallyExpired}
          onChange={handleToggle}
          disabled={loading}
          className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer disabled:opacity-50"
        />
        <span className="font-semibold">
          {isManuallyExpired ? 'Marked as Expired' : 'Mark Deadline Over'}
        </span>
      </label>
    </div>
  );
}