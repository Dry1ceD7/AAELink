import React from 'react';

const TestApp: React.FC = () => {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>AAELink Test Page</h1>
      <p>If you can see this, React is working!</p>
      <p>Current time: {new Date().toLocaleString()}</p>
      <div style={{ marginTop: '20px' }}>
        <a href="/login" style={{ color: 'blue', textDecoration: 'underline' }}>
          Go to Login Page
        </a>
      </div>
    </div>
  );
};

export default TestApp;
