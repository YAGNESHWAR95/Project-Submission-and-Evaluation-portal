import { useState } from 'react';
import { downloadProjectFile } from '../services/projectService';

export default function AuthenticatedFileDownload({ projectId, purpose, filename, versionNumber, phase, className, children }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      const file = await downloadProjectFile(projectId, purpose, versionNumber, phase);
      const objectUrl = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename || `${purpose}-document`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={handleDownload} disabled={downloading} className={className}>
        {downloading ? 'Downloading...' : children}
      </button>
      {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    </span>
  );
}