'use client';
import { useState, useTransition } from 'react';
import { executeUserPrompt } from '@/app/actions/agent-actions';

export default function CommandInput() {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');

    startTransition(async () => {
      try {
        const data = await executeUserPrompt(prompt);

        if (data.success) {
          setStatus('success');
          setMessage(
            data.actionTaken
              ? `Success: ${data.actionTaken.action} executed!`
              : data.message || 'Command executed.'
          );
          setPrompt('');
        } else {
          setStatus('error');
          setMessage(data.message || 'Failed to execute command.');
        }
      } catch {
        setStatus('error');
        setMessage('Failed to execute command.');
      }
    });
  };

  const loading = status === 'loading' || isPending;

  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white max-w-xl mx-auto mt-8">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="text-sm font-medium text-gray-700">
          Ask ProActiveAI to do something:
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Create a task for IPD demo tomorrow"
            className="flex-1 p-2 border rounded-md outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 disabled:bg-gray-400"
          >
            {loading ? 'Processing...' : 'Run'}
          </button>
        </div>
        {message && (
          <p
            className={`text-xs mt-2 ${
              status === 'success' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {message}
          </p>
        )}
      </form>
    </div>
  );
}
