import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { LangProvider } from './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <LangProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </LangProvider>
);
