import React from 'react';

// Simple toaster component - in a real app you'd use a proper toast library
export const Toaster: React.FC = () => {
  return (
    <div id="toaster" className="fixed top-4 right-4 z-50">
      {/* Toast notifications will be rendered here */}
    </div>
  );
};
