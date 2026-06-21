import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
});

export const startSession = (title, mode) => API.post('/api/sessions', { title, mode });
export const searchHistory = (query) => API.post('/api/search', { query });

export const sendAudioChunk = (id, blob) => {
  const form = new FormData();
  form.append('audio', blob, 'chunk.webm');
  return API.post(`/api/sessions/${id}/audio`, form);
};

export const getSession = (id) => API.get(`/api/sessions/${id}`);
export const stopSession = (id) => API.post(`/api/sessions/${id}/stop`);
export const getSummaries = () => API.get('/api/summaries');
export const getSummary = (id) => API.get(`/api/summaries/${id}`);
export const deleteSummary = (id) => API.delete(`/api/summaries/${id}`);
