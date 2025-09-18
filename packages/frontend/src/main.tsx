import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Simple function to render the app
function renderApp() {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('Root element not found!');
    return;
  }

  try {
    // Clear any existing content
    rootElement.innerHTML = '';

    // Create React root and render
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    console.log('AAELink React app rendered successfully');
  } catch (error) {
    console.error('Error rendering React app:', error);
    rootElement.innerHTML = `
      <div style="padding: 20px; text-align: center; color: red;">
        <h1>Error Loading App</h1>
        <p>There was an error loading the application. Please refresh the page.</p>
        <p>Error: ${error instanceof Error ? error.message : String(error)}</p>
      </div>
    `;
  }
}

// Render the app
renderApp();
