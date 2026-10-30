import { useState } from 'react';
import { uploadProjectFile } from '../services/projectService';

export default function useFileUpload() {
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const uploadFile = async (file, projectId, purpose) => {
    if (!file) return null;
    if (!projectId || !purpose) {
      const invalidRequest = new Error('A project and document purpose are required.');
      setError(invalidRequest.message);
      throw invalidRequest;
    }
    
    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      const response = await uploadProjectFile(projectId, file, purpose, (percent) => {
        setProgress(percent);
      });

      return {
        url: response.url,
        hash: response.hash,
        name: file.name,
      };
    } catch (err) {
      console.error('File direct upload failure:', err);
      setError(err.response?.data?.message || 'Failed to upload file');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    uploadFile,
    progress,
    loading,
    error,
    setProgress,
  };
}
