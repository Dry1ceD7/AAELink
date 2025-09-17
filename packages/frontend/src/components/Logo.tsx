import React from 'react';

interface LogoProps {
  variant?: 'default' | 'text' | 'transparent';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ 
  variant = 'default', 
  size = 'md', 
  className = '' 
}) => {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-16 w-16'
  };

  const textSizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl'
  };

  if (variant === 'text') {
    return (
      <div className={`font-bold text-blue-600 ${textSizeClasses[size]} ${className}`}>
        AAELink
      </div>
    );
  }

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <div className="w-full h-full bg-blue-600 rounded-lg flex items-center justify-center">
        <span className="text-white font-bold text-lg">A</span>
      </div>
    </div>
  );
};

export { Logo };